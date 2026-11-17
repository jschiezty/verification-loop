# Handoff

State on 17 Nov 2026: first usable version, public at https://github.com/jschiezty/verification-loop under MIT.

## What works and how it was checked

- `vloop scan | risk | evidence run | evidence check`: 20 tests in `test/` (temporary Git repos). A mutation pass (six hand-made bugs: dirty runs counting for a commit, the wrong tier winning, the earliest record winning, a missing merge_group warning, `*` crossing directories, a swallowed exit code) was caught by the tests every time.
- Demo: the property tests fail under `DEMO_BUG=float-total` and `DEMO_BUG=duplicate-on-retry` and pass without them. The Playwright journey (1.64.1, run with installed Chrome) passes, and fails under `duplicate-on-retry` with a screenshot.
- `examples/hooks/pre-push`: run against a scratch bare remote. It passes on clean code, blocks the push with a seeded bug, and skips branch deletions. shellcheck is clean.
- `examples/agent-hooks/require-evidence.sh`: run with simulated Stop input. It blocks when the current commit has no passing record, respects `stop_hook_active`, and allows the stop once evidence passes. Not yet tried inside a live Claude Code session.
- `examples/github-actions/verify.yml`: actionlint is clean. **Never run on GitHub.** The first real run happens when the repo has a remote.
- `prompts/1-audit.md`: dogfooded once by a fresh agent on a public repository (notes in the workspace, not in this repo). It produced a cited, useful report, and its feedback was applied to the prompt and the scanner.

## Open

1. Confirm the workflow on GitHub on every trigger it has (the pull_request risk job has only run in local tests so far).
2. Try the Stop hook in a live Claude Code session.
3. Run the audit prompt on two or three more repositories in different stacks (Python, Go, a mobile app) and fold the misses into the scanner.
4. Follow-on: a per-stage ladder (missing, exists, runs in CI, required, tied to a commit, covers what matters) in place of a score; tracked in the content backlog.
5. Possible later: `vloop evidence` output as a GitHub check-run summary; a `differential` test example; a short screencast for the article.

## Decisions made

- No score or maturity level, so a number cannot stand in for evidence. The scan says found, not-found or unknown, with citations.
- One CLI with no dependencies, instead of a framework. The prompts work without it.
- The journey runs on the CI runner by default; preview environments are opt-in, so there is no cloud spend by default.
- The risk job reads the policy and the tool from the base branch. The docs say plainly that rulesets, not the workflow, close the loop.
