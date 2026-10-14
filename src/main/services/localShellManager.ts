import { createWriteStream, type WriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { BrowserWindow } from "electron";
import type { IPty } from "node-pty";
import { IPC } from "../../shared/types";
import { loadPty } from "./ptyLoader";
import { prepareLocalShellIntegration } from "./shellIntegration";
import { getCommandBlocksEnabled } from "./store";

interface LocalSession {
  id: string;
  proc: IPty;
  logStream?: WriteStream;
}

const sessions = new Map<string, LocalSession>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function defaultShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe";
  return process.env.SHELL || "/bin/bash";
}

/** Opens a real local pty running the user's default shell. Mirrors
 * sshManager.connect()'s contract (broadcasts on the same IPC.ssh.onData /
 * onClosed channels, keyed by a fresh sessionId) so the renderer's
 * TerminalView/TerminalPanel need no awareness that this tab isn't SSH. */
export function connect(cols: number, rows: number): string {
  const pty = loadPty();
  const sessionId = randomUUID();
  const shell = defaultShell();
  const integration = getCommandBlocksEnabled() ? prepareLocalShellIntegration(shell) : null;

  const proc = pty.spawn(shell, integration?.args ?? [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: homedir(),
    env: { ...process.env, ...integration?.env } as Record<string, string>,
  });

  proc.onData((chunk: string) => {
    broadcast(IPC.ssh.onData, { sessionId, chunk });
    sessions.get(sessionId)?.logStream?.write(chunk);
  });
  proc.onExit(({ exitCode }: { exitCode: number }) => {
    // exitCode 0 is a plain `exit`/Ctrl+D — not worth flagging as an error,
    // same spirit as an SSH channel closing normally.
    broadcast(IPC.ssh.onClosed, { sessionId, error: exitCode === 0 ? undefined : `shell exited (code ${exitCode})` });
    sessions.get(sessionId)?.logStream?.end();
    sessions.delete(sessionId);
  });

  sessions.set(sessionId, { id: sessionId, proc });
  return sessionId;
}

export function has(sessionId: string): boolean {
  return sessions.has(sessionId);
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
