// node-pty ships a helper binary that npm extracts without its executable bit.
//
// On macOS and Linux, node-pty forks a shell through `spawn-helper` rather than
// calling posix_spawn directly. npm does not reliably preserve the mode bit when
// it unpacks the prebuilds, so the file lands as 0644 and every pty spawn fails
// with a bare "posix_spawnp failed" -- no path, no permission hint.
//
// The consequence is not limited to a development machine. electron-builder
// copies these files into the bundle with the modes they have on disk, so an
// install that produced a 0644 helper produces a shipped application whose
// terminal cannot start a shell at all, on every machine it is installed on.
//
// Found by the cross-platform CI matrix: the terminal rendered an empty pane on
// macOS and reported nothing, because the spawn failure had nowhere to surface.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'win32') {
  const root = join('node_modules', 'node-pty');
  let fixed = 0;

  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name !== 'spawn-helper') continue;
      try {
        const mode = statSync(full).mode;
        if ((mode & 0o111) !== 0) continue;
        chmodSync(full, 0o755);
        fixed += 1;
      } catch { /* nothing we can do; the pty error will say so */ }
    }
  };

  if (existsSync(root)) walk(root);
  if (fixed > 0) console.log(`fix-pty-permissions: made ${fixed} spawn-helper binar${fixed === 1 ? 'y' : 'ies'} executable`);
}
