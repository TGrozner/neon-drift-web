# Neon Drift Web Agent Rules

This file makes the `/home/thomas/dev` workspace rules explicit for sessions
started directly in this repo. Follow `/home/thomas/dev/AGENTS.md` first, then
apply these project-specific rules.

## Required Quality Loop

- Before editing, run:
  `/home/thomas/dev/scripts/dev-agent-check --repo /home/thomas/dev/neon-drift-web --mode preflight`
- During implementation, use small slices and verify with:
  `/home/thomas/dev/scripts/dev-agent-check --repo /home/thomas/dev/neon-drift-web --tier quick`
- Before handoff for normal code changes, run:
  `/home/thomas/dev/scripts/dev-agent-check --repo /home/thomas/dev/neon-drift-web --tier standard`
- Before branch-and-push handoff, run:
  `/home/thomas/dev/scripts/dev-agent-check --repo /home/thomas/dev/neon-drift-web --tier standard --mode final`

Do not report the task complete if typecheck, lint, build, tests, or the harness
fails. If a check was failing before your edits, document the exact failure and
separate it from your own changes.

## Project Commands

- `npm run typecheck`: TypeScript project check.
- `npm run lint`: ESLint.
- `npm run test`: Vitest unit/system tests.
- `npm run build`: production build.
- `npm run e2e`: Playwright; use for user-visible flows, routing, browser
  behavior, or when `--tier full` is requested.

## Frontend Verification

- For UI, rendering, or gameplay-visible changes, run the relevant automated
  checks and inspect the actual browser output before handoff.
- Use screenshots or Playwright evidence for visual changes; do not rely on a
  text-only claim that the UI looks correct.
- Keep changes scoped. Avoid mixing physics/gameplay, UI polish, audio/assets,
  and test infrastructure in one patch unless the coupling is necessary.
