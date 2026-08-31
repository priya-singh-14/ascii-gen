import { duotoneRamp, parseHex, toHex } from './color'

export type ColorMode = 'mono' | 'duotone' | 'source'
export type AspectFill = 'crop' | 'pad'

export interface RenderOptions {
  cols: number
  /** Already resolved: custom text and inversion applied. */
  ramp: string
  /** Cell height / cell width. */
  cellAspect: number
  fontSize: number
  fontFamily: string
  fontWeight: string
  /** Extra tracking between cells as a fraction of cell width. */
  letterSpacing: number
  /** Forced output width/height. 0 keeps the source's own ratio. */
  aspect: number
  aspectFill: AspectFill

  brightness: number // -1 .. 1
  contrast: number // 0 .. 3
  gamma: number // 0.2 .. 3
  invertImage: boolean
  /** 0 = hard quantisation, 1 = full ordered dither. */
  dither: number

  colorMode: ColorMode
  fg: string
  bg: string
  transparentBg: boolean
  duoShadow: string
  duoHighlight: string
  duoBias: number
  /** In source-colour mode, how far each cell is pushed toward the duotone ramp. */
  duoBlend: number
}

export interface GridMetrics {
  cols: number
  rows: number
  cellW: number
  cellH: number
  width: number
  height: number
}

/** Where the source frame lands on the grid. */
export interface Placement {
  /** Source rect, in source pixels. */
  sx: number
  sy: number
  sw: number
  sh: number
  /** Destination rect, in grid cells. Cells outside it stay empty. */
  dx: number
  dy: number
  dw: number
  dh: number
}

/**
 * Crops the source pixels rather than the rendered output, so the full column
 * budget is spent on what stays in shot.
 */
export function placeSource(
  m: GridMetrics,
  srcW: number,
  srcH: number,
  opts: RenderOptions,
): Placement {
  const full: Placement = { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: m.cols, dh: m.rows }
  if (opts.aspect <= 0) return full

  // Measure against the grid's real pixel aspect: rows are rounded to whole
  // cells, so the grid only approximates the requested ratio.
  const target = m.width / m.height
  const source = srcW / srcH
  if (Math.abs(target - source) < 1e-3) return full

  if (opts.aspectFill === 'crop') {
    if (source > target) {
      const sw = srcH * target
      return { ...full, sx: (srcW - sw) / 2, sw }
    }
    const sh = srcW / target
    return { ...full, sy: (srcH - sh) / 2, sh }
  }

  const scale = Math.min(m.width / srcW, m.height / srcH)
  const dw = Math.max(1, Math.min(m.cols, Math.round((srcW * scale) / m.cellW)))
  const dh = Math.max(1, Math.min(m.rows, Math.round((srcH * scale) / m.cellH)))
  return { ...full, dx: Math.floor((m.cols - dw) / 2), dy: Math.floor((m.rows - dh) / 2), dw, dh }
}

/** 8x8 ordered (Bayer) matrix, normalised to -0.5..0.5. */
const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((v) => (v + 0.5) / 64 - 0.5)

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  return c
}

/**
 * Renders a frame as ASCII onto a canvas.
 *
 * The hot path avoids per-cell `fillText`: in mono and duotone modes a cell's
 * colour is a pure function of its ramp index, so the `ramp.length` distinct
 * glyph bitmaps are pre-rendered into an atlas once and blitted with
 * `drawImage` — roughly an order of magnitude faster at 80k cells.
 */
export class AsciiRenderer {
  private sampler = createCanvas(1, 1)
  private samplerCtx = this.sampler.getContext('2d', { willReadFrequently: true })!
  private measurer = createCanvas(1, 1).getContext('2d')!

  private atlas: HTMLCanvasElement | null = null
  private atlasKey = ''
  private atlasColors: string[] = []

  /** Glyph tiles for source-colour mode, keyed by char + quantised RGB. */
  private tileCache = new Map<string, HTMLCanvasElement>()
  private tileCacheKey = ''

  metrics(opts: RenderOptions, srcW: number, srcH: number): GridMetrics {
    this.measurer.font = `${opts.fontWeight} ${opts.fontSize}px ${opts.fontFamily}`
    const advance = this.measurer.measureText('M').width || opts.fontSize * 0.6

    const cellW = Math.max(1, Math.round(advance * (1 + opts.letterSpacing)))
    const cellH = Math.max(1, Math.round(cellW * opts.cellAspect))

    const cols = Math.max(1, Math.round(opts.cols))
    const aspect = opts.aspect > 0 ? opts.aspect : srcW / srcH
    const rows = Math.max(1, Math.round((cols * cellW) / (aspect * cellH)))

    return { cols, rows, cellW, cellH, width: cols * cellW, height: rows * cellH }
  }

