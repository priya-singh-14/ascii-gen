import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js'
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'

export interface ClipFrame {
  bitmap: ImageBitmap
  /** Display duration in milliseconds. */
  delay: number
}

export interface Clip {
  name: string
  kind: 'gif' | 'video' | 'image'
  width: number
  height: number
  frames: ClipFrame[]
  /** Total loop length in milliseconds. */
  duration: number
  /** True when frames were dropped to respect `maxFrames`. */
  truncated: boolean
  sourceFrameCount: number
  dispose(): void
}

export interface LoadOptions {
  maxWidth: number
  maxFrames: number
  /** Video only — resample to this frame rate. */
  targetFps: number
  onProgress?: (fraction: number, label: string) => void
  signal?: AbortSignal
}

export const DEFAULT_LOAD: LoadOptions = {
  maxWidth: 640,
  maxFrames: 300,
  targetFps: 20,
}

export function isGif(file: File): boolean {
  return file.type === 'image/gif' || /\.gif$/i.test(file.name)
}

export function isStillImage(file: File): boolean {
  if (isGif(file)) return false
  return file.type.startsWith('image/') || /\.(png|jpe?g|jfif|webp|avif|bmp|svg)$/i.test(file.name)
}

export async function loadClip(file: File, opts: LoadOptions): Promise<Clip> {
  if (isGif(file)) return loadGif(file, opts)
  if (isStillImage(file)) return loadImage(file, opts)
  return loadVideo(file, opts)
}

function fitWithin(w: number, h: number, maxW: number): [number, number] {
  if (w <= maxW) return [w, h]
  const scale = maxW / w
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))]
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Load cancelled', 'AbortError')
}

async function loadGif(file: File, opts: LoadOptions): Promise<Clip> {
  const buffer = await file.arrayBuffer()
  const gif = parseGIF(buffer)
  const parsed = decompressFrames(gif, true)
  if (parsed.length === 0) throw new Error('That GIF has no frames.')

  const fullW = gif.lsd.width
  const fullH = gif.lsd.height
  const [outW, outH] = fitWithin(fullW, fullH, opts.maxWidth)

  // Composition buffer at native size: GIF frames are patches over the previous
  // frame's pixels, so they must be composited before scaling.
  const stage = document.createElement('canvas')
  stage.width = fullW
  stage.height = fullH
  const stageCtx = stage.getContext('2d', { willReadFrequently: true })!

  const patchCanvas = document.createElement('canvas')
  const patchCtx = patchCanvas.getContext('2d')!

  const scaled = document.createElement('canvas')
  scaled.width = outW
  scaled.height = outH
  const scaledCtx = scaled.getContext('2d')!
  scaledCtx.imageSmoothingEnabled = true
  scaledCtx.imageSmoothingQuality = 'high'

  const step = Math.max(1, Math.ceil(parsed.length / opts.maxFrames))
  const frames: ClipFrame[] = []
  let pending = 0

  for (let i = 0; i < parsed.length; i++) {
    throwIfAborted(opts.signal)
    const frame = parsed[i]
    const previous =
      frame.disposalType === 3 ? stageCtx.getImageData(0, 0, fullW, fullH) : null

    drawPatch(stageCtx, patchCanvas, patchCtx, frame)

    // Renderers conventionally clamp up very short delays; match that.
    const delay = frame.delay > 10 ? frame.delay : 100
    pending += delay

    if (i % step === 0 || i === parsed.length - 1) {
      scaledCtx.clearRect(0, 0, outW, outH)
      scaledCtx.drawImage(stage, 0, 0, outW, outH)
      frames.push({ bitmap: await createImageBitmap(scaled), delay: pending })
      pending = 0
      opts.onProgress?.((i + 1) / parsed.length, 'Decoding GIF')
    }

    if (frame.disposalType === 2) {
      stageCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height)
    } else if (previous) {
      stageCtx.putImageData(previous, 0, 0)
    }
  }

  return {
    name: file.name,
    kind: 'gif',
    width: outW,
    height: outH,
    frames,
    duration: frames.reduce((s, f) => s + f.delay, 0),
    truncated: step > 1,
    sourceFrameCount: parsed.length,
    dispose: () => frames.forEach((f) => f.bitmap.close()),
  }
}

