#!/usr/bin/env node
// vloop: inventory a repository's verification loop, classify a diff by risk,
// and keep a local ledger of which checks ran against which commit.
//
// Zero dependencies. Node 18+. Read-only except `evidence run`, which writes
// only under <repo>/.verification/.
//
// This is a helper for humans and agents, not an enforcement point. Anything
// it reads or writes locally can be edited by whoever runs it. Enforcement
// belongs in CI required checks, rulesets and access controls.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = '0.1.0';
const EVIDENCE_DIR = '.verification/evidence';
// The ledger lives in the work tree; it must not make the tree look dirty.
const NOT_LEDGER = ['--', '.', ':(exclude).verification'];

// ---------- small helpers ----------

function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${(err.stderr || err.message).toString().trim()}`);
  }
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function read(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

function listDir(root, rel) {
  try {
    return fs.readdirSync(path.join(root, rel));
  } catch {
    return [];
  }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.next', 'target', '.venv', 'venv', '__pycache__', '.verification']);

// Walk the tree up to a file budget so huge monorepos still return quickly.
function walk(root, { maxFiles = 20000 } = {}) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < maxFiles) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(child);
      } else if (e.isFile()) {
        out.push(child);
      }
    }
  }
  return { files: out, truncated: stack.length > 0 };
}

// Glob to RegExp: `**` spans directories, `*` and `?` stay inside one segment.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(file, globs) {
  return globs.some((g) => globToRegExp(g).test(file));
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      opts['--'] = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else {
        opts[key] = next;
        i++;
      }
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

// ---------- scan ----------

// Every finding carries a status:
//   found      the scanner saw it in a file it names in `evidence`
//   not-found  the scanner looked in the listed places and saw nothing;
//              it may still exist somewhere the scanner does not look
//   unknown    cannot be seen from a checkout (server settings, secrets, alerts)
// The scanner never says whether a check is good, only whether it is there.

// Which package.json scripts a workflow runs, following scripts that call
// other scripts and npm's automatic pre/post hooks. Heuristic: it reads
// command text, so a script run through a Makefile or shell file is missed.
export function scriptsReachedByCi(scripts, workflowText) {
  const invoked = (text, name) => {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(npm run|npm run-script|pnpm( run)?|yarn( run)?|bun run|turbo run|nx run)\\s+(--?[\\w-]+\\s+)*${n}(?![\\w:-])`).test(text) || (name === 'test' && /(npm|pnpm|yarn|bun) (t|test)(?![\w:-])/.test(text));
  };
  const reached = new Set();
  const queue = Object.keys(scripts).filter((k) => invoked(workflowText, k));
  while (queue.length) {
    const k = queue.pop();
    if (reached.has(k)) continue;
    reached.add(k);
    for (const hook of [`pre${k}`, `post${k}`]) if (scripts[hook]) queue.push(hook);
    for (const other of Object.keys(scripts)) if (!reached.has(other) && invoked(scripts[k], other)) queue.push(other);
  }
  return reached;
}

function finding(area, status, detail, evidence = []) {
  return { area, status, detail, evidence };
}

function workflowTriggers(text) {
  const names = ['pull_request_target', 'pull_request', 'merge_group', 'push', 'workflow_dispatch', 'schedule', 'deployment_status', 'workflow_run', 'release'];
  const onBlock = text.match(/^on:\s*(.*)$([\s\S]*?)(?=^\S|(?![\s\S]))/m) || text.match(/^"?on"?:\s*(.*)$/m);
  const scope = onBlock ? onBlock[0] : text;
  return names.filter((n) => new RegExp(`(^|[\\s\\[,'"-])${n}(?![a-z_])`, 'm').test(scope));
}

