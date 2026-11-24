// Which shell a terminal starts, per platform (src/main/terminal-shell.ts).
// macOS and Linux start login shells so profile PATH additions apply; Windows
// keeps its PowerShell-first choice with no arguments.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/main/terminal-shell.ts'], bundle: true, format: 'esm', write: false });
const { defaultShell } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const nothingOnPath = () => null;
const unix = (platform, SHELL) => defaultShell(platform, { SHELL }, () => { throw new Error('PATH is only searched on Windows'); });

for (const platform of ['darwin', 'linux']) {
  for (const shell of ['/bin/bash', '/bin/zsh', '/usr/local/bin/fish', '/opt/homebrew/bin/fish', '/bin/sh', '/bin/ksh', '/usr/bin/bash']) {
    check(unix(platform, shell), { shell, args: ['-l'] }, `${platform} ${shell} is a login shell`);
  }
  for (const shell of ['/usr/bin/nu', '/bin/notbash', '/usr/bin/xonsh', '/bin/bash5']) {
    check(unix(platform, shell), { shell, args: [] }, `${platform} ${shell}: unknown shells get no -l`);
  }
  const fallback = platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  for (const shell of [undefined, '']) {
    check(unix(platform, shell), { shell: fallback, args: ['-l'] }, `${platform}: unset SHELL falls back to ${fallback}`);
  }
}

// Other Unixes keep $SHELL (or /bin/bash) but are not given -l.
check(unix('freebsd', '/bin/sh'), { shell: '/bin/sh', args: [] });
check(unix('freebsd', undefined), { shell: '/bin/bash', args: [] });

// Windows: pwsh, then Windows PowerShell, then COMSPEC, then cmd.exe -- never
// $SHELL, never -l (Git Bash users often have SHELL set).
const asked = [];
const lookup = (found) => (candidates) => { asked.push(candidates); return found; };
check(defaultShell('win32', { SHELL: '/usr/bin/bash', COMSPEC: 'C:\\Windows\\system32\\cmd.exe' }, lookup('C:\\Program Files\\PowerShell\\7\\pwsh.exe')),
  { shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: [] });
check(asked, [['pwsh.exe', 'powershell.exe']], 'pwsh is preferred over Windows PowerShell');
check(defaultShell('win32', { COMSPEC: 'C:\\Windows\\system32\\cmd.exe' }, nothingOnPath), { shell: 'C:\\Windows\\system32\\cmd.exe', args: [] });
check(defaultShell('win32', {}, nothingOnPath), { shell: 'cmd.exe', args: [] });
check(defaultShell('win32', { SHELL: '/bin/zsh' }, nothingOnPath), { shell: 'cmd.exe', args: [] }, 'SHELL is ignored on Windows');

console.log(`terminal-shell: ${checks} checks passed`);
