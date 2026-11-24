import changelog from '../../../CHANGELOG.md?raw';

/**
 * This build's version: the newest released heading of the CHANGELOG that
 * ships with it (an "Unreleased" heading is skipped). About and the welcome
 * page both show it.
 */
export const APP_VERSION = changelog.match(/^## \[(\d[^\]]*)\]/m)?.[1] ?? '';

export { changelog };
