# Migration From s&box

## Paths

- Source s&box: `https://github.com/TGrozner/neon-drift-sbox`, cloned read-only at `/home/thomas/dev/neon-drift-sbox-source`.
- Destination web: `/home/thomas/dev/neon-drift-web`.

## Baseline Before Migration

The requested destination did not exist, so a new Vite React TypeScript app was created at `/home/thomas/dev/neon-drift-web`.

Baseline on the fresh scaffold before gameplay migration:

- `npm run typecheck --if-present`: no script, exited successfully via npm `--if-present`.
- `npm test`: failed because no `test` script existed.
- `npm run build`: passed.
- `npm run e2e --if-present`: no script, exited successfully via npm `--if-present`.
- `npm run lint`: passed.

## Scope Retarget

The original prompt described a conservative top-down web migration. The target was later corrected to a browser-native 3D port: same game feel and gameplay systems, but without Source 2 or s&box runtime APIs.

Current delivered scope is the first stable 3D cut:

- One track: Neon Oval.
- Three ship profiles: Balanced, Swift, Heavy.
- Solo race with deterministic pack bots.
- Three.js renderer.
- Shared pure simulation and tests.

## Source Systems Audited

- `Code/DriftShipController.cs`
- `Code/RaceDirector.cs`
- `Code/AiRaceDriver.cs`
- `Code/SlipstreamTrailSystem.cs`
- `Code/RaceTrack.cs`
- `Code/TrackPad.cs`
- `Code/CheckpointGate.cs`
- `Code/StartGridSlot.cs`
- `Code/NeonTutorial.cs`
- `Code/NeonDriftHud.cs`
- `Code/NeonCameraRig.cs`
- `Code/NeonAudio.cs`
- `Code/NeonPalette.cs`

## Mapping

- `DriftShipController.cs` -> `shared/physics.ts`, `shared/constants.ts`
- `RaceDirector.cs` -> `shared/race.ts`, HUD/menu components
- `SlipstreamTrailSystem.cs` -> `shared/slipstream.ts`
- `AiRaceDriver.cs` -> `shared/bot.ts`
- `RaceTrack.cs` -> `shared/track.ts`
- `TrackPad.cs` -> `shared/pads.ts`
- `CheckpointGate.cs` -> gate logic in `shared/physics.ts` and `shared/race.ts`
- `StartGridSlot.cs` -> `startGrid` data in `shared/track.ts`
- `NeonTutorial.cs` -> `src/components/Tutorial.tsx`
- `NeonDriftHud.cs` -> `src/components/Hud.tsx`
- `NeonCameraRig.cs` -> camera logic in `src/render/renderer.ts`

## Migrated Systems

- Airbrake as a distinct input.
- Reduced grip and increased turn authority while airbraking.
- Airbrake hold timer, release boost, power cost, cooldown and feedback pulse.
- Boost activation threshold, continue threshold, ramp up/down and empty lockout.
- Power regen throttle/coast and off-track penalty.
- Clean-line regen bonus.
- Rail damage and crash-out recovery.
- Checkpoint reset, partial power restore, grace period, time penalty.
- Boost and recharge pads with swept trigger and per-ship cooldown.
- Track-space slipstream segments, sampling, lane pull, stack cap and self-exclusion.
- Pack-aware bot lane changes, traffic brake, pad targeting, boost and airbrake use.
- Warmup/countdown/racing/finished/results race flow.
- Launch boost/perfect-start feedback.
- Standings, speed/power HUD, airbrake charge, crash-out and slipstream feedback.
- Client-side tutorial progression.

## Systems Ignored Voluntarily

- Steam invite and s&box networking.
- Source 2 `GameObject`, `Component`, `[Sync]`, `SceneFile`, editor workflows.
- Source 2 physics, exact 3D collision and `.vmdl` runtime assets.
- s&box audio asset workflow.
- Additional source tracks and true inversion/loop geometry.

## 3D Adaptation

The web version uses Three.js and a deterministic track-space simulation. Vehicles move along a 3D sampled track frame rather than a full rigid-body simulation. This preserves banking, camera motion and ship orientation while making gameplay stable in tests.

Tuning values were normalized from s&box scale using a `1/100` speed factor, preserving ratios and thresholds rather than copying world units directly.

## Risks

- Visual assets are procedural primitives, not converted source assets.
- Only Neon Oval is implemented.
- Full rigid-body contacts are approximated by lane/rail constraints.
- `preserveDrawingBuffer` is enabled for e2e canvas pixel checks and may be revisited for performance.
- Bundle size includes Three.js and currently triggers Vite's chunk-size warning.

## Compatibility Strategy

- No s&box dependency is introduced.
- No s&box multiplayer is migrated.
- Gameplay remains in `shared/` and is portable to a future server-authoritative model.
- Network protocol files were not created because no web backend/protocol existed in this newly created destination.

## Tests Added

- `tests/physics.test.ts`: airbrake grip, turn authority, exit boost timing/cooldown, boost thresholds/lockout, profiles, crash-out.
- `tests/systems.test.ts`: track/gates/grid/pads, pad swept cooldowns, slipstream emission/sampling/cap/decay, bot behavior, race flow.
- `e2e/app.spec.ts`: app launch, menu, race start, keyboard driving, HUD, WebGL nonblank pixel check.

## Playtest Checklist

- App launches and renders a 3D track.
- Menu opens on first viewport.
- Ship selection changes profile.
- Race starts from menu.
- Warmup/countdown appears.
- Launch boost/perfect start feedback appears.
- Acceleration works.
- Steering works.
- Airbrake in turns works.
- Airbrake exit boost fires after sufficient hold.
- Manual boost drains Power.
- Power recharges when not boosting.
- Rail collision damages Power.
- Crash-out resets to checkpoint and applies penalty.
- Slipstream appears behind fast ships and helps catch the pack.
- Bots form traffic and overtake.
- Boost/recharge pads trigger.
- Gates and laps advance.
- Results appear after finish.
- Mobile/touch controls remain reachable.
- E2E smoke passes with canvas pixel check.

## Future Implementation Order

1. Convert or recreate source ship/track assets.
2. Add Friend Circuit, Skyline Sprint and Banked Speedway.
3. Add audio cue matrix.
4. Improve wall/contact model.
5. Add browser multiplayer only if the web architecture is designed for it.
6. Revisit chunk splitting and renderer performance.

