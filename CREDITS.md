# Credits and related work

This kit is original work. It copies no code or text from the projects below. They shaped its ideas, and they are worth reading.

## Ideas

- **How the Claude Code team thinks about verification** (claude.dev blog, November 2026). End-to-end, property and differential tests; a `verify` skill; escalating to a person after repeated failed fixes; review rules read from the base branch so a change cannot modify its own judges; stamping commits with how they were verified; observe-then-enforce gates. https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/
- **PostHog on code review**: separating changes that are eligible for lighter review from ones that need human judgment. https://posthog.com/newsletter/code-review-tips
- **DORA capabilities**: continuous integration, test automation, monitoring, and streamlined change approval as research-backed practices. https://dora.dev/capabilities/
- **The Factory Stack** (Warp): the wider system around a verification loop. https://www.warp.dev/blog/the-factory-stack

## Neighboring tools

These answer different questions. Use them alongside this kit.

| Project | License | What it answers |
| --- | --- | --- |
| [OpenSSF Scorecard](https://github.com/ossf/scorecard) | Apache-2.0 | Is the repository's supply chain secure (branch protection, token permissions, pinned dependencies)? |
| [kodustech/agent-readiness](https://github.com/kodustech/agent-readiness) | MIT | Is the codebase set up for agents to work in (docs, linting, dev environment)? |
| Factory.ai Agent Readiness | Proprietary | The same question, as a hosted product. |
| [actions/attest-build-provenance](https://github.com/actions/attest-build-provenance) | MIT | Signed provenance tying a build artifact to its source commit. |
| [SLSA](https://slsa.dev) and [in-toto attestations](https://github.com/in-toto/attestation) | See each project | Standard formats for that provenance. |
| [pre-commit](https://github.com/pre-commit/pre-commit), [lefthook](https://github.com/evilmartians/lefthook), [husky](https://github.com/typicode/husky) | MIT | Managing Git hooks. Prefer one of these to the example hook if you already use it. |
| [AGENTS.md](https://github.com/agentsmd/agents.md) | MIT | A common place to tell any agent how to build and test a project. |

This kit's question: when a change ships, what checked it, against which commit, is that evidence still current, and who had to approve it given its risk?

## Documentation used

GitHub Actions events (including `merge_group` and `deployment_status`), rulesets and required status checks; Claude Code hooks and skills; Playwright test configuration, traces and web server.
