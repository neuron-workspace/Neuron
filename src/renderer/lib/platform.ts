/**
 * Which desktop the renderer is running on.
 *
 * The renderer used to work this out from `navigator.platform`, which the
 * platform deprecated years ago: browsers freeze or lie about its value, and it
 * says nothing about the Electron process actually hosting the window. Main
 * knows the real answer, so it says so through the preload bridge and this
 * reads it.
 *
 * The navigator fallback is kept for the one case the bridge cannot cover --
 * a renderer loaded without preload, which is how some tests and the plain
 * browser preview run. It is a guess, and it is only ever a guess.
 */
export type Platform = 'darwin' | 'win32' | 'linux' | 'unknown';

function detect(): Platform {
  const fromMain = typeof window !== 'undefined' ? window.electronAPI?.platform : undefined;
  if (fromMain === 'darwin' || fromMain === 'win32' || fromMain === 'linux') return fromMain;

  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad/i.test(ua)) return 'darwin';
  if (/Windows/i.test(ua)) return 'win32';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
}

/**
 * Resolved once. The host cannot change under a running window, and reading it
 * per keystroke to format a shortcut label would be silly.
 */
export const platform: Platform = detect();

export const isMac = platform === 'darwin';
export const isWindows = platform === 'win32';
export const isLinux = platform === 'linux';

/**
 * Whether the window is drawn with our own title bar and controls.
 *
 * macOS keeps the native frame and its traffic lights, so the app must not draw
 * its own minimise/maximise/close buttons on top of them. Everywhere else the
 * frame is off and those buttons are the only way to work the window.
 */
export const usesCustomWindowControls = !isMac;
