/**
 * Rules for what Command History keeps. Pure, so the main process applies them
 * to everything it stores and the tests exercise them directly.
 */

export interface HistorySettings {
  /** Record commands at all. */
  enabled: boolean;
  /** Skip commands that look like they carry a secret inline (`--password=x`, `TOKEN=…`, `mysql -pSECRET`, bearer tokens…). */
  skipSecretLooking: boolean;
  /** Commands matching any of these are skipped. `*` matches any run of characters; the whole command must match; case-insensitive. */
  ignorePatterns: string[];
  /** Entries older than this many days are deleted; 0 keeps them until cleared. */
  retentionDays: number;
}

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  enabled: true,
  skipSecretLooking: true,
  ignorePatterns: [],
  retentionDays: 0,
};

export const RETENTION_CHOICES = [0, 7, 30, 90, 365] as const;

const SECRET_WORD = "(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)";

// Each is deliberately narrow: a missed secret is a known limit (see the
// Settings text), but skipping ordinary commands would make History useless.
const SECRET_LOOKING: RegExp[] = [
  // NAME=value or --flag=value where the name says it's a secret: TOKEN=abc, --password=x, DB_PASSWORD=x
  new RegExp(`[A-Za-z0-9_-]*${SECRET_WORD}[A-Za-z0-9_-]*=\\S`, "i"),
  // --password x, --token x
  new RegExp(`--${SECRET_WORD}[a-z-]*\\s+[^\\s-]`, "i"),
  // mysql -pSECRET (no space is the only form that carries it)
  /\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]*\s-p\S/i,
  // sshpass -p SECRET
  /\bsshpass\b[^\n]*\s-p/i,
  // curl/wget/http with user:password
  /\b(?:curl|wget|http|https)\b[^\n]*\s(?:-u|--user)\s*['"]?[^\s:'"]+:[^\s'"]+/i,
  // Authorization / API-key headers and bearer tokens
  /\bauthorization:\s*\S/i,
  /\bx-api-key:\s*\S/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  // piping a password into chpasswd / passwd
  /\bchpasswd\b/i,
  // well-known token shapes
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
];

export function looksLikeInlineSecret(command: string): boolean {
  return SECRET_LOOKING.some((re) => re.test(command));
}

export function matchesIgnorePattern(command: string, patterns: readonly string[]): boolean {
  const text = command.trim();
  return patterns.some((raw) => {
    const pattern = raw.trim();
    if (!pattern) return false;
    const re = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`, "is");
    return re.test(text);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function shouldRecordCommand(command: string, settings: HistorySettings): boolean {
  if (!settings.enabled) return false;
  if (!command.trim()) return false;
  if (settings.skipSecretLooking && looksLikeInlineSecret(command)) return false;
  if (matchesIgnorePattern(command, settings.ignorePatterns)) return false;
  return true;
}

/** Accepts whatever was stored (older files, hand edits) and returns settings that are safe to use. */
export function normalizeHistorySettings(raw: unknown): HistorySettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof HistorySettings, unknown>>;
  const days = Number(r.retentionDays);
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULT_HISTORY_SETTINGS.enabled,
    skipSecretLooking: typeof r.skipSecretLooking === "boolean" ? r.skipSecretLooking : DEFAULT_HISTORY_SETTINGS.skipSecretLooking,
    ignorePatterns: Array.isArray(r.ignorePatterns)
      ? r.ignorePatterns
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 200)
      : [],
    retentionDays: Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 3650) : 0,
  };
}

export function pruneByRetention<T extends { timestamp: number }>(entries: T[], now: number, retentionDays: number): T[] {
  if (retentionDays <= 0) return entries;
  const cutoff = now - retentionDays * 86_400_000;
  return entries.filter((e) => e.timestamp >= cutoff);
}
