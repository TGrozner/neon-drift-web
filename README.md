# Neon Drift Web

Browser-native 3D port/remake of Neon Drift, based on the s&box gameplay audit from `TGrozner/neon-drift-sbox`.

This build does not run Source 2 or s&box APIs in the browser. It recreates the game in TypeScript, React, and Three.js with pure shared gameplay systems and a WebGL renderer.

## Current Scope

- Tutorial Circuit plus the source-authored stunt tracks as playable tracks; the baseline Neon Oval is kept out of the game menu.
- Track-space banking, gates, pads, start grid, rails, and slipstream wake rendering.
- Three ship profiles: Balanced, Swift, Heavy.
- Solo pack race with seven deterministic bots.
- Warmup, countdown, launch boost, racing, finish/results phase.
- Drift/airbrake, airbrake exit boost, manual boost, power economy, capped impact integrity damage, and permanent crash-out elimination once Integrity is exhausted.
- Boost/recharge pads, slipstream, pack-aware bot inputs, standings, HUD, tutorial, mobile controls.
- Prototype GLB ship and track-kit assets loaded through Three.js.

Still deferred from the s&box version:

- Exact Source 2 `.vmdl` runtime conversion and s&box scene loading.
- s&box networking, Steam invite, host/client logic, editor workflows.
- Scene-authored gameplay source contracts for visible `TrackWall`, `TrackPad`, `CheckpointGate`, and `StartGridSlot` objects.
- Full rigid-body 3D physics and exact wall/contact classification.

## Controls

- `W` / `Z` / `ArrowUp`: throttle
- `S` / `ArrowDown`: reverse/brake
- `A` / `Q` / `D` or arrows: steer
- `Space`: airbrake
- `Shift`: boost
- `R`: reset to last checkpoint
- `F1`: skip tutorial
- `F2`: reset tutorial

Touch controls are shown on narrow viewports.

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run lint
npm run build
npm run e2e
```

## Production

Production is prepared for GitHub Pages through GitHub Actions:

https://tgrozner.github.io/neon-drift-web/

The deploy job runs from `main` when the repository is public, or when the
repository variable `ENABLE_GITHUB_PAGES_DEPLOY` is set to `true` after GitHub
Pages is available for this repository.

## Mobile diagnostics

The browser keeps a persistent local diagnostics ring buffer in `localStorage`
and can upload it silently when `VITE_DIAGNOSTICS_ENDPOINT` is configured at
build time. It records session/device info, lifecycle events, race starts/phase
changes, race summaries, touch inputs, large simulation frame gaps, renderer
frame summaries, slow frames, and runtime errors or unhandled promise
rejections.

The diagnostics UI is hidden during normal play. Append `?logs=1` to the
production URL only when a manual export is needed; that opens a debug panel
with share/copy/download actions.

For production collection, configure the repository variable
`VITE_DIAGNOSTICS_ENDPOINT` with an HTTPS endpoint that accepts `POST
application/json` from the Pages origin. The client uploads pending diagnostics
silently on a debounce, immediately for warnings/errors, and again with
`sendBeacon` when the page is hidden or closed.

The same report is available from DevTools with:

```js
window.__NEON_DIAGNOSTICS__.exportText()
```

Logs stay local to the device until someone shares or copies the report; this
static build only uploads telemetry automatically when a diagnostics ingestion
endpoint is configured.

## Architecture

- `shared/`: deterministic gameplay modules usable by client/server style code.
- `src/render/renderer.ts`: Three.js renderer that reads race state only.
- `src/components/`: React HUD, menu, tutorial, touch controls.
- `src/hooks/useNeonGame.ts`: fixed-step simulation loop and input mapping.
- `tests/`: Vitest coverage for pure gameplay.
- `e2e/`: Playwright smoke test with WebGL canvas pixel verification.

See `MIGRATION_FROM_SBOX.md` and `ARCHITECTURE.md` for migration details.
