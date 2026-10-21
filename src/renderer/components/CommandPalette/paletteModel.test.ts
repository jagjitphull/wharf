import { describe, expect, it } from "vitest";
import type { HostRecord, SnippetRecord } from "@shared/types";
import { buildSections, flatten, MAX_SNIPPET_RESULTS, rankActions, rankSnippets, scoreText, type PaletteAction } from "./paletteModel";

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

const snip = (name: string, command: string): SnippetRecord => ({ id: name, name, command, createdAt: 0, updatedAt: 0 });
const snippets = [
  snip("Restart nginx", "sudo systemctl restart nginx"),
  snip("Tail app logs", "docker logs -f {{container}}"),
  snip("Disk usage", "df -h"),
];

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

describe("rankSnippets", () => {
  it("offers nothing for an empty query", () => {
    expect(rankSnippets(snippets, "")).toEqual([]);
    expect(rankSnippets(snippets, "   ")).toEqual([]);
  });

  it("matches the name or the command text, name first", () => {
    expect(rankSnippets(snippets, "nginx").map((s) => s.name)).toEqual(["Restart nginx"]);
    expect(rankSnippets(snippets, "docker").map((s) => s.name)).toEqual(["Tail app logs"]);
    const both = [snip("logs", "echo hi"), snip("other", "tail logs")];
    expect(rankSnippets(both, "logs").map((s) => s.name)).toEqual(["logs", "other"]);
  });

  it("needs every word to match", () => {
    expect(rankSnippets(snippets, "restart zzz")).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => snip(`deploy ${i}`, "x"));
    expect(rankSnippets(many, "deploy")).toHaveLength(MAX_SNIPPET_RESULTS);
  });
});

describe("buildSections with snippets", () => {
  it("puts matching snippets between actions and hosts", () => {
    const sections = buildSections([act("logs", "Show logs")], [host("logserver")], "log", snippets);
    expect(sections.map((s) => s.title)).toEqual(["Actions", "Snippets", "Hosts"]);
    expect(flatten(sections).map((e) => e.type)).toEqual(["action", "snippet", "host"]);
  });

  it("shows no snippets for an empty query or an actions-only query", () => {
    expect(buildSections(actions, [], "", snippets).map((s) => s.title)).toEqual(["Actions"]);
    expect(buildSections(actions, [], ">restart", snippets).map((s) => s.title)).not.toContain("Snippets");
  });
});
