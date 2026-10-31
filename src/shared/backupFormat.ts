import { normalizeHistorySettings, type HistorySettings } from "./historyFilter";
import { normalizeTranscriptSettings, type TranscriptSettings } from "./transcripts";
import { validateTunnelInput } from "./tunnelInput";
import type { AuthMethod, GroupRecord, HostRecord, SnippetRecord, TunnelRecord, WorkspaceNode, WorkspaceRecord } from "./types";

/**
 * The backup file: what is in it, how an untrusted one is read, and how it is merged into what
 * is already there. Pure (no files, no crypto), so every rule has a unit test.
 *
 * Passwords and key passphrases are only ever in a backup when the user chose a passphrase for
 * it, sealed with that passphrase (see services/backup.ts); everything below is without them.
 */

export const BACKUP_VERSION = 2;
export const MAX_ITEMS = 10_000;
const MAX_RENDERER_VALUE = 64 * 1024;
/** Layout keys that mean nothing on another machine, or point at ids that import replaces. */
const RENDERER_KEYS_SKIPPED = new Set(["wharf-collapsed-groups"]);

export type BackupPart = "tunnels" | "snippets" | "workspaces" | "settings";

export interface BackupGroup {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
}

export interface BackupHost {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  groupId: string | null;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  color?: string;
  tags?: string[];
  jumpHostId?: string | null;
  mosh?: boolean;
  pinned?: boolean;
}

export interface BackupTunnel {
  hostId: string;
  name: string;
  type: TunnelRecord["type"];
  srcHost: string;
  srcPort: number;
  dstHost?: string;
  dstPort?: number;
  autoStart?: boolean;
}

export interface BackupSnippet {
  name: string;
  command: string;
  run?: boolean;
}

export interface BackupWorkspace {
  name: string;
  tabs: WorkspaceRecord["tabs"];
}

/** Settings that are safe to carry between machines. Nothing about security (auto-lock, master password) or where AI requests go. */
export interface BackupSettings {
  main: {
    historySettings?: HistorySettings;
    transcriptSettings?: TranscriptSettings;
    commandBlocksEnabled?: boolean;
    updateCheckEnabled?: boolean;
  };
  /** The window's own preferences (theme, fonts, layout…): `wharf-*` browser-storage keys to their text values. */
  renderer: Record<string, string>;
}

/** Host passwords/passphrases sealed with a passphrase the user chose for this backup. */
export interface BackupSecrets {
  salt: string;
  cost: number;
  check: string;
  /** Backup host id → sealed secret. */
  items: Record<string, string>;
}

export interface BackupFile {
  app: "wharf";
  version: number;
  exportedAt: string;
  groups: BackupGroup[];
  hosts: BackupHost[];
  tunnels: BackupTunnel[];
  snippets: BackupSnippet[];
  workspaces: BackupWorkspace[];
  settings?: BackupSettings;
  secrets?: BackupSecrets;
}

/** What a picked file holds, shown before anything is imported. */
export interface BackupPreview {
  token: string;
  fileName: string;
  exportedAt: string | null;
  counts: { groups: number; hosts: number; tunnels: number; snippets: number; workspaces: number };
  hasSettings: boolean;
  hasSecrets: boolean;
  /** Entries in the file that were malformed and will be left out. */
  invalid: number;
}

