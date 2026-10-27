import { describe, expect, it } from "vitest";
import type { GroupRecord, HostRecord } from "@shared/types";
import { buildSections, formatLastConnected, greeting, hostGlyph, hostMatches } from "./homeModel";

const host = (id: string, name: string, groupId: string | null, extra: Partial<HostRecord> = {}): HostRecord => ({
  id,
  name,
  hostname: `${name}.example`,
  port: 22,
  username: "admin",
  groupId,
  authMethod: "agent",
  secretId: null,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
const group = (id: string, name: string) => ({ id, name }) as GroupRecord;

const hosts = [
  host("1", "web-02", "p"),
  host("2", "web-01", "p", { tags: ["nginx"] }),
  host("3", "rocky-lab", "l"),
  host("4", "router", null),
];
const groups = [group("p", "Production"), group("l", "Lab")];
const none = new Set<string>();

describe("greeting", () => {
  it("follows the hour", () => {
    expect(greeting(3)).toBe("Working late");
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
  });
});

describe("hostGlyph", () => {
  it("uses word initials, else the first two letters", () => {
    expect(hostGlyph("web-01")).toBe("W0");
    expect(hostGlyph("db_primary")).toBe("DP");
    expect(hostGlyph("router")).toBe("RO");
    expect(hostGlyph("")).toBe("?");
  });
});

describe("hostMatches", () => {
  it("matches name, address, user and tags, case-insensitively", () => {
    expect(hostMatches(hosts[1], "NGINX")).toBe(true);
    expect(hostMatches(hosts[1], "web-01.example")).toBe(true);
    expect(hostMatches(hosts[1], "admin")).toBe(true);
    expect(hostMatches(hosts[1], "postgres")).toBe(false);
    expect(hostMatches(hosts[1], "  ")).toBe(true);
  });
});

describe("buildSections", () => {
  it("groups in group order, sorted by name, ungrouped last", () => {
    const s = buildSections(hosts, groups, { query: "", filter: "all", connectedHostIds: none });
    expect(s.map((x) => [x.title, x.hosts.map((h) => h.name)])).toEqual([
      ["Production", ["web-01", "web-02"]],
      ["Lab", ["rocky-lab"]],
      ["Ungrouped", ["router"]],
    ]);
  });

  it("puts connected hosts first, and they stay in their group too", () => {
    const s = buildSections(hosts, groups, { query: "", filter: "all", connectedHostIds: new Set(["3"]) });
    expect(s[0]).toMatchObject({ title: "Connected now" });
    expect(s[0].hosts.map((h) => h.name)).toEqual(["rocky-lab"]);
    expect(s.map((x) => x.title)).toContain("Lab");
  });

  it("filters by group, by connected, and by search", () => {
    expect(buildSections(hosts, groups, { query: "", filter: "l", connectedHostIds: none }).map((x) => x.title)).toEqual(["Lab"]);
    expect(buildSections(hosts, groups, { query: "", filter: "connected", connectedHostIds: none })).toEqual([]);
    expect(buildSections(hosts, groups, { query: "", filter: "connected", connectedHostIds: new Set(["4"]) })[0].hosts[0].name).toBe(
      "router",
    );
    const q = buildSections(hosts, groups, { query: "web", filter: "all", connectedHostIds: none });
    expect(q.map((x) => x.title)).toEqual(["Production"]);
  });

  it("calls the only section 'All hosts' when there are no groups", () => {
    const s = buildSections(hosts, [], { query: "", filter: "all", connectedHostIds: none });
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe("All hosts");
    expect(s[0].hosts).toHaveLength(4);
  });

  it("treats a host whose group is gone as ungrouped", () => {
    const s = buildSections([host("9", "orphan", "gone")], groups, { query: "", filter: "all", connectedHostIds: none });
    expect(s[0].hosts[0].name).toBe("orphan");
  });
});

describe("formatLastConnected", () => {
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  const ago = (ms: number) => formatLastConnected(now - ms, now);
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [60_000, "1 min ago"],
    [59 * 60_000, "59 min ago"],
    [60 * 60_000, "1 h ago"],
    [23 * 3_600_000, "23 h ago"],
    [24 * 3_600_000, "yesterday"],
    [47 * 3_600_000, "yesterday"],
    [48 * 3_600_000, "2 d ago"],
    [13 * 86_400_000, "13 d ago"],
  ])("%d ms ago -> %s", (ms, text) => expect(ago(ms)).toBe(text));
  it("falls back to the date after two weeks", () => {
    expect(ago(30 * 86_400_000)).toMatch(/\d/);
    expect(ago(30 * 86_400_000)).not.toMatch(/ago/);
  });
  it("treats a clock that ran backwards as just now", () => {
    expect(formatLastConnected(now + 5000, now)).toBe("just now");
  });
});

describe("the Recent section", () => {
  const withTimes = [
    host("1", "web-02", "p", { lastConnectedAt: 300 }),
    host("2", "web-01", "p", { lastConnectedAt: 500 }),
    host("3", "rocky-lab", "l", { lastConnectedAt: 100 }),
    host("4", "router", null),
  ];
  it("lists the most recently connected first, ahead of the groups", () => {
    const s = buildSections(withTimes, groups, { query: "", filter: "all", connectedHostIds: none });
    expect(s[0]).toMatchObject({ id: "recent", title: "Recent" });
    expect(s[0].hosts.map((h) => h.name)).toEqual(["web-01", "web-02", "rocky-lab"]);
    expect(s.map((x) => x.title)).toEqual(["Recent", "Production", "Lab", "Ungrouped"]);
  });
  it("keeps a host in its group too", () => {
    const s = buildSections(withTimes, groups, { query: "", filter: "all", connectedHostIds: none });
    expect(s.find((x) => x.title === "Production")?.hosts.map((h) => h.name)).toEqual(["web-01", "web-02"]);
  });
  it("shows at most four", () => {
    const many = Array.from({ length: 7 }, (_, i) => host(String(i), `h${i}`, null, { lastConnectedAt: i + 1 }));
    const s = buildSections(many, [], { query: "", filter: "all", connectedHostIds: none });
    expect(s[0].hosts.map((h) => h.name)).toEqual(["h6", "h5", "h4", "h3"]);
  });
  it("leaves out hosts that are connected right now (they have their own section)", () => {
    const s = buildSections(withTimes, groups, { query: "", filter: "all", connectedHostIds: new Set(["2"]) });
    expect(s.map((x) => x.title).slice(0, 2)).toEqual(["Connected now", "Recent"]);
    expect(s[1].hosts.map((h) => h.name)).toEqual(["web-02", "rocky-lab"]);
  });
  it("is hidden while searching, or when filtering to a group", () => {
    expect(buildSections(withTimes, groups, { query: "web", filter: "all", connectedHostIds: none }).map((x) => x.title)).toEqual([
      "Production",
    ]);
    expect(buildSections(withTimes, groups, { query: "", filter: "p", connectedHostIds: none }).map((x) => x.title)).toEqual([
      "Production",
    ]);
  });
  it("is absent when nothing has ever connected", () => {
    expect(buildSections(hosts, groups, { query: "", filter: "all", connectedHostIds: none }).some((x) => x.id === "recent")).toBe(false);
  });
});
