import type { Clip } from './io/clip'

const SHEET = '/muybridge-gallop.jpg'
const COLS = 6
const ROWS = 2
const DELAY = 1000 / 20

export async function makeDemoClip(): Promise<Clip> {
  const img = new Image()
  img.src = SHEET
  await img.decode()

  const fw = Math.floor(img.naturalWidth / COLS)
  const fh = Math.floor(img.naturalHeight / ROWS)

  const canvas = document.createElement('canvas')
  canvas.width = fw
  canvas.height = fh
  const ctx = canvas.getContext('2d')!

  const frames: Clip['frames'] = []
  for (let i = 0; i < COLS * ROWS; i++) {
    ctx.clearRect(0, 0, fw, fh)
    ctx.drawImage(img, (i % COLS) * fw, Math.floor(i / COLS) * fh, fw, fh, 0, 0, fw, fh)
    frames.push({ bitmap: await createImageBitmap(canvas), delay: DELAY })
  }

  return {
    name: 'Sallie Gardner at a Gallop',
    kind: 'gif',
    width: fw,
    height: fh,
    frames,
    duration: frames.length * DELAY,
    truncated: false,
    sourceFrameCount: frames.length,
    dispose: () => frames.forEach((f) => f.bitmap.close()),
  }
}
