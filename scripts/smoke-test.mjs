// Launch smoke test for a packaged (or unpacked) Wharf build.
//
//   xvfb-run -a node scripts/smoke-test.mjs [path/to/wharf-executable]     (Linux: needs a display)
//   node scripts/smoke-test.mjs release/win-unpacked/Wharf.exe              (Windows)
//   node scripts/smoke-test.mjs release/mac-arm64/Wharf.app/Contents/MacOS/Wharf   (macOS)
//
// Unit and integration tests run on plain Node, so they can't notice a broken
// preload bridge, a file missing from the asar, or node-pty failing to load in
// the packaged app. This starts the real executable with a throwaway profile,
// drives it over the Chrome DevTools Protocol, and fails if any of that is
// broken:
//   - the React UI mounts
//   - the preload bridge exists and an IPC round trip to the main process works
//   - a local shell (node-pty) starts and runs a command
//   - nothing threw in the renderer, and the main process didn't die
//   - a log file was written
//   - the app quits cleanly when asked
//
// Environment:
//   SMOKE_NO_SANDBOX=1    Linux only: pass --no-sandbox (needed when the unpacked
//                         chrome-sandbox isn't setuid root, e.g. CI runners and
//                         containers; also applied automatically when running as root)
//   SMOKE_SCREENSHOT=path save a PNG of the window once the checks have run
//   SMOKE_TIMEOUT_MS=n    per-step timeout (default 30000)

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const defaultExecutable = isWindows
  ? path.join(root, "release", "win-unpacked", "Wharf.exe")
  : isMac
    ? path.join(root, "release", "mac-arm64", "Wharf.app", "Contents", "MacOS", "Wharf")
    : path.join(root, "release", "linux-unpacked", "wharf");
const executable = path.resolve(process.argv[2] ?? defaultExecutable);
/** The .app bundle on macOS (what the fuse reader wants), the executable elsewhere. */
const fuseTarget = isMac ? executable.slice(0, executable.indexOf(".app") + 4) : executable;
// macOS: a fake $HOME and a detached (new-session) launch both stop Chromium's
// helper processes from connecting back to the browser process ("Terminating
// current process after 15 seconds with no connection"), so the app never
// opens a window. Launched plainly, as a user would, it is fine.
const isolateHome = !isMac;
const detachApp = !isWindows && !isMac;
const useSandboxFlag = !isWindows && !isMac && (process.env.SMOKE_NO_SANDBOX === "1" || process.getuid?.() === 0);
const stepTimeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const requestTimeout = stepTimeout * 2; // the local-shell check legitimately waits up to stepTimeout inside one request
const overallTimeout = 8 * 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kills the app and everything it spawned (Chromium's helper processes keep
 * writing into the profile for a moment after the main one is gone), then
 * clears the throwaway profile. Cleanup is best-effort: a leftover temp
 * directory is harmless, a failed check run because of one is not. */
async function killAndClean(child, dir) {
  if (isWindows) {
    // /T takes the whole process tree; there are no process groups to signal.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    for (const target of [-child.pid, child.pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  await sleep(300);
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* leave it for the OS temp cleaner */
  }
}

