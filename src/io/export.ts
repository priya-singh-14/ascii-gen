import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeVideo,
} from 'mediabunny'
import { AsciiRenderer, type RenderOptions } from '../core/render'
import type { Clip } from './clip'

export type ExportFormat = 'png' | 'gif' | 'mp4' | 'webm'

export interface ExportOptions {
  format: ExportFormat
  /** Multiplies font size, so the output is larger without changing the grid. */
  scale: number
  /** GIF only. */
  maxColors: number
  /** Video only, 0..1. */
  quality: number
  /** Keep every Nth frame. 1 = keep all. */
  frameStep: number
  /** PNG only — which frame to write. */
  frameIndex?: number
  onProgress?: (fraction: number, label: string) => void
  signal?: AbortSignal
}

export interface ExportResult {
  blob: Blob
  filename: string
  width: number
  height: number
  frames: number
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'ascii'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
}

/** Give the event loop a turn so progress UI can paint during a long encode. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface Sequence {
  indices: number[]
  delays: number[]
}

function sequence(clip: Clip, step: number): Sequence {
  const indices: number[] = []
  const delays: number[] = []
  for (let i = 0; i < clip.frames.length; i += step) {
    indices.push(i)
    // Roll up the delays of the skipped frames so playback speed holds.
    let delay = 0
    for (let j = i; j < Math.min(i + step, clip.frames.length); j++) {
      delay += clip.frames[j].delay
    }
    delays.push(Math.max(20, Math.round(delay)))
  }
  return { indices, delays }
}

export async function exportClip(
  clip: Clip,
  renderer: AsciiRenderer,
  options: RenderOptions,
  exp: ExportOptions,
): Promise<ExportResult> {
  const scaled: RenderOptions = { ...options, fontSize: options.fontSize * exp.scale }
  if (exp.format === 'png') return exportPng(clip, renderer, scaled, exp)
  if (exp.format === 'gif') return exportGif(clip, renderer, scaled, exp)
  return exportVideo(clip, renderer, scaled, exp)
}

async function exportPng(
  clip: Clip,
  renderer: AsciiRenderer,
  options: RenderOptions,
  exp: ExportOptions,
): Promise<ExportResult> {
  const index = Math.min(Math.max(0, exp.frameIndex ?? 0), clip.frames.length - 1)
  const work = document.createElement('canvas')
  exp.onProgress?.(0, 'Rendering PNG')
  const m = renderer.render(clip.frames[index].bitmap, clip.width, clip.height, work, options)

  const blob = await new Promise<Blob | null>((resolve) => work.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode PNG.')
  throwIfAborted(exp.signal)

  const suffix = clip.frames.length > 1 ? `-${String(index + 1).padStart(3, '0')}` : ''
  return {
    blob,
    filename: `${baseName(clip.name)}-ascii${suffix}.png`,
    width: m.width,
    height: m.height,
    frames: 1,
  }
}

async function exportGif(
  clip: Clip,
  renderer: AsciiRenderer,
  options: RenderOptions,
  exp: ExportOptions,
): Promise<ExportResult> {
  const { indices, delays } = sequence(clip, exp.frameStep)
  const work = document.createElement('canvas')

  const format = options.transparentBg ? 'rgba4444' : 'rgb565'
  const gif = GIFEncoder()

  // ASCII output has a tiny colour range (background, ramp, and the glyph
  // antialiasing between them), so one shared palette is both accurate and
  // much smaller than per-frame tables.
  const palette = await buildPalette(clip, renderer, options, indices, exp)
  const transparentIndex = options.transparentBg
    ? palette.findIndex((c) => c.length === 4 && c[3] === 0)
    : -1

  let width = 0
  let height = 0

  for (let n = 0; n < indices.length; n++) {
    throwIfAborted(exp.signal)
    const frame = clip.frames[indices[n]]
    const m = renderer.render(frame.bitmap, clip.width, clip.height, work, options)
    width = m.width
    height = m.height

    const ctx = work.getContext('2d', { willReadFrequently: true })!
    const data = ctx.getImageData(0, 0, m.width, m.height).data
    const indexed = applyPalette(data, palette, format)

    gif.writeFrame(indexed, m.width, m.height, {
      // The first frame's palette becomes the global colour table.
      palette: n === 0 ? palette : undefined,
      delay: delays[n],
      repeat: 0,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: transparentIndex >= 0 ? 2 : -1,
    })

    exp.onProgress?.((n + 1) / indices.length, `Encoding GIF ${n + 1}/${indices.length}`)
    if (n % 4 === 0) await breathe()
  }

  gif.finish()
  const bytes = gif.bytes()
  return {
    blob: new Blob([bytes as BlobPart], { type: 'image/gif' }),
    filename: `${baseName(clip.name)}-ascii.gif`,
    width,
    height,
    frames: indices.length,
  }
}

async function buildPalette(
  clip: Clip,
  renderer: AsciiRenderer,
  options: RenderOptions,
  indices: number[],
  exp: ExportOptions,
): Promise<number[][]> {
  // Sample frames spread across the clip so the palette covers colours that
  // only appear later.
  const probeCount = Math.min(6, indices.length)
  const work = document.createElement('canvas')
  const chunks: Uint8ClampedArray[] = []

  for (let i = 0; i < probeCount; i++) {
    throwIfAborted(exp.signal)
    const idx = indices[Math.floor((i * indices.length) / probeCount)]
    const m = renderer.render(clip.frames[idx].bitmap, clip.width, clip.height, work, options)
    const ctx = work.getContext('2d', { willReadFrequently: true })!
    chunks.push(ctx.getImageData(0, 0, m.width, m.height).data)
    exp.onProgress?.(i / probeCount, 'Building palette')
  }

  // Subsample to keep quantisation fast on large frames.
  const stride = Math.max(1, Math.floor(chunks[0].length / 4 / 40000))
  const total = chunks.reduce((s, c) => s + Math.ceil(c.length / 4 / stride), 0)
  const merged = new Uint8ClampedArray(total * 4)
  let w = 0
  for (const chunk of chunks) {
    for (let p = 0; p < chunk.length; p += 4 * stride) {
      merged[w++] = chunk[p]
      merged[w++] = chunk[p + 1]
      merged[w++] = chunk[p + 2]
      merged[w++] = chunk[p + 3]
    }
  }

  return quantize(merged.subarray(0, w), exp.maxColors, {
    format: options.transparentBg ? 'rgba4444' : 'rgb565',
    oneBitAlpha: options.transparentBg,
  })
}

async function exportVideo(
  clip: Clip,
  renderer: AsciiRenderer,
  options: RenderOptions,
  exp: ExportOptions,
): Promise<ExportResult> {
  const { indices, delays } = sequence(clip, exp.frameStep)
  const isMp4 = exp.format === 'mp4'
  const codec = isMp4 ? 'avc' : 'vp9'

  const m = renderer.metrics(options, clip.width, clip.height)
  // H.264 requires even dimensions, and VP9 is happier with them too.
  const width = m.width + (m.width % 2)
  const height = m.height + (m.height % 2)

  if (!(await canEncodeVideo(codec, { width, height }))) {
    throw new Error(
      isMp4
        ? 'This browser cannot encode H.264. Try WebM or GIF instead.'
        : 'This browser cannot encode VP9. Try MP4 or GIF instead.',
    )
  }

  const work = document.createElement('canvas')
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const outCtx = out.getContext('2d')!

  const target = new BufferTarget()
  const output = new Output({
    format: isMp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target,
  })

  const source = new CanvasSource(out, {
    codec,
    quality: new Quality(exp.quality),
    keyFrameInterval: 2,
  })
  output.addVideoTrack(source)
  await output.start()

  let t = 0
  for (let n = 0; n < indices.length; n++) {
    throwIfAborted(exp.signal)
    renderer.render(clip.frames[indices[n]].bitmap, clip.width, clip.height, work, options)

    // No alpha channel in video, so the background is always painted.
    outCtx.fillStyle = options.transparentBg ? '#000000' : options.bg
    outCtx.fillRect(0, 0, width, height)
    outCtx.drawImage(work, 0, 0)

    const seconds = delays[n] / 1000
    await source.add(t, seconds)
    t += seconds

    exp.onProgress?.(
      (n + 1) / indices.length,
      `Encoding ${isMp4 ? 'MP4' : 'WebM'} ${n + 1}/${indices.length}`,
    )
  }

  source.close()
  await output.finalize()

  const buffer = target.buffer
  if (!buffer) throw new Error('Encoder produced no output.')

  return {
    blob: new Blob([buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' }),
    filename: `${baseName(clip.name)}-ascii.${isMp4 ? 'mp4' : 'webm'}`,
    width,
    height,
    frames: indices.length,
  }
}

export function download(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
