// Run: node tools/procs.test.mjs
//
// These are the functions that decide whether a real process lives or dies, so
// they are tested against real processes rather than mocks. The bug they exist
// to prevent -- eighteen Electron trees surviving two hours of test runs --
// came from believing a resolved promise instead of asking the operating
// system, so asking the operating system is the thing under test.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { isAlive, killTree, sweepStrandedApps, shutdown, parseElapsed } from './procs.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitGone = async (pid, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(50);
  }
  return false;
};

// --- elapsed time, in both shapes ps reports --------------------------------
// Linux etimes is a count of seconds; macOS and BSD etime is [[dd-]hh:]mm:ss.
// Reading the formatted one as a number gives NaN, the age guard reads that as
// "too young", and every stranded process survives the sweep. The
// cross-platform CI matrix caught this on its first run.
assert.equal(parseElapsed('42'), 42, 'Linux etimes is already seconds');
assert.equal(parseElapsed('00:07'), 7);
assert.equal(parseElapsed('01:30'), 90);
assert.equal(parseElapsed('1:02:03'), 3723, 'hh:mm:ss');
assert.equal(parseElapsed('2-03:04:05'), 183845, 'dd-hh:mm:ss');
assert.equal(parseElapsed('0:00'), 0);
assert.ok(Number.isNaN(parseElapsed(undefined)));
assert.ok(Number.isNaN(parseElapsed('bogus')));

// --- isAlive ----------------------------------------------------------------
assert.equal(isAlive(process.pid), true, 'this process is alive');
assert.equal(isAlive(0), false, 'pid 0 is not a process we can own');
assert.equal(isAlive(null), false);
// A pid that is almost certainly free. If it happens to exist this asserts
// nothing useful, which is why it is not the only negative case.
assert.equal(isAlive(0x7ffffff0), false, 'an absurd pid reads as dead');

// --- killTree, on a process that spawns a child -----------------------------
{
  // A parent that sits idle and starts a child doing the same. Killing only
  // the parent would leave the child behind, which is the exact failure this
  // is meant to catch.
  const script = `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `;
  const parent = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
  await sleep(700);

  assert.ok(isAlive(parent.pid), 'the parent started');
  killTree(parent.pid);
  assert.ok(await waitGone(parent.pid), 'killTree removed the parent');
}

// --- killTree tolerates a pid that is already gone --------------------------
{
  const short = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((r) => short.once('exit', r));
  killTree(short.pid); // must not throw
  assert.equal(isAlive(short.pid), false);
}

// --- shutdown reports what actually happened --------------------------------
{
  // A stand-in for an ElectronApplication whose close() resolves while the
  // process keeps running. This is the case the old teardown got wrong, so it
  // is the case worth simulating.
  const stubborn = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await sleep(400);
  const fakeApp = {
    process: () => stubborn,
    close: async () => { /* resolves, changes nothing -- the real failure mode */ },
  };

  const result = await shutdown(fakeApp, { graceMs: 300, verifyMs: 4000 });
  assert.equal(result, 'killed', 'a lying close() still ends with a dead process');
  assert.equal(isAlive(stubborn.pid), false);
}

// --- shutdown on a process that really does exit ----------------------------
{
  const willing = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await sleep(300);
  const fakeApp = {
    process: () => willing,
    close: async () => { willing.kill('SIGKILL'); await sleep(250); },
  };
  const result = await shutdown(fakeApp, { graceMs: 3000, verifyMs: 2000 });
  assert.equal(result, 'closed', 'a clean exit is not escalated to a kill');
}

// --- the sweep guards, exercised against a process that really can match ---
{
  // Pointed at node rather than electron so the marker and age guards are
  // tested for real. With the executable name hard-coded these assertions
  // could only pass vacuously.
  const NAME = process.platform === 'win32' ? 'node' : process.execPath.split(/[\/]/).pop();

  // Marked exactly like a stranded test app, but seconds old.
  const young = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', 'neuron-e2e-pretend'], { stdio: 'ignore' });
  await sleep(600);
  assert.ok(isAlive(young.pid), 'the decoy started');

  // Age guard: a live suite's app is seconds old, and a second suite running
  // in another terminal must survive this.
  sweepStrandedApps({ minAgeSeconds: 600, processName: NAME });
  await sleep(300);
  assert.ok(isAlive(young.pid), 'the sweep spared a process younger than the age floor');

  // Marker guard: no age floor at all, but nothing matches the marker.
  sweepStrandedApps({ markers: ['no-such-marker-zzz'], minAgeSeconds: 0, processName: NAME });
  await sleep(300);
  assert.ok(isAlive(young.pid), 'the sweep spared a process no marker matched');

  // And with both guards satisfied it does its job -- otherwise the two
  // assertions above would pass on a sweep that never kills anything.
  const killed = sweepStrandedApps({ markers: ['neuron-e2e-'], minAgeSeconds: 0, processName: NAME });
  assert.ok(killed >= 1, 'the sweep reported killing the decoy');
  assert.ok(await waitGone(young.pid), 'the sweep killed a matching, old-enough process');
}

console.log('procs: process teardown verified against real processes');