export function scan(root) {
  const findings = [];
  const { files, truncated } = walk(root);
  const has = (re) => files.filter((f) => re.test(f));

  // Revision
  const sha = git(root, ['rev-parse', 'HEAD'], { allowFail: true });
  const dirty = sha ? git(root, ['status', '--porcelain', ...NOT_LEDGER], { allowFail: true }) : null;
  const branch = sha ? git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true }) : null;
  const revision = { sha, branch, dirty: dirty ? dirty.split('\n').length : 0 };

  // Git hooks
  const hooksPath = git(root, ['config', '--get', 'core.hooksPath'], { allowFail: true });
  const gitDirRaw = git(root, ['rev-parse', '--git-dir'], { allowFail: true });
  const gitDir = gitDirRaw ? path.resolve(root, gitDirRaw) : null;
  const activeHooks = [];
  const hookDir = hooksPath ? path.resolve(root, hooksPath) : gitDir && path.join(gitDir, 'hooks');
  if (hookDir) {
    for (const h of listDir(hookDir, '.')) {
      if (h.endsWith('.sample')) continue;
      activeHooks.push(h);
    }
  }
  if (activeHooks.length) {
    findings.push(finding('git-hooks', 'found', `Active hooks in ${hooksPath || '.git/hooks'}: ${activeHooks.join(', ')}. Local to this clone; a fresh checkout may not have them.`, [hooksPath || '.git/hooks']));
  } else {
    findings.push(finding('git-hooks', 'not-found', 'No active Git hooks in this clone.', [hooksPath || '.git/hooks']));
  }
  const hookManagers = [
    ['.husky', 'husky'],
    ['lefthook.yml', 'lefthook'],
    ['lefthook.yaml', 'lefthook'],
    ['.lefthook.yml', 'lefthook'],
    ['.pre-commit-config.yaml', 'pre-commit'],
  ].filter(([p]) => exists(root, p));
  for (const [p, name] of hookManagers) {
    const text = read(root, p) || '';
    const prePush = /pre-push/.test(text) || (name === 'husky' && exists(root, '.husky/pre-push'));
    findings.push(finding('git-hooks', 'found', `${name} config${prePush ? ' (has pre-push)' : ''}. Installed only after each developer or agent runs its install step.`, [p]));
  }

  // Agent instructions and hooks
  const agentFiles = ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', '.github/copilot-instructions.md', 'GEMINI.md', '.cursorrules'].filter((p) => exists(root, p));
  agentFiles.push(...has(/^\.cursor\/rules\//));
  if (agentFiles.length) findings.push(finding('agent-instructions', 'found', 'Agent instruction files. Instructions guide an agent; they do not enforce anything.', agentFiles));
  else findings.push(finding('agent-instructions', 'not-found', 'No agent instruction files (AGENTS.md, CLAUDE.md, copilot-instructions, cursor rules).'));
  for (const p of ['.claude/settings.json', '.claude/settings.local.json']) {
    const text = read(root, p);
    if (!text) continue;
    try {
      const hooks = JSON.parse(text).hooks || {};
      const events = Object.keys(hooks);
      if (events.length) findings.push(finding('agent-hooks', 'found', `Claude Code hooks on: ${events.join(', ')}.`, [p]));
    } catch {
      findings.push(finding('agent-hooks', 'found', 'Settings file exists but is not valid JSON.', [p]));
    }
  }
  const skills = has(/^\.claude\/skills\/[^/]+\/SKILL\.md$/);
  const verifySkills = skills.filter((s) => /verif|smoke|qa|test/i.test(s));
  if (verifySkills.length) findings.push(finding('agent-hooks', 'found', 'Verification-related agent skills.', verifySkills));

  // CI
  const workflows = has(/^\.github\/workflows\/[^/]+\.ya?ml$/);
  const triggerSummary = {};
  for (const wf of workflows) {
    const text = read(root, wf) || '';
    const triggers = workflowTriggers(text);
    triggerSummary[wf] = triggers;
    const notes = [];
    if (triggers.includes('pull_request_target')) notes.push('uses pull_request_target: runs with base-branch secrets; check it never checks out or runs PR code');
    if (!/^permissions:/m.test(text)) {
      notes.push(/^\s+permissions:/m.test(text) ? 'permissions set per job, not at the top level (check every job has one)' : 'no permissions block (token gets the repo default)');
    }
    if (/secrets\./.test(text)) notes.push('references secrets');
    if (/upload-artifact/.test(text)) notes.push('uploads artifacts');
    if (/environment:/.test(text)) notes.push('uses deployment environments');
    findings.push(finding('ci', 'found', `Triggers: ${triggers.join(', ') || 'none detected'}${notes.length ? `; ${notes.join('; ')}` : ''}.`, [wf]));
  }
  const otherCi = ['.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile', 'azure-pipelines.yml', '.buildkite/pipeline.yml', 'bitbucket-pipelines.yml', '.drone.yml'].filter((p) => exists(root, p));
  for (const p of otherCi) findings.push(finding('ci', 'found', 'Non-GitHub CI config. The scanner does not parse it; read it directly.', [p]));
  if (!workflows.length && !otherCi.length) findings.push(finding('ci', 'not-found', 'No CI configuration in the usual places.'));
  const anyPr = Object.values(triggerSummary).some((t) => t.includes('pull_request'));
  const anyMergeGroup = Object.values(triggerSummary).some((t) => t.includes('merge_group'));
  if (anyPr && !anyMergeGroup) {
    findings.push(finding('ci', 'unknown', 'Workflows run on pull_request but none on merge_group. If the repo uses a merge queue, required checks must also run on merge_group or the queue stalls or tests a different commit than the PR.', workflows));
  }

  const workflowText = workflows.map((wf) => read(root, wf) || '').join('\n');

  // Tests
  const pkg = read(root, 'package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      const scripts = j.scripts || {};
      const interesting = Object.keys(scripts).filter((k) => /test|lint|type|check|e2e|verify|smoke/i.test(k));
      findings.push(finding('tests', interesting.length ? 'found' : 'not-found', interesting.length ? `package.json scripts: ${interesting.join(', ')}.` : 'package.json has no test, lint or check scripts.', ['package.json']));
      if (interesting.length && workflows.length) {
        const reached = scriptsReachedByCi(scripts, workflowText);
        const unreached = interesting.filter((k) => !reached.has(k) && !/watch|ui$|:up$|:down$|^pre|^post/.test(k));
        if (unreached.length) findings.push(finding('tests', 'found', `Scripts no workflow runs, directly or through another script: ${unreached.join(', ')}. If any of these guard important behavior, CI is not checking it.`, ['package.json', ...workflows]));
      }
      const deps = { ...j.dependencies, ...j.devDependencies };
      const prop = ['fast-check', '@fast-check/vitest', '@fast-check/jest'].filter((d) => deps[d]);
      if (prop.length) findings.push(finding('tests', 'found', `Property-testing library: ${prop.join(', ')}.`, ['package.json']));
      const mon = Object.keys(deps).filter((d) => /^@sentry\/|^@opentelemetry\/|^dd-trace$|^newrelic$|^@datadog\/|^@honeycombio\/|^posthog/.test(d));
      if (mon.length) findings.push(finding('monitoring', 'found', `Monitoring or telemetry packages: ${mon.join(', ')}. Being installed does not mean alerts exist.`, ['package.json']));
    } catch {
      findings.push(finding('tests', 'found', 'package.json is not valid JSON.', ['package.json']));
    }
  }
  const pyFiles = ['pyproject.toml', 'setup.cfg', 'requirements.txt', 'requirements-dev.txt', 'pytest.ini', 'tox.ini'].filter((p) => exists(root, p));
  const pyText = pyFiles.map((p) => read(root, p) || '').join('\n');
  if (pyFiles.length) {
    const bits = [];
    if (/pytest/.test(pyText)) bits.push('pytest');
    if (/hypothesis/.test(pyText)) bits.push('hypothesis (property tests)');
    if (/ruff|flake8|pylint/.test(pyText)) bits.push('linter');
    if (/mypy|pyright/.test(pyText)) bits.push('type checker');
    findings.push(finding('tests', bits.length ? 'found' : 'not-found', bits.length ? `Python tooling: ${bits.join(', ')}.` : 'Python project without detected test tooling.', pyFiles));
    if (/sentry-sdk|opentelemetry|ddtrace|newrelic/.test(pyText)) findings.push(finding('monitoring', 'found', 'Python monitoring or telemetry dependency.', pyFiles));
  }
  if (exists(root, 'go.mod')) findings.push(finding('tests', has(/_test\.go$/).length ? 'found' : 'not-found', `Go module with ${has(/_test\.go$/).length} *_test.go files.`, ['go.mod']));
  if (exists(root, 'Cargo.toml')) {
    const cargo = read(root, 'Cargo.toml') || '';
    findings.push(finding('tests', 'found', `Rust crate${/proptest|quickcheck/.test(cargo) ? ' with property-testing crate' : ''}. Look for #[test] and tests/.`, ['Cargo.toml']));
  }
  const makefile = read(root, 'Makefile');
  if (makefile) {
    const targets = [...makefile.matchAll(/^([A-Za-z0-9_.-]+):/gm)].map((m) => m[1]).filter((t) => /test|lint|check|verify|e2e|smoke/i.test(t));
    if (targets.length) findings.push(finding('tests', 'found', `Makefile targets: ${targets.join(', ')}.`, ['Makefile']));
  }
  const testFiles = has(/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(py|go)$|^test_.*\.py$|\/test_[^/]*\.py$/);
  findings.push(finding('tests', testFiles.length ? 'found' : 'not-found', `${testFiles.length} test-looking files${truncated ? ' (file walk truncated)' : ''}. Count says nothing about what they cover.`, testFiles.slice(0, 5)));

  // End-to-end
  const e2e = has(/(^|\/)(playwright|cypress)\.config\.[cm]?[jt]s$|(^|\/)wdio\.conf\.[jt]s$|(^|\/)detox\.config\.js$|(^|\/)\.maestro\//);
  if (e2e.length) {
    findings.push(finding('e2e', 'found', 'End-to-end test config.', e2e));
    if (workflows.length && !/playwright|cypress|wdio|detox|maestro|e2e/i.test(workflowText)) {
      findings.push(finding('e2e', 'found', 'No workflow mentions the end-to-end runner or an e2e script, so these tests probably do not run in CI. Check for other entry points (Makefile, scripts/).', workflows));
    }
  }
  else findings.push(finding('e2e', 'not-found', 'No Playwright, Cypress, WebdriverIO, Detox or Maestro config.'));

  // Review
  const owners = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'].filter((p) => exists(root, p));
  if (owners.length) findings.push(finding('review', 'found', 'CODEOWNERS file. It routes review requests; whether code-owner review is required is a server setting.', owners));
  else findings.push(finding('review', 'not-found', 'No CODEOWNERS file.'));
  const reviewCfg = ['REVIEW.md', '.coderabbit.yaml', '.coderabbit.yml', '.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md'].filter((p) => exists(root, p));
  if (reviewCfg.length) findings.push(finding('review', 'found', 'Review rules, bot config or PR template.', reviewCfg));

  // Preview and deploy
  const deployCfg = ['vercel.json', 'netlify.toml', 'fly.toml', 'render.yaml', 'app.yaml', 'wrangler.toml', 'wrangler.jsonc', 'Procfile', 'serverless.yml', 'amplify.yml', 'railway.json', 'Dockerfile', 'docker-compose.yml', 'compose.yaml'].filter((p) => exists(root, p));
  deployCfg.push(...has(/^(k8s|kubernetes|helm|charts|terraform|infra|deploy)\/[^/]+$/).slice(0, 3));
  if (deployCfg.length) findings.push(finding('deploy', 'found', 'Deployment or runtime config.', deployCfg));
  const previewWf = workflows.filter((wf) => /preview/i.test(read(root, wf) || ''));
  const deployWf = workflows.filter((wf) => /deploy|environment:/i.test(read(root, wf) || ''));
  if (previewWf.length) findings.push(finding('preview', 'found', 'Workflows that mention preview environments.', previewWf));
  if (deployWf.length) findings.push(finding('deploy', 'found', 'Workflows that mention deployment.', deployWf));
  findings.push(finding('preview', 'unknown', 'Hosted platforms (Vercel, Netlify, Render and others) can create previews from their own dashboards with no file in the repo. Check the platform or PR comments.'));
  const smokeWf = workflows.filter((wf) => /smoke|healthcheck|health-check|\/health/i.test(read(root, wf) || ''));
  if (smokeWf.length) findings.push(finding('monitoring', 'found', 'Workflows that mention smoke or health checks.', smokeWf));

  // Evidence ledger
  const ledger = readLedger(root);
  if (ledger.length) {
    const atHead = ledger.filter((r) => r.sha === sha);
    findings.push(finding('evidence', 'found', `${ledger.length} recorded check runs, ${atHead.length} at the current HEAD. Local records are notes, not proof.`, [EVIDENCE_DIR]));
  }

  // Things a checkout cannot show
  const unknowns = [
    'Branch protection or rulesets on the default branch, and which checks they require (try: gh api repos/OWNER/REPO/rulesets and gh api repos/OWNER/REPO/branches/BRANCH/protection, both read-only).',
    'Whether code-owner review, a minimum number of approvals or a merge queue is required.',
    'Which secrets each workflow can reach, and whether fork PRs get them.',
    'Deployment environment protection rules and who can approve a production deploy.',
    'Alert rules, error budgets, dashboards and the rollback procedure.',
    'Whether checks are flaky, retried into passing or routinely bypassed.',
  ];
  for (const u of unknowns) findings.push(finding('server-side', 'unknown', u));

  return { tool: `vloop ${VERSION}`, root: path.resolve(root), revision, findings };
}

function renderScan(result) {
  const lines = [];
  const { revision } = result;
  lines.push(`# Verification inventory`);
  lines.push('');
  lines.push(`Scanned \`${result.root}\` with ${result.tool}.`);
  lines.push(revision.sha ? `Revision \`${revision.sha}\` on \`${revision.branch}\`${revision.dirty ? `, with ${revision.dirty} uncommitted changes (results describe the working tree, not that commit)` : ', clean'}.` : 'Not a Git repository.');
  lines.push('');
  lines.push('Status: **found** = seen in the named file. **not-found** = not in the places the scanner looks; it may exist elsewhere. **unknown** = cannot be seen from a checkout. Nothing here says a check is correct or sufficient.');
  const order = ['git-hooks', 'agent-instructions', 'agent-hooks', 'tests', 'e2e', 'ci', 'review', 'preview', 'deploy', 'monitoring', 'evidence', 'server-side'];
  for (const area of order) {
    const items = result.findings.filter((f) => f.area === area);
    if (!items.length) continue;
    lines.push('');
    lines.push(`## ${area}`);
    for (const f of items) {
      const ev = f.evidence.length ? ` (${f.evidence.map((e) => `\`${e}\``).join(', ')})` : '';
      lines.push(`- **${f.status}**: ${f.detail}${ev}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ---------- risk ----------

export function loadPolicy(file) {
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(policy.tiers) || !policy.tiers.length) throw new Error(`${file}: "tiers" must be a non-empty array`);
  for (const t of policy.tiers) {
    if (!t.name || !Array.isArray(t.paths) || !Array.isArray(t.requires)) throw new Error(`${file}: each tier needs name, paths[] and requires[]`);
  }
  if (!policy.default || !Array.isArray(policy.default.requires)) throw new Error(`${file}: "default" needs name and requires[]`);
  return policy;
}

