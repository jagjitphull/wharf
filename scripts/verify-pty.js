#!/usr/bin/env node
// node-pty ships a native addon (built on node-addon-api/N-API, which is
// ABI-stable across Node versions) compiled during plain `npm install`
// against your system Node, not Electron's bundled one. For most native
// modules that difference would matter and need an Electron-specific
// rebuild; node-pty's N-API build doesn't need that rebuild in practice,
// but this only *assumes* the install actually succeeded — on Linux,
// node-pty has no prebuilt binary (see its prebuilds/ directory, which only
// covers darwin/win32), so it has to compile from source via node-gyp, and
// that step silently fails (and did, before this script existed) if the
// machine is missing build tools (gcc/make/python3), leaving Local Shell
// and Mosh broken with nothing catching it until a user hits the error at
// runtime (see ptyLoader.ts).
//
// So instead of trying to rebuild anything, this just verifies the actual,
// ground truth: does node-pty load under Electron's own Node runtime right
// now? ELECTRON_RUN_AS_NODE runs the installed Electron binary as a plain
// Node-compatible CLI — no window, no display server needed — which is
// exactly the runtime Local Shell/Mosh will really use.
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// node-pty runs every shell through a small helper binary, `spawn-helper`. The
// prebuilt macOS copies in its npm package are shipped *without* the executable
// bit, so on a Mac the first Local Shell (or Mosh) tab fails with
// "posix_spawnp failed" — in a dev checkout and in a packaged app alike, since
// the package keeps whatever mode the file has here. (Linux compiles its own
// and Windows has no such helper.) Fixed here, at install time, so everything
// downstream — `npm start`, `npm run package`, CI — gets a runnable helper.
function makeSpawnHelpersExecutable() {
  if (process.platform === "win32") return;
  let ptyDir;
  try {
    ptyDir = path.dirname(require.resolve("node-pty/package.json"));
  } catch {
    return; // not installed (yet): nothing to fix, and the check below will say so
  }
  const candidates = [path.join(ptyDir, "build", "Release", "spawn-helper")];
  const prebuilds = path.join(ptyDir, "prebuilds");
  if (fs.existsSync(prebuilds)) {
    for (const dir of fs.readdirSync(prebuilds)) candidates.push(path.join(prebuilds, dir, "spawn-helper"));
  }
  for (const file of candidates) {
    try {
      if (fs.existsSync(file) && (fs.statSync(file).mode & 0o111) !== 0o111) fs.chmodSync(file, 0o755);
    } catch {
      /* read-only or owned by someone else: leave it */
    }
  }
}
makeSpawnHelpersExecutable();

if (process.env.WHARF_SKIP_PTY_CHECK === "1") {
  console.log("WHARF_SKIP_PTY_CHECK=1 set — skipping the node-pty verification. Local Shell/Mosh may not work.");
  process.exit(0);
}

const electronPath = require("electron");
const probeScript = path.join(__dirname, "pty-probe.js");

const result = spawnSync(electronPath, [probeScript], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["ignore", "ignore", "pipe"],
  encoding: "utf8",
});

if (result.status === 0) {
  process.exit(0);
}

console.error(
  "\n" +
    "node-pty failed to load under Electron — Local Shell and Mosh tabs won't work.\n" +
    (result.stderr ? `\n${result.stderr.trim()}\n\n` : "\n") +
    "This almost always means node-pty couldn't compile its native addon during install\n" +
    "(no prebuilt binary exists for Linux). Install build tools and reinstall:\n" +
    "  Debian/Ubuntu: sudo apt install build-essential python3\n" +
    '  Fedora/RHEL:   sudo dnf groupinstall "Development Tools" && sudo dnf install python3\n' +
    "  then:          rm -rf node_modules/node-pty && npm install\n" +
    "\n" +
    "If you're intentionally working on SSH/SFTP only and don't need Local Shell or Mosh\n" +
    "right now, skip this check with: WHARF_SKIP_PTY_CHECK=1 npm install\n",
);
process.exit(1);
