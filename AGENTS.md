# Neon Drift Web Agent Rules

This file makes the `/home/thomas/dev` workspace rules explicit for sessions
started directly in this repo. Follow `/home/thomas/dev/AGENTS.md` first, then
apply these project-specific rules.

## Issue Intake

- Before planning or coding, check the open GitHub issues for this repository.
- Treat open issues as the current product/gameplay backlog and reconcile the
  user request with them before starting implementation.
- If the user request matches an open issue, explicitly work from that issue,
  reference its number in the plan, and keep the implementation aligned with its
  acceptance criteria.
- If the user request conflicts with an open issue, stop and call out the
  conflict instead of silently overriding the backlog.
- For gameplay changes, especially physics, ship life/damage, pack contact,
  crash-out, bots, HUD, or audio feedback, check whether an existing gameplay
  issue already frames the desired direction.
- Keep handoff summaries tied to the issue when relevant: what changed, what was
  intentionally deferred, and what should be tested manually.

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