export interface BackupImportResult {
  added: { groups: number; hosts: number; tunnels: number; snippets: number; workspaces: number };
  /** Already present (same host/group/tunnel/snippet/workspace), so left alone. */
  skipped: number;
  /** Left out because they were malformed, or pointed at a host that isn't in the file. */
  invalid: number;
  secrets: number;
  settingsApplied: boolean;
  /** The window preferences to store, for the renderer to write and reload with. */
  rendererSettings?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Reading an untrusted file
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isPort = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535;
const optionalString = (v: unknown): string | undefined => (isString(v) && v.length > 0 ? v : undefined);
const AUTH_METHODS: readonly string[] = ["password", "privateKey", "agent"];

export interface ParsedBackup {
  file: BackupFile;
  invalid: number;
}

function sanitizeNode(node: unknown, depth = 0): WorkspaceNode | null {
  if (!isObject(node) || depth > 12) return null;
  if (node.type === "leaf") {
    // Only the layout is kept: a saved workspace never replays old terminal content.
    return { type: "leaf", hostId: isString(node.hostId) ? node.hostId : null };
  }
  if (node.type === "split" && (node.direction === "row" || node.direction === "column") && Array.isArray(node.children)) {
    const children = node.children.map((c) => sanitizeNode(c, depth + 1)).filter((c): c is WorkspaceNode => c !== null);
    return children.length > 0 ? { type: "split", direction: node.direction, children } : null;
  }
  return null;
}

function parseSecrets(value: unknown): BackupSecrets | undefined {
  if (!isObject(value) || !isString(value.salt) || !isString(value.check) || !isObject(value.items)) return undefined;
  const cost = value.cost;
  // The cost comes from the file and sets how much memory unlocking uses: only powers of two in a sane range.
  if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 2 ** 10 || cost > 2 ** 18 || (cost & (cost - 1)) !== 0)
    return undefined;
  const items: Record<string, string> = {};
  for (const [id, sealed] of Object.entries(value.items)) if (isString(sealed) && sealed.startsWith("mp:")) items[id] = sealed;
  return { salt: value.salt, cost, check: value.check, items };
}

/** Only the window preferences that belong in a backup: `wharf-*` keys with short text values, minus layout that is tied to this machine's ids. */
export function sanitizeRendererSettings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObject(value)) return out;
  for (const [key, text] of Object.entries(value)) {
    if (key.startsWith("wharf-") && !RENDERER_KEYS_SKIPPED.has(key) && isString(text) && text.length <= MAX_RENDERER_VALUE) out[key] = text;
  }
  return out;
}

function parseSettings(value: unknown): BackupSettings | undefined {
  if (!isObject(value)) return undefined;
  const main = isObject(value.main) ? value.main : {};
  const out: BackupSettings = { main: {}, renderer: {} };
  if (isObject(main.historySettings)) out.main.historySettings = normalizeHistorySettings(main.historySettings as Partial<HistorySettings>);
  if (isObject(main.transcriptSettings))
    out.main.transcriptSettings = normalizeTranscriptSettings(main.transcriptSettings as Partial<TranscriptSettings>);
  if (typeof main.commandBlocksEnabled === "boolean") out.main.commandBlocksEnabled = main.commandBlocksEnabled;
  if (typeof main.updateCheckEnabled === "boolean") out.main.updateCheckEnabled = main.updateCheckEnabled;
  out.renderer = sanitizeRendererSettings(value.renderer);
  return out;
}

