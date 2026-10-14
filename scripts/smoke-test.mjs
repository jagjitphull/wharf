// Launch smoke test for a packaged (or unpacked) Wharf build.
//
//   xvfb-run -a node scripts/smoke-test.mjs [path/to/wharf-executable]
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
//   SMOKE_NO_SANDBOX=1    pass --no-sandbox (needed when the unpacked chrome-sandbox
//                         isn't setuid root, e.g. CI runners and containers; also
//                         applied automatically when running as root)
//   SMOKE_SCREENSHOT=path save a PNG of the window once the checks have run
//   SMOKE_TIMEOUT_MS=n    per-step timeout (default 30000)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const executable = path.resolve(process.argv[2] ?? path.join(root, "release", "linux-unpacked", "wharf"));
const stepTimeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { method, resolve, reject });
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

  // A throwaway profile: XDG_CONFIG_HOME decides where Electron puts userData
  // (and so the data file and logs), HOME is what the local shell starts in.
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "wharf-smoke-"));
  const home = path.join(sandboxDir, "home");
  const configHome = path.join(sandboxDir, "config");
  mkdirSync(home, { recursive: true }); // the local shell starts here
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`, "--disable-gpu"];
  if (process.env.SMOKE_NO_SANDBOX === "1" || process.getuid?.() === 0) args.push("--no-sandbox");

  console.log(`Launching ${executable}`);
  const output = [];
  const child = spawn(executable, args, {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: configHome, ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
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

  const rendererProblems = [];
  let page;
  let browser;
  try {
    await check("window opens and exposes a debuggable page", async () => {
      const target = await until("the app window", async () => {
        if (exitInfo) throw new Error(`the app exited early (${JSON.stringify(exitInfo)})`);
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
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

    await check("data store is readable over IPC", async () => {
      const isArray = await evaluate(page, `window.wharf.hosts.list().then((h) => Array.isArray(h))`);
      if (!isArray) throw new Error("hosts.list() did not return an array");
    });

    await check("local shell (node-pty) runs a command", async () => {
      // 6*7 is evaluated by the shell, so "wharf-smoke-42" can only appear in
      // the command's output, never in the echo of what was typed.
      const output = await evaluate(
        page,
        `(async () => {
          let text = "";
          const sessions = new Set();
          const off = window.wharf.ssh.onData((e) => { if (sessions.has(e.sessionId)) text += e.chunk; });
          const started = await window.wharf.localShell.connect(80, 24);
          const id = started.sessionId;
          sessions.add(id);
          window.wharf.ssh.write(id, "echo wharf-smoke-$((6*7))\\r");
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

    await check("log file was written", async () => {
      const logFile = path.join(configHome, "Wharf", "logs", "main.log");
      const size = await until(`${logFile}`, () => existsSync(logFile) && statSync(logFile).size > 0 && statSync(logFile).size);
      return `${size} bytes`;
    });

    await check("app quits cleanly when asked", async () => {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      browser = await connectCdp(version.webSocketDebuggerUrl);
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
    if (!exitInfo) child.kill("SIGKILL");
    await Promise.race([exited, sleep(5_000)]);
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log("\n--- app output (last 60 lines) ---");
    console.log(output.join("").split("\n").slice(-60).join("\n"));
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
