import * as fs from 'fs';
import * as path from 'path';

/** Return the workspace directory passed after the Electron/app executable. */
export function workspacePathFromArgv(argv: string[], packaged: boolean): string | null {
  const args = argv.slice(packaged ? 1 : 2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--user-data-dir') {
      i += 1;
      continue;
    }
    if (!arg || arg.startsWith('-')) continue;
    const unquoted = arg.replace(/^(["'])(.*)\1$/, '$2');
    const candidate = path.resolve(unquoted);
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Missing and inaccessible arguments are not workspaces.
    }
  }
  return null;
}
