import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { kdf } from "./masterKey";
import { createBackup, type BackupDeps } from "./backup";
import { parseBackup, type BackupPart, type ExistingData } from "../../shared/backupFormat";
import { DEFAULT_HISTORY_SETTINGS } from "../../shared/historyFilter";
import { DEFAULT_TRANSCRIPT_SETTINGS } from "../../shared/transcripts";
import type { HostRecord } from "../../shared/types";

beforeAll(() => {
  kdf.cost = 2 ** 10; // fast for tests
});

const ALL: BackupPart[] = ["tunnels", "snippets", "workspaces", "settings"];
const PASSPHRASE = "a long backup passphrase";

let data: ExistingData;
let secretsByHost: Record<string, string>; // secretId → plaintext
let savedSecrets: string[];
let locked: boolean;
let appliedSettings: unknown;
let ids: number;
let writes: number;

const host = (id: string, extra: Partial<HostRecord> = {}): HostRecord => ({
  id,
  name: `host-${id}`,
  hostname: `${id}.example`,
  port: 22,
  username: "admin",
  groupId: null,
  authMethod: "password",
  secretId: `secret-${id}`,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

function deps(): BackupDeps {
  return {
    data: () => structuredClone(data),
    save: (next) => {
      writes++;
      data = structuredClone(next);
    },
    settings: () => ({
      historySettings: DEFAULT_HISTORY_SETTINGS,
      transcriptSettings: DEFAULT_TRANSCRIPT_SETTINGS,
      commandBlocksEnabled: true,
      updateCheckEnabled: true,
    }),
    applySettings: (main) => {
      appliedSettings = main;
    },
    readSecret: (id) => {
      if (locked) throw new Error("Saved passwords are locked.");
      return id ? (secretsByHost[id] ?? null) : null;
    },
    saveSecret: (plaintext) => {
      if (locked) throw new Error("Saved passwords are locked.");
      const id = `saved-${savedSecrets.length}`;
      savedSecrets.push(plaintext);
      secretsByHost[id] = plaintext;
      return id;
    },
    newId: () => `id-${++ids}`,
    now: () => Date.UTC(2026, 0, 2),
  };
}

beforeEach(() => {
  ids = 0;
  writes = 0;
  locked = false;
  savedSecrets = [];
  appliedSettings = undefined;
  secretsByHost = { "secret-a": "hunter2-password", "secret-b": "key-passphrase" };
  data = {
    groups: [{ id: "g1", name: "Prod", parentId: null, createdAt: 1, updatedAt: 1 }],
    hosts: [
      host("a", { groupId: "g1", mosh: true }),
      host("b", { authMethod: "privateKey", privateKeyPath: "/k", jumpHostId: "a" }),
      host("c", { authMethod: "agent", secretId: null }),
    ],
    tunnels: [
      {
        id: "t1",
        hostId: "a",
        name: "db",
        type: "local",
        srcHost: "127.0.0.1",
        srcPort: 5432,
        dstHost: "10.0.0.2",
        dstPort: 5432,
        autoStart: true,
      },
    ],
    snippets: [{ id: "s1", name: "Disk", command: "df -h", run: true, createdAt: 1, updatedAt: 1 }],
    workspaces: [
      { id: "w1", name: "Release", createdAt: 1, tabs: [{ layout: { type: "leaf", hostId: "a", scrollback: "private output" } }] },
    ],
  };
});

describe("build", () => {
  it("never includes a password, passphrase or scrollback unless a passphrase seals it", () => {
    const file = createBackup(deps()).build({ parts: ALL });
    const text = JSON.stringify(file);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("key-passphrase");
    expect(text).not.toContain("private output");
    expect(text).not.toContain("secret-a"); // not even the id
    expect(file.secrets).toBeUndefined();
  });

  it("carries hosts (with Mosh and jump host), groups, tunnels, snippets and workspaces", () => {
    const file = createBackup(deps()).build({ parts: ALL });
    expect(file.hosts.find((h) => h.id === "a")).toMatchObject({ mosh: true, groupId: "g1" });
    expect(file.hosts.find((h) => h.id === "b")).toMatchObject({ jumpHostId: "a", privateKeyPath: "/k" });
    expect(file.tunnels[0]).toMatchObject({ srcPort: 5432, autoStart: true });
    expect(file.snippets[0]).toMatchObject({ name: "Disk", run: true });
    expect(file.workspaces[0].tabs[0].layout).toEqual({ type: "leaf", hostId: "a" });
    expect(file.settings?.main.commandBlocksEnabled).toBe(true);
  });

  it("leaves out the parts that weren't chosen", () => {
    const file = createBackup(deps()).build({ parts: ["snippets"] });
    expect(file.snippets).toHaveLength(1);
    expect(file.tunnels).toEqual([]);
    expect(file.workspaces).toEqual([]);
    expect(file.settings).toBeUndefined();
    expect(file.hosts).toHaveLength(3); // hosts and groups are always in
  });

  it("seals secrets with the passphrase: the file holds only ciphertext", () => {
    const file = createBackup(deps()).build({ parts: [], passphrase: PASSPHRASE });
    expect(Object.keys(file.secrets!.items).sort()).toEqual(["a", "b"]); // the agent host has none
    const text = JSON.stringify(file);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("key-passphrase");
    expect(text).not.toContain(PASSPHRASE);
  });

  it("refuses a short passphrase, and stops when the master password is locked", () => {
    expect(() => createBackup(deps()).build({ parts: [], passphrase: "short" })).toThrow(/at least 8/);
    locked = true;
    expect(() => createBackup(deps()).build({ parts: [], passphrase: PASSPHRASE })).toThrow(/locked/);
  });

  it("keeps only wharf-* window preferences", () => {
    const file = createBackup(deps()).build({
      parts: ["settings"],
      rendererSettings: { "wharf-theme-mode": "dark", other: "x", "wharf-collapsed-groups": "[]" },
    });
    expect(file.settings?.renderer).toEqual({ "wharf-theme-mode": "dark" });
  });
});

describe("apply", () => {
  const roundTrip = (options: Parameters<ReturnType<typeof createBackup>["build"]>[0]) =>
    parseBackup(JSON.parse(JSON.stringify(createBackup(deps()).build(options)))).file;

  it("restores everything on a clean install, including the passwords, under new ids", () => {
    const file = roundTrip({ parts: ALL, passphrase: PASSPHRASE, rendererSettings: { "wharf-theme-mode": "light" } });
    const source = structuredClone(data);
    data = { groups: [], hosts: [], tunnels: [], snippets: [], workspaces: [] };
    secretsByHost = {};
    const result = createBackup(deps()).apply(file, new Set(ALL), PASSPHRASE);
    expect(result).toMatchObject({
      added: { groups: 1, hosts: 3, tunnels: 1, snippets: 1, workspaces: 1 },
      skipped: 0,
      invalid: 0,
      secrets: 2,
      settingsApplied: true,
    });
    expect(result.rendererSettings).toEqual({ "wharf-theme-mode": "light" });
    expect(data.hosts.map((h) => h.id)).not.toContain("a");
    const a = data.hosts.find((h) => h.name === "host-a")!;
    const b = data.hosts.find((h) => h.name === "host-b")!;
    expect(secretsByHost[a.secretId!]).toBe("hunter2-password");
    expect(secretsByHost[b.secretId!]).toBe("key-passphrase");
    expect(data.hosts.find((h) => h.name === "host-c")!.secretId).toBeNull();
    expect(b.jumpHostId).toBe(a.id);
    expect(a.groupId).toBe(data.groups[0].id);
    expect(data.tunnels[0]).toMatchObject({ hostId: a.id, srcPort: 5432, autoStart: true });
    expect(data.workspaces[0].tabs[0].layout).toEqual({ type: "leaf", hostId: a.id });
    expect(data.snippets[0]).toMatchObject({ name: "Disk", run: true });
    expect(source.hosts).toHaveLength(3);
    expect(appliedSettings).toBeDefined();
  });

  it("changes nothing when the same backup is imported again", () => {
    const file = roundTrip({ parts: ALL });
    const before = structuredClone(data);
    const result = createBackup(deps()).apply(file, new Set(ALL));
    expect(result.added).toEqual({ groups: 0, hosts: 0, tunnels: 0, snippets: 0, workspaces: 0 });
    expect(result.skipped).toBeGreaterThan(0);
    expect(data).toEqual(before);
  });

  it("needs the passphrase, and a wrong one writes nothing", () => {
    const file = roundTrip({ parts: ALL, passphrase: PASSPHRASE });
    data = { groups: [], hosts: [], tunnels: [], snippets: [], workspaces: [] };
    expect(() => createBackup(deps()).apply(file, new Set(ALL))).toThrow(/passphrase/);
    expect(() => createBackup(deps()).apply(file, new Set(ALL), "not the passphrase")).toThrow(/Wrong backup passphrase/);
    expect(writes).toBe(0);
    expect(data.hosts).toEqual([]);
    expect(savedSecrets).toEqual([]);
  });

  it("imports without secrets when the file has none, and doesn't ask for a passphrase", () => {
    const file = roundTrip({ parts: ALL });
    data = { groups: [], hosts: [], tunnels: [], snippets: [], workspaces: [] };
    const result = createBackup(deps()).apply(file, new Set(ALL));
    expect(result.secrets).toBe(0);
    expect(data.hosts.every((h) => h.secretId === null)).toBe(true);
  });

  it("stops before writing anything when the master password is locked", () => {
    const file = roundTrip({ parts: ALL, passphrase: PASSPHRASE });
    data = { groups: [], hosts: [], tunnels: [], snippets: [], workspaces: [] };
    locked = true;
    expect(() => createBackup(deps()).apply(file, new Set(ALL), PASSPHRASE)).toThrow(/locked/);
    expect(writes).toBe(0);
  });

  it("applies settings only when asked", () => {
    const file = roundTrip({ parts: ALL });
    createBackup(deps()).apply(file, new Set<BackupPart>(["snippets"]));
    expect(appliedSettings).toBeUndefined();
    const result = createBackup(deps()).apply(file, new Set<BackupPart>(["settings"]));
    expect(result.settingsApplied).toBe(true);
  });

  it("a damaged sealed entry leaves that host without its password; the others are restored", () => {
    const file = roundTrip({ parts: [], passphrase: PASSPHRASE });
    file.secrets!.items.a = "mp:AAAA";
    data = { groups: [], hosts: [], tunnels: [], snippets: [], workspaces: [] };
    const result = createBackup(deps()).apply(file, new Set(), PASSPHRASE);
    expect(result.secrets).toBe(1);
    expect(data.hosts.find((h) => h.name === "host-a")!.secretId).toBeNull();
    expect(secretsByHost[data.hosts.find((h) => h.name === "host-b")!.secretId!]).toBe("key-passphrase");
  });
});
