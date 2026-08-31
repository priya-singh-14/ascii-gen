import './styles.css'
import { CHARSETS, charsetById } from './core/charsets'
import { AsciiRenderer, renderText } from './core/render'
import { DEFAULT_LOAD, loadClip, type Clip } from './io/clip'
import { download, exportClip, type ExportFormat } from './io/export'
import { makeDemoClip } from './demo'
import {
  ASPECT_RATIOS,
  DEFAULT_STATE,
  DUOTONE_PRESETS,
  FONT_STACKS,
  loadState,
  saveState,
  toRenderOptions,
  type AppState,
} from './state'
import { ControlPanel, button, rowOf } from './ui/controls'
import { PresetBar } from './ui/presetBar'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const canvas = $<HTMLCanvasElement>('out')
const dropzone = $('dropzone')
const clipInfo = $('clip-info')
const statusText = $('status-text')
const progress = $('progress')
const progressBar = $('progress-bar')
const scrub = $<HTMLInputElement>('scrub')
const frameCounter = $('frame-counter')
const playPause = $<HTMLButtonElement>('playpause')
const transport = $('transport')
const fileInput = $<HTMLInputElement>('file')

const state: AppState = loadState()
const renderer = new AsciiRenderer()

let clip: Clip | null = null
let frameIndex = 0
let elapsedInFrame = 0
let playing = true
let dirty = true
let busy = false
let abort: AbortController | null = null

