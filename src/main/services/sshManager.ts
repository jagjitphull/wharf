import { createWriteStream, readFileSync, type WriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client, type ClientChannel, type ConnectConfig, type HostVerifier } from "ssh2";
import { BrowserWindow } from "electron";
import { IPC, type HostRecord } from "../../shared/types";
import { readSecret } from "./secretStore";
import { getHosts } from "./store";
import { verifyHostKeyInteractive } from "./knownHosts";

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

/** Exported for reuse by the SFTP manager, which opens its own direct connections rather than piggybacking on shell sessions. */
export function buildConnectConfig(host: HostRecord): ConnectConfig {
  const base: ConnectConfig = {
    host: host.hostname,
    port: host.port,
    username: host.username,
    readyTimeout: 20_000,
    keepaliveInterval: 15_000,
    // Verify against ~/.ssh/known_hosts (TOFU) instead of ssh2's default of
    // silently accepting any server key.
    hostVerifier: ((keyBlob: Buffer, verify: (valid: boolean) => void) => {
      void verifyHostKeyInteractive(host.hostname, host.port, keyBlob).then(verify);
    }) satisfies HostVerifier,
  };

  switch (host.authMethod) {
    case "password":
      return { ...base, password: readSecret(host.secretId) ?? "" };
    case "privateKey": {
      if (!host.privateKeyPath) {
        throw new Error(`Host "${host.name}" is set to use a private key but no key file is configured.`);
      }
      const privateKey = readFileSync(host.privateKeyPath);
      const passphrase = readSecret(host.secretId) ?? undefined;
      return { ...base, privateKey, passphrase };
    }
    case "agent":
      return { ...base, agent: process.env.SSH_AUTH_SOCK };
    default:
      throw new Error(`Unsupported auth method: ${host.authMethod satisfies never}`);
  }
}

function connectClient(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client));
    client.on("error", reject);
    client.connect(config);
  });
}

interface EstablishedClient {
  client: Client;
  jumpClient?: Client;
}

/** Opens an authenticated `Client` for `host`, chaining through its jump
 * host first if one is configured. Shared by shell sessions, reconnect
 * attempts, and the SFTP manager, so every caller that needs a live
 * connection to a host goes through the same chain-building logic. */
export async function connectHostClient(host: HostRecord): Promise<EstablishedClient> {
  let jumpClient: Client | undefined;
  let sock: ConnectConfig["sock"];

  if (host.jumpHostId) {
    const jumpHost = getHosts().find((h) => h.id === host.jumpHostId);
    if (!jumpHost) throw new Error(`Jump host ${host.jumpHostId} not found`);

    jumpClient = await connectClient(buildConnectConfig(jumpHost));
    sock = await new Promise((resolve, reject) => {
      jumpClient!.forwardOut("127.0.0.1", 0, host.hostname, host.port, (err, stream) => {
        if (err) reject(err);
        else resolve(stream as unknown as ConnectConfig["sock"]);
      });
    });
  }

  try {
    const client = await connectClient({ ...buildConnectConfig(host), sock });
    return { client, jumpClient };
  } catch (err) {
    jumpClient?.end();
    throw err;
  }
}

interface EstablishedConnection {
  client: Client;
  channel: ClientChannel;
  jumpClient?: Client;
}

/** Opens a fresh authenticated shell channel against `host` (through its
 * jump host, if any). Shared by the initial connect() and by reconnect
 * attempts, so both go through the exact same chain-building logic. */
async function establishConnection(host: HostRecord, cols: number, rows: number): Promise<EstablishedConnection> {
  const { client, jumpClient } = await connectHostClient(host);

  let channel: ClientChannel;
  try {
    channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell({ term: "xterm-256color", cols, rows }, (err, stream) => {
        if (err) reject(err);
        else resolve(stream);
      });
    });
  } catch (err) {
    client.end();
    jumpClient?.end();
    throw err;
  }

  return { client, channel, jumpClient };
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

  // The old client/channel are already dead (that's why we're here) — end
  // them defensively so a still-limping jump-host connection doesn't leak.
  try {
    stillTracked.client.end();
  } catch {
    /* already dead */
  }
  try {
    stillTracked.jumpClient?.end();
  } catch {
    /* already dead */
  }

  try {
    const { client, channel, jumpClient } = await establishConnection(host, stillTracked.cols, stillTracked.rows);
    // The user may have disconnected while this attempt was in flight —
    // don't resurrect a session nobody wants anymore.
    if (!sessions.has(sessionId)) {
      channel.end();
      client.end();
      jumpClient?.end();
      return;
    }
    stillTracked.client = client;
    stillTracked.channel = channel;
    stillTracked.jumpClient = jumpClient;
    stillTracked.reconnecting = false;
    wireChannel(sessionId, channel, client);
    broadcast(IPC.ssh.onReconnected, { sessionId });
  } catch (err) {
    void attemptReconnect(sessionId, attemptIndex + 1, err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Opens an interactive shell session against the given saved host and
 * starts streaming its output to all renderer windows over
 * `IPC.ssh.onData`. Resolves once the shell is ready to accept input.
 */
export async function connect(hostId: string, cols: number, rows: number): Promise<string> {
  const host = getHosts().find((h) => h.id === hostId);
  if (!host) throw new Error(`Host ${hostId} not found`);

  const { client, channel, jumpClient } = await establishConnection(host, cols, rows);
  const sessionId = randomUUID();
  wireChannel(sessionId, channel, client);
  sessions.set(sessionId, { id: sessionId, hostId, client, channel, jumpClient, cols, rows, reconnecting: false });
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
  // Delete first: the .end() calls below asynchronously trigger the same
  // "close"/"error" events reconnect-on-drop listens for, which must see
  // this session already gone rather than try to resurrect it.
  sessions.delete(sessionId);
  session.channel.end();
  session.client.end();
  session.jumpClient?.end();
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