/** Reads a backup (any version). Entries that are malformed are dropped and counted, never trusted. Throws a readable error if it isn't a Wharf backup at all. */
export function parseBackup(raw: unknown): ParsedBackup {
  if (!isObject(raw) || (raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.groups) || !Array.isArray(raw.hosts)) {
    throw new Error("This doesn't look like a Wharf backup file.");
  }
  let invalid = 0;
  const list = (value: unknown): unknown[] => {
    const items = Array.isArray(value) ? value : [];
    if (items.length > MAX_ITEMS) throw new Error("This backup has far more entries than a real one would; it won't be imported.");
    return items;
  };

  const groups: BackupGroup[] = [];
  for (const g of list(raw.groups)) {
    if (isObject(g) && isString(g.id) && isString(g.name) && g.name.trim()) {
      groups.push({ id: g.id, name: g.name, parentId: isString(g.parentId) ? g.parentId : null, color: optionalString(g.color) });
    } else invalid++;
  }

  const hosts: BackupHost[] = [];
  for (const h of list(raw.hosts)) {
    if (
      isObject(h) &&
      isString(h.id) &&
      isString(h.name) &&
      h.name.trim() &&
      isString(h.hostname) &&
      h.hostname.trim() &&
      isPort(h.port) &&
      isString(h.username) &&
      isString(h.authMethod) &&
      AUTH_METHODS.includes(h.authMethod)
    ) {
      hosts.push({
        id: h.id,
        name: h.name,
        hostname: h.hostname,
        port: h.port,
        username: h.username,
        groupId: isString(h.groupId) ? h.groupId : null,
        authMethod: h.authMethod as AuthMethod,
        privateKeyPath: optionalString(h.privateKeyPath),
        color: optionalString(h.color),
        tags: Array.isArray(h.tags) ? h.tags.filter(isString) : undefined,
        jumpHostId: isString(h.jumpHostId) ? h.jumpHostId : null,
        ...(h.mosh === true ? { mosh: true } : {}),
        ...(h.pinned === true ? { pinned: true } : {}),
      });
    } else invalid++;
  }

  const tunnels: BackupTunnel[] = [];
  for (const t of list(raw.tunnels)) {
    if (!isObject(t) || !isString(t.hostId)) {
      invalid++;
      continue;
    }
    const candidate = {
      hostId: t.hostId,
      name: isString(t.name) ? t.name : "",
      type: t.type as TunnelRecord["type"],
      srcHost: isString(t.srcHost) ? t.srcHost : "",
      srcPort: t.srcPort as number,
      dstHost: isString(t.dstHost) ? t.dstHost : undefined,
      dstPort: typeof t.dstPort === "number" ? t.dstPort : undefined,
      ...(t.autoStart === true ? { autoStart: true } : {}),
    };
    if (validateTunnelInput(candidate) === null) tunnels.push(candidate);
    else invalid++;
  }

  const snippets: BackupSnippet[] = [];
  for (const s of list(raw.snippets)) {
    if (isObject(s) && isString(s.name) && s.name.trim() && isString(s.command) && s.command.trim()) {
      snippets.push({ name: s.name, command: s.command, ...(s.run === true ? { run: true } : {}) });
    } else invalid++;
  }

  const workspaces: BackupWorkspace[] = [];
  for (const w of list(raw.workspaces)) {
    if (isObject(w) && isString(w.name) && w.name.trim() && Array.isArray(w.tabs)) {
      const tabs = w.tabs
        .map((tab) => (isObject(tab) ? sanitizeNode(tab.layout) : null))
        .filter((layout): layout is WorkspaceNode => layout !== null)
        .map((layout) => ({ layout }));
      workspaces.push({ name: w.name, tabs });
    } else invalid++;
  }

  return {
    invalid,
    file: {
      app: "wharf",
      version: raw.version,
      exportedAt: isString(raw.exportedAt) ? raw.exportedAt : "",
      groups,
      hosts,
      tunnels,
      snippets,
      workspaces,
      settings: parseSettings(raw.settings),
      secrets: parseSecrets(raw.secrets),
    },
  };
}

// ---------------------------------------------------------------------------
// Merging into what is there
// ---------------------------------------------------------------------------

export interface ExistingData {
  groups: GroupRecord[];
  hosts: HostRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];
  workspaces: WorkspaceRecord[];
}

export interface ImportPlan {
  groups: GroupRecord[];
  hosts: HostRecord[];
  tunnels: Omit<TunnelRecord, "id">[];
  snippets: SnippetRecord[];
  workspaces: WorkspaceRecord[];
  /** New hosts that have a sealed secret in the file: new host id ← backup host id. */
  secretTargets: { hostId: string; backupId: string }[];
  skipped: number;
  invalid: number;
}

const hostKey = (h: { username: string; hostname: string; port: number }) => `${h.username}@${h.hostname}:${h.port}`.toLowerCase();

/**
 * What importing `file` adds to `existing`. Re-importing a backup changes nothing: a host with the
 * same user@host:port, a group of the same name under the same parent, an identical snippet, a
 * tunnel with the same ends, a workspace of the same name are all recognised and skipped.
 * Everything new gets a fresh id; references between records are carried across.
 */
