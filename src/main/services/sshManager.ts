import { createWriteStream, type WriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client, type ClientChannel } from "ssh2";
import { BrowserWindow } from "electron";
import { IPC } from "../../shared/types";
import { getCommandBlocksEnabled, getHosts } from "./store";
import { acquireClient, isPooledClient, releaseClient } from "./connectionPool";
import { buildRemoteBootstrapCommand } from "./shellIntegration";

export { buildConnectConfig, connectHostClient } from "./sshConnect";

interface Session {
  id: string;
  hostId: string;
  client: Client;
  channel: ClientChannel;
  /** Set when connected through a jump/bastion host; kept alive for the session's lifetime. */
  jumpClient?: Client;
  /** Open when this session's raw output is being logged to disk (see startLogging/stopLogging). */
  logStream?: WriteStream;
  /** Last known terminal size, so a reconnect can restore it without asking the renderer. */
  cols: number;
  rows: number;
  /** True while a reconnect attempt chain is in flight — guards against a
   * duplicate chain when both the channel and the client report the same
   * underlying failure. */
  reconnecting: boolean;
}

const sessions = new Map<string, Session>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/** Opens a shell channel on an already-authenticated client. Shared by the
 * initial connect() and by reconnect attempts, so both go through the exact
 * same channel-opening logic. */
function openShell(client: Client, cols: number, rows: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.shell({ term: "xterm-256color", cols, rows }, (err, stream) => {
      if (err) reject(err);
      else resolve(stream);
    });
  });
}

/** Releases a session's reference to its client the right way for how it
 * was obtained: a shared connectionPool slot (releaseClient — torn down
 * only once every other sharer has released too) or a private connection
 * that was never registered with the pool (ended directly). Used by both
 * disconnect() and reconnect-on-drop's cleanup, so a session's client is
 * never leaked and a still-shared pooled connection is never yanked out
 * from under sessions still using it. */
function releasePossiblyPooledClient(hostId: string, client: Client, jumpClient?: Client): void {
  if (isPooledClient(hostId, client)) {
    releaseClient(hostId);
  } else {
    try {
      client.end();
    } catch {
      /* already dead */
    }
    try {
      jumpClient?.end();
    } catch {
      /* already dead */
    }
  }
}

// Backoff schedule for reconnect-on-drop: 2s, 4s, 8s, 16s, 30s, then give up.
const RECONNECT_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wires a (re)established channel/client's data/close/error events to the
 * given session id — the raw-output tee to any active log stream, and
 * reconnect-on-drop handling for an unexpected close. */
function wireChannel(sessionId: string, channel: ClientChannel, client: Client): void {
  function emitData(data: Buffer) {
    broadcast(IPC.ssh.onData, { sessionId, chunk: data.toString("utf8") });
    // Raw bytes, ANSI codes included — same as what `script`/`asciinema`
    // record, and what the user actually sees in the terminal.
    sessions.get(sessionId)?.logStream?.write(data);
  }
  channel.on("data", emitData);
  channel.stderr.on("data", emitData);
  channel.on("close", () => handleUnexpectedClose(sessionId));
  client.on("error", (err) => handleUnexpectedClose(sessionId, err));
}

/** Entry point for both the channel's "close" and the client's "error" —
 * either can fire for the same underlying network blip, so this is guarded
 * by `session.reconnecting` to only start one attempt chain per failure. */
function handleUnexpectedClose(sessionId: string, err?: Error): void {
  const session = sessions.get(sessionId);
  if (!session || session.reconnecting) return;
  session.reconnecting = true;
  void attemptReconnect(sessionId, 0, err);
}

