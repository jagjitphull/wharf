import net from "node:net";
import { randomUUID } from "node:crypto";
import type { AcceptConnection, Client, ClientChannel, TcpConnectionDetails } from "ssh2";
import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { IPC, type TunnelInput, type TunnelRecord, type TunnelStateEvent, type TunnelStatus } from "../../shared/types";
import { validateTunnelInput } from "../../shared/tunnelInput";
import { getTunnels, setTunnels } from "./store";
import { acquireClient, releaseClient } from "./connectionPool";

interface RunningTunnel {
  hostId: string;
  client: Client;
  server?: net.Server;
  /** Undoes what start() registered on the (possibly shared) SSH connection,
   * so a stopped tunnel doesn't keep reacting to it. */
  detach: () => void;
}

// Local/remote/dynamic (SOCKS5) SSH port forwarding.
const running = new Map<string, RunningTunnel>();

function socksReply(rep: number): Buffer {
  // VER, REP, RSV, ATYP(IPv4), BND.ADDR (0.0.0.0), BND.PORT (0) — the bind
  // address/port in the reply are informational only for a CONNECT-only
  // proxy like this one, so zeros are fine (every real client ignores them).
  return Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

/**
 * Minimal SOCKS5 server (RFC 1928): no-auth only, CONNECT command only —
 * exactly what `ssh -D` dynamic forwarding needs. Each accepted connection
 * gets its own outbound channel opened through `sshClient.forwardOut`
 * (i.e. relayed through the SSH server), so the tunnel's destination is
 * chosen per-connection by whatever's using the proxy (browser, curl, …)
 * rather than being fixed like local/remote forwarding.
 */
function pipeSocksConnection(socket: net.Socket, sshClient: Client): void {
  let buffer = Buffer.alloc(0);
  let awaitingRequest = false;

  function onData(chunk: Buffer): void {
    buffer = Buffer.concat([buffer, chunk]);

    if (!awaitingRequest) {
      // Greeting: VER, NMETHODS, METHODS[NMETHODS]
      if (buffer.length < 2) return;
      const nmethods = buffer[1];
      if (buffer.length < 2 + nmethods) return;
      buffer = buffer.subarray(2 + nmethods);
      socket.write(Buffer.from([0x05, 0x00])); // no authentication required
      awaitingRequest = true;
      if (buffer.length === 0) return;
    }

    // Request: VER, CMD, RSV, ATYP, DST.ADDR, DST.PORT
    if (buffer.length < 4) return;
    const atyp = buffer[3];
    let addrLen: number;
    if (atyp === 0x01) addrLen = 4;
    else if (atyp === 0x04) addrLen = 16;
    else if (atyp === 0x03) {
      if (buffer.length < 5) return;
      addrLen = 1 + buffer[4];
    } else {
      socket.end(socksReply(0x08)); // address type not supported
      socket.removeListener("data", onData);
      return;
    }
    const total = 4 + addrLen + 2;
    if (buffer.length < total) return;

    const cmd = buffer[1];
    let addr: string;
    if (atyp === 0x01) {
      addr = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
    } else if (atyp === 0x03) {
      addr = buffer.subarray(5, 5 + buffer[4]).toString("utf8");
    } else {
      const bytes = buffer.subarray(4, 20);
      const parts: string[] = [];
      for (let i = 0; i < 16; i += 2) parts.push(bytes.readUInt16BE(i).toString(16));
      addr = parts.join(":");
    }
    const port = buffer.readUInt16BE(total - 2);
    socket.removeListener("data", onData);

    if (cmd !== 0x01) {
      socket.end(socksReply(0x07)); // command not supported (only CONNECT)
      return;
    }

    sshClient.forwardOut("127.0.0.1", 0, addr, port, (err, stream) => {
      if (err) {
        socket.end(socksReply(0x05)); // connection refused
        return;
      }
      socket.write(socksReply(0x00)); // succeeded
      socket.pipe(stream).pipe(socket);
      stream.on("error", () => socket.destroy());
      socket.on("error", () => stream.end());
    });
  }

  socket.on("data", onData);
  socket.on("error", () => {
    /* let the outer server's "close"/"error" plumbing handle teardown */
  });
}

/** The last state broadcast for each tunnel, so a window that wasn't listening
 * at the time (the tunnels panel opened later, or a tunnel started
 * automatically at launch) can still ask what's going on. */
const lastState = new Map<string, TunnelStateEvent>();

function broadcastState(tunnelId: string, status: TunnelStatus, error?: string): void {
  lastState.set(tunnelId, { tunnelId, status, error });
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.tunnels.onState, { tunnelId, status, error });
  }
}

