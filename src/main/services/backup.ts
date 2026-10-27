import { createConfig, keyFor, MIN_PASSWORD_LENGTH, open, seal } from "./masterKey";
import {
  BACKUP_VERSION,
  planImport,
  sanitizeRendererSettings,
  type BackupFile,
  type BackupImportResult,
  type BackupPart,
  type BackupSecrets,
  type ExistingData,
} from "../../shared/backupFormat";
import type { HistorySettings } from "../../shared/historyFilter";
import type { HostRecord, TunnelRecord, WorkspaceRecord } from "../../shared/types";
import type { TranscriptSettings } from "../../shared/transcripts";

/** Where backup reads and writes the app's data, so the logic can run against memory in tests. */
export interface BackupDeps {
  data(): ExistingData;
  save(data: ExistingData): void;
  settings(): {
    historySettings: HistorySettings;
    transcriptSettings: TranscriptSettings;
    commandBlocksEnabled: boolean;
    updateCheckEnabled: boolean;
  };
  applySettings(main: NonNullable<BackupFile["settings"]>["main"]): void;
  readSecret(secretId: string | null): string | null;
  saveSecret(plaintext: string): string;
  newId(): string;
  now(): number;
}

export interface ExportOptions {
  parts: readonly BackupPart[];
  /** Include saved passwords and key passphrases, sealed with this passphrase. */
  passphrase?: string;
  /** The window's own preferences, which only the renderer can read. */
  rendererSettings?: Record<string, string>;
}

export function createBackup(deps: BackupDeps) {
  return {
    build(options: ExportOptions): BackupFile {
      const parts = new Set(options.parts);
      const data = deps.data();

      let secrets: BackupSecrets | undefined;
      if (options.passphrase !== undefined) {
        if (options.passphrase.length < MIN_PASSWORD_LENGTH)
          throw new Error(`The backup passphrase must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        const { config, key } = createConfig(options.passphrase);
        const items: Record<string, string> = {};
        for (const host of data.hosts) {
          if (host.authMethod === "agent" || !host.secretId) continue;
          const plaintext = deps.readSecret(host.secretId); // throws while the master password is locked
          if (plaintext) items[host.id] = seal(key, plaintext);
        }
        secrets = { salt: config.salt, cost: config.cost, check: config.check, items };
      }

      const file: BackupFile = {
        app: "wharf",
        version: BACKUP_VERSION,
        exportedAt: new Date(deps.now()).toISOString(),
        groups: data.groups.map((g) => ({ id: g.id, name: g.name, parentId: g.parentId, color: g.color })),
        hosts: data.hosts.map((h) => ({
          id: h.id,
          name: h.name,
          hostname: h.hostname,
          port: h.port,
          username: h.username,
          groupId: h.groupId,
          authMethod: h.authMethod,
          privateKeyPath: h.privateKeyPath,
          color: h.color,
          tags: h.tags,
          jumpHostId: h.jumpHostId ?? null,
          ...(h.mosh ? { mosh: true } : {}),
          ...(h.pinned ? { pinned: true } : {}),
        })),
        tunnels: parts.has("tunnels")
          ? data.tunnels.map(({ hostId, name, type, srcHost, srcPort, dstHost, dstPort, autoStart }) => ({
              hostId,
              name,
              type,
              srcHost,
              srcPort,
              dstHost,
              dstPort,
              ...(autoStart ? { autoStart: true } : {}),
            }))
          : [],
        snippets: parts.has("snippets")
          ? data.snippets.map((s) => ({ name: s.name, command: s.command, ...(s.run ? { run: true } : {}) }))
          : [],
        workspaces: parts.has("workspaces")
          ? data.workspaces.map((w) => ({ name: w.name, tabs: w.tabs.map((t) => ({ layout: stripScrollback(t.layout) })) }))
          : [],
      };
      if (parts.has("settings")) file.settings = { main: deps.settings(), renderer: sanitizeRendererSettings(options.rendererSettings) };
      if (secrets) file.secrets = secrets;
      return file;
    },

    /** Merges `file` into the app. Throws before changing anything when the passphrase is needed and missing or wrong. */
    apply(file: BackupFile, parts: ReadonlySet<BackupPart>, passphrase?: string, skipSecrets = false): BackupImportResult {
      if (skipSecrets) file = { ...file, secrets: undefined };
      const existing = deps.data();
      const plan = planImport(file, existing, parts, deps.newId, deps.now());

      // Secrets first: a wrong passphrase, or a locked master password, must stop the import before any record is written.
      const secretIds = new Map<string, string>(); // new host id → saved secret id
      let secrets = 0;
      if (plan.secretTargets.length > 0 && file.secrets) {
        if (!passphrase) throw new Error("This backup contains saved passwords. Enter the passphrase it was exported with.");
        const key = keyFor(passphrase, { salt: file.secrets.salt, cost: file.secrets.cost, check: file.secrets.check });
        if (!key) throw new Error("Wrong backup passphrase.");
        for (const { hostId, backupId } of plan.secretTargets) {
          try {
            secretIds.set(hostId, deps.saveSecret(open(key, file.secrets.items[backupId])));
            secrets++;
          } catch (err) {
            if (err instanceof Error && /locked/i.test(err.message)) throw err; // a locked master password affects all of them
            // one damaged entry: that host just comes in without its password
          }
        }
      }

      const hosts: HostRecord[] = plan.hosts.map((h) => (secretIds.has(h.id) ? { ...h, secretId: secretIds.get(h.id)! } : h));
      const tunnels: TunnelRecord[] = plan.tunnels.map((t) => ({ id: deps.newId(), ...t }));
      deps.save({
        groups: [...existing.groups, ...plan.groups],
        hosts: [...existing.hosts, ...hosts],
        tunnels: [...existing.tunnels, ...tunnels],
        snippets: [...existing.snippets, ...plan.snippets],
        workspaces: [...existing.workspaces, ...plan.workspaces],
      });

      let settingsApplied = false;
      if (parts.has("settings") && file.settings) {
        deps.applySettings(file.settings.main);
        settingsApplied = true;
      }

      return {
        added: {
          groups: plan.groups.length,
          hosts: hosts.length,
          tunnels: tunnels.length,
          snippets: plan.snippets.length,
          workspaces: plan.workspaces.length,
        },
        skipped: plan.skipped,
        invalid: plan.invalid,
        secrets,
        settingsApplied,
        ...(settingsApplied && file.settings && Object.keys(file.settings.renderer).length > 0
          ? { rendererSettings: file.settings.renderer }
          : {}),
      };
    },
  };
}

function stripScrollback<T extends WorkspaceRecord["tabs"][number]["layout"]>(node: T): T {
  if (node.type === "leaf") return { type: "leaf", hostId: node.hostId } as T;
  return { ...node, children: node.children.map(stripScrollback) } as T;
}
