---
name: verification-loop
description: Audit how this repository verifies changes (hooks, tests, CI, required checks, review, preview environments, user journeys, deploy and monitoring), separate observed facts from assumptions, propose a risk-based plan, implement one agreed improvement, and report what was tested at which commit. Use when asked to assess or improve verification, CI, test coverage of key journeys, merge gates, or evidence at handoff.
---

# Verification loop

Three modes. Pick the one the request asks for; if unclear, start with the audit.

1. **Audit** (read-only). Run `node ${CLAUDE_SKILL_DIR}/scripts/vloop.mjs scan .` for a quick inventory, then follow `references/1-audit.md` exactly. Do not change files. Return the report in the format it gives and stop.
2. **Implement** one improvement the human has agreed to. Follow `references/2-implement.md`. Prove the new check fails on a deliberate break before relying on it.
3. **Handoff**. Report evidence per `references/3-handoff.md`. Use `node ${CLAUDE_SKILL_DIR}/scripts/vloop.mjs evidence run --check <name> -- <command>` to record checks and `... evidence check --require <names>` to see what is current at HEAD and what is stale.

Always:

- Label claims Observed (with a citation), Inferred (with its basis) or Unknown (with who could settle it).
- A workflow file is not a gate, and a green check is not proof the change is right.
- Do not change branch protection, rulesets, CODEOWNERS, review rules or the risk policy on your own, and never weaken a check to get a pass.
- Do not run anything that needs production credentials, spends money or writes to shared environments without the human's go.
