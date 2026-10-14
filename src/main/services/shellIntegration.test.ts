import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.userData } }));

const hasShell = (name: string): boolean => spawnSync(name, ["-c", "true"]).status === 0;
const hasBash = hasShell("bash");
const hasZsh = hasShell("zsh");

const OSC_PROMPT_START = "\x1b]133;A\x07";
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

let mod: typeof import("./shellIntegration");

beforeEach(async () => {
  state.userData = mkdtempSync(path.join(tmpdir(), "wharf-shellint-test-"));
  vi.resetModules();
  mod = await import("./shellIntegration");
});

afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true });
});

/** Pulls the two base64 hook bodies back out of the bootstrap line. */
function decodedHooks(command: string): { bash: string; zsh: string } {
  const payloads = [...command.matchAll(/echo ([A-Za-z0-9+/=]+) \| base64 -d/g)].map((m) => Buffer.from(m[1], "base64").toString("utf8"));
  expect(payloads).toHaveLength(2);
  return { bash: payloads[0], zsh: payloads[1] };
}

describe("buildRemoteBootstrapCommand", () => {
  it("is exactly one line (it's sent as a single line of real input)", () => {
    expect(mod.buildRemoteBootstrapCommand()).not.toMatch(/[\r\n]/);
  });

  it("embeds the bash and zsh hooks as base64 payloads that decode to the OSC 133 hook bodies", () => {
    const { bash, zsh } = decodedHooks(mod.buildRemoteBootstrapCommand());
    expect(bash).toContain("PROMPT_COMMAND");
    expect(bash).toContain("133;D;");
    expect(zsh).toContain("add-zsh-hook precmd");
    expect(zsh).toContain("133;C;");
  });

  it.skipIf(!hasBash)("is syntactically valid shell", () => {
    const result = spawnSync("bash", ["-n"], { input: mod.buildRemoteBootstrapCommand() });
    expect(result.status).toBe(0);
  });

  it("is a silent no-op on a shell that is neither bash nor zsh", () => {
    // /bin/sh is dash on Debian/Ubuntu: neither $BASH_VERSION nor $ZSH_VERSION is set.
    const out = execFileSync("sh", ["-c", mod.buildRemoteBootstrapCommand()], { encoding: "utf8", env: { PATH: process.env.PATH } });
    expect(out).toBe("");
  });

  it.skipIf(!hasBash)("makes bash emit a ;D;<exit code> marker followed by a fresh prompt-start marker", () => {
    const out = execFileSync("bash", ["--norc", "-c", `${mod.buildRemoteBootstrapCommand()}; false; __wharf_cmd_end`], {
      encoding: "utf8",
    });
    expect(out).toContain(`\x1b]133;D;1\x07${OSC_PROMPT_START}`);
  });

  it.skipIf(!hasBash)("reports a zero exit code too, not just failures", () => {
    const out = execFileSync("bash", ["--norc", "-c", `${mod.buildRemoteBootstrapCommand()}; true; __wharf_cmd_end`], { encoding: "utf8" });
    expect(out).toContain(`\x1b]133;D;0\x07${OSC_PROMPT_START}`);
  });

  it.skipIf(!hasBash)("makes bash emit the command text, base64-encoded, in a ;C marker", () => {
    const out = execFileSync("bash", ["--norc", "-c", `${mod.buildRemoteBootstrapCommand()}; echo 'a;b'`], { encoding: "utf8" });
    expect(out).toContain(`\x1b]133;C;${b64("echo 'a;b'")}\x07`);
  });

  it.skipIf(!hasZsh)("ships zsh hooks that parse cleanly under zsh", () => {
    const { zsh } = decodedHooks(mod.buildRemoteBootstrapCommand());
    expect(spawnSync("zsh", ["-n"], { input: zsh }).status).toBe(0);
  });
});

