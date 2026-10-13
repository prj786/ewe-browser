@AGENTS.md

Claude-specific notes:

- Run pnpm as `npx -y pnpm@11.13.0`; the `pnpm` shim on PATH is broken.
- Verify every change with the full loop in AGENTS.md and look at the screenshots before reporting.
- Test windows belong on Hyprland workspace 2; the e2e setup and `scripts/visual.mjs` handle that.
- Do not commit until the owner has reviewed `git diff --cached`.
- Open bugs and the roadmap live in `docs/PLAN.md`; update it when something lands.
