import { describe, expect, it } from "vitest";
import type { GroupRecord, HostRecord } from "@shared/types";
import { buildSections, greeting, hostGlyph, hostMatches } from "./homeModel";

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
