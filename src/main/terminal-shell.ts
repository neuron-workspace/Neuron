/**
 * Which shell a terminal starts, and with what arguments.
 *
 * Pure: the platform, the environment and a PATH lookup are passed in, so
 * tools/terminal-shell.test.mjs can check every platform from any machine
 * without Electron or node-pty.
 *
 * Windows: PowerShell, not cmd. Notes are written once and opened on whatever
 * machine the workspace lands on, so a `<Run />` button saying `ls` is the
 * normal case rather than a mistake. cmd.exe answers that with "'ls' is not
 * recognized"; PowerShell ships `ls`, `pwd`, `cat` and `rm` as aliases, so the
 * same note works on all three platforms without pretending Windows is Linux.
 * pwsh is preferred because it is the maintained one. COMSPEC remains the last
 * resort for a machine with neither, which is not a machine PowerShell was ever
 * removed from -- it is one where PATH is unusual. No arguments, as before.
 *
 * macOS and Linux: `$SHELL`, started as a login shell when it is one that takes
 * `-l`. Without it profile files (`~/.zprofile`, `/etc/zprofile`,
 * `~/.bash_profile`) are skipped, so a Neuron opened from the Dock gets a shell
 * without Homebrew and other PATH additions. With `$SHELL` unset: `/bin/zsh` on
 * macOS (its `/bin/bash` is Apple's old 3.2), `/bin/bash` on Linux.
 */
const LOGIN_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'ksh']);

export interface ShellLaunch { shell: string; args: string[] }

export function defaultShell(
  platform: string,
  env: { SHELL?: string; COMSPEC?: string },
  onPath: (candidates: string[]) => string | null,
): ShellLaunch {
  if (platform === 'win32') {
    return { shell: onPath(['pwsh.exe', 'powershell.exe']) ?? env.COMSPEC ?? 'cmd.exe', args: [] };
  }
  const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const login = (platform === 'darwin' || platform === 'linux') && LOGIN_SHELLS.has(shell.split('/').pop() ?? '');
  return { shell, args: login ? ['-l'] : [] };
}
