// Electron-free navigation policy. Kept out of main.ts so these decisions --
// which URLs the privileged app frame and a pinned HTMX view may navigate to --
// are unit-testable, the same reasoning as htmx/appPaths.ts.
//
// These MUST compare parsed origins. A string prefix test is not an origin
// check and never was: "http://localhost:5174@evil.com" parses `localhost` as
// userinfo and `evil.com` as the host, yet passes startsWith(); so does
// "http://localhost:51740". Both would navigate the frame that carries the
// preload bridge onto an attacker's page.

/** The dev-server URL. Single source for the renderer load and the nav guard. */
export const DEV_URL = 'http://localhost:5174';

/** True when `url` is exactly `origin` (scheme + host + port), never a prefix of it. */
export function isSameOrigin(url: string, origin: string | null | undefined): boolean {
  if (!origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * True for the app's own bundled content: packaged `file://` pages, or the dev
 * server in development. Anything else navigates the app frame off-origin.
 */
export function isAppContent(url: string): boolean {
  try {
    const parsed = new URL(url);
    // file:// URLs have an opaque ("null") origin, so match the scheme itself.
    return parsed.protocol === 'file:' || parsed.origin === DEV_URL;
  } catch {
    return false;
  }
}