function drawPatch(
  stageCtx: CanvasRenderingContext2D,
  patchCanvas: HTMLCanvasElement,
  patchCtx: CanvasRenderingContext2D,
  frame: ParsedFrame,
): void {
  const { width, height, left, top } = frame.dims
  if (patchCanvas.width !== width || patchCanvas.height !== height) {
    patchCanvas.width = width
    patchCanvas.height = height
  }
  // The cast narrows away SharedArrayBuffer, which ImageData's signature rejects.
  const patch = frame.patch as unknown as ImageDataArray
  patchCtx.putImageData(new ImageData(patch, width, height), 0, 0)
  stageCtx.drawImage(patchCanvas, left, top)
}

/**
 * Decoding goes through an `<img>` rather than `createImageBitmap(file)`
 * because that covers SVG, which the bitmap path rejects in some browsers.
 */
async function loadImage(file: File, opts: LoadOptions): Promise<Clip> {
  const url = URL.createObjectURL(file)
  try {
    opts.onProgress?.(0, 'Decoding image')
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      throw new Error('That image could not be decoded. Try a PNG, JPEG, or WebP.')
    }
    throwIfAborted(opts.signal)

    // An SVG with no intrinsic size reports 0×0; give it a box to raster into.
    const srcW = img.naturalWidth || 1024
    const srcH = img.naturalHeight || Math.round((img.naturalWidth || 1024) * 0.75)
    const [outW, outH] = fitWithin(srcW, srcH, opts.maxWidth)

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, outW, outH)

    const frames: ClipFrame[] = [{ bitmap: await createImageBitmap(canvas), delay: 100 }]
    opts.onProgress?.(1, 'Decoding image')

    return {
      name: file.name,
      kind: 'image',
      width: outW,
      height: outH,
      frames,
      duration: 0,
      truncated: false,
      sourceFrameCount: 1,
      dispose: () => frames.forEach((f) => f.bitmap.close()),
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function loadVideo(file: File, opts: LoadOptions): Promise<Clip> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })

  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No video track found in that file.')
    if (!(await track.canDecode())) {
      throw new Error('This browser cannot decode that video codec. Try an MP4 (H.264) or WebM.')
    }

    const srcW = await track.getDisplayWidth()
    const srcH = await track.getDisplayHeight()
    const [outW, outH] = fitWithin(srcW, srcH, opts.maxWidth)
    const duration = await track.computeDuration()

    const metrics = await track.computeFrameRateMetrics()
    const nativeFps = metrics.bestGuessFrameRate || 30
    const fps = Math.max(1, Math.min(opts.targetFps, nativeFps))

    // A fixed rate keeps export timing trivial and bounds memory.
    const wanted = Math.max(1, Math.floor(duration * fps))
    const count = Math.min(wanted, opts.maxFrames)
    const spacing = duration / count
    const timestamps = Array.from({ length: count }, (_, i) => i * spacing)

    const sink = new CanvasSink(track, { width: outW, height: outH, fit: 'fill' })
    const frames: ClipFrame[] = []
    let i = 0

    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      throwIfAborted(opts.signal)
      if (wrapped) {
        // Must copy before advancing — the sink may reuse the canvas.
        frames.push({ bitmap: await createImageBitmap(wrapped.canvas), delay: spacing * 1000 })
      }
      i++
      opts.onProgress?.(i / count, 'Decoding video')
    }

    if (frames.length === 0) throw new Error('Could not decode any frames from that video.')

    return {
      name: file.name,
      kind: 'video',
      width: outW,
      height: outH,
      frames,
      duration: frames.reduce((s, f) => s + f.delay, 0),
      truncated: count < wanted,
      sourceFrameCount: wanted,
      dispose: () => frames.forEach((f) => f.bitmap.close()),
    }
  } finally {
    input.dispose()
  }
}