  render(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    out: HTMLCanvasElement,
    opts: RenderOptions,
  ): GridMetrics {
    const m = this.metrics(opts, srcW, srcH)

    // Downsample the frame so one pixel == one character cell.
    if (this.sampler.width !== m.cols || this.sampler.height !== m.rows) {
      this.sampler.width = m.cols
      this.sampler.height = m.rows
    }
    const place = placeSource(m, srcW, srcH, opts)
    this.samplerCtx.clearRect(0, 0, m.cols, m.rows)
    this.samplerCtx.imageSmoothingEnabled = true
    this.samplerCtx.imageSmoothingQuality = 'high'
    this.samplerCtx.drawImage(
      source,
      place.sx,
      place.sy,
      place.sw,
      place.sh,
      place.dx,
      place.dy,
      place.dw,
      place.dh,
    )
    const px = this.samplerCtx.getImageData(0, 0, m.cols, m.rows).data

    if (out.width !== m.width || out.height !== m.height) {
      out.width = m.width
      out.height = m.height
    }
    const ctx = out.getContext('2d')!
    ctx.clearRect(0, 0, m.width, m.height)
    if (!opts.transparentBg) {
      ctx.fillStyle = opts.bg
      ctx.fillRect(0, 0, m.width, m.height)
    }

    const ramp = opts.ramp
    const n = ramp.length
    const maxIdx = n - 1
    const atlas = this.ensureAtlas(opts, m)
    const dither = opts.dither
    // Spread the dither over one ramp step: fills quantisation gaps without
    // washing out the image.
    const ditherAmp = maxIdx > 0 ? dither / maxIdx : 0

    // Only the cells the frame landed on, so pad bars stay pure background
    // instead of picking up the ramp's dark end.
    const yEnd = place.dy + place.dh
    const xEnd = place.dx + place.dw
    for (let y = place.dy; y < yEnd; y++) {
      const bayerRow = (y & 7) << 3
      for (let x = place.dx; x < xEnd; x++) {
        const p = (y * m.cols + x) << 2
        const a = px[p + 3] / 255

        // Rec.709 luma, faded toward black where the source is transparent.
        let l = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255
        l *= a

        l = tone(l, opts)
        if (dither > 0) l += BAYER_8[bayerRow + (x & 7)] * ditherAmp

        let idx = Math.round(l * maxIdx)
        idx = idx < 0 ? 0 : idx > maxIdx ? maxIdx : idx

        const ch = ramp[idx]
        if (ch === ' ' || ch === undefined) continue

        const dx = x * m.cellW
        const dy = y * m.cellH

        if (opts.colorMode === 'source') {
          const tile = this.sourceTile(ch, px[p], px[p + 1], px[p + 2], idx, opts, m)
          ctx.drawImage(tile, dx, dy)
        } else {
          ctx.drawImage(atlas, idx * m.cellW, 0, m.cellW, m.cellH, dx, dy, m.cellW, m.cellH)
        }
      }
    }

    return m
  }

  /**
   * The colour assigned to each ramp index. Source-colour mode still resolves
   * the duotone ramp, because that is what `duoBlend` tints each cell toward.
   */
  rampColors(opts: RenderOptions): string[] {
    const n = opts.ramp.length
    if (opts.colorMode === 'mono') return new Array(n).fill(opts.fg)
    return duotoneRamp(opts.duoShadow, opts.duoHighlight, n, opts.duoBias)
  }

  private ensureAtlas(opts: RenderOptions, m: GridMetrics): HTMLCanvasElement {
    const colors = this.rampColors(opts)
    const key = [
      opts.ramp,
      m.cellW,
      m.cellH,
      opts.fontSize,
      opts.fontFamily,
      opts.fontWeight,
      opts.colorMode,
      colors.join(','),
    ].join('|')

    if (this.atlas && this.atlasKey === key) return this.atlas

    const n = opts.ramp.length
    const canvas = createCanvas(n * m.cellW, m.cellH)
    const ctx = canvas.getContext('2d')!
    for (let i = 0; i < n; i++) {
      this.drawGlyph(ctx, opts.ramp[i], i * m.cellW, colors[i], opts, m)
    }

    this.atlas = canvas
    this.atlasKey = key
    this.atlasColors = colors
    return canvas
  }

