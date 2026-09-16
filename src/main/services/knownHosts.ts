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
 * Deliberately scoped down from full OpenSSH semantics: exact-host or
 * `*`/`?` glob patterns (including `!negation`) and the `@revoked` marker
 * are handled, but not CIDR ranges or `@cert-authority` (CA-signed host
 * certificates) — enough to interoperate with typical known_hosts files
 * without reimplementing the whole spec.
 */

const KNOWN_HOSTS_PATH = path.join(homedir(), ".ssh", "known_hosts");

interface ParsedEntry {
  /** Raw comma-split patterns, `!`-prefix (negation) intact — see labelMatchesEntry. */
  hostPatterns: string[];
  hashedHosts: { salt: Buffer; hash: Buffer }[];
  keyType: string;
  keyBlob: Buffer;
  /** True for a line marked `@revoked` — this key must never be trusted for this host, full stop. */
  revoked: boolean;
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
    let revoked = false;
    if (parts[idx]?.startsWith("@")) {
      // @revoked is handled below; @cert-authority (CA-signed host certs) is
      // a different trust model entirely and stays unsupported — an entry
      // marked with it is skipped rather than mismatched into.
      if (parts[idx] !== "@revoked") continue;
      revoked = true;
      idx += 1;
    }

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
          revoked,
        });
      } catch {
        continue;
      }
    } else {
      entries.push({ hostPatterns: hostsField.split(","), hashedHosts: [], keyType, keyBlob, revoked });
    }
  }
  return entries;
}

/** Matches a comma-split OpenSSH pattern list against a host label, honoring
 * `!pattern` negation: if any negated pattern matches, the whole list is
 * rejected for this host — even if a non-negated pattern on the same line
 * also matched — same as `ssh`/`sshd` itself. */
function patternListMatches(label: string, patterns: string[]): boolean {
  let matched = false;
  for (const raw of patterns) {
    const negated = raw.startsWith("!");
    const pattern = negated ? raw.slice(1) : raw;
    if (!pattern || !globToRegExp(pattern).test(label)) continue;
    if (negated) return false;
    matched = true;
  }
  return matched;
}

function labelMatchesEntry(label: string, entry: ParsedEntry): boolean {
  if (patternListMatches(label, entry.hostPatterns)) return true;
  return entry.hashedHosts.some(({ salt, hash }) => {
    const computed = createHmac("sha1", salt).update(label).digest();
    return computed.length === hash.length && computed.equals(hash);
  });
}

export type HostKeyStatus = "match" | "new" | "mismatch" | "revoked";

export function checkHostKey(hostname: string, port: number, keyBlob: Buffer): HostKeyStatus {
  const label = hostPortLabel(hostname, port);
  const keyType = parseKeyType(keyBlob);
  const entries = parseKnownHostsFile();

  let sameHostSameTypeSeen = false;
  for (const entry of entries) {
    if (entry.keyType !== keyType) continue;
    if (!labelMatchesEntry(label, entry)) continue;
    if (entry.keyBlob.equals(keyBlob)) {
      // A key can be trusted by one line and separately revoked by another
      // (e.g. after `ssh-keygen -R` + re-adding, or a manually maintained
      // revocation line) — revoked always wins, checked across every
      // matching entry before falling back to an ordinary match.
      if (entry.revoked) return "revoked";
    }
    sameHostSameTypeSeen = true;
  }
  for (const entry of entries) {
    if (entry.keyType !== keyType || entry.revoked) continue;
    if (!labelMatchesEntry(label, entry)) continue;
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

    if (status === "revoked") {
      // No "trust anyway" option, deliberately — a key explicitly marked
      // @revoked in known_hosts must never be accepted here, matching
      // OpenSSH's own refusal (RevokedHostKeys) rather than offering an
      // override that would defeat the point of revoking it.
      await dialog.showMessageBox({
        type: "error",
        title: "REVOKED HOST KEY",
        message: `The key offered by ${label} is marked as REVOKED in known_hosts.`,
        detail:
          `Fingerprint:\n${fingerprint}\n\n` +
          "This key was explicitly revoked and must not be trusted, even though it matches this host. " +
          "Refusing to connect. If you believe this is wrong, check the @revoked line for this host in " +
          "~/.ssh/known_hosts and remove it only if you're certain the revocation no longer applies.",
        buttons: ["OK"],
        defaultId: 0,
        noLink: true,
      });
      return false;
    }

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