/**
 * Automatic reconnection. A tunnel the user started that loses its SSH
 * connection (network change, laptop sleep, server restart) keeps trying to
 * come back, with a growing pause between attempts, until the user stops it.
 * It gives up early only for failures that retrying won't fix and could do
 * harm: repeated bad logins can lock an account, and a changed host key is
 * something to look at, not to retry past.
 */
export const reconnectPolicy = { baseMs: 2_000, maxMs: 60_000 };

interface Retry {
  timer?: NodeJS.Timeout;
}
const retries = new Map<string, Retry>();

function reconnectDelay(attempt: number): number {
  return Math.min(reconnectPolicy.baseMs * 2 ** attempt, reconnectPolicy.maxMs);
}

function isPermanentFailure(message: string): boolean {
  return /authentication|permission denied|host key|not found|passwords are locked/i.test(message);
}

function cancelRetry(tunnelId: string): boolean {
  const retry = retries.get(tunnelId);
  if (!retry) return false;
  if (retry.timer) clearTimeout(retry.timer);
  retries.delete(tunnelId);
  return true;
}

function scheduleReconnect(tunnelId: string, attempt: number, retry: Retry, reason: string): void {
  const delay = reconnectDelay(attempt);
  broadcastState(tunnelId, "reconnecting", `${reason} Retrying in ${Math.round(delay / 1000)}s.`);
  retry.timer = setTimeout(() => {
    retry.timer = undefined;
    void connect(tunnelId).then(
      () => {
        // Stopped while the attempt was in flight: it just registered a running tunnel nobody wants.
        if (retries.get(tunnelId) !== retry) stop(tunnelId);
        else retries.delete(tunnelId);
      },
      (err: unknown) => {
        if (retries.get(tunnelId) !== retry) return;
        const message = err instanceof Error ? err.message : String(err);
        if (isPermanentFailure(message)) {
          retries.delete(tunnelId);
          log.warn(`Tunnel ${tunnelId} stopped reconnecting: ${message}`);
          return; // connect() already reported the error state
        }
        scheduleReconnect(tunnelId, attempt + 1, retry, `Couldn't reconnect: ${message}.`);
      },
    );
  }, delay);
}

export function list(): TunnelRecord[] {
  return getTunnels();
}

export function create(input: TunnelInput): TunnelRecord {
  const problem = validateTunnelInput(input);
  if (problem) throw new Error(problem);
  const record: TunnelRecord = { id: randomUUID(), ...input };
  setTunnels([...getTunnels(), record]);
  return record;
}

export function remove(tunnelId: string): void {
  stop(tunnelId);
  lastState.delete(tunnelId);
  setTunnels(getTunnels().filter((t) => t.id !== tunnelId));
}

export function setAutoStart(tunnelId: string, enabled: boolean): void {
  const all = getTunnels();
  if (!all.some((t) => t.id === tunnelId)) throw new Error(`Tunnel ${tunnelId} not found`);
  setTunnels(all.map((t) => (t.id === tunnelId ? { ...t, autoStart: enabled } : t)));
}

export function statuses(): TunnelStateEvent[] {
  return [...lastState.values()];
}

/**
 * Starts every tunnel marked "start when Wharf launches". One failing
 * (host down, port already taken, host key rejected) never keeps the others
 * from starting — each failure is logged and shows up as that tunnel's
 * error state in the panel. Resolves once every attempt has finished.
 */
export async function startAutoStartTunnels(): Promise<void> {
  const wanted = getTunnels().filter((t) => t.autoStart);
  const results = await Promise.allSettled(wanted.map((t) => start(t.id)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      log.warn(`Tunnel "${wanted[i].name}" didn't start automatically: ${reason}`);
    }
  });
}

export async function start(tunnelId: string): Promise<void> {
  cancelRetry(tunnelId); // starting by hand replaces any pending automatic retry
  await connect(tunnelId);
}