function setStatus(text: string, fraction?: number): void {
  statusText.textContent = text
  if (fraction === undefined) {
    progress.classList.remove('active')
  } else {
    progress.classList.add('active')
    progressBar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`
  }
}

function setBusy(value: boolean): void {
  busy = value
  document.body.classList.toggle('busy', value)
}

function draw(): void {
  if (!clip) return
  const frame = clip.frames[frameIndex]
  if (!frame) return

  const opts = toRenderOptions(state)
  renderer.render(frame.bitmap, clip.width, clip.height, canvas, opts)

  frameCounter.textContent = `${frameIndex + 1} / ${clip.frames.length}`
  scrub.value = String(frameIndex)
  dirty = false
}

function tick(now: number): void {
  requestAnimationFrame(tick)
  const dt = now - lastTime
  lastTime = now

  if (clip && playing && clip.frames.length > 1) {
    elapsedInFrame += dt * state.speed
    let guard = 0
    while (elapsedInFrame >= Math.max(1, clip.frames[frameIndex].delay) && guard++ < 1000) {
      elapsedInFrame -= Math.max(1, clip.frames[frameIndex].delay)
      frameIndex = (frameIndex + 1) % clip.frames.length
      dirty = true
    }
  }

  if (dirty) draw()
}

let lastTime = performance.now()
requestAnimationFrame(tick)

async function useClip(next: Clip): Promise<void> {
  clip?.dispose()
  clip = next
  frameIndex = 0
  elapsedInFrame = 0
  dirty = true

  scrub.max = String(Math.max(0, next.frames.length - 1))
  scrub.value = '0'
  dropzone.classList.add('hidden')

  const still = next.frames.length === 1
  transport.classList.toggle('still', still)
  playing = !still
  playPause.textContent = playing ? 'Pause' : 'Play'
  pngButton.classList.toggle('primary', still)
  gifButton.classList.toggle('primary', !still)

  const seconds = (next.duration / 1000).toFixed(1)
  clipInfo.textContent = still
    ? `${next.name} — ${next.width}×${next.height}`
    : `${next.name} — ${next.width}×${next.height}, ${next.frames.length} frames, ${seconds}s`
  setStatus(
    next.truncated
      ? `Loaded (sampled ${next.frames.length} of ~${next.sourceFrameCount} frames — raise "Max frames" for more)`
      : 'Loaded',
  )
  updateAspectNote()
  draw()
}

async function openFile(file: File): Promise<void> {
  if (busy) return
  setBusy(true)
  abort = new AbortController()
  try {
    setStatus('Reading file…', 0)
    const next = await loadClip(file, {
      ...DEFAULT_LOAD,
      maxWidth: state.maxWidth,
      maxFrames: state.maxFrames,
      targetFps: state.targetFps,
      signal: abort.signal,
      onProgress: (f, label) => setStatus(`${label}… ${Math.round(f * 100)}%`, f),
    })
    await useClip(next)
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      setStatus('Cancelled')
    } else {
      console.error(err)
      setStatus(`Error: ${(err as Error).message ?? err}`)
    }
  } finally {
    setBusy(false)
    abort = null
  }
}

async function runExport(format: ExportFormat): Promise<void> {
  if (!clip || busy) return
  setBusy(true)
  abort = new AbortController()
  const started = performance.now()

  try {
    const result = await exportClip(clip, renderer, toRenderOptions(state), {
      format,
      scale: state.exportScale,
      maxColors: state.maxColors,
      quality: state.quality,
      frameStep: state.frameStep,
      frameIndex,
      signal: abort.signal,
      onProgress: (f, label) => setStatus(label, f),
    })
    download(result)
    const size = (result.blob.size / 1024 / 1024).toFixed(2)
    const secs = ((performance.now() - started) / 1000).toFixed(1)
    const count = result.frames === 1 ? '1 frame' : `${result.frames} frames`
    setStatus(
      `${result.filename} — ${result.width}×${result.height}, ${count}, ${size} MB in ${secs}s`,
    )
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      setStatus('Export cancelled')
    } else {
      console.error(err)
      setStatus(`Export failed: ${(err as Error).message ?? err}`)
    }
  } finally {
    setBusy(false)
    abort = null
    dirty = true
  }
}

let previousCharsetId = state.charsetId
let duotoneGroup: HTMLDetailsElement | null = null

let aspectFillRow: HTMLElement | null = null
const aspectNote = document.createElement('p')
aspectNote.className = 'row row-note'

function updateAspectNote(): void {
  if (!clip) {
    aspectNote.textContent = ''
    return
  }
  const opts = toRenderOptions(state)
  const m = renderer.metrics(
    { ...opts, fontSize: opts.fontSize * state.exportScale },
    clip.width,
    clip.height,
  )
  aspectNote.textContent = `${m.width}×${m.height} px · ${m.cols}×${m.rows} chars`
}

function onStateChange(): void {
  // Seed the custom field from the named ramp, so editing starts from what's on screen.
  if (state.charsetId !== previousCharsetId) {
    if (state.charsetId !== 'custom') state.customRamp = charsetById(state.charsetId).ramp
    previousCharsetId = state.charsetId
    panel.syncAll()
  }
  if (duotoneGroup) duotoneGroup.hidden = state.colorMode === 'mono'
  if (aspectFillRow) aspectFillRow.hidden = state.aspectId === 'source'
  updateAspectNote()
  saveState(state)
  dirty = true
}

const panel = new ControlPanel(state, onStateChange)
const pct = (v: number) => `${Math.round(v * 100)}%`
const num = (d: number) => (v: number) => v.toFixed(d)

const presetBar = new PresetBar(state, {
  onApply: () => {
    previousCharsetId = state.charsetId
    panel.syncAll()
    if (duotoneGroup) duotoneGroup.hidden = state.colorMode === 'mono'
    updateAspectNote()
    saveState(state)
    dirty = true
  },
  onStatus: (message) => setStatus(message),
})

panel.group('Presets')
panel.custom(presetBar.pickerEl)

panel.group('Source')
panel.custom(
  rowOf(
    button('Open file…', () => fileInput.click(), 'primary'),
    button('Demo clip', () => loadDemo()),
  ),
)
panel.range('maxWidth', 'Decode width', { min: 160, max: 1280, step: 32, format: (v) => `${v}px` })
panel.range('maxFrames', 'Max frames', { min: 12, max: 900, step: 1 })
panel.range('targetFps', 'Sample rate (video)', { min: 4, max: 60, step: 1, format: (v) => `${v} fps` })
panel.custom(
  rowOf(button('Reload with these settings', () => reloadCurrent())),
)

panel.group('Characters')
panel.select(
  'charsetId',
  'Ramp',
  CHARSETS.map((c) => ({ value: c.id, label: c.name })),
)
panel.text('customRamp', 'Custom ramp', 'dark → light')
panel.check('invertRamp', 'Reverse ramp')
panel.select(
  'fontFamily',
  'Font',
  Object.entries(FONT_STACKS).map(([label, value]) => ({ value, label })),
)
panel.select('fontWeight', 'Weight', [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '700', label: 'Bold' },
])

panel.group('Detail')
panel.range('cols', 'Columns', { min: 20, max: 500, step: 1, format: (v) => `${v} chars` })
panel.range('cellAspect', 'Cell aspect', { min: 0.6, max: 3, step: 0.05, format: num(2) })
panel.range('letterSpacing', 'Tracking', { min: -0.3, max: 1, step: 0.02, format: pct })
panel.range('fontSize', 'Glyph size', { min: 4, max: 48, step: 1, format: (v) => `${v}px` })
panel.range('dither', 'Dither', { min: 0, max: 1.5, step: 0.05, format: pct })

panel.group('Tone')
panel.range('brightness', 'Brightness', { min: -0.5, max: 0.5, step: 0.01, format: num(2) })
panel.range('contrast', 'Contrast', { min: 0, max: 3, step: 0.05, format: num(2) })
panel.range('gamma', 'Gamma', { min: 0.2, max: 3, step: 0.05, format: num(2) })
panel.check('invertImage', 'Invert image')

panel.group('Colour')
panel.select('colorMode', 'Mode', [
  { value: 'duotone', label: 'Duotone' },
  { value: 'mono', label: 'Mono' },
  { value: 'source', label: 'Source colour' },
])
panel.color('fg', 'Text (mono)')
panel.color('bg', 'Background')
panel.check('transparentBg', 'Transparent background')

panel.group('Duotone')
duotoneGroup = panel.lastGroup
panel.custom(presetSwatches())
panel.color('duoShadow', 'Shadow')
panel.color('duoHighlight', 'Highlight')
panel.range('duoBias', 'Bias', { min: 0.3, max: 3, step: 0.05, format: num(2) })
panel.range('duoBlend', 'Tint source colour', { min: 0, max: 1, step: 0.02, format: pct })
panel.custom(
  rowOf(
    button('Swap', () => {
      const s = state.duoShadow
      state.duoShadow = state.duoHighlight
      state.duoHighlight = s
      panel.syncAll()
      onStateChange()
    }),
  ),
)

panel.group('Playback')
panel.range('speed', 'Speed', { min: 0.1, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)}×` })

