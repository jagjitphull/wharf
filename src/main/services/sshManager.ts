import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { BrowserWindow } from "electron";
import { IPC, type HostRecord } from "../../shared/types";
import { readSecret } from "./secretStore";
import { getHosts } from "./store";
import { getCurrentLicenseState } from "../licensing/currentLicense";
import { requireFeature } from "../licensing/featureFlags";

interface Session {
  id: string;
  hostId: string;
  client: Client;
  channel: ClientChannel;
  /** Set when connected through a jump/bastion host (Pro feature); kept alive for the session's lifetime. */
  jumpClient?: Client;
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

/**
 * Opens an interactive shell session against the given saved host and
 * starts streaming its output to all renderer windows over
 * `IPC.ssh.onData`. Resolves once the shell is ready to accept input.
 */
export async function connect(hostId: string, cols: number, rows: number): Promise<string> {
  const host = getHosts().find((h) => h.id === hostId);
  if (!host) throw new Error(`Host ${hostId} not found`);

  let jumpClient: Client | undefined;
  let sock: ConnectConfig["sock"];

  if (host.jumpHostId) {
    requireFeature(getCurrentLicenseState(), "jumpHosts");
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

  let client: Client;
  try {
    client = await connectClient({ ...buildConnectConfig(host), sock });
  } catch (err) {
    jumpClient?.end();
    throw err;
  }

  const channel = await new Promise<ClientChannel>((resolve, reject) => {
    client.shell({ term: "xterm-256color", cols, rows }, (err, stream) => {
      if (err) reject(err);
      else resolve(stream);
    });
  });

  const sessionId = randomUUID();

  channel.on("data", (data: Buffer) => {
    broadcast(IPC.ssh.onData, { sessionId, chunk: data.toString("utf8") });
  });
  channel.stderr.on("data", (data: Buffer) => {
    broadcast(IPC.ssh.onData, { sessionId, chunk: data.toString("utf8") });
  });
  channel.on("close", () => {
    broadcast(IPC.ssh.onClosed, { sessionId });
    cleanup(sessionId);
  });
  client.on("error", (err) => {
    broadcast(IPC.ssh.onClosed, { sessionId, error: err.message });
    cleanup(sessionId);
  });

  sessions.set(sessionId, { id: sessionId, hostId, client, channel, jumpClient });
  return sessionId;
}

export function write(sessionId: string, data: string): void {
  sessions.get(sessionId)?.channel.write(data);
}

export function resize(sessionId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.channel.setWindow(rows, cols, 0, 0);
}

export function disconnect(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.channel.end();
  session.client.end();
  session.jumpClient?.end();
  sessions.delete(sessionId);
}

export function disconnectSessionsForHost(hostId: string): void {
  for (const [id, session] of sessions) {
    if (session.hostId === hostId) disconnect(id);
  }
}

function cleanup(sessionId: string): void {
  const session = sessions.get(sessionId);
  session?.jumpClient?.end();
  sessions.delete(sessionId);
}

/** Returns a live client for an active session, used by the SFTP manager so file browsing reuses the same authenticated connection instead of opening a second one. */
export function getClientForSession(sessionId: string): Client | undefined {
  return sessions.get(sessionId)?.client;
}
