# Adapting the examples

The examples verify the demo app in this kit. They show a shape; the right checks for your repository come out of the audit. Start there, then borrow what fits.

## What is illustrative and what is not

| Piece | Status |
| --- | --- |
| `prompts/` | Ready to use as is. Edit freely. |
| `bin/vloop.mjs` | Works on any Git repository. Its scan is a heuristic inventory; its evidence ledger is a local note, not proof. |
| `policy/example.risk.json` | Illustrative. The paths and check names are placeholders. Your tiers come from your own risk areas. |
| `examples/github-actions/verify.yml` | Illustrative. Commands, paths and the preview job are for the demo. |
| `examples/hooks/pre-push` | A working template. Replace the check list. |
| `examples/agent-hooks/` | A working template for Claude Code. Other agents have their own hook systems. |
| `demo/` | A teaching target with two seeded bugs. Not a pattern for application code. |

None of it is a policy you can adopt without review. A green run of any of it means the listed checks passed on that commit, nothing more.

## Your stack

The kit does not assume Node for your project. Only `vloop` itself needs Node 18+, and you can skip it entirely: the prompts work without it.

- **Checks.** Replace the commands with your own: `pytest -q`, `go test ./...`, `cargo test`, `./gradlew test`, `bundle exec rspec`, `make check`. Wrap any of them with `vloop evidence run --check <name> --` if you want a ledger.
- **Property tests.** fast-check (JS/TS), Hypothesis (Python), proptest (Rust), jqwik (Java), gopter or `testing/quick` (Go). The demo's hand-rolled generator only avoids a dependency.
- **Journeys.** Playwright is one option. Cypress, WebdriverIO, Maestro or Detox (mobile), or an HTTP-level test for an API all work. What matters: the real path a person takes, isolated test data, and a record of which revision was tested.
- **Other CI.** The workflow ideas carry over to GitLab CI, CircleCI, Buildkite and others: run on the change and on the merge result, cancel superseded runs, record the commit, keep artifacts, and make the jobs required in the platform's own settings.

## Make a check a gate

A job in a workflow file is a suggestion until something requires it.

- On GitHub: add the job names as required status checks in branch protection or a ruleset on the default branch. If you use a merge queue, the same workflow must run on `merge_group`.
- Protect the rules themselves: require code-owner review for `.github/workflows/**`, the risk policy and CODEOWNERS, or use an organization-level required workflow that a PR cannot edit.
- The example `risk` job reads the policy and the tool from the base branch. That stops a PR from quietly loosening the policy file, but a PR can still edit the workflow. The ruleset is what closes that.

## Preview environments and missing credentials

- **No preview environment.** The `journey` job starts the app on the runner and tests it there. That covers most journeys without any cloud cost. Add a preview later, when you need real infrastructure or human design review.
- **A preview that reports deployments** (Vercel, Netlify, Render and others can send GitHub `deployment_status` events). The `preview-journey` job runs only when such an event arrives with a URL, checks out the deployed commit, and fails if the app reports a different revision. Expose the revision somewhere the test can read it; the demo uses `/health`.
- **A preview behind a login.** Give the job a dedicated test account through repository secrets, available only to trusted branches. Never give fork PRs production credentials. If the secret is missing, fail the job with a clear message or skip it visibly. Do not let it pass.
- **Shared test data.** Separate browser contexts do not isolate a shared database, email queue or payment sandbox. Use per-run data you can identify and clean up.

## Keeping CI cost down

- Cancel superseded runs (`concurrency` with `cancel-in-progress`).
- Skip docs-only changes with `paths-ignore`, but never on a check that is required, or the PR will wait forever for a check that never runs. Use a small always-run job that reports success for skipped paths if you need both.
- Set `timeout-minutes` on every job.
- Install one browser, not all of them. Keep traces and screenshots only on failure. Set artifact retention.
- Run expensive suites (full cross-browser, load, long property runs) on a schedule or on high-risk tiers only, using the `risk` job's output.
- Public repositories get free standard runners on GitHub; private repositories spend included minutes and then pay. Check your plan before adding jobs.

## The evidence ledger

`vloop evidence run` appends to `.verification/evidence/<sha>.jsonl` at the top of the work tree. Add `.verification/` to `.gitignore`. In CI, upload it as an artifact named with the commit, as the example does. To link a deployed build to its evidence, record the commit in the build (an environment variable or a `/health` field) and keep the CI run URL with the release. For signed provenance, see GitHub artifact attestations and SLSA (links in CREDITS.md).
