import net from "node:net";
import { Client } from "ssh2";
import { nanoid } from "nanoid";
import { BrowserWindow } from "electron";
import { IPC, type TunnelInput, type TunnelRecord, type TunnelStatus } from "../../shared/types";
import { getHosts, getTunnels, setTunnels } from "./store";
import { buildConnectConfig } from "./sshManager";
import { getCurrentLicenseState } from "../licensing/currentLicense";
import { requireFeature } from "../licensing/featureFlags";

interface RunningTunnel {
  client: Client;
  server?: net.Server;
}

// Pro feature: local/remote SSH port forwarding. Gated by requireFeature()
// on every mutating/start call, not just in the renderer, so the guard
// holds even if the UI gate is ever bypassed.
const running = new Map<string, RunningTunnel>();

function broadcastState(tunnelId: string, status: TunnelStatus, error?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.tunnels.onState, { tunnelId, status, error });
  }
}

export function list(): TunnelRecord[] {
  return getTunnels();
}

export function create(input: TunnelInput): TunnelRecord {
  requireFeature(getCurrentLicenseState(), "portForwarding");
  const record: TunnelRecord = { id: nanoid(), ...input };
  setTunnels([...getTunnels(), record]);
  return record;
}

export function remove(tunnelId: string): void {
  stop(tunnelId);
  setTunnels(getTunnels().filter((t) => t.id !== tunnelId));
}

export async function start(tunnelId: string): Promise<void> {
  requireFeature(getCurrentLicenseState(), "portForwarding");
  if (running.has(tunnelId)) return;

  const tunnel = getTunnels().find((t) => t.id === tunnelId);
  if (!tunnel) throw new Error(`Tunnel ${tunnelId} not found`);
  if (tunnel.type === "dynamic") {
    throw new Error("Dynamic (SOCKS5) tunnels aren't implemented in this starter yet — use local or remote forwarding.");
  }

  const host = getHosts().find((h) => h.id === tunnel.hostId);
  if (!host) throw new Error(`Host ${tunnel.hostId} not found`);

  broadcastState(tunnelId, "starting");
  const client = new Client();

  try {
    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => resolve());
      client.on("error", reject);
      client.connect(buildConnectConfig(host));
    });

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
      running.set(tunnelId, { client, server });
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
      running.set(tunnelId, { client });
    }

    broadcastState(tunnelId, "running");
  } catch (err) {
    client.end();
    const message = err instanceof Error ? err.message : String(err);
    broadcastState(tunnelId, "error", message);
    throw err;
  }

  client.on("close", () => {
    running.delete(tunnelId);
    broadcastState(tunnelId, "stopped");
  });
}

export function stop(tunnelId: string): void {
  const entry = running.get(tunnelId);
  if (!entry) return;
  entry.server?.close();
  entry.client.end();
  running.delete(tunnelId);
  broadcastState(tunnelId, "stopped");
}

export function stopAll(): void {
  for (const id of [...running.keys()]) stop(id);
}

export function isRunning(tunnelId: string): boolean {
  return running.has(tunnelId);
}
