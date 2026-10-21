/** SSH key manager: what the main process reports and accepts, and the rules both sides share. */

export type SshKeyType = "ed25519" | "rsa" | "ecdsa";

export interface SshKeyInfo {
  /** File name inside ~/.ssh, e.g. "id_ed25519". */
  name: string;
  /** Full path of the private key, which is what a host's "private key" field holds. */
  path: string;
  /** Null when the key is passphrase-protected and has no .pub next to it to read the type from. */
  type: string | null;
  bits: number | null;
  /** "SHA256:…", as `ssh-keygen -l` prints it; null when the public half can't be read. */
  fingerprint: string | null;
  comment: string | null;
  encrypted: boolean;
  /** Whether name.pub exists next to it. */
  hasPublicFile: boolean;
  modifiedAt: number;
  /** Saved hosts that point at this key. */
  usedBy: string[];
}

export interface GenerateKeyRequest {
  name: string;
  type: SshKeyType;
  /** RSA: 2048/3072/4096. ECDSA: 256/384/521. Ignored for ed25519. */
  bits?: number;
  comment?: string;
  passphrase?: string;
}

export interface InstallKeyResult {
  /** True when the key was added; false when the host already had it. */
  added: boolean;
}

export const RSA_BITS = [2048, 3072, 4096] as const;
export const ECDSA_BITS = [256, 384, 521] as const;
export const MIN_KEY_PASSPHRASE = 5; // ssh-keygen's own minimum

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Why `name` can't be a key file name, or null. Keys live directly in ~/.ssh; nothing path-like gets through. */
export function validateKeyName(name: string): string | null {
  if (!name) return "Give the key a name.";
  if (!NAME_RE.test(name)) return "Use letters, digits, dot, dash and underscore only (it becomes the file name).";
  if (name.endsWith(".pub")) return "The name can't end in .pub — that is added for the public half.";
  if (["config", "known_hosts", "authorized_keys", "environment"].includes(name) || name.startsWith("known_hosts")) {
    return `“${name}” is used by SSH itself.`;
  }
  return null;
}

/** Why a generate request is unusable, or null. */
export function validateGenerateRequest(req: GenerateKeyRequest): string | null {
  const name = validateKeyName(req.name);
  if (name) return name;
  if (req.type === "rsa" && !(RSA_BITS as readonly number[]).includes(req.bits ?? 0))
    return "Choose 2048, 3072 or 4096 bits for an RSA key.";
  if (req.type === "ecdsa" && !(ECDSA_BITS as readonly number[]).includes(req.bits ?? 0))
    return "Choose 256, 384 or 521 bits for an ECDSA key.";
  if (!["ed25519", "rsa", "ecdsa"].includes(req.type)) return "Unknown key type.";
  if (req.passphrase !== undefined && req.passphrase !== "" && req.passphrase.length < MIN_KEY_PASSPHRASE) {
    return `A passphrase must be at least ${MIN_KEY_PASSPHRASE} characters (or leave it empty).`;
  }
  if (req.comment !== undefined && /[\r\n]/.test(req.comment)) return "The comment must be a single line.";
  return null;
}

/** A public key line that is safe to paste into a shell command and into authorized_keys: `type base64 [comment]`, one line, no quotes or control characters. */
export function isSafePublicKeyLine(line: string): boolean {
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/]+={0,3}( [\w@.+:=, -]{0,200})?$/.test(
    line,
  );
}

/** The shell command that appends `publicKey` to ~/.ssh/authorized_keys once, creating the folder and file with safe permissions. Prints "added" or "present". */
export function installKeyCommand(publicKey: string): string {
  if (!isSafePublicKeyLine(publicKey)) throw new Error("That doesn't look like a public key line.");
  const q = `'${publicKey}'`; // safe: the line is vetted above, it has no quote characters
  return (
    `umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys && ` +
    `if grep -qxF ${q} ~/.ssh/authorized_keys; then echo present; else printf '%s\\n' ${q} >> ~/.ssh/authorized_keys && echo added; fi`
  );
}

/** A free key name to suggest, following ssh-keygen's own: id_ed25519, then id_ed25519_2, … */
export function suggestKeyName(type: SshKeyType, taken: readonly string[]): string {
  const base = `id_${type}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_new`;
}