panel.group('Export')
panel.select(
  'aspectId',
  'Aspect ratio',
  ASPECT_RATIOS.map((a) => ({ value: a.id, label: a.label })),
)
panel.select('aspectFill', 'Fit', [
  { value: 'crop', label: 'Crop to fill' },
  { value: 'pad', label: 'Pad with background' },
])
aspectFillRow = panel.lastRow
panel.custom(aspectNote)
panel.range('exportScale', 'Output scale', { min: 0.5, max: 4, step: 0.25, format: (v) => `${v}×` })
panel.range('frameStep', 'Keep every Nth frame', { min: 1, max: 6, step: 1 })
panel.range('maxColors', 'GIF colours', { min: 8, max: 256, step: 8 })
panel.range('quality', 'Video quality', { min: 0.1, max: 1, step: 0.05, format: pct })
const pngButton = button('PNG', () => runExport('png'))
const gifButton = button('GIF', () => runExport('gif'), 'primary')
panel.custom(
  rowOf(
    pngButton,
    gifButton,
    button('MP4', () => runExport('mp4')),
    button('WebM', () => runExport('webm')),
  ),
)
panel.custom(presetBar.actionsEl)
panel.custom(
  rowOf(
    button('Cancel', () => abort?.abort(), 'cancel'),
    button('Reset settings', () => {
      Object.assign(state, DEFAULT_STATE)
      previousCharsetId = state.charsetId
      panel.syncAll()
      onStateChange()
    }),
  ),
)

