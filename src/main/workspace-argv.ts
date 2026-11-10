import * as fs from 'fs';
import * as path from 'path';
import { folderKey } from './recentRepos';

/** Protect the whole macOS bundle, not just Contents/MacOS. */
export function installDirectory(exe: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const dir = pathApi.dirname(exe);
  if (platform === 'darwin') {
    for (let ancestor = dir; ; ancestor = pathApi.dirname(ancestor)) {
      if (ancestor.toLowerCase().endsWith('.app')) return ancestor;
      if (pathApi.dirname(ancestor) === ancestor) break;
    }
  }
  return dir;
}

export function isInsideInstall(
  dir: string,
  installDir: string,
  platform: NodeJS.Platform = process.platform,
  realpath: (p: string) => string = fs.realpathSync.native,
): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const relative = pathApi.relative(folderKey(installDir, platform, realpath), folderKey(dir, platform, realpath));
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + pathApi.sep) && !pathApi.isAbsolute(relative));
}

/** Return the workspace directory passed after the Electron/app executable. */
export function workspacePathFromArgv(argv: string[], packaged: boolean, exclude?: (dir: string) => boolean): string | null {
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
      if (fs.statSync(candidate).isDirectory() && !exclude?.(candidate)) return candidate;
    } catch {
      // Missing and inaccessible arguments are not workspaces.
    }
  }
  return null;
}
