import { createWriteStream, type WriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { BrowserWindow } from "electron";
import type { IPty } from "node-pty";
import { IPC, type HostRecord } from "../../shared/types";
import { getCommandBlocksEnabled, getHosts } from "./store";
import { readSecret } from "./secretStore";
import { loadPty } from "./ptyLoader";
import { BootstrapEchoSuppressor, buildRemoteBootstrapCommand } from "./shellIntegration";

interface MoshSession {
  id: string;
  hostId: string;
  proc: IPty;
  logStream?: WriteStream;
  /** True once we've either auto-answered a password/passphrase prompt once,
   * or seen enough output that we're clearly past the auth step — stops us
   * from ever pattern-matching again for this session, so a coincidental
   * "password" appearing in real remote output later is never mistaken for
   * a login prompt. */
  authHandled: boolean;
  /** Everything received before authHandled flips, so onExit can recognize
   * the "binary not found" case and give a clear message instead of a bare
   * exit code. */
  earlyOutput: string;
  /** Hides the visible echo of the Command Blocks bootstrap line right
   * after it's sent — see BootstrapEchoSuppressor. A no-op the rest of the
   * time. */
  echoFilter: BootstrapEchoSuppressor;
}

const sessions = new Map<string, MoshSession>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/** Builds the `ssh` command Mosh's own bootstrap step shells out to, so it
 * picks up the same port/key/jump-host settings as a regular SSH session to
 * this host would — Mosh has no concept of these itself, they only matter
 * for the initial SSH handshake that starts mosh-server. */
function buildSshCommand(host: HostRecord): string {
  const parts = ["ssh"];
  if (host.port && host.port !== 22) parts.push("-p", String(host.port));
  if (host.authMethod === "privateKey" && host.privateKeyPath) {
    parts.push("-i", host.privateKeyPath);
  }
  if (host.jumpHostId) {
    const jump = getHosts().find((h) => h.id === host.jumpHostId);
    if (jump) {
      const target = jump.port && jump.port !== 22 ? `${jump.username}@${jump.hostname}:${jump.port}` : `${jump.username}@${jump.hostname}`;
      parts.push("-J", target);
    }
  }
  // Quote each part defensively (paths/hosts could contain spaces) — this
  // string is passed to mosh's --ssh= option, which re-splits it itself.
  return parts.map((p) => (/\s/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p)).join(" ");
}

const AUTH_PROMPT = /(password:|passphrase for)/i;

/**
 * Opens a Mosh (mobile shell) session by spawning the real `mosh` CLI as a
 * pty, exactly the way a user would run it themselves in a terminal —
 * there's no reimplementation of Mosh's UDP-based State Synchronization
 * Protocol here, just the same client binary a real terminal would use.
 * Mirrors sshManager.connect()'s contract (broadcasts on IPC.ssh.onData /
 * onClosed, keyed by a fresh sessionId) so the renderer needs no awareness
 * that a tab is Mosh rather than plain SSH.
 *
 * Requires `mosh` installed locally and `mosh-server` installed on the
 * remote host — this is not something Wharf can install for the user.
 * Host-key verification and interactive password/passphrase prompts are
 * handled by the real `ssh` binary Mosh shells out to (its own
 * ~/.ssh/known_hosts, not Wharf's own TOFU dialog) — a host-key prompt
 * shows up live in the terminal exactly as it would in a real terminal, and
 * the user answers it there. A password or key passphrase, if this host has
 * one saved, is auto-filled the first time such a prompt appears (falling
 * back to the user typing it themselves if the pattern is ever missed).
 */
export function connect(hostId: string, cols: number, rows: number): string {
  const host = getHosts().find((h) => h.id === hostId);
  if (!host) throw new Error(`Host ${hostId} not found`);

  const pty = loadPty();
  const sessionId = randomUUID();

  const sshCommand = buildSshCommand(host);
  const target = `${host.username}@${host.hostname}`;
  const secret = host.authMethod !== "agent" ? readSecret(host.secretId) : null;

  // GUI-launched apps (Electron included) commonly don't inherit the user's
  // shell locale — mosh-server refuses to start without a UTF-8 locale on
  // both ends, and fails with a locale-mismatch error that has nothing to
  // do with the actual connection. Only fills in when unset, so a real
  // configured locale always wins.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.LANG) env.LANG = "C.UTF-8";
  if (!env.LC_ALL) env.LC_ALL = "C.UTF-8";

  const proc = pty.spawn("mosh", ["--ssh=" + sshCommand, target], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: homedir(),
    env,
  });

  proc.onData((chunk: string) => {
    const session = sessions.get(sessionId);
    const visible = session ? session.echoFilter.feed(chunk) : chunk;
    if (visible) broadcast(IPC.ssh.onData, { sessionId, chunk: visible });
    if (session) {
      // Unfiltered — logging and the password/passphrase auto-fill match
      // below both need the real, complete stream, not the display-only
      // filtered view.
      session.logStream?.write(chunk);
      if (!session.authHandled) {
        session.earlyOutput += chunk;
        if (secret && AUTH_PROMPT.test(chunk)) {
          proc.write(secret + "\r");
          session.authHandled = true;
        } else if (session.earlyOutput.length > 4096) {
          // Well past any plausible auth prompt by now — stop matching so
          // real remote output is never mistaken for one.
          session.authHandled = true;
        }
      }
    }
  });

  proc.onExit(({ exitCode }: { exitCode: number }) => {
    const session = sessions.get(sessionId);
    let error: string | undefined;
    if (exitCode !== 0) {
      if (session?.earlyOutput.includes("execvp(3) failed")) {
        error =
          "Mosh isn't installed on this machine — install it (e.g. `apt install mosh` / `brew install mosh`) " +
          "and make sure `mosh-server` is installed on the remote host too.";
      } else {
        error = `Mosh session ended (exit code ${exitCode})`;
      }
    }
    broadcast(IPC.ssh.onClosed, { sessionId, error });
    session?.logStream?.end();
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, {
    id: sessionId,
    hostId,
    proc,
    authHandled: !secret,
    earlyOutput: "",
    echoFilter: new BootstrapEchoSuppressor(),
  });

  if (getCommandBlocksEnabled()) {
    // Sent as one real line of input, same as the user typing it — there's
    // no clean signal from here that the mosh session is fully up (auth
    // done, MOTD flushed, real shell prompt showing), so this is a fixed
    // best-effort delay long enough for that to typically have happened.
    // A bash/zsh remote shell picks it up; anything else no-ops harmlessly.
    setTimeout(() => {
      const session = sessions.get(sessionId);
      if (!session) return;
      session.echoFilter.start((pending) => broadcast(IPC.ssh.onData, { sessionId, chunk: pending }));
      proc.write(buildRemoteBootstrapCommand() + "\r");
    }, 1000);
  }

  return sessionId;
}

export function has(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function disconnectSessionsForHost(hostId: string): void {
  for (const [id, session] of sessions) {
    if (session.hostId === hostId) disconnect(id);
  }
}

export function write(sessionId: string, data: string): void {
  sessions.get(sessionId)?.proc.write(data);
}

export function resize(sessionId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.proc.resize(cols, rows);
}

export function disconnect(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  session.proc.kill();
  session.logStream?.end();
}

export function startLogging(sessionId: string, filePath: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.logStream?.end();
  session.logStream = createWriteStream(filePath, { flags: "w" });
}

export function stopLogging(sessionId: string): void {
  const session = sessions.get(sessionId);
  session?.logStream?.end();
  if (session) session.logStream = undefined;
}