$('controls').append(panel.el)
if (duotoneGroup) duotoneGroup.hidden = state.colorMode === 'mono'
if (aspectFillRow) aspectFillRow.hidden = state.aspectId === 'source'

function presetSwatches(): HTMLElement {
  const grid = document.createElement('div')
  grid.className = 'swatches'
  for (const preset of DUOTONE_PRESETS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'swatch'
    b.title = preset.name
    b.style.background = `linear-gradient(135deg, ${preset.shadow}, ${preset.highlight})`
    b.innerHTML = `<span>${preset.name}</span>`
    b.addEventListener('click', () => {
      state.duoShadow = preset.shadow
      state.duoHighlight = preset.highlight
      state.bg = preset.bg
      state.colorMode = 'duotone'
      panel.syncAll()
      onStateChange()
    })
    grid.append(b)
  }
  return grid
}

/* Typing a ramp by hand selects the custom ramp. */
panel.el.addEventListener('input', (e) => {
  const target = e.target as HTMLElement
  if (target.classList?.contains('ramp-input') && state.charsetId !== 'custom') {
    state.charsetId = 'custom'
    previousCharsetId = 'custom'
    panel.syncAll()
    dirty = true
  }
})

let lastFile: File | null = null

async function reloadCurrent(): Promise<void> {
  if (lastFile) await openFile(lastFile)
  else await loadDemo()
}

async function loadDemo(): Promise<void> {
  if (busy) return
  setBusy(true)
  try {
    setStatus('Loading demo clip…')
    lastFile = null
    await useClip(await makeDemoClip())
  } catch (err) {
    console.error(err)
    setStatus(`Could not load the demo clip: ${(err as Error).message ?? err}`)
  } finally {
    setBusy(false)
  }
}

$('pick').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) {
    lastFile = file
    void openFile(file)
  }
  fileInput.value = ''
})

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (e) => {
    e.preventDefault()
    dropzone.classList.add('over')
  })
}
for (const type of ['dragleave', 'drop']) {
  document.addEventListener(type, (e) => {
    e.preventDefault()
    if (type === 'drop' || (e as DragEvent).relatedTarget === null) {
      dropzone.classList.remove('over')
    }
  })
}
document.addEventListener('drop', (e) => {
  const file = (e as DragEvent).dataTransfer?.files?.[0]
  if (file) {
    lastFile = file
    dropzone.classList.remove('hidden')
    void openFile(file)
  }
})

playPause.addEventListener('click', () => {
  playing = !playing
  playPause.textContent = playing ? 'Pause' : 'Play'
})

scrub.addEventListener('input', () => {
  frameIndex = Number(scrub.value)
  elapsedInFrame = 0
  playing = false
  playPause.textContent = 'Play'
  dirty = true
})

$('copy-text').addEventListener('click', async () => {
  if (!clip) return
  const text = renderText(
    renderer,
    clip.frames[frameIndex].bitmap,
    clip.width,
    clip.height,
    toRenderOptions(state),
  )
  try {
    await navigator.clipboard.writeText(text)
    setStatus(`Copied frame ${frameIndex + 1} (${text.split('\n')[0].length} cols)`)
  } catch {
    setStatus('Clipboard blocked by the browser')
  }
})

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return
  if (e.code === 'Space') {
    e.preventDefault()
    playPause.click()
  } else if (e.code === 'ArrowRight' && clip) {
    frameIndex = (frameIndex + 1) % clip.frames.length
    dirty = true
  } else if (e.code === 'ArrowLeft' && clip) {
    frameIndex = (frameIndex - 1 + clip.frames.length) % clip.frames.length
    dirty = true
  }
})

void loadDemo()
