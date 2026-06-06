# Architecture

## Goal

Neon Drift Web is a browser-native 3D recreation of the s&box Neon Drift gameplay. The browser build keeps the s&box feel where practical, but it does not depend on `GameObject`, `Component`, `SceneFile`, Source 2 physics, or s&box networking.

## Layers

`shared/` owns gameplay:

- `constants.ts`: tuning, ship profiles, race timings, pad/slipstream values.
- `math.ts`: small vector and scalar helpers.
- `track.ts`: 3D track-space data, Neon Oval sampling, gates, pads, start grid.
- `physics.ts`: ship inputs, boost/power, airbrake, crash-out, rails, gates.
- `pads.ts`: pure swept pad triggering and cooldowns.
- `slipstream.ts`: pure track-space wake segments and sampling.
- `bot.ts`: deterministic pack-aware bot input generation.
- `race.ts`: race phases, standings, launch boost, race updates.

`src/render/renderer.ts` owns rendering:

- Builds Three.js track, gates, pads, rails, ships, slipstream planes, and camera.
- Reads `RaceState`; it does not mutate gameplay or decide rules.

`src/components/` owns UI:

- HUD, menu, tutorial and touch controls read state and send serialized inputs.
- Tutorial progress is local UI state and localStorage only.

`src/hooks/useNeonGame.ts` owns runtime integration:

- Browser keyboard/touch input mapping.
- Fixed-step `1/60` simulation.
- React render refresh.

## Determinism Rules

- Simulation uses explicit `dt`; no gameplay code reads wall clock time directly.
- Gameplay modules avoid unseeded `Math.random()`.
- Bot choices are derived from stable ids/seeds.
- Renderer and React do not decide gameplay.
- Inputs are serializable: `{ throttle, steer, boost, airbrake, reset }`.

## 3D Strategy

The first build uses a track-space 3D model instead of rigid-body Source 2 parity. Vehicles move by distance/lane over a sampled 3D track frame (`center`, `tangent`, `right`, `up`). This gives WebGL banking, camera motion and ship orientation while keeping gameplay stable and testable.

True loops, inversion ribbons, Source 2 collision, and converted `.vmdl` assets are deferred until the base browser port is stable.

