// Process cleanup shared by the E2E fixture and the screenshot script.
//
// Both launch a real Electron app and both have to guarantee it is gone
// afterwards. It lives here rather than being written out twice because the
// last thing duplicated across two call sites in this repo drifted and shipped
// a broken package.

import { execFileSync } from 'node:child_process';

/**
 * Is this pid still running?
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything. EPERM means the process exists but belongs to someone else, which
 * is still alive -- reading that as dead is how a stray survives a cleanup.
 */
export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Kill a process and everything it spawned.
 *
 * The tree matters: Electron's renderer, GPU and utility children inherit the
 * parent's stdio, so killing the main process alone leaves them holding pipes
 * that whoever launched it is still waiting on.
 */
export function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 20_000 });
      return;
    }
    // Negative pid signals the whole process group, which only works if the
    // child leads one. Playwright does not promise that, so fall through.
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch { /* not a group leader */ }
    process.kill(pid, 'SIGKILL');
  } catch { /* already gone, or not ours to kill */ }
}

/**
 * Close an Electron app and make sure it actually died.
 *
 * The previous version keyed off whether `close()` resolved. It is possible --
 * and it happened, eighteen times over two hours -- for close to resolve while
 * the process keeps running, and in that case nothing killed anything. What
 * matters is whether the pid is still there afterwards, so that is what this
 * asks.
 *
 * Returns 'closed', 'killed', or 'survived'. Callers should treat 'survived'
 * as worth printing: it means something new is holding the app open.
 */
export async function shutdown(app, { graceMs = 5000, verifyMs = 3000 } = {}) {
  // Capture the pid first: app.process() is not reliable once close begins.
  let pid = null;
  try { pid = app.process()?.pid ?? null; } catch { /* already detached */ }

  await Promise.race([
    app.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, graceMs)),
  ]);

  if (!pid || !isAlive(pid)) return 'closed';

  killTree(pid);

  // Confirm rather than assume. taskkill returns before the kernel has
  // finished, and a kill that silently failed looks identical to one that
  // worked if nobody checks.
  const deadline = Date.now() + verifyMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return 'killed';
    await new Promise((r) => setTimeout(r, 100));
  }
  return 'survived';
}

/**
 * Kill Electron processes stranded by an earlier run.
 *
 * Teardown handles the normal path; this is for the abnormal one. Interrupting
 * a suite with Ctrl-C, or a crashed worker, leaves the whole tree running with
 * nothing left to clean it up, and they accumulate silently until something
 * else fails -- a file lock on a build output, in the case that prompted this.
 *
 * Two guards keep it from touching anything it should not:
 *
 *  - The command line must mention one of our throwaway user-data directories.
 *    A developer's own `npm run dev` never does, so it cannot be caught.
 *  - The process must be older than `minAgeSeconds`. A live suite's app is
 *    seconds old, so a second suite running in another terminal is safe.
 */
export function sweepStrandedApps({
  markers = ['neuron-e2e-', 'neuron-shot-'],
  minAgeSeconds = 600,
  // Which executable to look at. A parameter rather than a constant so the
  // test can point the whole thing at node and exercise both guards for real
  // -- with 'electron' hard-coded the age and marker checks could only ever be
  // asserted against a process that could not match in the first place.
  processName = 'electron',
} = {}) {
  let rows = [];
  try {
    if (process.platform === 'win32') {
      const filter = markers.map((m) => `$_.CommandLine -like '*${m}*'`).join(' -or ');
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='${processName}.exe'" | ` +
        `Where-Object { ${filter} } | ` +
        `ForEach-Object { "$($_.ProcessId) $([int]((Get-Date) - $_.CreationDate).TotalSeconds)" }`;
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf-8', timeout: 30_000 });
      rows = out.split('\n').map((l) => l.trim()).filter(Boolean);
    } else {
      // etimes is elapsed seconds, which is exactly the age test.
      const out = execFileSync('ps', ['-eo', 'pid=,etimes=,args='], { encoding: 'utf-8', timeout: 30_000 });
      rows = out.split('\n')
        .filter((l) => l.includes(processName) && markers.some((m) => l.includes(m)))
        .map((l) => l.trim().split(/\s+/).slice(0, 2).join(' '));
    }
  } catch {
    // No ps, no powershell, or a locked-down runner. The teardown guard is the
    // real fix; this is only the safety net, so its absence is not an error.
    return 0;
  }

  let killed = 0;
  for (const row of rows) {
    const [pidText, ageText] = row.split(/\s+/);
    const pid = Number(pidText);
    const age = Number(ageText);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!Number.isFinite(age) || age < minAgeSeconds) continue;
    if (pid === process.pid) continue;
    killTree(pid);
    killed++;
  }
  return killed;
}
