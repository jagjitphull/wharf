/**
 * node-pty ships a native addon that must be compiled against Electron's own
 * Node ABI (a plain `npm install` only builds it for the system Node used to
 * run npm) — see the `rebuild-native` script / postinstall. Requiring it
 * lazily, only when a pty-backed feature (local shell, Mosh) is actually
 * used, means a missing or ABI-mismatched build surfaces as one clear,
 * catchable error right there instead of crashing the whole main process at
 * startup. Shared by localShellManager.ts and moshManager.ts so both give
 * the exact same diagnostic for the same underlying problem.
 */
export function loadPty(): typeof import("node-pty") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("node-pty");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `This feature isn't available: node-pty's native module failed to load (${detail}). ` +
        `Run "npm run rebuild-native" (or "npx electron-rebuild -f -w node-pty") and restart Wharf.`,
    );
  }
}
