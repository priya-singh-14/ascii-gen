import type { Clip } from './io/clip'

/** A procedurally generated loop so the app has something moving on first load. */
export async function makeDemoClip(): Promise<Clip> {
  const width = 480
  const height = 320
  const frameCount = 60
  const delay = 1000 / 24

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const blobs = [
    { r: 150, ax: 110, ay: 60, sx: 1, sy: 2, phase: 0 },
    { r: 120, ax: 90, ay: 80, sx: 2, sy: 1, phase: 1.7 },
    { r: 95, ax: 130, ay: 45, sx: 3, sy: 2, phase: 3.4 },
  ]

  const frames: Clip['frames'] = []

  for (let f = 0; f < frameCount; f++) {
    const t = (f / frameCount) * Math.PI * 2

    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = 'lighter'

    for (const b of blobs) {
      const x = width / 2 + Math.cos(t * b.sx + b.phase) * b.ax
      const y = height / 2 + Math.sin(t * b.sy + b.phase) * b.ay
      const g = ctx.createRadialGradient(x, y, 0, x, y, b.r)
      g.addColorStop(0, 'rgba(255,255,255,0.95)')
      g.addColorStop(0.45, 'rgba(255,255,255,0.35)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, b.r, 0, Math.PI * 2)
      ctx.fill()
    }

    // A hard-edged ring keeps some high-frequency detail in the frame.
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.ellipse(width / 2, height / 2, 130, 130 * Math.abs(Math.cos(t)) + 8, t * 0.5, 0, Math.PI * 2)
    ctx.stroke()

    frames.push({ bitmap: await createImageBitmap(canvas), delay })
  }

  return {
    name: 'demo',
    kind: 'gif',
    width,
    height,
    frames,
    duration: frameCount * delay,
    truncated: false,
    sourceFrameCount: frameCount,
    dispose: () => frames.forEach((f) => f.bitmap.close()),
  }
}
