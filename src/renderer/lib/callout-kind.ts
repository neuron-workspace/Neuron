export type CalloutKind = 'success' | 'info' | 'warning' | 'error';

const SYNONYMS: Record<string, CalloutKind> = {
  success: 'success', done: 'success', tip: 'success', congratulations: 'success',
  info: 'info', note: 'info',
  warning: 'warning', caution: 'warning',
  error: 'error', danger: 'error',
};

export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  success: 'Success', info: 'Info', warning: 'Warning', error: 'Error',
};

/** A note's `type` attribute, in any case; anything unrecognised reads as info. */
export function calloutKind(type: string | undefined): CalloutKind {
  const key = type?.trim().toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(SYNONYMS, key) ? SYNONYMS[key] : 'info';
}
