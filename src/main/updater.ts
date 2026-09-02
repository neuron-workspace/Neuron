// In-app updates, from the same GitHub Releases everything else comes from.
//
// electron-builder already publishes `latest.yml`, `latest-mac.yml` and
// `latest-linux.yml` beside the installers, each carrying a sha512 for every
// artifact. That file is the security boundary: it is fetched from GitHub over
// HTTPS, and electron-updater refuses to install a download whose hash does not
// match it. None of that depends on the binary being code-signed, which matters
// here because these builds are not.
//
// Signing, when it arrives, is an ADDITIONAL check on Windows -- electron-updater
// compares the publisher name on the downloaded installer against the running
// one. It is never a replacement for the hash, and nothing here disables either.
import type { AppUpdater } from 'electron-updater';

export type UpdaterPlatform = 'win32' | 'darwin' | 'linux' | string;

export interface UpdaterContext {
  platform: UpdaterPlatform;
  /** app.isPackaged — a dev build has nothing to update. */
  packaged: boolean;
  /** True inside a Microsoft Store build, which updates through the Store. */
  windowsStore: boolean;
  /** The running version, e.g. "0.4.5" or "0.4.5-beta.1". */
  version: string;
  /** Whether the app has a real code signature (not ad-hoc). */
  signed: boolean;
}

export interface UpdaterDecision {
  check: boolean;
  /** Accept prereleases as updates. */
  allowPrerelease: boolean;
  /** Present when `check` is false, for the log. */
  reason?: string;
}

/**
 * Whether to look for an update, and what counts as one.
 *
 * Separated from the wiring so the rules can be tested without launching
 * Electron -- every one of these branches is a case where getting it wrong
 * either offers an update that cannot install or silently offers none at all.
 */
export function updatePolicy(context: UpdaterContext): UpdaterDecision {
  // Someone running a prerelease asked for prereleases; someone on a stable
  // build did not. Without this, every beta so far was invisible to the
  // updater: `checkForUpdates` skips prereleases by default, and every release
  // this project has published is one.
  const allowPrerelease = context.version.includes('-');

  if (!context.packaged) {
    return { check: false, allowPrerelease, reason: 'development build' };
  }
  if (context.windowsStore) {
    return { check: false, allowPrerelease, reason: 'Microsoft Store builds update through the Store' };
  }
  // Squirrel.Mac will not install an update into an app it cannot validate, and
  // an ad-hoc signature is not a validatable one. Checking anyway would download
  // an update, fail at the install step, and do it again on every launch.
  if (context.platform === 'darwin' && !context.signed) {
    return { check: false, allowPrerelease, reason: 'macOS updates need a Developer ID signature' };
  }
  return { check: true, allowPrerelease };
}

/**
 * Apply the policy to a real updater.
 *
 * Deliberately does not touch `autoUpdater.autoDownload`, signature
 * verification, or the provider: those come from the publish config that
 * electron-builder wrote into the package, and overriding them here is how an
 * update channel quietly stops being the one that was tested.
 */
export function configureUpdater(updater: AppUpdater, context: UpdaterContext, log = console): UpdaterDecision {
  const decision = updatePolicy(context);
  if (!decision.check) {
    log.info?.(`Updates: not checking (${decision.reason}).`);
    return decision;
  }

  updater.allowPrerelease = decision.allowPrerelease;
  updater.on('error', (error: Error) => {
    // An update failing must never take the app down with it. A workspace is
    // open and unsaved work may be in it.
    log.error(`Updates: check failed: ${error?.message ?? error}`);
  });

  return decision;
}