async function until(description, probe, timeoutMs = stepTimeout) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(200);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}${lastError ? ` (${lastError.message})` : ""}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Minimal CDP client: request/response by id, plus a listener for events. */
async function connectCdp(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry?.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry?.resolve(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  });
  // Browser.close tears the connection down before it can answer, so a send
  // still waiting when the socket closes has to fail rather than hang.
  ws.on("close", () => {
    for (const entry of pending.values()) entry.reject(new Error(`${entry.method}: connection closed`));
    pending.clear();
  });
  return {
    // Every request gets a deadline: a main process stuck on something (a native
    // dialog, say) otherwise leaves the run waiting forever for an answer.
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method}: no answer within ${requestTimeout / 1000}s`));
        }, requestTimeout);
        pending.set(id, {
          method,
          resolve: (value) => (clearTimeout(timer), resolve(value)),
          reject: (err) => (clearTimeout(timer), reject(err)),
        });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    onEvent: (listener) => listeners.push(listener),
    close: () => ws.close(),
  };
}

/** Evaluates `expression` in the page and returns its value (awaiting promises). */
async function evaluate(page, expression) {
  const result = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

/**
 * Starts the app with extra arguments/environment in its own throwaway
 * profile, lets it run for `ms`, then kills it. Used for the checks that
 * prove the binary's fuses are flipped: they're about what the *binary*
 * refuses to do, so there's nothing to drive over CDP.
 */
async function probeLaunch({ args = [], env = {}, ms = 6_000, afterMs, bare = false }) {
  const dir = mkdtempSync(path.join(tmpdir(), "wharf-probe-"));
  mkdirSync(path.join(dir, "home"), { recursive: true });
  // `bare` passes exactly `args`: with the RunAsNode fuse on, the binary
  // behaves as Node.js, which rejects Chromium switches like --no-sandbox.
  const probeArgs = bare ? args : ["--disable-gpu", `--user-data-dir=${path.join(dir, "userData")}`, ...args];
  if (!bare && useSandboxFlag) probeArgs.push("--no-sandbox");
  const child = spawn(executable, probeArgs, {
    env: { ...process.env, ...(isolateHome ? { HOME: path.join(dir, "home") } : {}), ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: detachApp, // its own process group, so killAndClean can take the helpers with it
  });
  const chunks = [];
  child.stdout.on("data", (c) => chunks.push(c.toString()));
  child.stderr.on("data", (c) => chunks.push(c.toString()));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    await Promise.race([exited, sleep(ms)]);
    const during = afterMs ? await afterMs() : undefined;
    return { output: chunks.join(""), during };
  } finally {
    await killAndClean(child, dir);
  }
}

function portAcceptsConnections(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  ok    ${name}${detail ? ` (${detail})` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

async function main() {
  if (!existsSync(executable)) {
    console.error(`No executable at ${executable}. Build it first (npm run package) or pass a path.`);
    return 2;
  }

  // Checks on the binary itself, before the main launch (the app holds a
  // single-instance lock, so these can't overlap with it).
  await check("ELECTRON_RUN_AS_NODE is ignored (RunAsNode fuse off)", async () => {
    // With the fuse on, this would run the snippet as plain Node.js and exit.
    const { output } = await probeLaunch({
      args: ["-e", "process.stdout.write('RAN-AS-NODE:' + process.versions.node)"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      bare: true,
    });
    if (output.includes("RAN-AS-NODE")) throw new Error("the binary ran arbitrary JavaScript as Node.js");
  });

  await check("--inspect does not open a debugger (NodeCliInspect fuse off)", async () => {
    const inspectPort = await freePort();
    const { during } = await probeLaunch({
      args: [`--inspect=${inspectPort}`],
      afterMs: () => portAcceptsConnections(inspectPort),
    });
    if (during) throw new Error(`a debugger is listening on port ${inspectPort}`);
  });

  await check("fuses are set as electron-builder.yml configures them", async () => {
    // Reads the flags straight out of the binary. The two checks above prove
    // the behavior of the riskiest ones; this covers the rest (NODE_OPTIONS
    // can't be probed reliably from outside).
    const { getCurrentFuseWire, FuseV1Options } = (await import("@electron/fuses")).default;
    const wire = await getCurrentFuseWire(fuseTarget);
    const expected = {
      RunAsNode: false,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      OnlyLoadAppFromAsar: true,
      EnableCookieEncryption: true,
    };
    const wrong = Object.entries(expected)
      .filter(([name, enabled]) => (wire[FuseV1Options[name]] === 49) !== enabled)
      .map(([name, enabled]) => `${name} should be ${enabled ? "on" : "off"}`);
    if (wrong.length > 0) throw new Error(wrong.join(", "));
  });

  // A throwaway profile: --user-data-dir decides where Electron puts userData
  // (the data file, and the logs everywhere but macOS), HOME is what a POSIX
  // local shell starts in.
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "wharf-smoke-"));
  const home = path.join(sandboxDir, "home");
  const userData = path.join(sandboxDir, "userData");
  mkdirSync(home, { recursive: true });
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`, "--disable-gpu", `--user-data-dir=${userData}`];
  if (useSandboxFlag) args.push("--no-sandbox");

  console.log(`Launching ${executable}`);
  const output = [];
  const child = spawn(executable, args, {
    // WHARF_SMOKE lets the local-shell check tell a command's output from the echo of what was typed.
    env: { ...process.env, ...(isolateHome ? { HOME: home } : {}), WHARF_SMOKE: "42", ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: detachApp,
  });
  const capture = (chunk) => output.push(chunk.toString());
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  let exitInfo = null;
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exitInfo = { code, signal };
      resolve(exitInfo);
    });
  });

  let outputPrinted = false;
  const printAppOutput = () => {
    if (outputPrinted) return;
    outputPrinted = true;
    console.log("\n--- app output (last 60 lines) ---");
    console.log(output.join("").split("\n").slice(-60).join("\n"));
    console.log(`--- app exit: ${exitInfo ? JSON.stringify(exitInfo) : "still running"} ---`);
  };

  // Whatever else goes wrong, this ends the run with the app's own output
  // rather than leaving CI to hit its job limit with nothing to read.
  const watchdog = setTimeout(() => {
    console.error(`\nSmoke test exceeded ${overallTimeout / 60_000} minutes; giving up.`);
    printAppOutput();
    process.exit(1);
  }, overallTimeout);
  watchdog.unref();

  const rendererProblems = [];
  let page;
  let browser;
  try {
    await check("window opens and exposes a debuggable page", async () => {
      const target = await until("the app window", async () => {
        if (exitInfo) throw new Error(`the app exited early (${JSON.stringify(exitInfo)})`);
        // A per-attempt timeout: against a port nothing answers on, a bare fetch can sit far longer than the step's own deadline.
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) });
        const targets = await response.json();
        return targets.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
      });
      page = await connectCdp(target.webSocketDebuggerUrl);
      page.onEvent((event) => {
        if (event.method === "Runtime.exceptionThrown") {
          const d = event.params.exceptionDetails;
          rendererProblems.push(`exception: ${d.exception?.description ?? d.text}`);
        } else if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") {
          rendererProblems.push(`console.error: ${event.params.args.map((a) => a.value ?? a.description).join(" ")}`);
        }
      });
      await page.send("Runtime.enable");
      // The window has usually finished loading before we could attach, so an
      // error thrown during startup would be missed. Reload it with the
      // listeners in place; the main process is unaffected.
      await page.send("Page.reload");
      return target.url;
    });
    if (!page) throw new Error("no page to test against");

    await check("React UI mounts", async () => {
      // Page.reload doesn't wait for the new document; make sure we're not
      // looking at the old one.
      await sleep(500);
      await until("#root to have content", () => evaluate(page, `document.getElementById("root")?.childElementCount > 0`));
    });

    await check("preload bridge is exposed", async () => {
      const type = await evaluate(page, `typeof window.wharf`);
      if (type !== "object") throw new Error(`window.wharf is ${type}`);
    });

    await check("IPC round trip returns the app version", async () => {
      const version = await evaluate(page, `window.wharf.update.getVersion()`);
      if (version !== expectedVersion) throw new Error(`expected ${expectedVersion}, got ${version}`);
      return version;
    });

    await check("web permissions are denied except notifications", async () => {
      // Electron grants every permission Chromium asks about unless told
      // otherwise; Wharf only needs desktop notifications.
      const states = await evaluate(
        page,
        `Promise.all(["geolocation", "midi", "camera", "notifications"].map((name) =>
          navigator.permissions.query({ name }).then((s) => [name, s.state], () => [name, "unsupported"]),
        )).then((pairs) => Object.fromEntries(pairs))`,
      );
      for (const name of ["geolocation", "midi", "camera"]) {
        if (states[name] === "granted") throw new Error(`${name} is granted`);
      }
      if (states.notifications !== "granted") throw new Error(`notifications is ${states.notifications}`);
      return Object.entries(states)
        .map(([name, state]) => `${name}: ${state}`)
        .join(", ");
    });

    await check("data store is readable over IPC", async () => {
      const isArray = await evaluate(page, `window.wharf.hosts.list().then((h) => Array.isArray(h))`);
      if (!isArray) throw new Error("hosts.list() did not return an array");
    });

    await check("local shell (node-pty) runs a command", async () => {
      // The shell expands $WHARF_SMOKE (%WHARF_SMOKE% in cmd.exe, Windows' default
      // shell), so "wharf-smoke-42" can only appear in the command's output,
      // never in the echo of what was typed.
      const command = isWindows ? "echo wharf-smoke-%WHARF_SMOKE%" : "echo wharf-smoke-$WHARF_SMOKE";
      const output = await evaluate(
        page,
        `(async () => {
          let text = "";
          const sessions = new Set();
          const off = window.wharf.ssh.onData((e) => { if (sessions.has(e.sessionId)) text += e.chunk; });
          const started = await window.wharf.localShell.connect(80, 24);
          const id = started.sessionId;
          sessions.add(id);
          window.wharf.ssh.write(id, ${JSON.stringify(command)} + "\\r");
          const deadline = Date.now() + ${stepTimeout};
          while (!text.includes("wharf-smoke-42") && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
          }
          off();
          await window.wharf.ssh.disconnect(id);
          return text;
        })()`,
      );
      if (!output.includes("wharf-smoke-42")) throw new Error(`no command output; got: ${JSON.stringify(output.slice(-200))}`);
    });

    if (process.env.SMOKE_SCREENSHOT) {
      await check("screenshot saved", async () => {
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(process.env.SMOKE_SCREENSHOT, Buffer.from(shot.data, "base64"));
        return process.env.SMOKE_SCREENSHOT;
      });
    }

    await check("no renderer exceptions or console errors", async () => {
      if (rendererProblems.length > 0) throw new Error(rendererProblems.join("; "));
    });

    await check("main process is still running", async () => {
      if (exitInfo) throw new Error(`exited ${JSON.stringify(exitInfo)}`);
    });

    await check("data file and its directory are owner-only", async () => {
      // The store library creates its file world-readable; that file holds
      // every saved host (and, without a keyring, the saved passwords).
      // Windows files have no Unix permission bits to check.
      if (isWindows) return "skipped on Windows (no Unix permission bits)";
      const dataFile = path.join(userData, "wharf-data.json");
      await until("the data file", () => existsSync(dataFile));
      const modes = {
        "data directory": statSync(userData).mode & 0o777,
        "data file": statSync(dataFile).mode & 0o777,
      };
      const loose = Object.entries(modes).filter(([, mode]) => mode & 0o077);
      if (loose.length > 0) {
        throw new Error(loose.map(([name, mode]) => `${name} is ${mode.toString(8)}`).join(", "));
      }
      return `dir ${modes["data directory"].toString(8)}, file ${modes["data file"].toString(8)}`;
    });

    await check("log file was written", async () => {
      // electron-log writes to <userData>/logs, except on macOS where it is ~/Library/Logs/<app>.
      const logFile = isMac ? path.join(homedir(), "Library", "Logs", "Wharf", "main.log") : path.join(userData, "logs", "main.log");
      const size = await until(`${logFile}`, () => existsSync(logFile) && statSync(logFile).size > 0 && statSync(logFile).size);
      return `${size} bytes`;
    });

    await check("app quits cleanly when asked", async () => {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5_000) })).json();
      browser = await connectCdp(version.webSocketDebuggerUrl);
      if (isMac) {
        // By macOS convention the app keeps running after its last window closes
        // (Wharf follows that, see window-all-closed), and Browser.close then never
        // answers. So: closing the windows must leave no window, and a terminate
        // request (what Cmd+Q and a shutdown amount to) must end the process.
        void browser.send("Browser.close").catch(() => {});
        await sleep(2_000);
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) })).json();
        const windows = targets.filter((t) => t.type === "page");
        if (windows.length > 0) throw new Error(`${windows.length} window(s) still open after Browser.close`);
        child.kill("SIGTERM");
        const result = await Promise.race([
          exited,
          sleep(stepTimeout).then(() => {
            throw new Error("still running 30s after SIGTERM");
          }),
        ]);
        if (result.code !== 0 && result.signal !== "SIGTERM") throw new Error(`exit code ${result.code} (signal ${result.signal})`);
        return "windows closed; stays running as macOS apps do; ended on SIGTERM";
      }
      await browser.send("Browser.close").catch(() => {});
      const result = await Promise.race([
        exited,
        sleep(stepTimeout).then(() => {
          throw new Error("still running after Browser.close");
        }),
      ]);
      if (result.code !== 0) throw new Error(`exit code ${result.code} (signal ${result.signal})`);
    });
  } finally {
    page?.close();
    browser?.close();
    if (results.some((r) => !r.ok) || process.exitCode) printAppOutput();
    await killAndClean(child, sandboxDir);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log(`\nSmoke test FAILED: ${failed.length} of ${results.length} checks`);
    return 1;
  }
  console.log(`\nSmoke test passed (${results.length} checks)`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
