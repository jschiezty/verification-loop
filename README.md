# verification-loop

When agents write a growing share of your code, the question that matters is not "did the agent say done?" but "what checked this change, against which commit, and is that still true?"

This kit helps you answer that for your own repository. It has three parts:

- **Prompts** you paste into any coding agent: a read-only audit that maps how your repository verifies changes and proposes a risk-based plan, an implementation prompt for one agreed improvement, and a handoff format that ties evidence to a commit.
- **`vloop`**, a small CLI with no dependencies (Node 18+): an inventory scan, a risk classifier for a diff, and a local ledger of which checks ran on which commit, so stale evidence is easy to see.
- **Runnable examples** around a tiny demo app: unit and property tests, a Playwright user-journey test, a pre-push hook, a Claude Code stop hook and a GitHub Actions workflow. The demo has two seeded bugs so you can watch each check catch the one it is meant for.

It does not score your repository, install anything into it, or decide whether a change is correct. A green check means the listed checks passed on that commit. That is evidence, not proof.

> **Illustrative starting point.** The examples, policy and workflow show one way to do this. They will likely need changes to fit your stack, your risks and your team, and none of them is a ready-made policy. Read them before you copy anything into a real project, and test them there. See [docs/adapting.md](docs/adapting.md).

## Try it in five minutes

```sh
git clone https://github.com/jschiezty/verification-loop.git
cd verification-loop

# 1. Inventory any repository (read-only)
node bin/vloop.mjs scan /path/to/your/repo

# 2. Watch tests catch seeded bugs
node --test demo/test/                               # passes
DEMO_BUG=float-total node --test demo/test/          # the property test on totals fails
DEMO_BUG=duplicate-on-retry node --test demo/test/   # the idempotency property fails

# 3. The user journey (needs Playwright; uses installed Chrome to skip the browser download)
cd demo && npm install && PW_CHANNEL=chrome npx playwright test
DEMO_BUG=duplicate-on-retry PW_CHANNEL=chrome npx playwright test   # fails: a retry made a second invoice
cd ..

# 4. Evidence tied to a commit
node bin/vloop.mjs evidence run --check unit -- node --test demo/test/
node bin/vloop.mjs evidence check --require unit     # pass at this commit
# make a commit, then check again: the record is now stale and lists what changed
```

## Audit your own repository

1. Open your coding agent in your repository.
2. Paste [prompts/1-audit.md](prompts/1-audit.md). It changes nothing and returns a report: what exists at each stage, what is enforced and by what, what is tied to which commit, the riskiest gaps, and a plan that says for each step whether it is deterministic, needs agent judgment or needs a person.
3. Read it. Correct what it got wrong. Pick one item.
4. Paste [prompts/2-implement.md](prompts/2-implement.md) with that item. The agent must show the new check failing on a deliberate break before relying on it, and report evidence at the final commit.
5. Add [prompts/3-handoff.md](prompts/3-handoff.md) to your agent instructions so every handoff reports what was tested where.

Using Claude Code? Copy `skill/verification-loop/` into `.claude/skills/` and ask for a verification audit.

## Principles the kit follows

- **Observed, inferred, unknown.** Every claim says which it is. Branch rules, secrets and alerting usually live outside the repository; the audit marks them unknown instead of guessing.
- **Evidence belongs to a commit.** A pass on commit A says nothing about commit B. On a pull request, CI usually tests a merge commit, not the PR head; under a merge queue, a different merge commit again. Record which.
- **Gates live outside the agent.** Prompts and hooks shape behavior. Required checks, rulesets and code-owner review enforce it. An agent can flag extra risk; it should not be able to waive a rule or edit the policy that judges its own change.
- **Match checks to risk.** A docs fix and a billing migration should not need the same checks or the same reviewer. [policy/example.risk.json](policy/example.risk.json) shows the idea; your tiers come from your audit.
- **Default to no new spend.** The journey test runs against a local server on the CI runner. Preview environments, paid services and extra CI minutes are opt-in decisions.

## What is in here

```
prompts/                 audit, implement, handoff (copy into any agent)
skill/verification-loop/ the same prompts and CLI as a Claude Code skill
bin/vloop.mjs            scan | risk | evidence run | evidence check
policy/                  an illustrative risk policy
examples/github-actions/ an illustrative workflow (not installed; read docs/adapting.md)
examples/hooks/          a pre-push hook template
examples/agent-hooks/    a Claude Code Stop hook that asks for evidence before "done"
demo/                    a tiny invoice app with seeded bugs, unit, property and journey tests
docs/adapting.md         other stacks, making checks required, previews, credentials, cost
```

This repository runs the same workflow as its own CI (`.github/workflows/verify.yml` is a copy of the example, kept identical by a test), so you can see real runs in the Actions tab.

## Run the kit's own tests

```sh
npm test            # vloop tests (temporary Git repos under your temp directory)
npm run lint        # needs shellcheck and actionlint
```

## Credits

See [CREDITS.md](CREDITS.md). The ideas draw on the Claude Code team's writing on verification, PostHog on code review and DORA's research. Neighboring tools such as OpenSSF Scorecard and agent-readiness scanners answer different questions and work well alongside this one.

## License

[MIT](LICENSE).
