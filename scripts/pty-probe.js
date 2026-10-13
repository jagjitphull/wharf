// Run inside Electron's own Node runtime (via ELECTRON_RUN_AS_NODE=1, no GUI
// involved) by verify-pty.js — a plain `require("node-pty")` here is the
// actual, ground-truth test of whether Local Shell/Mosh will work, since
// it's running under the exact binary that will load it for real.
try {
  require("node-pty");
  process.exit(0);
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
}
