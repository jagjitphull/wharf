import { existsSync, readFileSync, renameSync } from "node:fs";

/**
 * electron-store (via `conf`) throws a raw SyntaxError out of its
 * constructor if the on-disk JSON is corrupt (e.g. a crash or a full disk
 * mid-write) — uncaught, that crashes the whole app on every launch from
 * then on, with a cryptic native dialog and no way for an ordinary user to
 * recover. Call this *before* constructing the store: a file that exists
 * but isn't valid JSON is moved aside to `<path>.corrupted-<timestamp>`
 * (rather than relying on `conf`'s clearInvalidConfig, which would just
 * discard it), so a corrupted file costs a reset to defaults — never a
 * bricked app or quietly-vanished hosts/secrets with nothing to recover.
 *
 * Returns the backup path if it had to move the file, otherwise null (file
 * absent, or valid).
 */
export function moveAsideIfCorrupt(filePath: string, now: () => number = Date.now): string | null {
  if (!existsSync(filePath)) return null;
  try {
    JSON.parse(readFileSync(filePath, "utf8"));
    return null;
  } catch {
    const backupPath = `${filePath}.corrupted-${now()}`;
    renameSync(filePath, backupPath);
    return backupPath;
  }
}
