import type { Client } from "ssh2";
import { acquireClient, releaseClient } from "./connectionPool";
import { installKeyCommand, type InstallKeyResult } from "../../shared/sshKeys";

function run(client: Client, command: string): Promise<{ out: string; err: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let out = "";
      let err = "";
      stream.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      stream.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
      stream.on("close", (code: number | null) => resolve({ out, err, code }));
      stream.on("error", reject);
    });
  });
}

/**
 * Adds `publicKey` to the saved host's ~/.ssh/authorized_keys (once), over the same
 * connection pool terminals and tunnels use — so it asks for the host key and the host's
 * credentials exactly as connecting would.
 */
export async function installPublicKey(hostId: string, publicKey: string): Promise<InstallKeyResult> {
  const command = installKeyCommand(publicKey); // throws for anything that isn't a plain key line
  const { client } = await acquireClient(hostId);
  try {
    const { out, err, code } = await run(client, command);
    if (code !== 0 && !/^(added|present)$/m.test(out)) {
      throw new Error(err.trim() || `The host refused (exit code ${code}).`);
    }
    return { added: /^added$/m.test(out) };
  } finally {
    releaseClient(hostId);
  }
}
