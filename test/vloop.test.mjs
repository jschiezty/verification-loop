// Tests for bin/vloop.mjs. Each test builds a throwaway Git repository under
// the OS temp directory. Nothing here deletes files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globToRegExp, classify, scan, checkEvidence, runCheck, loadPolicy, scriptsReachedByCi } from '../bin/vloop.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'bin', 'vloop.mjs');
const POLICY = path.join(here, '..', 'policy', 'example.risk.json');

function repo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vloop-test-'));
  const g = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main', '--template=');
  write(dir, { 'README.md': 'x\n', ...files });
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return { dir, g, sha: () => g('rev-parse', 'HEAD') };
}

function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

function cli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

test('globToRegExp handles **, * and ?', () => {
  assert.ok(globToRegExp('**/auth/**').test('src/auth/login.ts'));
  assert.ok(globToRegExp('**/auth/**').test('auth/x.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('src/*.ts').test('src/b.ts'));
  assert.ok(globToRegExp('**/*.sql').test('db/migrations/001.sql'));
  assert.ok(globToRegExp('file?.md').test('file1.md'));
  assert.ok(!globToRegExp('docs/**').test('src/docs.md'));
});

test('classify takes the most severe tier and unions requirements', () => {
  const policy = loadPolicy(POLICY);
  const r = classify(['docs/guide.md', 'src/billing/charge.ts', 'src/ui/button.tsx'], policy);
  assert.equal(r.tier, 'high');
  assert.deepEqual(r.reasons, ['src/billing/charge.ts']);
  for (const need of ['unit', 'property', 'journey', 'human-review', 'docs-lint']) assert.ok(r.requires.includes(need), need);
});

test('a change to the rules themselves is classified as policy, above high risk', () => {
  const policy = loadPolicy(POLICY);
  const r = classify(['.github/workflows/verify.yml', 'src/auth/session.ts'], policy);
  assert.equal(r.tier, 'policy');
  assert.ok(r.requires.includes('human-review'));
});

test('unmatched files fall to the default tier; no files means default', () => {
  const policy = loadPolicy(POLICY);
  assert.equal(classify(['lib/util.go'], policy).tier, 'standard');
  assert.equal(classify([], policy).tier, 'standard');
});

test('loadPolicy rejects a malformed policy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vloop-policy-'));
  const bad = path.join(dir, 'p.json');
  fs.writeFileSync(bad, JSON.stringify({ tiers: [{ name: 'x', paths: [] }], default: { name: 'd', requires: [] } }));
  assert.throws(() => loadPolicy(bad), /requires/);
});

test('scan reports found, not-found and unknown with file citations', () => {
  const { dir } = repo({
    '.github/workflows/ci.yml': 'name: ci\non:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
    'package.json': JSON.stringify({ scripts: { test: 'node --test', lint: 'eslint .' }, devDependencies: { 'fast-check': '3.0.0', '@sentry/node': '8.0.0' } }),
    'playwright.config.ts': 'export default {}\n',
    '.github/CODEOWNERS': '* @someone\n',
    'AGENTS.md': '# agents\n',
  });
  const r = scan(dir);
  const by = (area, status) => r.findings.filter((f) => f.area === area && f.status === status);
  assert.equal(r.revision.dirty, 0);
  assert.match(by('ci', 'found')[0].detail, /pull_request, push/);
  assert.match(by('ci', 'found')[0].detail, /no permissions block/);
  assert.ok(by('ci', 'unknown').some((f) => /merge_group/.test(f.detail)), 'warns about merge_group');
  assert.ok(by('tests', 'found').some((f) => /fast-check/.test(f.detail)));
  assert.ok(by('monitoring', 'found').some((f) => /@sentry\/node/.test(f.detail)));
  assert.deepEqual(by('e2e', 'found')[0].evidence, ['playwright.config.ts']);
  assert.deepEqual(by('review', 'found')[0].evidence, ['.github/CODEOWNERS']);
  assert.ok(by('agent-instructions', 'found')[0].evidence.includes('AGENTS.md'));
  assert.equal(by('git-hooks', 'not-found').length, 1);
  assert.ok(by('server-side', 'unknown').some((f) => /rulesets/.test(f.detail)));
});

