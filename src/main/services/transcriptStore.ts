import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { open as openFile, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { open as openSealed, seal } from "./masterKey";
import { createTranscriptCleaner, type TranscriptCleaner } from "./transcriptText";
import {
  TRANSCRIPT_SEARCH_LIMIT,
  type TranscriptContent,
  type TranscriptInfo,
  type TranscriptLine,
  type TranscriptMatch,
  type TranscriptSearchResult,
  type TranscriptSettings,
} from "../../shared/transcripts";

/** A transcript stops growing here: a runaway `yes` or `cat bigfile` must not fill the disk. */
export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;
const FLUSH_INTERVAL_MS = 250;
const SEALED_PREFIX = "mp:";
const SIZE_LIMIT_NOTE = "[transcript size limit reached — recording stopped]";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether lines are written sealed with the master password, and whether that is possible right now. */
export type Sealing = { mode: "none" } | { mode: "locked" } | { mode: "key"; key: Buffer };

export interface TranscriptDeps {
  dir(): string;
  settings(): TranscriptSettings;
  sealing(): Sealing;
  now(): number;
}

export interface TranscriptSessionMeta {
  hostId: string | null;
  hostName: string;
}

interface Header extends TranscriptSessionMeta {
  v: 1;
  id: string;
  startedAt: number;
}

interface Active {
  header: Header;
  file: string;
  fd: number;
  cleaner: TranscriptCleaner;
  pending: string[];
  bytes: number;
  lastWriteAt: number;
}

function fileName(startedAt: number, id: string): string {
  return `${startedAt}_${id}.jsonl`;
}

function parseName(name: string): { startedAt: number; id: string } | null {
  const m = /^(\d+)_([A-Za-z0-9-]+)\.jsonl$/.exec(name);
  return m ? { startedAt: Number(m[1]), id: m[2] } : null;
}

/** One stored line back to its object, or null when it can't be read (sealed and locked, or damaged). */
function decodeLine(raw: string, key: Buffer | null): unknown {
  try {
    if (raw.startsWith(SEALED_PREFIX)) return key ? JSON.parse(openSealed(key, raw)) : null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Session transcripts: the cleaned text of terminal sessions, one append-only
 * JSON-lines file each (a header line, then `{t, s}` per line of output). With
 * a master password every line is sealed with its key, so a transcript is only
 * readable — and only recorded — while unlocked.
 */
export function createTranscriptStore(deps: TranscriptDeps) {
  const active = new Map<string, Active>();
  let timer: NodeJS.Timeout | null = null;

  function key(): Buffer | null {
    const s = deps.sealing();
    return s.mode === "key" ? s.key : null;
  }

  function encode(s: Sealing & { mode: "none" | "key" }, value: unknown): string {
    const json = JSON.stringify(value);
    return (s.mode === "key" ? seal(s.key, json) : json) + "\n";
  }

  function flush(entry: Active): void {
    if (entry.pending.length === 0) return;
    const text = entry.pending.join("");
    entry.pending = [];
    try {
      writeSync(entry.fd, text);
    } catch {
      // Disk full, folder removed… a transcript is a convenience; never let it break the terminal.
    }
  }

  function flushAll(): void {
    for (const entry of active.values()) flush(entry);
  }

  function schedule(): void {
    if (timer) return;
    timer = setInterval(flushAll, FLUSH_INTERVAL_MS);
    timer.unref();
  }

  function append(entry: Active, s: Sealing & { mode: "none" | "key" }, t: number, text: string): void {
    if (entry.bytes >= MAX_TRANSCRIPT_BYTES) return;
    const line = encode(s, { t, s: text });
    entry.bytes += line.length;
    entry.pending.push(line);
    entry.lastWriteAt = t;
    if (entry.bytes >= MAX_TRANSCRIPT_BYTES) {
      entry.pending.push(encode(s, { t, s: SIZE_LIMIT_NOTE }));
    }
  }

  function close(sessionId: string): void {
    const entry = active.get(sessionId);
    if (!entry) return;
    const s = deps.sealing();
    const rest = entry.cleaner.flush();
    if (s.mode !== "locked") {
      const now = deps.now();
      if (rest !== null) append(entry, s, now, rest);
    }
    flush(entry);
    try {
      closeSync(entry.fd);
    } catch {
      /* already closed */
    }
    active.delete(sessionId);
  }

  return {
    /** A terminal session opened; starts its transcript if recording is on (and the data can be written). */
    begin(sessionId: string, meta: TranscriptSessionMeta): void {
      if (!deps.settings().enabled || active.has(sessionId)) return;
      const s = deps.sealing();
      if (s.mode === "locked") return;
      try {
        const dir = deps.dir();
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const startedAt = deps.now();
        const header: Header = { v: 1, id: sessionId, hostId: meta.hostId, hostName: meta.hostName, startedAt };
        const file = path.join(dir, fileName(startedAt, sessionId));
        const fd = openSync(file, "a", 0o600);
        const entry: Active = {
          header,
          file,
          fd,
          cleaner: createTranscriptCleaner(),
          pending: [encode(s, header)],
          bytes: 0,
          lastWriteAt: startedAt,
        };
        active.set(sessionId, entry);
        flush(entry);
        schedule();
      } catch {
        // Unwritable folder: the session just isn't recorded.
      }
    },

    /** Output that reached the terminal. */
    feed(sessionId: string, text: string): void {
      const entry = active.get(sessionId);
      if (!entry) return;
      if (!deps.settings().enabled) {
        close(sessionId);
        return;
      }
      const s = deps.sealing();
      if (s.mode === "locked") return; // can't seal while locked; this output is not recorded
      const now = deps.now();
      for (const line of entry.cleaner.feed(text)) append(entry, s, now, line);
    },

    /** The session ended (or was disconnected for good). */
    end(sessionId: string): void {
      close(sessionId);
    },

    /** Everything buffered is written — before quitting, or before the files are rewritten. */
    flushAll,

    endAll(): void {
      for (const id of [...active.keys()]) close(id);
    },

    isActive(sessionId: string): boolean {
      return active.has(sessionId);
    },

    async list(): Promise<TranscriptInfo[]> {
      flushAll();
      const dir = deps.dir();
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const k = key();
      const infos: TranscriptInfo[] = [];
      for (const name of names) {
        const parsed = parseName(name);
        if (!parsed) continue;
        const file = path.join(dir, name);
        try {
          const [st, header] = await Promise.all([stat(file), readHeader(file, k)]);
          if (!header) continue; // sealed while locked, or damaged
          infos.push({
            id: parsed.id,
            hostId: header.hostId,
            hostName: header.hostName,
            startedAt: header.startedAt,
            updatedAt: st.mtimeMs,
            bytes: st.size,
            active: active.has(parsed.id),
          });
        } catch {
          /* vanished meanwhile */
        }
      }
      return infos.sort((a, b) => b.startedAt - a.startedAt);
    },

    async read(id: string): Promise<TranscriptContent | null> {
      flushAll();
      const found = await locate(id);
      if (!found) return null;
      const k = key();
      const decoded = await decodeFile(found.file, k);
      if (!decoded) return null;
      const st = await stat(found.file);
      return {
        info: {
          id,
          hostId: decoded.header.hostId,
          hostName: decoded.header.hostName,
          startedAt: decoded.header.startedAt,
          updatedAt: st.mtimeMs,
          bytes: st.size,
          active: active.has(id),
        },
        lines: decoded.lines,
      };
    },

    /** Case-insensitive text search over every readable transcript, newest first. */
    async search(query: string, limit = TRANSCRIPT_SEARCH_LIMIT): Promise<TranscriptSearchResult> {
      flushAll();
      const needle = query.trim().toLowerCase();
      if (!needle) return { matches: [], truncated: false };
      const dir = deps.dir();
      let names: string[];
      try {
        names = (await readdir(dir))
          .filter((n) => parseName(n))
          .sort()
          .reverse();
      } catch {
        return { matches: [], truncated: false };
      }
      const k = key();
      const matches: TranscriptMatch[] = [];
      for (const name of names) {
        const decoded = await decodeFile(path.join(dir, name), k).catch(() => null);
        if (!decoded) continue;
        const { header, lines } = decoded;
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].text.toLowerCase().includes(needle)) continue;
          if (matches.length >= limit) return { matches, truncated: true };
          matches.push({
            transcriptId: header.id,
            hostName: header.hostName,
            startedAt: header.startedAt,
            line: i,
            t: lines[i].t,
            text: lines[i].text,
            before: lines.slice(Math.max(0, i - 2), i).map((l) => l.text),
            after: lines.slice(i + 1, i + 3).map((l) => l.text),
          });
        }
      }
      return { matches, truncated: false };
    },

    async remove(id: string): Promise<void> {
      close(id);
      const found = await locate(id);
      if (found) await unlink(found.file).catch(() => undefined);
    },

    async clear(): Promise<void> {
      this.endAll();
      const dir = deps.dir();
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        if (parseName(name)) await unlink(path.join(dir, name)).catch(() => undefined);
      }
    },

    /** Like clear(), for the places that can't wait (a forgotten master password erasing what it sealed). */
    clearSync(): void {
      this.endAll();
      const dir = deps.dir();
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (!parseName(name)) continue;
        try {
          unlinkSync(path.join(dir, name));
        } catch {
          /* gone already */
        }
      }
    },

    /** Deletes transcripts that outlived the retention setting (open sessions are never touched). Returns how many went. */
    async prune(): Promise<number> {
      const days = deps.settings().retentionDays;
      if (days <= 0) return 0;
      const cutoff = deps.now() - days * DAY_MS;
      const dir = deps.dir();
      let removed = 0;
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const parsed = parseName(name);
        if (!parsed || active.has(parsed.id)) continue;
        try {
          const file = path.join(dir, name);
          if ((await stat(file)).mtimeMs < cutoff) {
            await unlink(file);
            removed++;
          }
        } catch {
          /* gone already */
        }
      }
      return removed;
    },

    /**
     * Rewrites every stored line through `convert` (sealing, re-sealing or unsealing for a
     * master-password change). Synchronous, because the callers are; lines it throws on stay
     * as they were. Sessions being recorded carry on appending to the converted file.
     */
    convertAll(convert: (rawLine: string) => string): void {
      flushAll();
      for (const entry of active.values()) closeSync(entry.fd);
      const dir = deps.dir();
      let names: string[] = [];
      try {
        names = readdirSync(dir).filter((n) => parseName(n));
      } catch {
        /* no transcripts yet */
      }
      for (const name of names) {
        const file = path.join(dir, name);
        try {
          const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
          const next = lines.map((line) => {
            try {
              return convert(line);
            } catch {
              return line;
            }
          });
          const tmp = file + ".tmp";
          writeFileSync(tmp, next.join("\n") + "\n", { mode: 0o600 });
          renameSync(tmp, file);
        } catch {
          /* unreadable: leave it */
        }
      }
      for (const entry of active.values()) {
        entry.fd = openSync(entry.file, "a", 0o600);
        try {
          entry.bytes = statSync(entry.file).size;
        } catch {
          /* keep the old count */
        }
      }
    },
  };

  async function locate(id: string): Promise<{ file: string } | null> {
    if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
    const dir = deps.dir();
    const names = await readdir(dir).catch(() => [] as string[]);
    const name = names.find((n) => parseName(n)?.id === id);
    return name ? { file: path.join(dir, name) } : null;
  }

  async function readHeader(file: string, k: Buffer | null): Promise<Header | null> {
    const handle = await openFile(file, "r");
    try {
      const buf = Buffer.alloc(16 * 1024);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      const first = buf.subarray(0, bytesRead).toString("utf8").split("\n")[0];
      const header = decodeLine(first, k) as Header | null;
      return header && header.v === 1 ? header : null;
    } finally {
      await handle.close();
    }
  }

  async function decodeFile(file: string, k: Buffer | null): Promise<{ header: Header; lines: TranscriptLine[] } | null> {
    const raw = await readFile(file, "utf8");
    const rows = raw.split("\n");
    const header = decodeLine(rows[0] ?? "", k) as Header | null;
    if (!header || header.v !== 1) return null;
    const lines: TranscriptLine[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i]) continue;
      const row = decodeLine(rows[i], k) as { t?: number; s?: string } | null;
      if (row && typeof row.s === "string" && typeof row.t === "number") lines.push({ t: row.t, text: row.s });
    }
    return { header, lines };
  }
}

export type TranscriptStore = ReturnType<typeof createTranscriptStore>;
