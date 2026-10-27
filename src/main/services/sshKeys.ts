import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import ssh2 from "ssh2";
import { validateGenerateRequest, validateKeyName, type GenerateKeyRequest, type SshKeyInfo } from "../../shared/sshKeys";

const { utils } = ssh2;

/** How many times to make a key pair that fails to read back before giving up. */
const KEYGEN_ATTEMPTS = 8;
/** Anything bigger than this in ~/.ssh isn't a key. */
const MAX_KEY_FILE_BYTES = 64 * 1024;
/** Files in ~/.ssh that are never private keys, whatever they contain. */
const NOT_KEYS = /^(config|authorized_keys2?|environment|known_hosts.*|.*\.pub|.*\.tmp|.*~|\..*)$/;

/** `ssh-keygen -l`'s fingerprint of a public key blob: SHA256, base64 without padding. */
export function fingerprintOf(publicBlob: Buffer): string {
  return "SHA256:" + createHash("sha256").update(publicBlob).digest("base64").replace(/=+$/, "");
}

interface ParsedPublic {
  type: string;
  bits: number | null;
  fingerprint: string;
  comment: string | null;
  line: string;
}

function bitsOf(type: string, blob: Buffer): number | null {
  if (type === "ssh-ed25519") return 256;
  if (type.startsWith("ecdsa-sha2-nistp")) return Number(type.slice("ecdsa-sha2-nistp".length));
  if (type === "ssh-rsa") {
    // blob: string "ssh-rsa", mpint e, mpint n — the modulus length is the size
    try {
      let off = 4 + blob.readUInt32BE(0);
      off += 4 + blob.readUInt32BE(off);
      const nLen = blob.readUInt32BE(off);
      const lead = blob[off + 4] === 0 ? 1 : 0;
      return (nLen - lead) * 8;
    } catch {
      return null;
    }
  }
  return null;
}

function parsePublic(parsed: { type: string; comment: string; getPublicSSH(): Buffer }): ParsedPublic {
  const blob = parsed.getPublicSSH();
  const comment = parsed.comment || null;
  return {
    type: parsed.type,
    bits: bitsOf(parsed.type, blob),
    fingerprint: fingerprintOf(blob),
    comment,
    line: `${parsed.type} ${blob.toString("base64")}${comment ? ` ${comment}` : ""}`,
  };
}

function readPublicFile(file: string): ParsedPublic | null {
  try {
    const parsed = utils.parseKey(readFileSync(file, "utf8").trim());
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    return key instanceof Error ? null : parsePublic(key);
  } catch {
    return null;
  }
}

/** Looks at one file in the key folder; null when it isn't a private key. */
function inspect(dir: string, name: string): { info: SshKeyInfo; publicLine: string | null } | null {
  const file = path.join(dir, name);
  let st;
  try {
    st = statSync(file);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size === 0 || st.size > MAX_KEY_FILE_BYTES) return null;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  if (!/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/m.test(text)) return null;

  const pubFile = file + ".pub";
  const hasPublicFile = existsSync(pubFile);
  let publicInfo: ParsedPublic | null = null;
  let encrypted = false;

  const parsed = utils.parseKey(text);
  if (parsed instanceof Error) {
    encrypted = /passphrase/i.test(parsed.message) || /encrypted/i.test(parsed.message);
  } else {
    publicInfo = parsePublic(Array.isArray(parsed) ? parsed[0] : parsed);
  }
  // A passphrase-protected key hides its public half; the .pub next to it still has it.
  if (!publicInfo && hasPublicFile) publicInfo = readPublicFile(pubFile);
  if (!publicInfo && !encrypted) return null; // PEM that ssh2 can't read at all

  return {
    publicLine: publicInfo?.line ?? null,
    info: {
      name,
      path: file,
      type: publicInfo?.type ?? null,
      bits: publicInfo?.bits ?? null,
      fingerprint: publicInfo?.fingerprint ?? null,
      comment: publicInfo?.comment ?? null,
      encrypted,
      hasPublicFile,
      modifiedAt: st.mtimeMs,
      usedBy: [],
    },
  };
}