test('scan flags pull_request_target and does not confuse it with pull_request', () => {
  const { dir } = repo({ '.github/workflows/t.yml': 'on:\n  pull_request_target:\n    types: [opened]\npermissions: {}\njobs: {}\n' });
  const ci = scan(dir).findings.filter((f) => f.area === 'ci');
  assert.match(ci[0].detail, /Triggers: pull_request_target;/);
  assert.match(ci[0].detail, /base-branch secrets/);
  assert.ok(!ci.some((f) => /merge_group/.test(f.detail)), 'no merge_group warning without a pull_request trigger');
});

test('scan of an empty repo says not-found rather than inventing anything', () => {
  const { dir } = repo();
  const r = scan(dir);
  assert.ok(!r.findings.some((f) => f.status === 'found'));
  assert.ok(r.findings.some((f) => f.area === 'ci' && f.status === 'not-found'));
});

test('scan reports a dirty tree', () => {
  const { dir } = repo();
  write(dir, { 'new.txt': 'x' });
  assert.equal(scan(dir).revision.dirty, 1);
});

test('evidence: a pass at HEAD is current; a new commit makes it stale and lists changed files', () => {
  const r = repo({ 'src/a.js': '1' });
  const first = r.sha();
  const rec = runCheck(r.dir, 'unit', [process.execPath, '-e', 'process.exit(0)']);
  assert.equal(rec.sha, first);
  assert.equal(rec.exitCode, 0);
  // The ledger is untracked but must not make the next run look dirty.
  assert.equal(runCheck(r.dir, 'unit', [process.execPath, '-e', 'process.exit(0)']).dirty, false);
  let report = checkEvidence(r.dir, { requires: ['unit'] });
  assert.equal(report.ok, true);
  assert.equal(report.results[0].state, 'pass');

  write(r.dir, { 'src/a.js': '2' });
  r.g('commit', '-qam', 'change');
  report = checkEvidence(r.dir, { requires: ['unit'] });
  assert.equal(report.ok, false);
  assert.equal(report.results[0].state, 'stale');
  assert.deepEqual(report.results[0].changedSince, ['src/a.js']);
});

test('evidence: a failing run is recorded as fail, and a missing check is missing', () => {
  const r = repo();
  runCheck(r.dir, 'unit', [process.execPath, '-e', 'process.exit(3)']);
  const report = checkEvidence(r.dir, { requires: ['unit', 'journey'] });
  assert.equal(report.ok, false);
  assert.deepEqual(report.results.map((x) => x.state), ['fail', 'missing']);
});

test('evidence: a run on uncommitted changes does not count for the commit', () => {
  const r = repo({ 'src/a.js': '1' });
  write(r.dir, { 'src/a.js': 'edited' });
  const rec = runCheck(r.dir, 'unit', [process.execPath, '-e', 'process.exit(0)']);
  assert.equal(rec.dirty, true);
  assert.ok(rec.treeDigest);
  const report = checkEvidence(r.dir, { requires: ['unit'] });
  assert.equal(report.results[0].state, 'stale');
  assert.match(report.results[0].why, /uncommitted/);
});

test('evidence: the latest record at a commit wins, so a later failure is not hidden', () => {
  const r = repo();
  runCheck(r.dir, 'unit', [process.execPath, '-e', 'process.exit(0)']);
  runCheck(r.dir, 'unit', [process.execPath, '-e', 'process.exit(1)']);
  assert.equal(checkEvidence(r.dir, { requires: ['unit'] }).results[0].state, 'fail');
});

test('cli: evidence run passes through the exit code; check exits 1 when not satisfied', () => {
  const r = repo();
  assert.equal(cli(['evidence', 'run', '--check', 'unit', '--', process.execPath, '-e', 'process.exit(4)'], r.dir).status, 4);
  const chk = cli(['evidence', 'check', '--require', 'unit'], r.dir);
  assert.equal(chk.status, 1);
  assert.match(chk.stdout, /\*\*unit\*\*: fail/);
  assert.equal(cli(['evidence', 'run', '--check', 'unit', '--', process.execPath, '-e', ''], r.dir).status, 0);
  assert.equal(cli(['evidence', 'check', '--require', 'unit'], r.dir).status, 0);
});