// Tiers are listed most severe first. A file takes the first tier it matches;
// the change takes the most severe tier of any file and the union of requirements.
export function classify(files, policy) {
  const perFile = files.map((f) => {
    const idx = policy.tiers.findIndex((t) => matchesAny(f, t.paths));
    return { file: f, tier: idx === -1 ? policy.default.name : policy.tiers[idx].name, rank: idx === -1 ? policy.tiers.length : idx };
  });
  const ranks = perFile.map((p) => p.rank);
  const top = ranks.length ? Math.min(...ranks) : policy.tiers.length;
  const tier = top === policy.tiers.length ? policy.default : policy.tiers[top];
  const requires = new Set(tier.requires);
  for (const p of perFile) {
    const t = p.rank === policy.tiers.length ? policy.default : policy.tiers[p.rank];
    for (const r of t.requires) requires.add(r);
  }
  const reasons = perFile.filter((p) => p.rank === top).map((p) => p.file);
  return { tier: tier.name, requires: [...requires].sort(), reasons, files: perFile.map(({ file, tier }) => ({ file, tier })) };
}

function changedFiles(root, base, head) {
  const out = git(root, ['diff', '--name-only', `${base}...${head}`]);
  return out ? out.split('\n') : [];
}

// ---------- evidence ----------