async function attemptReconnect(sessionId: string, attemptIndex: number, lastErr?: Error): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return; // explicitly disconnected already

  if (attemptIndex >= RECONNECT_DELAYS_MS.length) {
    const suffix = lastErr ? `: ${lastErr.message}` : "";
    broadcast(IPC.ssh.onClosed, {
      sessionId,
      error: `Connection lost${suffix} — gave up after ${RECONNECT_DELAYS_MS.length} reconnect attempts`,
    });
    session.logStream?.end();
    sessions.delete(sessionId);
    return;
  }

  const delay = RECONNECT_DELAYS_MS[attemptIndex];
  broadcast(IPC.ssh.onReconnecting, {
    sessionId,
    attempt: attemptIndex + 1,
    maxAttempts: RECONNECT_DELAYS_MS.length,
    delayMs: delay,
  });
  await sleep(delay);

  const stillTracked = sessions.get(sessionId);
  if (!stillTracked) return; // disconnected while we were waiting

  const host = getHosts().find((h) => h.id === stillTracked.hostId);
  if (!host) {
    broadcast(IPC.ssh.onClosed, { sessionId, error: "Host no longer exists" });
    stillTracked.logStream?.end();
    sessions.delete(sessionId);
    return;
  }

  // The old client/channel are already dead (that's why we're here) —
  // release our reference the right way (a shared pool slot vs. a private
  // post-reconnect connection) so nothing leaks.
  releasePossiblyPooledClient(stillTracked.hostId, stillTracked.client, stillTracked.jumpClient);

  try {
    // Reconnect through the shared pool, same as a fresh connect() — so
    // sessions/SFTP-browses/tunnels that were multiplexed onto the same
    // connection before it dropped can end up sharing a connection again
    // after reconnecting too, rather than each always paying for a private
    // one. (Best-effort: if two sessions' reconnect attempts race, the
    // second may not see the first's still-in-flight dial and end up with
    // its own connection anyway — the same inherent limitation as two
    // concurrent first-time connects to a host, not something reconnect
    // makes worse.)
    const { client, jumpClient } = await acquireClient(stillTracked.hostId);

    let channel: ClientChannel;
    try {
      channel = await openShell(client, stillTracked.cols, stillTracked.rows);
    } catch (err) {
      releaseClient(stillTracked.hostId);
      throw err;
    }

    // The user may have disconnected while this attempt was in flight —
    // don't resurrect a session nobody wants anymore.
    if (!sessions.has(sessionId)) {
      channel.end();
      releaseClient(stillTracked.hostId);
      return;
    }
    stillTracked.client = client;
    stillTracked.channel = channel;
    stillTracked.jumpClient = jumpClient;
    stillTracked.reconnecting = false;
    wireChannel(sessionId, channel, client);
    broadcast(IPC.ssh.onReconnected, { sessionId });

    if (getCommandBlocksEnabled()) {
      setTimeout(() => {
        if (sessions.has(sessionId)) channel.write(buildRemoteBootstrapCommand() + "\r");
      }, 1000);
    }
  } catch (err) {
    void attemptReconnect(sessionId, attemptIndex + 1, err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Opens an interactive shell session against the given saved host and
 * starts streaming its output to all renderer windows over
 * `IPC.ssh.onData`. Resolves once the shell is ready to accept input.
 *
 * Reuses an already-open connection to this host if one exists (via
 * connectionPool — real SSH multiplexing: a second/third tab to a host
 * you're already connected to just opens a new channel, no fresh
 * handshake) rather than always dialing a brand new one.
 */
export async function connect(hostId: string, cols: number, rows: number): Promise<string> {
  const host = getHosts().find((h) => h.id === hostId);
  if (!host) throw new Error(`Host ${hostId} not found`);

  const { client, jumpClient } = await acquireClient(hostId);

  let channel: ClientChannel;
  try {
    channel = await openShell(client, cols, rows);
  } catch (err) {
    releaseClient(hostId);
    throw err;
  }

  const sessionId = randomUUID();
  wireChannel(sessionId, channel, client);
  sessions.set(sessionId, { id: sessionId, hostId, client, channel, jumpClient, cols, rows, reconnecting: false });

  if (getCommandBlocksEnabled()) {
    // Sent as one real line of input, same as the user typing it — there's
    // no clean signal from here that the remote shell's first prompt has
    // actually appeared (MOTD etc. may still be flushing), so this is a
    // fixed best-effort delay long enough for that to typically have
    // happened. A bash/zsh remote shell picks it up; anything else no-ops
    // harmlessly. Each channel gets its own fresh interactive shell on the
    // remote (even ones sharing a pooled connection), so every session
    // needs this, not just the first to a host.
    setTimeout(() => {
      if (sessions.has(sessionId)) channel.write(buildRemoteBootstrapCommand() + "\r");
    }, 1000);
  }

  return sessionId;
}

export function write(sessionId: string, data: string): void {
  sessions.get(sessionId)?.channel.write(data);
}

export function resize(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.cols = cols;
  session.rows = rows;
  session.channel.setWindow(rows, cols, 0, 0);
}

export function disconnect(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  // Delete first: the .end()/releaseClient() calls below can asynchronously
  // trigger the same "close"/"error" events reconnect-on-drop listens for,
  // which must see this session already gone rather than try to resurrect it.
  sessions.delete(sessionId);
  session.channel.end();
  releasePossiblyPooledClient(session.hostId, session.client, session.jumpClient);
  session.logStream?.end();
}

export function disconnectSessionsForHost(hostId: string): void {
  for (const [id, session] of sessions) {
    if (session.hostId === hostId) disconnect(id);
  }
}

/** Returns a live client for an active session, used by the SFTP manager so file browsing reuses the same authenticated connection instead of opening a second one. */
export function getClientForSession(sessionId: string): Client | undefined {
  return sessions.get(sessionId)?.client;
}

/** Host name for a session, used to build a sensible default log file name. */
export function getHostNameForSession(sessionId: string): string | undefined {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  return getHosts().find((h) => h.id === session.hostId)?.name;
}

/** Starts teeing this session's raw output to `filePath` (truncating any
 * existing file at that path) from this point on — logging never replays
 * already-emitted scrollback. Replaces any log already in progress. */
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

export function isLogging(sessionId: string): boolean {
  return !!sessions.get(sessionId)?.logStream;
}
