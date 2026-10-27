// Drives a packaged Wharf over the Chrome DevTools Protocol for the end-to-end
// scenarios in ./scenarios. Each scenario gets a fresh app with its own profile
// and $HOME, so nothing leaks between them. Linux only: the scenarios open a
// local bash shell and rely on a virtual display (xvfb-run).

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let nextPort = 9500 + Math.floor(Math.random() * 200);

/** Polls `fn` until it returns something truthy; returns that value, or undefined on timeout. */
export async function until(fn, timeout = 10_000, interval = 100) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) return undefined;
    await sleep(interval);
  }
}

/**
 * Starts the app. `profile` and `home` can be passed to reuse a previous run's data (a restart).
 * Returns the controls scenarios use; call `close()` when done (it also deletes any profile it created).
 */
export async function launch({ exe, shotsDir, profile, home, env = {} }) {
  const ownsProfile = !profile;
  profile ??= mkdtempSync(path.join(tmpdir(), "wharf-e2e-"));
  home ??= mkdtempSync(path.join(tmpdir(), "wharf-e2e-home-"));
  const port = nextPort++;
  const sandboxFlag = process.env.E2E_NO_SANDBOX === "1" || process.getuid?.() === 0 ? ["--no-sandbox"] : [];
  const child = spawn(exe, [...sandboxFlag, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), SHELL: "/bin/bash", ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let appOutput = "";
  child.stdout.on("data", (d) => (appOutput += d));
  child.stderr.on("data", (d) => (appOutput += d));

  const page = await until(
    async () => {
      try {
        return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
      } catch {
        return undefined;
      }
    },
    30_000,
    250,
  );
  if (!page) {
    killTree(child);
    throw new Error(`Wharf never opened its debugging port.\n${appOutput.slice(-2000)}`);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(`${d.text} ${d.exception?.description ?? ""}`.trim());
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Runtime.enable");

  /** Evaluates an expression in the page (awaiting promises) and returns its value. */
  const ev = async (expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result?.value;
  /** Same, for expressions that produce JSON-able values. */
  const evJson = async (expression) => JSON.parse(await ev(`(async () => JSON.stringify(await (${expression})))()`));
  /** Runs `fn(element)` (source text) against the first match for `selector`; false-ish when there is none. */
  const q = (selector, fn = "(el) => !!el") =>
    ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return (${fn})(el); })()`);

  const key = async (k, code, vk, { modifiers = 0, text } = {}) => {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      modifiers,
      ...(text ? { text } : {}),
    });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const KEYS = {
    Enter: ["Enter", 13, "\r"],
    Escape: ["Escape", 27],
    Tab: ["Tab", 9, "\t"],
    ArrowRight: ["ArrowRight", 39],
    ArrowUp: ["ArrowUp", 38],
  };

  const app = {
    profile,
    home,
    errors,
    ev,
    evJson,
    q,
    send,
    sleep,
    until,
    output: () => appOutput,

    /** Presses a named key (Enter, Escape, Tab, ArrowRight, ArrowUp) or a letter with Ctrl held. */
    async press(name, { ctrl = false } = {}) {
      if (KEYS[name]) {
        const [code, vk, text] = KEYS[name];
        return key(name, code, vk, { text });
      }
      return key(name, `Key${name.toUpperCase()}`, name.toUpperCase().charCodeAt(0), { modifiers: ctrl ? 2 : 0 });
    },
    /** Types into whatever has focus; "\n" presses Enter. */
    async type(text) {
      for (const ch of text) {
        if (ch === "\n") await key("Enter", "Enter", 13, { text: "\r" });
        else await send("Input.insertText", { text: ch });
      }
    },
    /** Sets a text input's value the way a user typing would (so React sees it). */
    setInput: (selector, value) =>
      ev(
        `(() => { const i = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      ),
    clickText: (selector, text) =>
      ev(
        `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); el?.click(); return !!el; })()`,
      ),
    click: (selector) => ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.click(); return !!el; })()`),
    rail: (label) => ev(`document.querySelector('button[aria-label="${label}"]').click()`),
    menuItems: () => evJson(`[...document.querySelectorAll('.context-menu-item')].map((i) => i.textContent)`),
    async rightClick(selector, index = 0) {
      const r = await evJson(
        `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
      );
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "right", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "right", clickCount: 1 });
      await until(() => q(".context-menu"), 3000, 50);
      return r;
    },
    /** Opens a local bash shell tab through the title bar's + menu and focuses its terminal. */
    async newLocalShell() {
      const before = await ev(`document.querySelectorAll('.tab-strip .tab').length`);
      await ev(`document.querySelector('.title-bar-new-tab').click()`);
      await until(() => app.q(".context-menu"), 3000, 50);
      await app.clickText(".context-menu-item", "New Local Shell");
      await until(async () => (await ev(`document.querySelectorAll('.tab-strip .tab').length`)) > before, 10_000);
      await until(async () => atPrompt(await app.screen()), 15_000);
      await ev(`document.querySelector('.tab-pane-container[style*="flex"] .xterm-helper-textarea')?.focus()`);
    },
    /** The visible text of the active terminal. */
    screen: () => ev(`document.querySelector('.tab-pane-container[style*="flex"] .xterm-rows')?.innerText ?? ''`),
    waitScreen: (re, timeout = 10_000) => until(async () => re.test(await app.screen()), timeout),
    /** Types a command into the active terminal and, unless told not to, waits for the prompt to come back. */
    async run(command, { wait = true } = {}) {
      const before = await app.screen();
      await app.type(`${command}\n`);
      if (wait)
        await until(
          async () => {
            const now = await app.screen();
            return now !== before && atPrompt(now);
          },
          15_000,
          100,
        );
      await sleep(250);
    },
    async shot(name) {
      if (!shotsDir) return;
      mkdirSync(shotsDir, { recursive: true });
      const { result } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(result.data, "base64"));
    },
    async reload() {
      await ev(`window.wharf.window.reload()`);
      await sleep(1500);
      await until(() => q("#root > *"), 15_000);
    },
    /** Quits the app but keeps its profile, so a later launch({ profile, home }) is a restart. */
    async stop() {
      killTree(child);
      await sleep(1500);
    },
    async close() {
      killTree(child);
      await sleep(800);
      if (ownsProfile) {
        for (const d of [profile, home]) {
          try {
            rmSync(d, { recursive: true, force: true });
          } catch {
            /* a helper process may still be writing; the OS temp dir is cleaned up anyway */
          }
        }
      }
    },
  };
  return app;
}

/** Whether the terminal's last line is a shell prompt (ends in # or $). */
export const atPrompt = (screenText) => /[#$]$/.test(screenText.trimEnd());

function killTree(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}
