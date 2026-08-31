# ascii-gen

Turn GIFs and videos into ASCII animations in the browser, with live controls for
character ramp, detail, tone, and duotone colour. Everything runs client-side —
no file ever leaves the machine.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

## Controls

**Presets** — the dropdown at the top of the sidebar applies a look; the saving
and management controls live down in *Export*, since that's where files get
written. *Save as preset…* also serves as update: reusing an existing name
overwrites it after a confirm. Seven built-in presets ship with the app, and
saving under a built-in's name creates a user copy that shadows it. A preset
captures only the *look* (characters, detail, tone, colour) — decode and export
settings are left alone, so applying one never re-decodes the clip.

**Source** — decode width, max frames, and video sample rate. The clip is decoded
once into memory, so these bound how much RAM a long video takes. Change them and
hit *Reload with these settings*.

**Characters** — pick a ramp preset or type your own (darkest character first;
*Reverse ramp* flips it for light backgrounds). Font family and weight change how
much ink each glyph puts down, which shifts the whole tonal feel.

**Detail** — `Columns` is the main resolution knob. `Cell aspect` fixes the squish
you get from character cells being taller than they are wide (~2 is right for most
monospace fonts). `Dither` adds an ordered Bayer pattern before quantisation, which
recovers gradient detail a short ramp would otherwise flatten.

**Tone** — brightness → contrast → gamma, applied in that order to luma before the
ramp lookup.

**Colour** — three modes:
- *Mono* — one text colour on one background.
- *Duotone* — the ramp is mapped across a shadow → highlight gradient interpolated
  in OKLab, so the midtones stay saturated instead of going grey.
- *Source colour* — each cell takes the colour of the pixel underneath, with
  `Tint source colour` blending it toward the duotone ramp.

**Export** — GIF, MP4 (H.264), or WebM (VP9). `Output scale` multiplies glyph size
for a larger file without changing the character grid. `Keep every Nth frame`
shortens the output while preserving playback speed.

Space toggles playback; arrow keys step frames. *Copy text* puts the current frame
on the clipboard as plain text.

## How it works

- `src/io/clip.ts` — GIF frames are decoded with `gifuct-js` and composited
  honouring disposal methods; video is decoded frame-accurately with `mediabunny`
  and resampled to a fixed rate.
- `src/core/render.ts` — the frame is downsampled so one pixel equals one cell,
  then each cell's luma picks a ramp index. In mono and duotone modes a cell's
  colour is a pure function of that index, so all `ramp.length` glyph bitmaps are
  pre-rendered into an atlas and blitted with `drawImage` rather than re-running
  `fillText` 80,000 times per frame.
- `src/io/export.ts` — GIF encoding uses one global palette built from frames
  sampled across the clip; video encoding goes through WebCodecs via `mediabunny`.

## Typography

The interface is set in **Satoshi**, self-hosted from `public/fonts` as a single
42 KB variable `.woff2` covering weights 300–900. The `@font-face` rule lists
`local()` first, so a copy installed on the machine is used without a download.
The fallback is **Helvetica Neue Light** — the base UI weight is 300, which is
what resolves Helvetica Neue to its Light cut on macOS.

Monospace is kept where it carries meaning: the ASCII canvas itself, the custom
ramp field, hex inputs, numeric readouts, and the frame counter.

## Browser support

Needs WebCodecs for video import and MP4/WebM export — Chrome and Edge are solid,
Safari 17+ mostly works. GIF import and GIF export have no such requirement.
