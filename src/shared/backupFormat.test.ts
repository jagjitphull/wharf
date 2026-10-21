import { describe, expect, it } from "vitest";
import { countBackup, parseBackup, planImport, type BackupFile, type BackupPart, type ExistingData } from "./backupFormat";

const host = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `host-${id}`,
  hostname: `${id}.example`,
  port: 22,
  username: "admin",
  groupId: null,
  authMethod: "agent",
  ...extra,
});

const base = (extra: Record<string, unknown> = {}) => ({ version: 2, exportedAt: "2026-01-01T00:00:00Z", groups: [], hosts: [], ...extra });
const empty: ExistingData = { groups: [], hosts: [], tunnels: [], snippets: [], workspaces: [] };
const ALL: ReadonlySet<BackupPart> = new Set(["tunnels", "snippets", "workspaces", "settings"]);
let counter = 0;
const newId = () => `new-${++counter}`;
const plan = (file: BackupFile, existing = empty, parts = ALL) => planImport(file, existing, parts, newId, 1000);

describe("parseBackup", () => {
  it("rejects things that aren't backups", () => {
    for (const bad of [null, "x", [], {}, { version: 3, groups: [], hosts: [] }, { version: 2, groups: {}, hosts: [] }]) {
      expect(() => parseBackup(bad)).toThrow(/Wharf backup/);
    }
  });

  it("reads the original hosts-and-groups format (version 1) too", () => {
    const { file, invalid } = parseBackup({
      version: 1,
      exportedAt: "x",
      groups: [{ id: "g", name: "Prod", parentId: null }],
      hosts: [host("a")],
    });
    expect(invalid).toBe(0);
    expect(file.hosts).toHaveLength(1);
    expect(file.tunnels).toEqual([]);
    expect(file.settings).toBeUndefined();
  });

  it("drops malformed entries and counts them", () => {
    const { file, invalid } = parseBackup(
      base({
        groups: [{ id: "g", name: "ok" }, { id: "g2", name: " " }, 7],
        hosts: [host("a"), host("b", { port: 70000 }), host("c", { authMethod: "magic" }), host("d", { hostname: "" }), "nope"],
        tunnels: [
          { hostId: "a", name: "t", type: "local", srcHost: "127.0.0.1", srcPort: 1, dstHost: "h", dstPort: 2 },
          { hostId: "a", name: "bad", type: "local", srcPort: 0 },
        ],
        snippets: [
          { name: "n", command: "c" },
          { name: "n", command: "  " },
        ],
        workspaces: [
          { name: "w", tabs: [] },
          { name: "", tabs: [] },
        ],
      }),
    );
    expect(countBackup(file)).toEqual({ groups: 1, hosts: 1, tunnels: 1, snippets: 1, workspaces: 1 });
    expect(invalid).toBe(2 + 4 + 1 + 1 + 1);
  });

  it("refuses an absurd number of entries", () => {
    expect(() => parseBackup(base({ hosts: new Array(10_001).fill(host("a")) }))).toThrow(/far more/);
  });

  it("keeps only a workspace's layout, never old terminal content", () => {
    const { file } = parseBackup(
      base({
        workspaces: [
          {
            name: "w",
            tabs: [
              {
                layout: {
                  type: "split",
                  direction: "row",
                  children: [{ type: "leaf", hostId: "a", scrollback: "SECRET OUTPUT" }, { type: "bogus" }],
                },
              },
              { layout: 5 },
            ],
          },
        ],
      }),
    );
    expect(JSON.stringify(file.workspaces)).not.toContain("SECRET");
    expect(file.workspaces[0].tabs).toEqual([{ layout: { type: "split", direction: "row", children: [{ type: "leaf", hostId: "a" }] } }]);
  });

  it("limits sealed-secret costs to what is safe to unlock", () => {
    const secrets = (cost: unknown) => ({ salt: "s", check: "mp:x", cost, items: { a: "mp:y", b: "plain-text-not-sealed" } });
    expect(parseBackup(base({ secrets: secrets(2 ** 17) })).file.secrets?.items).toEqual({ a: "mp:y" });
    for (const cost of [2 ** 20, 2 ** 9, 1000, "big", -1, 2 ** 17 + 1]) {
      expect(parseBackup(base({ secrets: secrets(cost) })).file.secrets).toBeUndefined();
    }
  });

  it("takes only safe settings: normalised main ones, and wharf-* window prefs without group ids or oversized values", () => {
    const { file } = parseBackup(
      base({
        settings: {
          main: {
            historySettings: { enabled: false, retentionDays: 99999 },
            aiProviderConfig: { ollama: { baseUrl: "http://attacker.example" } },
            autoLockMinutes: 0,
            commandBlocksEnabled: false,
            updateCheckEnabled: "yes",
          },
          renderer: {
            "wharf-theme-mode": "dark",
            "wharf-collapsed-groups": '["old-id"]',
            "other-app-key": "x",
            "wharf-huge": "x".repeat(70_000),
            "wharf-number": 5,
          },
        },
      }),
    );
    expect(file.settings?.main.historySettings?.retentionDays).not.toBe(99999);
    expect(file.settings?.main.commandBlocksEnabled).toBe(false);
    expect(file.settings?.main).not.toHaveProperty("aiProviderConfig");
    expect(file.settings?.main).not.toHaveProperty("autoLockMinutes");
    expect(file.settings?.main).not.toHaveProperty("updateCheckEnabled");
    expect(file.settings?.renderer).toEqual({ "wharf-theme-mode": "dark" });
  });
});

