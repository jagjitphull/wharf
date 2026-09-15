import net from "node:net";
import { randomUUID } from "node:crypto";
import { Client } from "ssh2";
import { BrowserWindow } from "electron";
import { IPC, type TunnelInput, type TunnelRecord, type TunnelStatus } from "../../shared/types";
import { getHosts, getTunnels, setTunnels } from "./store";
import { connectHostClient } from "./sshManager";

interface RunningTunnel {
  client: Client;
  /** Kept alive alongside `client` for the tunnel's lifetime when its host connects through a jump host. */
  jumpClient?: Client;
  server?: net.Server;
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

function broadcastState(tunnelId: string, status: TunnelStatus, error?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.tunnels.onState, { tunnelId, status, error });
  }
}

export function list(): TunnelRecord[] {
  return getTunnels();
}

export function create(input: TunnelInput): TunnelRecord {
  const record: TunnelRecord = { id: randomUUID(), ...input };
  setTunnels([...getTunnels(), record]);
  return record;
}

export function remove(tunnelId: string): void {
  stop(tunnelId);
  setTunnels(getTunnels().filter((t) => t.id !== tunnelId));
}

export async function start(tunnelId: string): Promise<void> {
  if (running.has(tunnelId)) return;

  const tunnel = getTunnels().find((t) => t.id === tunnelId);
  if (!tunnel) throw new Error(`Tunnel ${tunnelId} not found`);

  const host = getHosts().find((h) => h.id === tunnel.hostId);
  if (!host) throw new Error(`Host ${tunnel.hostId} not found`);

  broadcastState(tunnelId, "starting");
  // Filled in once connectHostClient() resolves, so the catch below (which
  // also covers connectHostClient() itself throwing — e.g. an unreachable
  // jump host) has something safe to .end() without risking a second,
  // unrelated crash that would mask the real error.
  const connected: { client?: Client; jumpClient?: Client } = {};

  try {
    const { client, jumpClient } = await connectHostClient(host);
    connected.client = client;
    connected.jumpClient = jumpClient;

    if (tunnel.type === "local") {
      const server = net.createServer((socket) => {
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
      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(tunnel.srcPort, tunnel.srcHost, () => resolve());
      });
      running.set(tunnelId, { client, jumpClient, server });
    } else if (tunnel.type === "dynamic") {
      const server = net.createServer((socket) => pipeSocksConnection(socket, client));
      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(tunnel.srcPort, tunnel.srcHost, () => resolve());
      });
      running.set(tunnelId, { client, jumpClient, server });
    } else {
      // remote: ask the SSH server to listen on srcHost:srcPort and forward
      // incoming connections back to us, which we relay to dstHost:dstPort.
      await new Promise<void>((resolve, reject) => {
        client.forwardIn(tunnel.srcHost, tunnel.srcPort, (err) => (err ? reject(err) : resolve()));
      });
      client.on("tcp connection", (_info, accept) => {
        const stream = accept();
        const socket = net.connect(tunnel.dstPort ?? 0, tunnel.dstHost ?? "127.0.0.1", () => {
          socket.pipe(stream).pipe(socket);
        });
        socket.on("error", () => stream.end());
        stream.on("error", () => socket.destroy());
      });
      running.set(tunnelId, { client, jumpClient });
    }

    broadcastState(tunnelId, "running");

    client.on("close", () => {
      jumpClient?.end();
      running.delete(tunnelId);
      broadcastState(tunnelId, "stopped");
    });
  } catch (err) {
    connected.client?.end();
    connected.jumpClient?.end();
    const message = err instanceof Error ? err.message : String(err);
    broadcastState(tunnelId, "error", message);
    throw err;
  }
}

export function stop(tunnelId: string): void {
  const entry = running.get(tunnelId);
  if (!entry) return;
  entry.server?.close();
  entry.client.end();
  entry.jumpClient?.end();
  running.delete(tunnelId);
  broadcastState(tunnelId, "stopped");
}

export function stopAll(): void {
  for (const id of [...running.keys()]) stop(id);
}

export function isRunning(tunnelId: string): boolean {
  return running.has(tunnelId);
}
