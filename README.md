# Sea of Lines

A game inside an op-art music video. You ride a chrome pearl across a living sea of black-and-white
lines that swells to the music, rolls itself into a tunnel, grows hands, folds up into the sky,
and raises a giant face out of the water for you to ride straight through.

Plain HTML + JavaScript modules + one WebGL2 shader. No build step, no dependencies.

## How to play

| | Keyboard + mouse | PS5 controller |
|---|---|---|
| Steer | ← → · A D · or point with the mouse | left stick · d-pad |
| Dive (get heavy) | hold Space · S · left mouse button | hold ✕ · R2 |
| Flip the sea | E · Q · Shift · right-click | □ · ○ · L1 · R1 |
| Look around | — | right stick |
| Pause · restart | Esc · R | Options · Create |
| Hide everything | H | — |

- **Dive** going down the far side of a wave to pick up speed. Let go going up the near side and you'll fly off the crest.
- Land **with** the slope for a *smooth* landing (speed + points). Land against it and it's *rough*.
- **Flip** turns the sea inside out: crests become troughs and troughs become crests. Flip while you're
  sitting low in a trough and the sea throws you into the air (a *flip pop*).
- **Rings** are arches standing in the sea. Roll or fly through them for a boost.
- Orbs, rings, smooth landings, air time and pops keep the dream going (the line at the bottom).
  If it runs out, the static closes in. You get three seconds to catch something before you wake up.

## Modes

- **Dream**: five dreams, each a run of sections timed to its own generative 6/8 soundtrack.
  *Silk* (learn to fall), *Moiré* (the flip), *Hands*, *Tunnel* (the sea rolls up), *Cherry* (everything, and the faces).
- **Drift**: free ride, no fading. Keys `1`–`9`/`0` pick the sea, `[` `]` change colors.
- **Your song**: drop an mp3 anywhere (or pick one from the menu). It's analyzed in the browser (tempo, loudness,
  sections) and the sea is cut from it. Louder parts get rougher seas, the waves breathe with the volume, and the
  columns rise on its beat. Nothing is uploaded.

## How it works

- `src/sea.js`: the surface `h(u, v)` (swells, chop, dunes, whirlpools, terraces, ripples, the flip wave), the
  hands and columns, and the bend that rolls the strip into a tube. **The same math is written in GLSL in
  `src/shader.js`**, so what you see is what you ride.
- `src/shader.js`: one ray-marched scene. Lines are painted in track space (cross lines, lanes, contours,
  rings around the pearl, moiré), and light thins the ink so form is drawn with lines alone.
  Rays bend to fold the sea up into the sky; the pearl is chrome and mirrors the sea with a second march.
- `src/ride.js`: physics at 120 Hz (sphere against the sea's distance field, with the surface's own motion
  pushing you), scoring, lucidity, what gets scattered on the sea, and an autopilot that rides the title screen.
- `src/dreams.js`: the looks (each a set of equation parameters that the sea glides between), the five dreams,
  Drift, and the song-to-dream cutter.
- `src/params.js`: every knob in one list, with glides, so one equation *re-forms* into the next.
- `src/audio.js`: Web Audio synth: soundtrack, wind that follows your speed, every sound effect. Also plays your song.
- `src/analysis.js`: whole-song analysis (FFT, onsets, tempo, sections), shared with the trippy visualizer.

## Run it locally

Any static server works:

```bash
npx serve .
```

Then open the printed URL. Needs a browser with WebGL2 (recent Chrome, Edge, Firefox, Safari).

## Deploy on Vercel

Import the repo. Framework preset **Other**, no build command, output directory = the repo root.

Settings has *Reduce flashing* (no color inversion or flashes), *Detail* (low / auto / high), mouse steering and volumes.
