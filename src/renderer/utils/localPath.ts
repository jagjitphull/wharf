/**
 * Minimal client-side path helpers for the local SFTP pane. The renderer
 * has no access to Node's `path` module (sandboxed, no node integration),
 * and the local pane only needs "go up a level" and "join a child name" —
 * not a full path library. Detects Windows-style paths (drive letter or a
 * backslash) and uses `\` as the separator for those, `/` otherwise.
 */

function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.includes("\\");
}

function sepFor(p: string): string {
  return isWindowsPath(p) ? "\\" : "/";
}

export function localJoin(dir: string, name: string): string {
  const sep = sepFor(dir);
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export function localParent(p: string): string {
  const sep = sepFor(p);
  const trimmed = p.length > 1 && p.endsWith(sep) ? p.slice(0, -1) : p;
  const idx = trimmed.lastIndexOf(sep);
  if (sep === "\\") {
    // "C:\Users" -> "C:\", "C:\" -> "C:\" (already at a drive root)
    if (idx <= 2) return trimmed.slice(0, 3);
    return trimmed.slice(0, idx);
  }
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

export function localBaseName(p: string): string {
  const sep = sepFor(p);
  const trimmed = p.length > 1 && p.endsWith(sep) ? p.slice(0, -1) : p;
  const idx = trimmed.lastIndexOf(sep);
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function isLocalRoot(p: string): boolean {
  return sepFor(p) === "\\" ? /^[a-zA-Z]:\\?$/.test(p) : p === "/";
}
