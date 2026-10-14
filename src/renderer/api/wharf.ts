/** Thin wrapper around the `window.wharf` bridge exposed by preload.ts. */
export const wharf = window.wharf;

/**
 * Electron wraps a thrown main-process Error as
 * `Error invoking remote method 'X': Error: <message>`. Strip that
 * boilerplate so the UI can show the actual message (e.g. from
 * LimitReachedError / ProFeatureRequiredError) directly.
 */
export function ipcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/Error invoking remote method '[^']+': (?:Error: )?([\s\S]*)/);
  return match ? match[1] : raw;
}
