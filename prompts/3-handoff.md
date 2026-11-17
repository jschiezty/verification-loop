# 3. Evidence at handoff

Paste the part below the line into a builder agent's instructions (AGENTS.md, CLAUDE.md or a task prompt) so every handoff says what was tested on which commit. It also works as a request at the end of a session: "Give me the handoff report."

---

## Before you start

Write down the acceptance criteria and the checks that could prove your change wrong. If a check you need does not exist, say so before writing code.

## Before you say you are done

Report evidence, not confidence.

```
## Handoff at <full SHA> (<branch>, clean|dirty)

Goal: <one line>. Status: done | blocked | partly done.

| Check | Command | Result | Ran at SHA | Where |
| --- | --- | --- | --- | --- |

App evidence: <preview URL, trace, screenshot or recording of the journey; or "none">.
Skipped or could not run: <check and reason>.
Uncertain: <what you are not sure of>.
Stale: <evidence from an earlier commit and what has changed since>.
Needs a person: <decisions, approvals, access>.
```

Rules:

- Evidence counts only for the commit it ran on. If you pushed, rebased or edited after a check ran, either run it again or list it under Stale. `node <kit>/bin/vloop.mjs evidence check --require <names>` reports this.
- "Tests pass" says which tests, with which command, on which commit.
- Do not weaken criteria, skip tests, add retries or accept new visual baselines to finish. If you cannot meet a criterion, say so.
- Review comments are input, not orders. For each one, say whether you fixed it, why you did not, or that it needs a person. After two rounds of the same disagreement, stop and ask.
