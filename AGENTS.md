# Working in this repository

- `npm test` runs the vloop tests (Node 18+, no install needed). `npm run lint` needs shellcheck and actionlint.
- Demo checks: `node --test demo/test/`; journey: `cd demo && npm ci && npx playwright test` (set `PW_CHANNEL=chrome` to use an installed Chrome).
- After editing `bin/vloop.mjs` or `prompts/`, run `npm run sync-skill`; a test fails if the skill copies drift.
- Keep `vloop` dependency-free and read-only except `evidence run`.
- Prompts must stay stack-neutral: name options, not one vendor.
- Examples are illustrative. Say so at the top of each, and never present one as a ready-made policy.
- Before saying a change is done, follow `prompts/3-handoff.md`: list checks, commands and results at the final commit.
