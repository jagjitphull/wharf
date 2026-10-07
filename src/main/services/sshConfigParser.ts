import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { SshConfigCandidate } from "../../shared/types";

export const DEFAULT_SSH_CONFIG_PATH = join(homedir(), ".ssh", "config");

/** Working (mutable) shape while parsing, before the final "alreadyImported"
 * flag is stamped on by the caller. */
interface RawCandidate {
  alias: string;
  hostname?: string;
  port?: number;
  username?: string;
  identityFile?: string;
  proxyJump?: string;
}

function expandTilde(path: string): string {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

/** Only `*` (any run of characters) is supported — the common case for a
 * config's `Include some/dir/*.conf` or `Include some/dir/*`. Anything
 * fancier (`?`, character classes, `**`) is treated as a literal path and
 * will simply not match, same as if the file doesn't exist. */
function resolveIncludeGlob(pattern: string, baseDir: string): string[] {
  const full = isAbsolute(pattern) ? pattern : join(baseDir, pattern);
  if (!full.includes("*")) return existsSync(full) ? [full] : [];

  const dir = dirname(full);
  const filePattern = full.slice(dir.length + 1);
  if (!existsSync(dir)) return [];
  const regex = new RegExp(`^${filePattern.split("*").map(escapeRegExp).join(".*")}$`);
  return readdirSync(dir)
    .filter((name) => regex.test(name))
    .map((name) => join(dir, name))
    .sort();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits a config line into its keyword and the rest of the value,
 * OpenSSH-style: keyword is the first whitespace-separated token (an `=`
 * right after the keyword is also accepted), the remainder is the value
 * with a single layer of surrounding double-quotes stripped if present. */
function splitDirective(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(\S+?)(?:\s+|\s*=\s*)(.+)$/);
  if (!match) return null;
  const [, keyword, rawValue] = match;
  const value = rawValue.trim().replace(/^"(.*)"$/, "$1");
  return [keyword.toLowerCase(), value];
}

/**
 * Parses an OpenSSH client config file into a flat list of concrete
 * (non-wildcard) host candidates.
 *
 * This is a pragmatic subset of the real OpenSSH config grammar, not a full
 * implementation: directives are applied in file order, a `Host *` (or any
 * all-wildcard pattern) block's values become *defaults* merged into every
 * concrete `Host` block that follows it, and `Match` blocks are ignored
 * entirely. Real ssh(1) resolves each keyword independently on a
 * first-obtained-value-wins basis across the whole file, including blocks
 * that appear *before* a wildcard default — this parser doesn't replicate
 * that, so a config relying on unusual keyword ordering may import
 * slightly differently than `ssh` itself would resolve it. Good enough to
 * save re-typing the common case; review before importing.
 */
export function parseSshConfig(filePath: string = DEFAULT_SSH_CONFIG_PATH): SshConfigCandidate[] {
  if (!existsSync(filePath)) return [];

  const candidates: RawCandidate[] = [];
  let defaults: Omit<RawCandidate, "alias"> = {};
  let current: RawCandidate | null = null;
  let currentIsWildcardOnly = false;

  function flush() {
    if (current && !currentIsWildcardOnly) candidates.push(current);
    else if (current && currentIsWildcardOnly) {
      // A "Host *"-style defaults block: merge its own values (set before
      // this flush) into the running defaults for subsequent concrete blocks.
      defaults = { ...defaults, ...stripAlias(current) };
    }
  }

  function stripAlias(c: RawCandidate): Omit<RawCandidate, "alias"> {
    const { alias: _alias, ...rest } = c;
    return rest;
  }

  function visit(path: string, seen: Set<string>, depth: number) {
    if (depth > 8 || seen.has(path) || !existsSync(path)) return;
    seen.add(path);

    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const directive = splitDirective(line);
      if (!directive) continue;
      const [keyword, value] = directive;

      if (keyword === "include") {
        // Per ssh_config(5): a relative Include path in a user config file
        // resolves against ~/.ssh, not the directory of the file doing the
        // including (relevant once an included file itself has an Include).
        for (const pattern of value.split(/\s+/)) {
          for (const includePath of resolveIncludeGlob(expandTilde(pattern), join(homedir(), ".ssh"))) {
            visit(includePath, seen, depth + 1);
          }
        }
        continue;
      }

      if (keyword === "host") {
        flush();
        const patterns = value.split(/\s+/).filter(Boolean);
        const concrete = patterns.find((p) => !p.includes("*") && !p.includes("?"));
        currentIsWildcardOnly = !concrete;
        current = { alias: concrete ?? patterns[0] ?? "*", ...defaults };
        continue;
      }

      if (!current) continue; // directive before any Host block — ignore
      switch (keyword) {
        case "hostname":
          current.hostname = value;
          break;
        case "user":
          current.username = value;
          break;
        case "port": {
          const port = Number(value);
          if (Number.isFinite(port)) current.port = port;
          break;
        }
        case "identityfile":
          // A block can list multiple IdentityFile lines; keep the first.
          if (!current.identityFile) current.identityFile = expandTilde(value);
          break;
        case "proxyjump":
          current.proxyJump = value.split(",")[0]?.trim(); // first hop only
          break;
        default:
          break; // directive not modeled by Wharf — ignored
      }
    }
  }

  visit(filePath, new Set(), 0);
  flush();

  return candidates
    .filter((c) => c.alias !== "*")
    .map((c) => ({
      alias: c.alias,
      hostname: c.hostname ?? c.alias, // ssh itself falls back to the alias as the hostname
      port: c.port ?? 22,
      username: c.username,
      identityFile: c.identityFile,
      proxyJump: c.proxyJump,
      alreadyImported: false,
    }));
}
