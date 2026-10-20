import { describe, expect, it } from "vitest";
import type { HostRecord } from "@shared/types";
import { buildSections, flatten, rankActions, scoreText, type PaletteAction } from "./paletteModel";

const act = (id: string, title: string, extra: Partial<PaletteAction> = {}): PaletteAction => ({ id, title, run: () => {}, ...extra });
const host = (name: string, extra: Partial<HostRecord> = {}): HostRecord => ({
  id: name,
  name,
  hostname: `${name}.example`,
  port: 22,
  username: "admin",
  groupId: null,
  authMethod: "agent",
  secretId: null,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const actions = [
  act("rc", "Reconnect tab", { subtitle: "Starts a new session", featured: true, keywords: "restart" }),
  act("rca", "Reconnect all closed tabs"),
  act("dup", "Duplicate tab", { featured: true }),
  act("theme", "Toggle theme", { keywords: "dark light" }),
  act("home", "Go to Home", { featured: true }),
];

describe("scoreText", () => {
  it("is 0 unless every word matches", () => {
    expect(scoreText("Reconnect tab", "reco tab")).toBeGreaterThan(0);
    expect(scoreText("Reconnect tab", "reco zzz")).toBe(0);
  });
  it("prefers prefix over word-start over substring", () => {
    const prefix = scoreText("web-01", "web");
    const word = scoreText("my web-01", "web");
    const sub = scoreText("cobweb", "web");
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(0);
  });
  it("treats regex characters in the query literally", () => {
    expect(scoreText("a.b", ".")).toBeGreaterThan(0);
    expect(() => scoreText("abc", "(")).not.toThrow();
  });
});

describe("rankActions", () => {
  it("shows only featured actions for an empty query", () => {
    expect(rankActions(actions, "").map((a) => a.id)).toEqual(["rc", "dup", "home"]);
  });
  it("matches titles, subtitles and hidden keywords", () => {
    expect(rankActions(actions, "restart").map((a) => a.id)).toEqual(["rc"]);
    expect(rankActions(actions, "dark").map((a) => a.id)).toEqual(["theme"]);
    expect(rankActions(actions, "new session").map((a) => a.id)).toEqual(["rc"]);
  });
  it("ranks the closer title first", () => {
    expect(rankActions(actions, "reconnect").map((a) => a.id)).toEqual(["rc", "rca"]);
    expect(rankActions(actions, "tab").map((a) => a.id)).toContain("dup");
  });
});

describe("buildSections", () => {
  const hosts = [host("web-01", { tags: ["nginx"] }), host("db-primary"), host("web-02")];
  it("empty query: featured actions then every host", () => {
    const s = buildSections(actions, hosts, "");
    expect(s.map((x) => x.title)).toEqual(["Actions", "Hosts"]);
    expect(s[1].entries).toHaveLength(3);
  });
  it("finds hosts by tag and drops empty sections", () => {
    const s = buildSections(actions, hosts, "nginx");
    expect(s.map((x) => x.title)).toEqual(["Hosts"]);
    expect(flatten(s)).toHaveLength(1);
  });
  it("a leading > means actions only, and lists them all when bare", () => {
    expect(buildSections(actions, hosts, ">").map((x) => [x.title, x.entries.length])).toEqual([["Actions", 5]]);
    expect(buildSections(actions, hosts, "> web")).toEqual([]);
    expect(flatten(buildSections(actions, hosts, ">theme"))).toHaveLength(1);
  });
  it("sorts hosts by closeness, then name", () => {
    const names = flatten(buildSections([], hosts, "web")).map((e) => (e.type === "host" ? e.host.name : ""));
    expect(names).toEqual(["web-01", "web-02"]);
  });
});
