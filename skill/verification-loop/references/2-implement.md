# 2. Implement one agreed improvement

Use this after you have read the audit and picked one item from its plan. Fill in the bracketed part, then paste everything below the line into the same agent session, or a new one with the audit report attached.

---

Implement this improvement from the verification audit, and nothing else:

> [paste the plan item, and any changes you made to it]

## How to work

1. **Restate the goal** in one or two sentences, with acceptance criteria: what failure the new check must catch, and what it must not flag. If the item is ambiguous, ask before editing.
2. **Show the gap first.** Before adding the check, demonstrate the failure it is meant to catch: a test that fails on a deliberately broken version, a seeded bug, or a reproduction of a past incident. Revert the deliberate break afterwards. A check you have never seen fail is unproven.
3. **Make the change** in the repository's own style, using tools it already has. Keep unrelated files untouched. If the change adds a dependency, a paid service, a new secret, a preview environment or more CI minutes than a few per run, stop and ask.
4. **Keep enforcement outside yourself.** You may add or change tests, workflows and hooks. Do not change branch protection, rulesets, CODEOWNERS, required reviewers, review rules or the risk policy unless that is the agreed item, and in that case prepare the change for a human to apply or approve. Never weaken an existing check, mark a test as skipped, add retries or sleeps to make a flaky test pass, or accept new screenshot baselines just to get a green result.
5. **Handle what you cannot run.** If the check needs credentials, a preview environment or a service you cannot reach, make it fail clearly or skip with a visible reason when that dependency is missing. Do not let it pass silently. Document how a person can run it.
6. **Verify on the final commit.** Commit, then run the new check and the existing checks it could affect against that commit. If you change anything after that, run them again. Record each run, for example:
   `node <kit>/bin/vloop.mjs evidence run --check <name> -- <command>`
   If the working tree is dirty when you run a check, say so: the result describes the working tree, not the commit.
7. **Explain it.** Add a short note where the repository keeps such things (README, CONTRIBUTING, docs) covering what the check does, how to run it locally, and what to do when it fails.

## Report

```
## What changed
Files and why, in plain words.

## Proof it catches the failure
The deliberate break, the failing output, the revert.

## Evidence at <full SHA>
| Check | Command | Result | Where (local, CI run URL) |

## Skipped or not verified
And why. Anything that needs credentials, an environment or a person.

## Needs a person
Settings to change (required checks, rulesets), approvals, spend.

## Next gap
The next item from the plan, or a new one you found.
```
