# 1. Audit the verification loop (read-only)

Paste everything below the line into a coding agent that is running in the repository you want to assess. It works with any agent that can read files and run shell commands. It does not change files.

If you have this kit checked out, the agent can run `node <path-to-kit>/bin/vloop.mjs scan .` first for a quick inventory. The scan is a starting point, not the audit.

---

You are auditing how this repository verifies changes, from a developer's machine to production. The goal is a short, honest report that a person can act on. **Do not change any files, install anything, push, open pull requests, trigger workflows or deploy during this audit.** Read-only commands are fine, including read-only `gh api` calls if the GitHub CLI is already authenticated.

## Ground rules

- Every claim is one of three kinds. Label each one.
  - **Observed**: you saw it in a named file, a command's output or a settings page. Cite the file and line, the command, or the URL.
  - **Inferred**: a reasonable conclusion from what you observed. Say what it rests on.
  - **Unknown**: you could not see it. Say what would settle it and who can check.
- A workflow file is not a gate. A check only gates merging if branch protection or a ruleset requires it. If you cannot read those settings, the gate is Unknown.
- A passing check is not proof of correctness. Describe what each check would catch, and what it would miss.
- Do not report anything as tested unless you ran it or saw a run for the exact commit. Do not run commands that need secrets, write to shared environments, send messages, spend money or touch production. If running the test suite looks expensive or risky, say so and skip it.
- Prefer the repository's own tools and conventions. Do not recommend a platform change when a small change would do.

## Steps

1. **Revision.** Record `git rev-parse HEAD`, the branch, and whether the working tree is dirty. Everything you observe is about this commit.

2. **Stack.** Languages, frameworks, package managers, how the app runs, what it depends on (databases, queues, payment or email providers, third-party APIs). Note which of those have test doubles, sandboxes or local equivalents.

3. **Inventory the loop.** For each stage, find what exists, cite it and say how it is enforced.
   - Definition of done: issue or PR templates, acceptance criteria, agent instructions (AGENTS.md, CLAUDE.md and similar).
   - Local feedback: Git hooks (`.git/hooks`, `core.hooksPath`, husky, lefthook, pre-commit), agent hooks (`.claude/settings.json` and similar), and whether a fresh clone gets them.
   - Tests by kind: unit, integration, property, differential, contract, end-to-end. For each kind: how many, how they run, how long, and whether they run in CI.
   - CI: workflow triggers (`pull_request`, `merge_group`, `push`, `pull_request_target`), what each job runs, permissions, which secrets it can reach, and whether fork PRs get those secrets.
   - Required checks and review rules: branch protection, rulesets, CODEOWNERS, required approvals, merge queue. Try `gh api repos/OWNER/REPO/rulesets` and `gh api repos/OWNER/REPO/branches/BRANCH/protection`. If those fail for lack of access, mark the gate Unknown.
   - Code review: human reviewers, review bots, review rules files, and whether review rules are read from the base branch or from the PR.
   - Preview environments: per-branch or per-PR deploys, how the URL is found, how they are seeded with data, who can reach them, and whether they need credentials.
   - User-journey testing: which journeys are automated, against what (local, preview, staging), and with what test data.
   - Deployment: how a commit becomes a release, who or what approves it, and whether the deployed artifact can be traced to a commit.
   - After deploy: smoke tests, health checks, monitoring, alerts, rollback. Note whether anything checks that the business workflow still works, not just that the server is up.

4. **Evidence and commits.** For the stages that produce evidence (CI runs, test reports, traces, screenshots, deploy logs), answer:
   - Is it tied to an exact commit SHA? Which SHA: the PR head, a merge commit, a merge-queue commit, or the deployed build?
   - What makes it stale? A new push, a rebase, a base-branch change, a dependency update, a config or secret change, a new deploy.
   - Can anyone tell, from the PR or the deploy, which commit was actually tested?
   If you can, look at the latest run for the default branch and for one open PR, and compare the SHA each run tested with the branch or PR head. Note the event that triggered each run (push, pull_request, merge_group); they test different commits.

5. **Risk.** Identify the parts of this codebase where a mistake costs the most. Typical candidates: authentication, authorization and permissions, money, data deletion or migrations, public API contracts, privacy-sensitive data, anything customers rely on daily. Use the code and history (for example `git log` on reverts and hotfixes) as evidence, not assumptions. Name the 1 to 3 user journeys that matter most and say how each is verified today.

6. **Gaps.** For each gap, say what could go wrong, how likely and how costly that is given the risk areas, and what would close it.

7. **Plan.** Propose a prioritized plan. For each item:
   - the change, in one or two sentences, reusing existing tools;
   - which risk it addresses and what failure it would catch;
   - whether the check is **deterministic** (tests, linters, type checks, schema checks, required status checks, path-based rules), needs **agent judgment** (exploratory QA on a preview, reviewing a diff against rules, triaging findings), or needs **human judgment** (product taste, architecture, risk acceptance, approving changes to sensitive areas or to the rules themselves);
   - where it is enforced, kept outside any agent's own self-assessment: required checks, rulesets, code-owner review, environment protection. An agent may flag extra risk; it should not be able to waive a rule, approve its own change or edit the policy that judges it;
   - cost: CI minutes, paid services, preview environments, maintenance. Default to options that add no paid spend, and say clearly when one would;
   - what you need from a person (access, decisions, credentials, approvals).
   Put the smallest useful step first. Match the depth of checks and the need for a human reviewer to the risk of a change. Not every change needs every check.

## Report format

Return this report, then stop and wait for the human to choose what to do.

```
# Verification audit: <repo> at <short SHA> (<branch>, clean|dirty)

## Summary
3 to 5 sentences: how changes are verified today, the biggest risk, and the first step you recommend.

## The loop today
| Stage | What exists | Enforced by | Evidence tied to commit? | Status |
| --- | --- | --- | --- | --- |
(one row per stage from step 3; merge stages that share one mechanism, and say "none" rather than dropping a stage. Status is Observed, Inferred or Unknown; put citations below the table)

## Evidence and staleness
What is tested at which SHA, and what would make it stale.

## Risk areas and key journeys
Each with how it is verified today.

## Gaps, highest risk first
1. Gap: what could go wrong. Likelihood and cost. Evidence.

## Proposed plan
| # | Change | Catches | Deterministic / agent / human | Enforced where | Cost | Needs from a person |
| --- | --- | --- | --- | --- | --- | --- |

## Unknowns to resolve
Each with who or what could resolve it.

## What I did not do
Commands skipped and why, settings I could not read.
```
