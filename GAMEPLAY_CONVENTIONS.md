# Gameplay Conventions

- Gameplay simulation lives in `shared/`.
- React components render UI and send inputs only.
- Three.js renders `RaceState`; it does not decide gameplay.
- New shared mechanics must accept explicit `dt`.
- Do not use unseeded `Math.random()` in simulation.
- Inputs must stay serializable.
- Track data is 3D browser data, not s&box scene data.
- Tuning belongs in `shared/constants.ts` unless a larger table is justified.
- Browser physics may approximate Source 2, but invariants need tests.
- Pads, gates, start grid, bots, power, crash-out and slipstream should stay covered by Vitest.
- If networking is added later, shared simulation must remain portable to server authority.