test('cli: a command that cannot start is recorded and fails', () => {
  const r = repo();
  const res = cli(['evidence', 'run', '--check', 'lint', '--', 'definitely-not-a-real-binary-xyz'], r.dir);
  assert.equal(res.status, 1);
  assert.equal(checkEvidence(r.dir, { requires: ['lint'] }).results[0].state, 'fail');
});

test('cli: risk reads the diff between base and head', () => {
  const r = repo();
  r.g('checkout', '-q', '-b', 'feature');
  write(r.dir, { 'db/migrations/002_drop.sql': 'drop table x;' });
  r.g('add', '-A');
  r.g('commit', '-q', '-m', 'migration');
  const res = cli(['risk', '--policy', POLICY, '--base', 'main', '--json'], r.dir);
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.tier, 'high');
  assert.deepEqual(out.reasons, ['db/migrations/002_drop.sql']);
});

test('cli: unknown command and missing args exit 2', () => {
  const r = repo();
  assert.equal(cli(['nope'], r.dir).status, 2);
  assert.equal(cli(['risk'], r.dir).status, 2);
  assert.equal(cli(['evidence', 'run', '--check', 'x'], r.dir).status, 2);
});

test('the skill bundle carries current copies of the prompts and the CLI', () => {
  const kit = path.join(here, '..');
  const pairs = [
    ['bin/vloop.mjs', 'skill/verification-loop/scripts/vloop.mjs'],
    ['examples/github-actions/verify.yml', '.github/workflows/verify.yml'],
    ...['1-audit.md', '2-implement.md', '3-handoff.md'].map((f) => [`prompts/${f}`, `skill/verification-loop/references/${f}`]),
  ];
  for (const [src, copy] of pairs) {
    assert.equal(fs.readFileSync(path.join(kit, copy), 'utf8'), fs.readFileSync(path.join(kit, src), 'utf8'), `${copy} is out of date; run: npm run sync-skill`);
  }
});

test('scriptsReachedByCi follows nested scripts and pre hooks, and spots scripts CI never runs', () => {
  const scripts = { test: 'vitest', pretest: 'gen', 'test:api': 'docker compose up && pnpm test:api:run', 'test:api:run': 'playwright test', check: 'pnpm lint && npm run test:e2e', 'test:e2e': 'playwright test', lint: 'biome check' };
  const reached = scriptsReachedByCi(scripts, 'run: pnpm test\n      run: pnpm run check');
  assert.deepEqual([...reached].sort(), ['check', 'lint', 'pretest', 'test', 'test:e2e']);
  assert.ok(!reached.has('test:api'), 'test:api is never invoked');
  assert.ok(!scriptsReachedByCi({ 'lint:i18n': 'x', lint: 'y' }, 'pnpm lint:i18n').has('lint'), 'lint:i18n is not lint');
});

test('scan reports unreached test scripts, e2e config without CI, job-level permissions, and ignores UI chart folders', () => {
  const { dir } = repo({
    '.github/workflows/ci.yml': 'on: [pull_request]\njobs:\n  t:\n    permissions:\n      contents: read\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n',
    'package.json': JSON.stringify({ scripts: { test: 'vitest', 'test:api': 'playwright test -c api' } }),
    'playwright.config.ts': 'export default {}\n',
    'src/components/charts/BarChart.tsx': 'x',
  });
  const f = scan(dir).findings;
  assert.ok(f.some((x) => /no workflow runs.*test:api/.test(x.detail)));
  assert.ok(f.some((x) => x.area === 'e2e' && /probably do not run in CI/.test(x.detail)));
  assert.ok(f.some((x) => x.area === 'ci' && /permissions set per job/.test(x.detail)));
  assert.ok(!f.some((x) => x.area === 'deploy'), 'a UI charts folder is not deploy config');
});