/**
 * Manages the private keys in one folder (~/.ssh): list them, make new ones, hand out
 * the public half, delete one. Everything takes the folder from `dir()` so tests use a
 * temporary one.
 */
export function createKeyManager(dir: () => string) {
  return {
    list(hosts: { name: string; privateKeyPath?: string }[] = []): SshKeyInfo[] {
      let names: string[];
      try {
        names = readdirSync(dir());
      } catch {
        return [];
      }
      const keys: SshKeyInfo[] = [];
      for (const name of names) {
        if (NOT_KEYS.test(name)) continue;
        const found = inspect(dir(), name);
        if (!found) continue;
        found.info.usedBy = hosts
          .filter((h) => h.privateKeyPath && path.resolve(h.privateKeyPath) === path.resolve(found.info.path))
          .map((h) => h.name);
        keys.push(found.info);
      }
      return keys.sort((a, b) => a.name.localeCompare(b.name));
    },

    /** Makes a new key pair named `req.name`. Never overwrites: an existing file with that name (or .pub) is an error. */
    generate(req: GenerateKeyRequest): SshKeyInfo {
      const problem = validateGenerateRequest(req);
      if (problem) throw new Error(problem);
      const folder = dir();
      const privatePath = path.join(folder, req.name);
      const publicPath = privatePath + ".pub";
      if (existsSync(privatePath) || existsSync(publicPath)) throw new Error(`${req.name} already exists in ${folder}. Pick another name.`);
      mkdirSync(folder, { recursive: true, mode: 0o700 });

      const passphrase = req.passphrase ? req.passphrase : undefined;
      // ssh2's typings model each key type separately; the options are validated above.
      const generateKeyPair = utils.generateKeyPairSync as unknown as (
        type: string,
        options: object,
      ) => { private: string; public: string };
      // ssh2 now and then (about 1 in 250 ed25519 keys) produces a key it cannot parse back. Nothing is written until
      // a pair reads back, so a bad one is simply made again rather than left on disk.
      let pair: { private: string; public: string } | null = null;
      for (let attempt = 0; attempt < KEYGEN_ATTEMPTS && !pair; attempt++) {
        const candidate = generateKeyPair(req.type, {
          ...(req.type === "ed25519" ? {} : { bits: req.bits }),
          comment: req.comment ?? "",
          format: "new",
          ...(passphrase ? { passphrase, cipher: "aes256-ctr", rounds: 16 } : {}),
        });
        const parsed = utils.parseKey(candidate.private, passphrase);
        if (!(parsed instanceof Error) && parsePublic(Array.isArray(parsed) ? parsed[0] : parsed)) pair = candidate;
      }
      if (!pair) throw new Error("Couldn't make a key that reads back correctly. Try again.");

      // 'wx': fail rather than overwrite if something appeared in the meantime.
      writeFileSync(privatePath, pair.private.endsWith("\n") ? pair.private : pair.private + "\n", { flag: "wx", mode: 0o600 });
      try {
        writeFileSync(publicPath, pair.public.trim() + "\n", { flag: "wx", mode: 0o644 });
      } catch (err) {
        unlinkSync(privatePath);
        throw err;
      }
      chmodSync(privatePath, 0o600);
      const made = inspect(folder, req.name);
      if (!made) throw new Error("The key was written but couldn't be read back.");
      return made.info;
    },

    /** The public key line (`type base64 comment`), from the .pub file or derived from an unprotected private key. Null when neither is possible. */
    publicKey(name: string): string | null {
      if (validateKeyName(name)) return null;
      const file = path.join(dir(), name);
      const fromFile = existsSync(file + ".pub") ? readPublicFile(file + ".pub") : null;
      if (fromFile) return fromFile.line;
      return inspect(dir(), name)?.publicLine ?? null;
    },

    /** Deletes the private key and its .pub. */
    remove(name: string): void {
      const problem = validateKeyName(name);
      if (problem) throw new Error(problem);
      const file = path.join(dir(), name);
      if (!inspect(dir(), name)) throw new Error(`${name} isn't a key Wharf can manage.`);
      unlinkSync(file);
      if (existsSync(file + ".pub")) unlinkSync(file + ".pub");
    },
  };
}