describe("planImport", () => {
  const file = parseBackup(
    base({
      groups: [
        { id: "child", name: "Web", parentId: "root" },
        { id: "root", name: "Prod", parentId: null },
      ],
      hosts: [host("a", { groupId: "child" }), host("b", { jumpHostId: "a", mosh: true })],
      tunnels: [{ hostId: "a", name: "db", type: "local", srcHost: "127.0.0.1", srcPort: 5432, dstHost: "127.0.0.1", dstPort: 5432 }],
      snippets: [{ name: "Disk", command: "df -h", run: true }],
      workspaces: [{ name: "Release", tabs: [{ layout: { type: "leaf", hostId: "b" } }] }],
      secrets: { salt: "s", cost: 2 ** 10, check: "mp:c", items: { a: "mp:1" } },
    }),
  ).file;

  it("creates everything with fresh ids and carries references across, whatever order they came in", () => {
    counter = 0;
    const p = plan(file);
    expect(p.groups.map((g) => g.name).sort()).toEqual(["Prod", "Web"]);
    const prod = p.groups.find((g) => g.name === "Prod")!;
    const web = p.groups.find((g) => g.name === "Web")!;
    expect(web.parentId).toBe(prod.id);
    const a = p.hosts.find((h) => h.name === "host-a")!;
    const b = p.hosts.find((h) => h.name === "host-b")!;
    expect(a.groupId).toBe(web.id);
    expect(b.jumpHostId).toBe(a.id);
    expect(b.mosh).toBe(true);
    expect(a.secretId).toBeNull();
    expect(p.tunnels[0].hostId).toBe(a.id);
    expect(p.workspaces[0].tabs[0].layout).toEqual({ type: "leaf", hostId: b.id });
    expect(p.snippets[0]).toMatchObject({ name: "Disk", run: true });
    expect(p.secretTargets).toEqual([{ hostId: a.id, backupId: "a" }]);
    expect(new Set([...p.groups, ...p.hosts, ...p.snippets, ...p.workspaces].map((r) => r.id)).size).toBe(6);
  });

  it("is idempotent: importing what is already there adds nothing", () => {
    counter = 0;
    const first = plan(file);
    const existing: ExistingData = {
      groups: first.groups,
      hosts: first.hosts,
      tunnels: first.tunnels.map((t, i) => ({ ...t, id: `t${i}` })),
      snippets: first.snippets,
      workspaces: first.workspaces,
    };
    const second = plan(file, existing);
    expect(second.groups).toEqual([]);
    expect(second.hosts).toEqual([]);
    expect(second.tunnels).toEqual([]);
    expect(second.snippets).toEqual([]);
    expect(second.workspaces).toEqual([]);
    expect(second.secretTargets).toEqual([]);
    expect(second.skipped).toBe(2 + 2 + 1 + 1 + 1);
  });

  it("points a tunnel or workspace at an existing host that matched", () => {
    const existingHost = {
      id: "mine",
      name: "other name",
      hostname: "A.example",
      port: 22,
      username: "ADMIN",
      groupId: null,
      authMethod: "agent" as const,
      secretId: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const p = plan(file, { ...empty, hosts: [existingHost] });
    expect(p.hosts.map((h) => h.name)).toEqual(["host-b"]); // host-a is the same user@host:port
    expect(p.tunnels[0].hostId).toBe("mine");
    expect(p.hosts[0].jumpHostId).toBe("mine");
    expect(p.secretTargets).toEqual([]); // the host that has a secret already exists: its own is kept
  });

  it("only takes the parts asked for", () => {
    const p = plan(file, empty, new Set<BackupPart>(["snippets"]));
    expect(p.hosts).toHaveLength(2);
    expect(p.snippets).toHaveLength(1);
    expect(p.tunnels).toEqual([]);
    expect(p.workspaces).toEqual([]);
  });

  it("drops a tunnel whose host isn't in the file, and survives a group cycle", () => {
    const odd = parseBackup(
      base({
        groups: [
          { id: "x", name: "X", parentId: "y" },
          { id: "y", name: "Y", parentId: "x" },
        ],
        hosts: [host("a")],
        tunnels: [{ hostId: "ghost", name: "t", type: "dynamic", srcHost: "127.0.0.1", srcPort: 1080 }],
      }),
    ).file;
    const p = plan(odd);
    expect(p.tunnels).toEqual([]);
    expect(p.invalid).toBe(1);
    expect(p.groups).toHaveLength(2); // created, with the cycle cut
  });
});
