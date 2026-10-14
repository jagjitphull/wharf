/**
 * node-pty ships a native addon that has to compile successfully during
 * `npm install` (no prebuilt binary exists for Linux — see scripts/verify-
 * pty.js, which checks exactly this right after install). Requiring it
 * lazily, only when a pty-backed feature (local shell, Mosh) is actually
 * used, means a build that somehow still slipped through broken (install
 * ran with WHARF_SKIP_PTY_CHECK=1, or node_modules got hand-edited) surfaces
 * as one clear, catchable error right there instead of crashing the whole
 * main process at startup. Shared by localShellManager.ts and
 * moshManager.ts so both give the exact same diagnostic for the same
 * underlying problem.
 */
export function loadPty(): typeof import("node-pty") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately lazy (see doc comment above)
    return require("node-pty");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `This feature isn't available: node-pty's native module failed to load (${detail}). ` +
        `Install build tools (e.g. "sudo apt install build-essential python3" on Debian/Ubuntu), ` +
        `then "rm -rf node_modules/node-pty && npm install", and restart Wharf.`,
    );
  }
}
