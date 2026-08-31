/** Ramps are written darkest -> lightest; `invertRamp` flips them for light backgrounds. */
export interface Charset {
  id: string
  name: string
  ramp: string
  /** Box-drawing/block glyphs look wrong in a proportional fallback font. */
  monoOnly?: boolean
}

export const CHARSETS: Charset[] = [
  { id: 'standard', name: 'Standard', ramp: ' .:-=+*#%@' },
  { id: 'classic', name: 'Classic 70', ramp: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
  { id: 'minimal', name: 'Minimal', ramp: ' .:*#' },
  { id: 'blocks', name: 'Blocks', ramp: ' ░▒▓█', monoOnly: true },
  { id: 'shades', name: 'Shades', ramp: ' ·:░▒▓█', monoOnly: true },
  { id: 'quadrants', name: 'Quadrants', ramp: ' ▖▚▜█', monoOnly: true },
  { id: 'binary', name: 'Binary', ramp: ' 01', monoOnly: false },
  { id: 'dots', name: 'Dots', ramp: ' .·•●', monoOnly: true },
  { id: 'braille', name: 'Braille', ramp: ' ⠁⠃⠇⠏⠟⠿⡿⣿', monoOnly: true },
  { id: 'ascii-art', name: 'Line art', ramp: ' .-=+|/\\#@' },
  { id: 'thin', name: 'Thin', ramp: ' ▁▂▃▄▅▆▇█', monoOnly: true },
  { id: 'terminal', name: 'Terminal', ramp: ' `.-\':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@' },
  { id: 'custom', name: 'Custom…', ramp: ' .:-=+*#%@' },
]

export function charsetById(id: string): Charset {
  return CHARSETS.find((c) => c.id === id) ?? CHARSETS[0]
}

export function resolveRamp(id: string, custom: string, invert: boolean): string {
  const base = id === 'custom' ? custom : charsetById(id).ramp
  const ramp = base.length > 0 ? base : ' '
  return invert ? [...ramp].reverse().join('') : ramp
}