export function planImport(
  file: BackupFile,
  existing: ExistingData,
  parts: ReadonlySet<BackupPart>,
  newId: () => string,
  now: number,
): ImportPlan {
  const plan: ImportPlan = { groups: [], hosts: [], tunnels: [], snippets: [], workspaces: [], secretTargets: [], skipped: 0, invalid: 0 };

  // Groups: reuse a same-named group under the same (resolved) parent, otherwise create one.
  const groupMap = new Map<string, string>(); // backup id → id in the app
  const byBackupId = new Map(file.groups.map((g) => [g.id, g]));
  const resolving = new Set<string>();
  const resolveGroup = (backupId: string): string | null => {
    const known = groupMap.get(backupId);
    if (known) return known;
    const g = byBackupId.get(backupId);
    if (!g || resolving.has(backupId)) return null; // unknown parent, or a cycle in a damaged file
    resolving.add(backupId);
    const parentId = g.parentId ? resolveGroup(g.parentId) : null;
    resolving.delete(backupId);
    const match = [...existing.groups, ...plan.groups].find((x) => x.name === g.name && x.parentId === parentId);
    if (match) {
      groupMap.set(backupId, match.id);
      if (!plan.groups.includes(match)) plan.skipped++;
      return match.id;
    }
    const created: GroupRecord = { id: newId(), name: g.name, parentId, color: g.color, createdAt: now, updatedAt: now };
    plan.groups.push(created);
    groupMap.set(backupId, created.id);
    return created.id;
  };
  for (const g of file.groups) resolveGroup(g.id);

  // Hosts
  const hostMap = new Map<string, string>();
  const existingHosts = new Map(existing.hosts.map((h) => [hostKey(h), h.id]));
  const created: { backup: BackupHost; record: HostRecord }[] = [];
  for (const h of file.hosts) {
    const same = existingHosts.get(hostKey(h));
    if (same) {
      hostMap.set(h.id, same);
      plan.skipped++;
      continue;
    }
    const record: HostRecord = {
      id: newId(),
      name: h.name,
      hostname: h.hostname,
      port: h.port,
      username: h.username,
      groupId: h.groupId ? (groupMap.get(h.groupId) ?? null) : null,
      authMethod: h.authMethod,
      secretId: null,
      privateKeyPath: h.privateKeyPath,
      color: h.color,
      tags: h.tags,
      jumpHostId: null, // filled in below, once every host has its id
      ...(h.mosh ? { mosh: true } : {}),
      ...(h.pinned ? { pinned: true } : {}),
      createdAt: now,
      updatedAt: now,
    };
    hostMap.set(h.id, record.id);
    existingHosts.set(hostKey(h), record.id);
    created.push({ backup: h, record });
  }
  for (const { backup, record } of created) {
    record.jumpHostId = backup.jumpHostId ? (hostMap.get(backup.jumpHostId) ?? null) : null;
    plan.hosts.push(record);
    if (file.secrets?.items[backup.id]) plan.secretTargets.push({ hostId: record.id, backupId: backup.id });
  }

  if (parts.has("tunnels")) {
    const seen = new Set(existing.tunnels.map((t) => `${t.hostId}|${t.type}|${t.srcHost}|${t.srcPort}|${t.dstHost}|${t.dstPort}`));
    for (const t of file.tunnels) {
      const hostId = hostMap.get(t.hostId);
      if (!hostId) {
        plan.invalid++; // its host isn't in this backup or this app
        continue;
      }
      const key = `${hostId}|${t.type}|${t.srcHost}|${t.srcPort}|${t.dstHost}|${t.dstPort}`;
      if (seen.has(key)) {
        plan.skipped++;
        continue;
      }
      seen.add(key);
      plan.tunnels.push({ ...t, hostId });
    }
  }

  if (parts.has("snippets")) {
    const seen = new Set(existing.snippets.map((s) => `${s.name}\n${s.command}`));
    for (const s of file.snippets) {
      const key = `${s.name}\n${s.command}`;
      if (seen.has(key)) {
        plan.skipped++;
        continue;
      }
      seen.add(key);
      plan.snippets.push({
        id: newId(),
        name: s.name,
        command: s.command,
        ...(s.run ? { run: true } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  if (parts.has("workspaces")) {
    const seen = new Set(existing.workspaces.map((w) => w.name));
    const remap = (node: WorkspaceNode): WorkspaceNode =>
      node.type === "leaf"
        ? { type: "leaf", hostId: node.hostId ? (hostMap.get(node.hostId) ?? null) : null }
        : { ...node, children: node.children.map(remap) };
    for (const w of file.workspaces) {
      if (seen.has(w.name)) {
        plan.skipped++;
        continue;
      }
      seen.add(w.name);
      plan.workspaces.push({ id: newId(), name: w.name, tabs: w.tabs.map((t) => ({ layout: remap(t.layout) })), createdAt: now });
    }
  }

  return plan;
}

/** The counts a preview shows. */
export function countBackup(file: BackupFile): BackupPreview["counts"] {
  return {
    groups: file.groups.length,
    hosts: file.hosts.length,
    tunnels: file.tunnels.length,
    snippets: file.snippets.length,
    workspaces: file.workspaces.length,
  };
}
