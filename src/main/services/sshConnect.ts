import { readFileSync } from "node:fs";
import { Client, type ConnectConfig, type HostVerifier } from "ssh2";
import type { HostRecord } from "../../shared/types";
import { readSecret } from "./secretStore";
import { getHosts } from "./store";
import { verifyHostKeyInteractive } from "./knownHosts";

/**
 * Low-level "open an authenticated ssh2 Client for a host" logic, pulled
 * out of sshManager.ts so connectionPool.ts (the shared-connection/
 * multiplexing registry) can use it too without sshManager and
 * connectionPool importing each other in a circle — sshManager itself
 * also uses the pool for its own connect().
 */

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

export function connectClient(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client));
    client.on("error", reject);
    client.connect(config);
  });
}

export interface EstablishedClient {
  client: Client;
  jumpClient?: Client;
}

/** Opens an authenticated `Client` for `host`, chaining through its jump
 * host first if one is configured. The one place that builds a fresh
 * connection "from scratch" — connectionPool.ts wraps this with sharing,
 * sshManager's reconnect-on-drop calls it directly (a drop always needs a
 * genuinely new connection, never a pooled one). */
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
