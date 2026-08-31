import { resolveRamp } from './core/charsets'
import type { AspectFill, ColorMode, RenderOptions } from './core/render'
import type { ExportFormat } from './io/export'

export interface AppState {
  // Characters
  charsetId: string
  customRamp: string
  invertRamp: boolean

  // Detail
  cols: number
  cellAspect: number
  letterSpacing: number
  fontSize: number
  fontFamily: string
  fontWeight: string
  dither: number

  // Tone
  brightness: number
  contrast: number
  gamma: number
  invertImage: boolean

  // Colour
  colorMode: ColorMode
  fg: string
  bg: string
  transparentBg: boolean
  duoShadow: string
  duoHighlight: string
  duoBias: number
  duoBlend: number

  // Playback
  speed: number

  // Decode
  maxWidth: number
  maxFrames: number
  targetFps: number

  // Export
  aspectId: string
  aspectFill: AspectFill
  exportFormat: ExportFormat
  exportScale: number
  maxColors: number
  quality: number
  frameStep: number
}

export const FONT_STACKS: Record<string, string> = {
  'System mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  Menlo: 'Menlo, monospace',
  Courier: '"Courier New", Courier, monospace',
  'Andale Mono': '"Andale Mono", monospace',
  'PT Mono': '"PT Mono", monospace',
}

export interface AspectOption {
  id: string
  label: string
  /** Width / height. 0 means "match the source". */
  ratio: number
}

export const ASPECT_RATIOS: AspectOption[] = [
  { id: 'source', label: 'Source', ratio: 0 },
  { id: '1:1', label: 'Square — 1:1', ratio: 1 },
  { id: '4:5', label: 'Portrait — 4:5', ratio: 4 / 5 },
  { id: '9:16', label: 'Story — 9:16', ratio: 9 / 16 },
  { id: '2:3', label: 'Print — 2:3', ratio: 2 / 3 },
  { id: '3:2', label: 'Photo — 3:2', ratio: 3 / 2 },
  { id: '16:9', label: 'Wide — 16:9', ratio: 16 / 9 },
  { id: '21:9', label: 'Cinema — 21:9', ratio: 21 / 9 },
]

export function aspectRatio(id: string): number {
  return ASPECT_RATIOS.find((a) => a.id === id)?.ratio ?? 0
}

export interface DuotonePreset {
  name: string
  shadow: string
  highlight: string
  bg: string
}

export const DUOTONE_PRESETS: DuotonePreset[] = [
  { name: 'Cyanotype', shadow: '#0a1a3f', highlight: '#7fdbff', bg: '#04060f' },
  { name: 'Ember', shadow: '#3d0a12', highlight: '#ffcf6b', bg: '#0d0405' },
  { name: 'Acid', shadow: '#16123a', highlight: '#c2ff3d', bg: '#07060f' },
  { name: 'Bubblegum', shadow: '#3b0a52', highlight: '#ff9ad5', bg: '#0b0410' },
  { name: 'Terminal', shadow: '#00301a', highlight: '#3dff9e', bg: '#000000' },
  { name: 'Risograph', shadow: '#1a2ea8', highlight: '#ff4f3d', bg: '#f4f0e6' },
  { name: 'Newsprint', shadow: '#1c1c1c', highlight: '#f2f2f2', bg: '#f2f2f2' },
  { name: 'Vaporwave', shadow: '#2b1055', highlight: '#ff6ec7', bg: '#120524' },
]

export const DEFAULT_STATE: AppState = {
  charsetId: 'standard',
  customRamp: ' .:-=+*#%@',
  invertRamp: false,

  cols: 140,
  cellAspect: 2,
  letterSpacing: 0,
  fontSize: 12,
  fontFamily: FONT_STACKS['System mono'],
  fontWeight: '500',
  dither: 0.35,

  brightness: 0,
  contrast: 1.15,
  gamma: 1,
  invertImage: false,

  colorMode: 'duotone',
  fg: '#e8e8e8',
  bg: '#04060f',
  transparentBg: false,
  duoShadow: '#0a1a3f',
  duoHighlight: '#7fdbff',
  duoBias: 1,
  duoBlend: 0.35,

  speed: 1,

  maxWidth: 640,
  maxFrames: 300,
  targetFps: 20,

  aspectId: 'source',
  aspectFill: 'crop',
  exportFormat: 'gif',
  exportScale: 1,
  maxColors: 128,
  quality: 0.75,
  frameStep: 1,
}

export function toRenderOptions(state: AppState): RenderOptions {
  return {
    cols: state.cols,
    ramp: resolveRamp(state.charsetId, state.customRamp, state.invertRamp),
    cellAspect: state.cellAspect,
    fontSize: state.fontSize,
    fontFamily: state.fontFamily,
    fontWeight: state.fontWeight,
    letterSpacing: state.letterSpacing,
    aspect: aspectRatio(state.aspectId),
    aspectFill: state.aspectFill,
    brightness: state.brightness,
    contrast: state.contrast,
    gamma: state.gamma,
    invertImage: state.invertImage,
    dither: state.dither,
    colorMode: state.colorMode,
    fg: state.fg,
    bg: state.bg,
    transparentBg: state.transparentBg,
    duoShadow: state.duoShadow,
    duoHighlight: state.duoHighlight,
    duoBias: state.duoBias,
    duoBlend: state.duoBlend,
  }
}

const STORAGE_KEY = 'ascii-gen:state'

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    // Merge rather than replace so new options pick up their defaults.
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<AppState>) }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private browsing or quota */
  }
}