function workingTreeDigest(root) {
  const diff = git(root, ['diff', 'HEAD', '--binary', ...NOT_LEDGER], { allowFail: true }) || '';
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', ...NOT_LEDGER], { allowFail: true }) || '';
  return createHash('sha256').update(diff).update('\0').update(untracked).digest('hex').slice(0, 16);
}

function ciContext() {
  const env = process.env;
  if (!env.GITHUB_ACTIONS) return null;
  return {
    provider: 'github-actions',
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    githubSha: env.GITHUB_SHA,
    prHeadSha: env.VLOOP_PR_HEAD_SHA || null,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
  };
}

// The ledger lives at the top of the Git work tree, wherever the command ran.
function repoRoot(dir) {
  return git(dir, ['rev-parse', '--show-toplevel']);
}

export function readLedger(root) {
  const dir = path.join(root, EVIDENCE_DIR);
  const records = [];
  for (const f of listDir(dir, '.')) {
    if (!f.endsWith('.jsonl')) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // A corrupt line is skipped, not trusted.
      }
    }
  }
  return records.sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : 1));
}

export function runCheck(cwd, name, command, { target } = {}) {
  const root = repoRoot(cwd);
  const sha = git(root, ['rev-parse', 'HEAD']);
  const status = git(root, ['status', '--porcelain', ...NOT_LEDGER]);
  const started = new Date();
  const res = spawnSync(command[0], command.slice(1), { cwd, stdio: 'inherit', shell: false });
  const finished = new Date();
  const record = {
    check: name,
    sha,
    dirty: Boolean(status),
    treeDigest: status ? workingTreeDigest(root) : null,
    command: command.join(' '),
    cwd: path.relative(root, path.resolve(cwd)) || '.',
    exitCode: res.error ? null : res.status,
    signal: res.signal || null,
    error: res.error ? res.error.message : null,
    target: target || null,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished - started,
    host: process.env.GITHUB_ACTIONS ? 'ci' : 'local',
    ci: ciContext(),
    tool: `vloop ${VERSION}`,
  };
  const dir = path.join(root, EVIDENCE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${sha}.jsonl`), `${JSON.stringify(record)}\n`);
  return record;
}

// For each required check, find the latest record and decide whether it
// still describes `sha`. Evidence from another commit is reported as stale
// together with the files that changed since, so a person or agent can judge
// whether it still applies; vloop never decides that on its own.
export function checkEvidence(dir, { sha, requires = [] } = {}) {
  const root = repoRoot(dir);
  const target = sha || git(root, ['rev-parse', 'HEAD']);
  const status = git(root, ['status', '--porcelain', ...NOT_LEDGER], { allowFail: true });
  const ledger = readLedger(root);
  const names = requires.length ? requires : [...new Set(ledger.map((r) => r.check))];
  const results = names.map((name) => {
    const forName = ledger.filter((r) => r.check === name);
    const exact = forName.filter((r) => r.sha === target && !r.dirty);
    const latestExact = exact[exact.length - 1];
    if (latestExact) {
      return { check: name, state: latestExact.exitCode === 0 ? 'pass' : 'fail', record: latestExact };
    }
    const dirtyHere = forName.filter((r) => r.sha === target && r.dirty);
    if (dirtyHere.length) {
      return { check: name, state: 'stale', why: 'ran on uncommitted changes on top of this commit, not on the commit itself', record: dirtyHere[dirtyHere.length - 1] };
    }
    const older = forName[forName.length - 1];
    if (older) {
      const isAncestor = git(root, ['merge-base', '--is-ancestor', older.sha, target], { allowFail: true }) !== null;
      const changed = isAncestor ? git(root, ['diff', '--name-only', `${older.sha}..${target}`], { allowFail: true }) : null;
      return {
        check: name,
        state: 'stale',
        why: isAncestor ? `ran on ${older.sha.slice(0, 12)}; files changed since: ${changed ? changed.split('\n').length : 0}` : `ran on ${older.sha.slice(0, 12)}, which is not an ancestor of the target`,
        changedSince: changed ? changed.split('\n') : null,
        record: older,
      };
    }
    return { check: name, state: 'missing' };
  });
  const ok = results.length > 0 && results.every((r) => r.state === 'pass');
  return { sha: target, workingTreeDirty: Boolean(status), ok, results };
}

function renderEvidence(report) {
  const lines = [`# Evidence for \`${report.sha}\``, ''];
  if (report.workingTreeDirty) lines.push('The working tree has uncommitted changes. They are not covered by any record below.', '');
  if (!report.results.length) lines.push('No checks recorded and none required.');
  for (const r of report.results) {
    const rec = r.record;
    const where = rec ? ` (${rec.host}${rec.ci?.runUrl ? `, ${rec.ci.runUrl}` : ''}, ${rec.finishedAt}, \`${rec.command}\`, exit ${rec.exitCode})` : '';
    lines.push(`- **${r.check}**: ${r.state}${r.why ? `; ${r.why}` : ''}${where}`);
    if (r.changedSince?.length) for (const f of r.changedSince.slice(0, 10)) lines.push(`  - ${f}`);
    if (r.changedSince?.length > 10) lines.push(`  - and ${r.changedSince.length - 10} more`);
  }
  lines.push('', report.ok ? 'Every required check has a passing record at this exact commit. That says the checks ran and passed, not that the change is correct.' : 'Not every required check has a passing record at this exact commit.', '');
  return lines.join('\n');
}

// ---------- CLI ----------

const HELP = `vloop ${VERSION}: map and record a repository's verification loop

Usage:
  vloop scan [dir] [--json]
      Inventory hooks, CI, tests, review, preview, deploy and monitoring.
      Read-only. Reports found / not-found / unknown with file citations.

  vloop risk --policy <file> --base <ref> [--head <ref>] [--dir <dir>] [--json]
      Classify the files changed between base and head against a policy.
      In CI, read the policy from the base branch so a change cannot edit
      the rules it is judged by.

  vloop evidence run --check <name> [--dir <dir>] [--target <url>] -- <command...>
      Run a command in --dir (default: here) and append the result, commit
      SHA and dirty state to .verification/evidence/<sha>.jsonl at the top
      of the Git work tree. Exits with the command's code.

  vloop evidence check [--require a,b] [--sha <sha>] [--dir <dir>] [--json]
      Report which checks passed at exactly this commit and which records
      are stale. Exits 1 if any required check is not passing here.

Local records are notes for humans and agents. Anyone can edit them, so
merge decisions should rest on CI checks and branch rules, not on them.
`;

export function main(argv) {
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (cmd === 'scan') {
    const opts = parseArgs([sub, ...rest].filter((x) => x !== undefined));
    const dir = opts._[0] || '.';
    const result = scan(dir);
    process.stdout.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : renderScan(result));
    return 0;
  }
  if (cmd === 'risk') {
    const opts = parseArgs([sub, ...rest].filter((x) => x !== undefined));
    if (!opts.policy || !opts.base) {
      process.stderr.write('vloop risk needs --policy and --base\n');
      return 2;
    }
    const dir = opts.dir || '.';
    const policy = loadPolicy(opts.policy);
    const files = changedFiles(dir, opts.base, opts.head || 'HEAD');
    const result = classify(files, policy);
    if (opts.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`Tier: ${result.tier}\nRequires: ${result.requires.join(', ') || 'nothing'}\n`);
      if (result.reasons.length) process.stdout.write(`Because of: ${result.reasons.slice(0, 10).join(', ')}${result.reasons.length > 10 ? ', ...' : ''}\n`);
      if (!files.length) process.stdout.write('No changed files.\n');
    }
    return 0;
  }
  if (cmd === 'evidence' && sub === 'run') {
    const opts = parseArgs(rest);
    const command = opts['--'];
    if (!opts.check || !command?.length) {
      process.stderr.write('usage: vloop evidence run --check <name> -- <command...>\n');
      return 2;
    }
    const record = runCheck(opts.dir || '.', opts.check, command, { target: opts.target });
    process.stderr.write(`vloop: recorded ${record.check} exit ${record.exitCode} at ${record.sha.slice(0, 12)}${record.dirty ? ' (dirty tree)' : ''}\n`);
    if (record.exitCode === null) return 1;
    return record.exitCode;
  }
  if (cmd === 'evidence' && sub === 'check') {
    const opts = parseArgs(rest);
    const requires = typeof opts.require === 'string' ? opts.require.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const report = checkEvidence(opts.dir || '.', { sha: typeof opts.sha === 'string' ? opts.sha : undefined, requires });
    process.stdout.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : renderEvidence(report));
    return report.ok ? 0 : 1;
  }
  process.stderr.write(`unknown command: ${argv.join(' ')}\n\n${HELP}`);
  return 2;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`vloop: ${err.message}\n`);
    process.exitCode = 2;
  }
}
