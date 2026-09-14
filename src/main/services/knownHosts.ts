import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { dialog } from "electron";

/**
 * Minimal OpenSSH known_hosts-compatible host-key verification (TOFU: trust
 * on first use), so ssh2 doesn't silently accept any server's key. Reads
 * the user's real ~/.ssh/known_hosts (both plain and HashKnownHosts-hashed
 * entries) so hosts already trusted via the regular `ssh` CLI aren't
 * re-prompted; new trust decisions made here are appended in plain form.
 *
 * Deliberately scoped down from full OpenSSH semantics: only exact-host or
 * `*`/`?` glob patterns are matched (no `!negation`, no CIDR, no
 * @cert-authority/@revoked markers) — enough to interoperate with typical
 * known_hosts files without reimplementing the whole spec.
 */

const KNOWN_HOSTS_PATH = path.join(homedir(), ".ssh", "known_hosts");

interface ParsedEntry {
  hostPatterns: string[];
  hashedHosts: { salt: Buffer; hash: Buffer }[];
  keyType: string;
  keyBlob: Buffer;
}

function hostPortLabel(hostname: string, port: number): string {
  return port === 22 ? hostname : `[${hostname}]:${port}`;
}

function parseKeyType(blob: Buffer): string {
  if (blob.length < 4) return "";
  const len = blob.readUInt32BE(0);
  return blob.subarray(4, 4 + len).toString("ascii");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function parseKnownHostsFile(): ParsedEntry[] {
  if (!existsSync(KNOWN_HOSTS_PATH)) return [];
  let text: string;
  try {
    text = readFileSync(KNOWN_HOSTS_PATH, "utf8");
  } catch {
    return [];
  }

  const entries: ParsedEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    let idx = 0;
    if (parts[idx]?.startsWith("@")) idx += 1; // skip @cert-authority / @revoked markers — not supported, entry ignored below if too short

    const hostsField = parts[idx];
    const keyType = parts[idx + 1];
    const keyB64 = parts[idx + 2];
    if (!hostsField || !keyType || !keyB64) continue;

    let keyBlob: Buffer;
    try {
      keyBlob = Buffer.from(keyB64, "base64");
    } catch {
      continue;
    }
    if (keyBlob.length === 0) continue;

    if (hostsField.startsWith("|1|")) {
      const segs = hostsField.split("|"); // ["", "1", saltB64, hashB64]
      if (segs.length < 4) continue;
      try {
        entries.push({
          hostPatterns: [],
          hashedHosts: [{ salt: Buffer.from(segs[2], "base64"), hash: Buffer.from(segs[3], "base64") }],
          keyType,
          keyBlob,
        });
      } catch {
        continue;
      }
    } else {
      entries.push({ hostPatterns: hostsField.split(","), hashedHosts: [], keyType, keyBlob });
    }
  }
  return entries;
}

function labelMatchesEntry(label: string, entry: ParsedEntry): boolean {
  if (entry.hostPatterns.some((p) => globToRegExp(p).test(label))) return true;
  return entry.hashedHosts.some(({ salt, hash }) => {
    const computed = createHmac("sha1", salt).update(label).digest();
    return computed.length === hash.length && computed.equals(hash);
  });
}

export type HostKeyStatus = "match" | "new" | "mismatch";

export function checkHostKey(hostname: string, port: number, keyBlob: Buffer): HostKeyStatus {
  const label = hostPortLabel(hostname, port);
  const keyType = parseKeyType(keyBlob);
  const entries = parseKnownHostsFile();

  let sameHostSameTypeSeen = false;
  for (const entry of entries) {
    if (entry.keyType !== keyType) continue;
    if (!labelMatchesEntry(label, entry)) continue;
    sameHostSameTypeSeen = true;
    if (entry.keyBlob.equals(keyBlob)) return "match";
  }
  return sameHostSameTypeSeen ? "mismatch" : "new";
}

export function trustHostKey(hostname: string, port: number, keyBlob: Buffer): void {
  const label = hostPortLabel(hostname, port);
  const keyType = parseKeyType(keyBlob);
  const dir = path.dirname(KNOWN_HOSTS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(KNOWN_HOSTS_PATH, `${label} ${keyType} ${keyBlob.toString("base64")}\n`, { mode: 0o600 });
}

export function fingerprintSha256(keyBlob: Buffer): string {
  const digest = createHash("sha256").update(keyBlob).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

/**
 * Full interactive verification used as an ssh2 `hostVerifier`: checks the
 * presented key against known_hosts and, for a new or changed key, blocks
 * on a native dialog asking the user to confirm before the handshake
 * proceeds — mirroring OpenSSH's own interactive TOFU prompt.
 */
export async function verifyHostKeyInteractive(hostname: string, port: number, keyBlob: Buffer): Promise<boolean> {
  try {
    const status = checkHostKey(hostname, port, keyBlob);
    if (status === "match") return true;

    const label = hostPortLabel(hostname, port);
    const fingerprint = fingerprintSha256(keyBlob);

    if (status === "mismatch") {
      const result = await dialog.showMessageBox({
        type: "warning",
        title: "WARNING: Host key has changed",
        message: `REMOTE HOST IDENTIFICATION HAS CHANGED for ${label}!`,
        detail:
          "Someone could be eavesdropping on this connection (a man-in-the-middle attack), or the host's key " +
          `was legitimately regenerated (e.g. the server was reinstalled).\n\nNew key fingerprint:\n${fingerprint}\n\n` +
          "Only continue if you know why this changed. Otherwise cancel and verify out-of-band before connecting.",
        buttons: ["Cancel", "Trust New Key & Continue"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response === 1) {
        trustHostKey(hostname, port, keyBlob);
        return true;
      }
      return false;
    }

    // status === "new"
    const result = await dialog.showMessageBox({
      type: "question",
      title: "Verify host fingerprint",
      message: `The authenticity of host '${label}' can't be established.`,
      detail: `Key fingerprint:\n${fingerprint}\n\nAre you sure you want to continue connecting?`,
      buttons: ["Cancel", "Trust & Continue"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 1) {
      trustHostKey(hostname, port, keyBlob);
      return true;
    }
    return false;
  } catch {
    // Fail closed: an unexpected error while verifying must not silently accept the connection.
    return false;
  }
}