  private sourceTile(
    ch: string,
    r: number,
    g: number,
    b: number,
    idx: number,
    opts: RenderOptions,
    m: GridMetrics,
  ): HTMLCanvasElement {
    // Quantise to 4 bits per channel to bound the cache; still far more colour
    // resolution than a character grid can express.
    const qr = r & 0xf0
    const qg = g & 0xf0
    const qb = b & 0xf0

    let hex = toHex({ r: qr, g: qg, b: qb })
    if (opts.duoBlend > 0) {
      const target = parseHex(this.atlasColors[idx] ?? opts.fg)
      const t = opts.duoBlend
      hex = toHex({
        r: qr + (target.r - qr) * t,
        g: qg + (target.g - qg) * t,
        b: qb + (target.b - qb) * t,
      })
    }

    // Anything that changes a tile's pixels must be in the key, including the
    // duotone settings the tint above depends on.
    const cacheKey = [
      opts.fontFamily,
      opts.fontWeight,
      opts.fontSize,
      m.cellW,
      m.cellH,
      opts.duoBlend,
      opts.duoShadow,
      opts.duoHighlight,
      opts.duoBias,
    ].join('|')
    if (this.tileCacheKey !== cacheKey) {
      this.tileCache.clear()
      this.tileCacheKey = cacheKey
    }

    const key = ch + hex
    let tile = this.tileCache.get(key)
    if (!tile) {
      if (this.tileCache.size > 6000) this.tileCache.clear()
      tile = createCanvas(m.cellW, m.cellH)
      this.drawGlyph(tile.getContext('2d')!, ch, 0, hex, opts, m)
      this.tileCache.set(key, tile)
    }
    return tile
  }

  private drawGlyph(
    ctx: CanvasRenderingContext2D,
    ch: string,
    xOffset: number,
    color: string,
    opts: RenderOptions,
    m: GridMetrics,
  ): void {
    // Drawn at natural size and squashed to the cell box, so a tall cellAspect
    // stretches the character rather than clipping it.
    const naturalH = opts.fontSize * 1.25
    const scaleY = m.cellH / naturalH

    ctx.save()
    ctx.translate(xOffset, 0)
    ctx.scale(1, scaleY)
    ctx.font = `${opts.fontWeight} ${opts.fontSize}px ${opts.fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(ch, m.cellW / 2, naturalH / 2)
    ctx.restore()
  }
}

/** brightness -> contrast -> gamma -> invert, all in 0..1 luma space. */
function tone(l: number, opts: RenderOptions): number {
  let v = l + opts.brightness
  v = (v - 0.5) * opts.contrast + 0.5
  v = v < 0 ? 0 : v > 1 ? 1 : v
  if (opts.gamma !== 1) v = Math.pow(v, 1 / opts.gamma)
  return opts.invertImage ? 1 - v : v
}

/** Plain-text version of a frame, for copy/paste. */
export function renderText(
  renderer: AsciiRenderer,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: RenderOptions,
): string {
  const m = renderer.metrics(opts, srcW, srcH)
  const place = placeSource(m, srcW, srcH, opts)
  const sampler = createCanvas(m.cols, m.rows)
  const sctx = sampler.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingEnabled = true
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(
    source,
    place.sx,
    place.sy,
    place.sw,
    place.sh,
    place.dx,
    place.dy,
    place.dw,
    place.dh,
  )
  const px = sctx.getImageData(0, 0, m.cols, m.rows).data

  const maxIdx = opts.ramp.length - 1
  const ditherAmp = maxIdx > 0 ? opts.dither / maxIdx : 0
  const lines: string[] = []

  for (let y = 0; y < m.rows; y++) {
    let line = ''
    for (let x = 0; x < m.cols; x++) {
      const inside =
        y >= place.dy && y < place.dy + place.dh && x >= place.dx && x < place.dx + place.dw
      if (!inside) {
        line += ' '
        continue
      }
      const p = (y * m.cols + x) << 2
      let l = ((0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255) * (px[p + 3] / 255)
      l = tone(l, opts)
      if (opts.dither > 0) l += BAYER_8[((y & 7) << 3) + (x & 7)] * ditherAmp
      const idx = Math.max(0, Math.min(maxIdx, Math.round(l * maxIdx)))
      line += opts.ramp[idx]
    }
    lines.push(line)
  }
  return lines.join('\n')
}
