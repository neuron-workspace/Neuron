// Native crashes, captured locally.
//
// The diagnostic logger catches what JavaScript can catch: uncaught exceptions,
// unhandled rejections, a renderer or child process going away. It cannot catch
// a crash *below* that layer. A Chromium CHECK() failure calls __debugbreak(),
// which on Windows raises EXCEPTION_BREAKPOINT (0x80000003) and terminates the
// process before any handler runs -- the user sees Windows' own "a breakpoint
// has been reached" dialog and nothing is written down anywhere.
//
// That is exactly what happened, and the log file was empty afterwards. Crashpad
// is the only thing that can record it, because it runs out-of-process and is
// still alive when the process it is watching is not.
//
// NOTHING IS UPLOADED. `uploadToServer: false` is the entire point: Neuron says
// it has no telemetry, and a crash reporter that phones home would make that
// untrue. Dumps land next to the diagnostic log, on the user's disk, and go
// nowhere unless the user chooses to send one.
import * as path from 'path';

/** Where Crashpad writes, given the app's log directory. */
export function crashDumpDirectory(logsDirectory: string): string {
  // Beneath the logs folder on purpose: "Open logs folder" already exists in the
  // menu, so a crash dump is findable through an action the user already knows
  // rather than a second one they have to be told about.
  return path.join(logsDirectory, 'crashes');
}

export interface CrashReporterOptions {
  productName: string;
  companyName: string;
  uploadToServer: false;
  /** Leave the system handler alone, so a crash still surfaces to the user. */
  ignoreSystemCrashHandler: boolean;
  /** Smaller dumps; these sit on someone's disk indefinitely. */
  compress: boolean;
  extra: Record<string, string>;
}

/**
 * The options Crashpad is started with.
 *
 * Separated from the wiring so the promise made above -- that nothing leaves the
 * machine -- is a thing a test can assert rather than a comment someone has to
 * believe. `uploadToServer` is typed as the literal `false`, so setting it true
 * is a compile error and not merely a review comment.
 */
export function crashReporterOptions(appVersion: string): CrashReporterOptions {
  return {
    productName: 'Neuron',
    companyName: 'Neuron',
    uploadToServer: false,
    // False, not true: suppressing the system handler would hide the crash from
    // the user entirely. They should still be told the app died; the dump is so
    // that someone can find out why.
    ignoreSystemCrashHandler: false,
    compress: true,
    // Deliberately minimal. Crashpad already records the platform, the version
    // and the module list. Nothing here may carry a workspace path or note
    // content: a dump is a memory image, and adding identifying strings to one
    // is how a local file becomes a thing you cannot safely send to anyone.
    extra: { neuronVersion: appVersion },
  };
}

export interface CrashReporterHost {
  setPath: (name: string, value: string) => void;
  getVersion: () => string;
}

export interface Crashpad {
  start: (options: CrashReporterOptions) => void;
}

/**
 * Point Crashpad at the dump directory and start it.
 *
 * Must run before `app.whenReady()`, and before any window exists: a crash
 * during startup is the one most worth catching, and Crashpad only records what
 * happens after it is running.
 */
export function configureCrashReporter(
  app: CrashReporterHost,
  crashpad: Crashpad,
  logsDirectory: string,
): string {
  const directory = crashDumpDirectory(logsDirectory);
  // Must precede start(): Crashpad reads the path once, when it initialises.
  app.setPath('crashDumps', directory);
  crashpad.start(crashReporterOptions(app.getVersion()));
  return directory;
}