describe("prepareLocalShellIntegration", () => {
  it("returns null for shells that aren't supported, so they spawn exactly as before", () => {
    expect(mod.prepareLocalShellIntegration("/usr/bin/fish")).toBeNull();
    expect(mod.prepareLocalShellIntegration("/bin/sh")).toBeNull();
    expect(mod.prepareLocalShellIntegration("")).toBeNull();
    expect(mod.prepareLocalShellIntegration("powershell.exe")).toBeNull();
  });

  it("gives bash a generated --rcfile that sources the user's ~/.bashrc and then the hooks", () => {
    const result = mod.prepareLocalShellIntegration("/usr/bin/bash");
    expect(result).not.toBeNull();
    expect(result!.args[0]).toBe("--rcfile");
    expect(result!.args[2]).toBe("-i");
    expect(result!.env).toEqual({});

    const initPath = result!.args[1];
    expect(initPath.startsWith(state.userData)).toBe(true);
    const contents = readFileSync(initPath, "utf8");
    expect(contents.indexOf("source ~/.bashrc")).toBeGreaterThanOrEqual(0);
    expect(contents.indexOf("source ~/.bashrc")).toBeLessThan(contents.indexOf("PROMPT_COMMAND"));
  });

  it.skipIf(!hasBash)("generates a bash init file that parses cleanly", () => {
    const result = mod.prepareLocalShellIntegration("bash");
    expect(spawnSync("bash", ["-n", result!.args[1]]).status).toBe(0);
  });

  it("gives zsh a generated ZDOTDIR whose .zshrc sources the user's real one first, then the hooks", () => {
    vi.stubEnv("ZDOTDIR", "/custom/zdotdir");
    try {
      const result = mod.prepareLocalShellIntegration("/bin/zsh");
      expect(result).not.toBeNull();
      expect(result!.args).toEqual([]);
      expect(result!.env.ZDOTDIR.startsWith(state.userData)).toBe(true);
      expect(result!.env.WHARF_ORIG_ZDOTDIR).toBe("/custom/zdotdir");

      const rcPath = path.join(result!.env.ZDOTDIR, ".zshrc");
      expect(existsSync(rcPath)).toBe(true);
      const rc = readFileSync(rcPath, "utf8");
      expect(rc.indexOf('source "$ORIG_ZDOTDIR/.zshrc"')).toBeGreaterThanOrEqual(0);
      expect(rc.indexOf('source "$ORIG_ZDOTDIR/.zshrc"')).toBeLessThan(rc.indexOf("add-zsh-hook"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to $HOME as the original ZDOTDIR when none is set", () => {
    vi.stubEnv("ZDOTDIR", "");
    vi.stubEnv("HOME", "/home/someone");
    try {
      expect(mod.prepareLocalShellIntegration("zsh")!.env.WHARF_ORIG_ZDOTDIR).toBe("/home/someone");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.skipIf(!hasZsh)("generates a .zshrc that parses cleanly under zsh", () => {
    const result = mod.prepareLocalShellIntegration("zsh");
    expect(spawnSync("zsh", ["-n", path.join(result!.env.ZDOTDIR, ".zshrc")]).status).toBe(0);
  });
});

describe("BootstrapEchoSuppressor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes everything straight through until start() is called", () => {
    const s = new mod.BootstrapEchoSuppressor();
    expect(s.feed("hello")).toBe("hello");
  });

  it("holds output back until the shell's first prompt-start marker, then releases it with a leading line break", () => {
    const s = new mod.BootstrapEchoSuppressor();
    s.start(() => {});
    expect(s.feed(' if [ -n "$BASH_VERSION" ]; then eval ...\r\n')).toBe("");
    expect(s.feed(`${OSC_PROMPT_START}user@host:~$ `)).toBe(`\r\n${OSC_PROMPT_START}user@host:~$ `);
  });

  it("finds a marker that arrives split across two chunks", () => {
    const s = new mod.BootstrapEchoSuppressor();
    s.start(() => {});
    expect(s.feed("echo\r\n\x1b]13")).toBe("");
    expect(s.feed("3;A\x07$ ")).toBe(`\r\n${OSC_PROMPT_START}$ `);
  });

  it("goes back to pass-through after releasing, and never fires the timeout callback afterward", () => {
    const onTimeout = vi.fn();
    const s = new mod.BootstrapEchoSuppressor();
    s.start(onTimeout);
    s.feed(`junk${OSC_PROMPT_START}`);
    expect(s.feed("later output")).toBe("later output");
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("flushes whatever was held back on timeout, so an unsupported shell isn't left silent", () => {
    const onTimeout = vi.fn();
    const s = new mod.BootstrapEchoSuppressor();
    s.start(onTimeout, 3000);
    expect(s.feed("fish prompt> ")).toBe("");
    vi.advanceTimersByTime(2999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledExactlyOnceWith("fish prompt> ");
    expect(s.feed("next")).toBe("next");
  });

  it("doesn't call the timeout callback when nothing was held back", () => {
    const onTimeout = vi.fn();
    const s = new mod.BootstrapEchoSuppressor();
    s.start(onTimeout, 1000);
    vi.advanceTimersByTime(1000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("restarting discards anything held from the previous start", () => {
    const first = vi.fn();
    const second = vi.fn();
    const s = new mod.BootstrapEchoSuppressor();
    s.start(first, 1000);
    s.feed("stale");
    s.start(second, 1000);
    s.feed("fresh");
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith("fresh");
  });
});
