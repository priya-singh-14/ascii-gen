import { DEFAULT_STATE, type AppState } from './state'

/**
 * The subset of state a preset captures. Decode, playback and export settings
 * are excluded, so applying a preset never forces the clip to be re-decoded.
 */
export const LOOK_KEYS = [
  'charsetId',
  'customRamp',
  'invertRamp',
  'cols',
  'cellAspect',
  'letterSpacing',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'dither',
  'brightness',
  'contrast',
  'gamma',
  'invertImage',
  'colorMode',
  'fg',
  'bg',
  'transparentBg',
  'duoShadow',
  'duoHighlight',
  'duoBias',
  'duoBlend',
] as const satisfies ReadonlyArray<keyof AppState>

export type Look = Pick<AppState, (typeof LOOK_KEYS)[number]>

export interface Preset {
  name: string
  look: Look
}

export function captureLook(state: AppState): Look {
  const look = {} as Look
  for (const key of LOOK_KEYS) {
    // TS can't narrow a union of key types against a union of value types.
    ;(look as Record<string, unknown>)[key] = state[key]
  }
  return look
}

export function applyLook(state: AppState, look: Partial<Look>): void {
  const target = state as unknown as Record<string, unknown>
  for (const key of LOOK_KEYS) {
    const value = (look as Record<string, unknown>)[key]
    if (value !== undefined) target[key] = value
  }
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

function look(overrides: Partial<Look>): Look {
  return { ...captureLook(DEFAULT_STATE), fontFamily: MONO, ...overrides }
}

export const BUILT_IN_PRESETS: Preset[] = [
  {
    name: 'Cyanotype',
    look: look({
      charsetId: 'standard',
      cols: 140,
      dither: 0.35,
      contrast: 1.15,
      colorMode: 'duotone',
      bg: '#04060f',
      duoShadow: '#0a1a3f',
      duoHighlight: '#7fdbff',
    }),
  },
  {
    name: 'Newsprint',
    look: look({
      charsetId: 'classic',
      cols: 220,
      fontSize: 9,
      dither: 0.7,
      contrast: 1.5,
      gamma: 1.2,
      invertImage: true,
      colorMode: 'duotone',
      bg: '#f2f0ea',
      duoShadow: '#f2f0ea',
      duoHighlight: '#141414',
    }),
  },
  {
    name: 'Terminal',
    look: look({
      charsetId: 'terminal',
      cols: 160,
      dither: 0.2,
      contrast: 1.3,
      colorMode: 'duotone',
      bg: '#000000',
      duoShadow: '#00301a',
      duoHighlight: '#3dff9e',
    }),
  },
  {
    name: 'Riso duo',
    look: look({
      charsetId: 'blocks',
      cols: 110,
      cellAspect: 2,
      dither: 1,
      contrast: 1.4,
      colorMode: 'duotone',
      bg: '#f4f0e6',
      duoShadow: '#1a2ea8',
      duoHighlight: '#ff4f3d',
      duoBias: 0.8,
    }),
  },
  {
    name: 'Hi-fi mono',
    look: look({
      charsetId: 'classic',
      cols: 400,
      fontSize: 6,
      dither: 0.5,
      contrast: 1.1,
      colorMode: 'mono',
      fg: '#f2f2f2',
      bg: '#0b0b0b',
    }),
  },
  {
    name: 'Braille',
    look: look({
      charsetId: 'braille',
      cols: 180,
      cellAspect: 1.6,
      dither: 0.6,
      contrast: 1.35,
      colorMode: 'duotone',
      bg: '#0b0410',
      duoShadow: '#3b0a52',
      duoHighlight: '#ff9ad5',
    }),
  },
  {
    name: 'Live colour',
    look: look({
      charsetId: 'shades',
      cols: 150,
      dither: 0.4,
      contrast: 1.2,
      colorMode: 'source',
      bg: '#0a0a0a',
      duoBlend: 0.25,
      duoShadow: '#16123a',
      duoHighlight: '#c2ff3d',
    }),
  },
]

const STORAGE_KEY = 'ascii-gen:presets'

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(isPreset) : []
  } catch {
    return []
  }
}

export function savePresets(presets: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    /* quota or private browsing */
  }
}

function isPreset(value: unknown): value is Preset {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Preset).name === 'string' &&
    typeof (value as Preset).look === 'object' &&
    (value as Preset).look !== null
  )
}

/** Merge imported presets in, replacing same-named entries. */
export function mergePresets(existing: Preset[], incoming: Preset[]): Preset[] {
  const merged = [...existing]
  for (const preset of incoming) {
    const at = merged.findIndex((p) => p.name === preset.name)
    if (at >= 0) merged[at] = preset
    else merged.push(preset)
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name))
}

export function parsePresetFile(text: string): Preset[] {
  const parsed = JSON.parse(text) as unknown
  const list = Array.isArray(parsed) ? parsed : [parsed]
  const valid = list.filter(isPreset)
  if (valid.length === 0) throw new Error('No presets found in that file.')
  return valid
}
