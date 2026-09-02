// Whether a finished release build publishes to package managers.
//
// This gate decides, from a workflow_run event, whether WinGet, Chocolatey and
// Homebrew hear about a release at all -- so every way it can wrongly say yes
// puts a package in front of people who opted into nothing, and every way it
// can wrongly say no is invisible.
//
// The second is not hypothetical. v0.4.5 shipped to GitHub while this workflow
// had never run once: it was triggered `on: release: [published]`, and GitHub
// suppresses workflow triggers from events a GITHUB_TOKEN caused. Nothing
// failed and nothing logged. So the trigger is asserted here too, not just the
// decision it feeds.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, '.github/workflows/package-managers.yml');
const source = readFileSync(file, 'utf-8');
const workflow = parse(source);

let checks = 0;
const check = (what, fn) => { fn(); checks += 1; console.log(`  ok  ${what}`); };

// --- the trigger ------------------------------------------------------------
// `on` is YAML 1.1's boolean true, which is why this reads the way it does.
const triggers = workflow.on ?? workflow[true];

check('the workflow is triggered by the release build finishing', () => {
  assert.ok(triggers.workflow_run, 'workflow_run must be a trigger');
  assert.deepEqual(triggers.workflow_run.workflows, ['Release desktop builds'],
    'must name the release workflow exactly as release.yml declares it');
});

check('that name matches the release workflow', () => {
  const release = parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf-8'));
  assert.equal(release.name, triggers.workflow_run.workflows[0],
    'renaming release.yml silently stops package publishing');
});

check('it is NOT triggered by release: published', () => {
  // The trigger that looks correct and never fires: our releases are created by
  // release.yml with GITHUB_TOKEN, and GitHub does not start workflow runs from
  // events a GITHUB_TOKEN caused.
  assert.equal(triggers.release, undefined,
    'release: published cannot fire for a release GITHUB_TOKEN published');
});

check('it can still be run by hand', () => {
  assert.ok(triggers.workflow_dispatch?.inputs?.tag,
    'a failed token needs a re-run without cutting a new tag');
});

// --- the decision -----------------------------------------------------------
// Pulled out of the workflow file rather than copied into this test, so the
// script under test is the one that actually runs.
const step = workflow.jobs.manifests.steps.find((s) => s.id === 'gate');
assert.ok(step?.run, 'the gate step must exist and have a script');

const out = mkdtempSync(join(tmpdir(), 'neuron-gate-'));
const script = join(out, 'gate.sh');
writeFileSync(script, step.run, 'utf-8');

/** Run the real gate script and read back what it wrote to $GITHUB_OUTPUT. */
const gate = ({ tag, upstream = '' }) => {
  const outputs = join(out, 'outputs.txt');
  writeFileSync(outputs, '');
  const log = execFileSync('bash', [script], {
    env: { ...process.env, TAG: tag, UPSTREAM: upstream, GITHUB_OUTPUT: outputs },
    encoding: 'utf-8',
  });
  const parsed = Object.fromEntries(
    readFileSync(outputs, 'utf-8').split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
  );
  return { ...parsed, log };
};

check('a successful stable release publishes', () => {
  const r = gate({ tag: 'v0.4.5', upstream: 'success' });
  assert.equal(r.publish, 'true');
  assert.equal(r.version, '0.4.5');
});

check('a prerelease does not', () => {
  const r = gate({ tag: 'v0.4.5-beta.1', upstream: 'success' });
  assert.equal(r.publish, 'false');
  assert.match(r.log, /prerelease/);
});

check('a failed release build publishes nothing', () => {
  // workflow_run fires on every completion, failures included. Packaging the
  // artifacts of a run that failed is worse than packaging none.
  for (const upstream of ['failure', 'cancelled', 'timed_out']) {
    const r = gate({ tag: 'v0.4.5', upstream });
    assert.equal(r.publish, 'false', `${upstream} must not publish`);
    assert.match(r.log, new RegExp(upstream));
  }
});

check('release.yml running on a branch publishes nothing', () => {
  // workflow_run does not distinguish a tag build from a branch build; only the
  // shape of head_branch does.
  for (const tag of ['main', 'dev', 'feat/something']) {
    assert.equal(gate({ tag, upstream: 'success' }).publish, 'false', tag);
  }
});

check('a hand-run dispatch has no upstream conclusion and still publishes', () => {
  // workflow_dispatch leaves UPSTREAM empty; an empty conclusion must not be
  // read as a failure, or the manual re-run path would never work.
  const r = gate({ tag: 'v1.2.3', upstream: '' });
  assert.equal(r.publish, 'true');
  assert.equal(r.version, '1.2.3');
});

check('both outputs are always written, exactly once', () => {
  // The job's other three depend on `publish`; an unwritten output is an empty
  // string, which compares false and would skip publishing without saying why.
  for (const c of [
    { tag: 'v0.4.5', upstream: 'success' },
    { tag: 'v0.4.5-beta.1', upstream: 'success' },
    { tag: 'main', upstream: 'success' },
    { tag: 'v0.4.5', upstream: 'failure' },
  ]) {
    const outputs = join(out, 'outputs.txt');
    writeFileSync(outputs, '');
    execFileSync('bash', [script], {
      env: { ...process.env, TAG: c.tag, UPSTREAM: c.upstream, GITHUB_OUTPUT: outputs },
      encoding: 'utf-8',
    });
    const lines = readFileSync(outputs, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.filter((l) => l.startsWith('publish=')).length, 1, `publish, ${c.tag}`);
    assert.equal(lines.filter((l) => l.startsWith('version=')).length, 1, `version, ${c.tag}`);
  }
});

check('the tag comes from head_branch, which is where it survives', () => {
  // On a tag push workflow_run.head_branch is the tag name. It is the only
  // place the tag reaches this workflow -- github.ref here is the default
  // branch, because that is the ref workflow_run workflows run from.
  assert.match(source, /TAG:\s*\$\{\{\s*github\.event\.workflow_run\.head_branch\s*\|\|\s*inputs\.tag\s*\}\}/);
});

rmSync(out, { recursive: true, force: true });
console.log(`\npublish-gate: ${checks} checks passed`);