async function connect(tunnelId: string): Promise<void> {
  if (running.has(tunnelId)) return;

  const tunnel = getTunnels().find((t) => t.id === tunnelId);
  if (!tunnel) throw new Error(`Tunnel ${tunnelId} not found`);

  broadcastState(tunnelId, "starting");
  // Set once acquireClient() resolves, so the catch below (which also
  // covers acquireClient() itself throwing — e.g. an unreachable jump
  // host, or the host no longer existing) knows whether it actually holds
  // a pool reference that needs releasing, without risking a second,
  // unrelated crash that would mask the real error.
  let acquired = false;

  try {
    // Real SSH multiplexing, same as shell sessions and SFTP: reuses an
    // already-open connection to this host rather than dialing a fresh one.
    const { client } = await acquireClient(tunnel.hostId);
    acquired = true;

    let server: net.Server | undefined;
    let detachRemote: (() => void) | undefined;

    if (tunnel.type === "local") {
      server = net.createServer((socket) => {
        client.forwardOut(tunnel.srcHost, tunnel.srcPort, tunnel.dstHost ?? "127.0.0.1", tunnel.dstPort ?? 0, (err, stream) => {
          if (err) {
            socket.destroy();
            return;
          }
          socket.pipe(stream).pipe(socket);
          stream.on("error", () => socket.destroy());
          socket.on("error", () => stream.end());
        });
      });
    } else if (tunnel.type === "dynamic") {
      server = net.createServer((socket) => pipeSocksConnection(socket, client));
    }

    if (server) {
      const listening = server;
      await new Promise<void>((resolve, reject) => {
        listening.on("error", reject);
        listening.listen(tunnel.srcPort, tunnel.srcHost, () => resolve());
      });
    } else {
      // remote: ask the SSH server to listen on srcHost:srcPort and forward
      // incoming connections back to us, which we relay to dstHost:dstPort.
      const boundPort = await new Promise<number>((resolve, reject) => {
        client.forwardIn(tunnel.srcHost, tunnel.srcPort, (err, port) => (err ? reject(err) : resolve(port || tunnel.srcPort)));
      });
      const onTcpConnection = (info: TcpConnectionDetails, accept: AcceptConnection<ClientChannel>) => {
        // This connection may be shared with other remote tunnels, and every
        // one of them hears about every forwarded connection — only handle
        // the ones that arrived on this tunnel's own port (accepting the same
        // channel twice would break both).
        if (info.destPort !== boundPort) return;
        const stream = accept();
        const socket = net.connect(tunnel.dstPort ?? 0, tunnel.dstHost ?? "127.0.0.1", () => {
          socket.pipe(stream).pipe(socket);
        });
        socket.on("error", () => stream.end());
        stream.on("error", () => socket.destroy());
      };
      client.on("tcp connection", onTcpConnection);
      detachRemote = () => {
        client.removeListener("tcp connection", onTcpConnection);
        try {
          client.unforwardIn(tunnel.srcHost, boundPort, () => {});
        } catch {
          // the connection is already gone; its remote listener went with it
        }
      };
    }

    // Fires once the connection is actually torn down — which, since it's
    // shared, only happens once every session/SFTP-browse/other tunnel
    // using it has also let go. Until then this tunnel just keeps running
    // on the still-live shared connection, same as everyone else on it.
    const onClose = () => {
      const entry = running.get(tunnelId);
      // Already stopped, or since restarted on a newer connection: not ours to tear down.
      if (!entry || entry.client !== client) return;
      // Without this the local port stays bound after the drop and starting
      // the tunnel again fails with EADDRINUSE.
      entry.server?.close();
      running.delete(tunnelId);
      cancelRetry(tunnelId);
      const retry: Retry = {};
      retries.set(tunnelId, retry);
      scheduleReconnect(tunnelId, 0, retry, "Connection lost.");
    };
    client.on("close", onClose);

    running.set(tunnelId, {
      hostId: tunnel.hostId,
      client,
      server,
      detach: () => {
        client.removeListener("close", onClose);
        detachRemote?.();
      },
    });
    broadcastState(tunnelId, "running");
  } catch (err) {
    if (acquired) releaseClient(tunnel.hostId);
    const message = err instanceof Error ? err.message : String(err);
    broadcastState(tunnelId, "error", message);
    throw err;
  }
}

export function stop(tunnelId: string): void {
  const wasRetrying = cancelRetry(tunnelId);
  const entry = running.get(tunnelId);
  if (!entry) {
    if (wasRetrying) broadcastState(tunnelId, "stopped");
    return;
  }
  entry.server?.close();
  entry.detach();
  running.delete(tunnelId);
  // Releases our reference; the underlying connection itself is only
  // actually closed once every other sharer (a terminal session, an SFTP
  // browse, another tunnel to the same host) has released theirs too.
  releaseClient(entry.hostId);
  broadcastState(tunnelId, "stopped");
}

export function stopAll(): void {
  for (const id of new Set([...running.keys(), ...retries.keys()])) stop(id);
}

export function isReconnecting(tunnelId: string): boolean {
  return retries.has(tunnelId);
}

export function isRunning(tunnelId: string): boolean {
  return running.has(tunnelId);
}
