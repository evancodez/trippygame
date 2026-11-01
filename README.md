# Underneath

You are the hand beneath the sheet.

A game made from the same pieces as the trippy visualizer's music videos: a sheet of black-and-white
lines, hands pushing through it from behind, eyes, a ghost face. Here the sheet is a real elastic
membrane, and you play from underneath it. You never touch the pearl that rolls on top. You push the
fabric up into a hill behind it, press it down into a well in front of it, snap it on the beat to
throw it, and read every slope from the way the lines bend.

Plain HTML + JavaScript modules + one WebGL2 shader. No build step, no dependencies.

## How to play

| | Mouse + keyboard | PS5 controller |
|---|---|---|
| Move your hand | move the mouse · WASD / arrows | left stick · d-pad |
| Push up | hold left mouse · space | squeeze **R2** (pressure = height) · ✕ |
| Press down | hold right mouse · shift | squeeze **L2** · □ |
| Pause · restart | esc · R | options · create |
| Hide everything | H | — |

- Push just **behind** the pearl and it rolls away from your hand. Press **ahead** of it and it drops into the well.
- A push that starts **on the beat** snaps up hard enough to throw the pearl into the air, and builds your beat streak (a score multiplier).
- Each scene is one phrase of the song. Finish before the phrase ends for points; miss and you lose one of three lights.
- Eyes swallow whatever falls in. Tears in the fabric drop things into the dark. Ink crawls after the pearl and runs from your hand's light.

## The songs

1. **Silk**: learning the fabric: eyes, lights, a bowl, swells, a drum, a blinking eye.
2. **Moiré**: tears, herding ink, a saddle, wandering eyes, an eye you have to find by feel.
3. **Hands**: a rival hand under the sheet, a swaying sheet, two pearls at once.
4. **Vortex**: whirlpools, ridges to throw the pearl over, a drum with tears.
5. **Cherry**: a face rises out of the sheet. Give it its eyes, feed its singing mouth on the beat, then do it again when the face is pressed in hollow.

**Free** plays every scene with nothing to lose. **Your song**: drop in an mp3 (analyzed in the browser,
never uploaded) and the sheet moves to its tempo.

## How it works

- `src/sheet.js`: the membrane: a 128×128 damped wave equation pinned to a hoop, resting on a shape that
  morphs between equations (bowl, saddle, swells, funnel, ridges, the face…). Hands are one-way constraints
  (they can only push from their side). The pearl and ink are spheres riding the surface, tossed by its velocity.
- `src/shader.js`: one ray-marched scene: the height texture drawn with the visualizer's line equation
  (lines bend over the relief, light thins the ink), hands glowing through the fabric, eyes with irises
  beneath that watch the pearl, tears of static, a chrome pearl that reflects the sheet.
- `src/game.js`: songs as scenes timed to the music, goals, the rival hand, ink, scoring, beat timing.
- `src/scenes.js`: the five songs, the line looks, palettes.
- `src/audio.js`: generative 6/8 soundtrack, the sheet as a drum, an organ hum that swells as you push.

## Run it locally

```bash
npx serve .
```

## Deploy on Vercel

Import the repo. Framework preset **Other**, no build command, output directory = the repo root.
