import type { GroupRecord, HostRecord } from "@shared/types";

export function greeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Two letters for a host's tile: initials of its words, or its first two characters. */
export function hostGlyph(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function hostMatches(host: HostRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${host.name} ${host.username} ${host.hostname} ${(host.tags ?? []).join(" ")}`.toLowerCase().includes(q);
}

export interface HomeSection {
  id: string;
  title: string;
  hosts: HostRecord[];
}

/** "all" shows everything, "connected" only hosts with an open session, otherwise a group id. */
export type HomeFilter = "all" | "connected" | string;

/**
 * The Home screen's sections: hosts that are connected right now first (when
 * showing everything), then one section per group in the groups' own order,
 * then whatever has no group. Empty sections are dropped.
 */
export function buildSections(
  hosts: HostRecord[],
  groups: GroupRecord[],
  opts: { query: string; filter: HomeFilter; connectedHostIds: ReadonlySet<string> },
): HomeSection[] {
  const { query, filter, connectedHostIds } = opts;
  const visible = hosts.filter((h) => hostMatches(h, query));
  const byName = (a: HostRecord, b: HostRecord) => a.name.localeCompare(b.name);

  if (filter === "connected") {
    const list = visible.filter((h) => connectedHostIds.has(h.id)).sort(byName);
    return list.length ? [{ id: "connected", title: "Connected", hosts: list }] : [];
  }

  const sections: HomeSection[] = [];
  if (filter === "all") {
    const live = visible.filter((h) => connectedHostIds.has(h.id)).sort(byName);
    if (live.length) sections.push({ id: "connected", title: "Connected now", hosts: live });
  }
  for (const g of groups) {
    if (filter !== "all" && filter !== g.id) continue;
    const list = visible.filter((h) => h.groupId === g.id).sort(byName);
    if (list.length) sections.push({ id: g.id, title: g.name, hosts: list });
  }
  if (filter === "all") {
    const known = new Set(groups.map((g) => g.id));
    const rest = visible.filter((h) => !h.groupId || !known.has(h.groupId)).sort(byName);
    if (rest.length) sections.push({ id: "ungrouped", title: groups.length ? "Ungrouped" : "All hosts", hosts: rest });
  }
  return sections;
}
