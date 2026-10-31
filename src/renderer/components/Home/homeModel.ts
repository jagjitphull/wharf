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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "2 h ago", "yesterday", "3 d ago", then the date. */
export function formatLastConnected(at: number, now: number): string {
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
  if (ago < 2 * DAY) return "yesterday";
  if (ago < 14 * DAY) return `${Math.floor(ago / DAY)} d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The line under Home's greeting: "7 hosts · 2 connected · last connected 3 h ago". */
export function homeSummary(hosts: HostRecord[], connectedCount: number, now: number): string {
  if (hosts.length === 0) return "No hosts yet";
  const parts = [
    `${hosts.length} host${hosts.length === 1 ? "" : "s"}`,
    connectedCount > 0 ? `${connectedCount} connected` : "none connected",
  ];
  const last = Math.max(0, ...hosts.map((h) => h.lastConnectedAt ?? 0));
  if (last > 0) parts.push(`last connected ${formatLastConnected(last, now)}`);
  return parts.join(" · ");
}

/** How many hosts Home's Recent row shows. */
export const RECENT_COUNT = 4;

export interface HomeSection {
  id: string;
  title: string;
  hosts: HostRecord[];
  /** Hosts of this group that are shown under Pinned instead; the section stays (as a drop target) even if nothing else is left. */
  pinnedAbove?: number;
}

/** "all" shows everything, "connected" only hosts with an open session, otherwise a group id. */
export type HomeFilter = "all" | "connected" | string;

/**
 * The Home screen's sections, when showing everything: pinned hosts first, then
 * hosts connected right now, then the most recently connected ones (when not
 * searching), then one section per group in the groups' own order, then
 * whatever has no group. Empty sections are dropped. A pinned host is shown
 * once, under Pinned — not repeated under Connected now, Recent or its group
 * (the group's section says how many are pinned above). A host that is
 * connected or recent but not pinned also stays in its group.
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
  const pinnedIds = new Set<string>();
  if (filter === "all" && !query.trim()) {
    const pinned = visible.filter((h) => h.pinned).sort(byName);
    for (const h of pinned) pinnedIds.add(h.id);
    if (pinned.length) sections.push({ id: "pinned", title: "Pinned", hosts: pinned });
  }
  if (filter === "all") {
    const live = visible.filter((h) => connectedHostIds.has(h.id) && !pinnedIds.has(h.id)).sort(byName);
    if (live.length) sections.push({ id: "connected", title: "Connected now", hosts: live });
  }
  if (filter === "all" && !query.trim()) {
    const recent = visible
      .filter((h) => (h.lastConnectedAt ?? 0) > 0 && !connectedHostIds.has(h.id) && !pinnedIds.has(h.id))
      .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
      .slice(0, RECENT_COUNT);
    if (recent.length) sections.push({ id: "recent", title: "Recent", hosts: recent });
  }
  for (const g of groups) {
    if (filter !== "all" && filter !== g.id) continue;
    const inGroup = visible.filter((h) => h.groupId === g.id).sort(byName);
    const list = inGroup.filter((h) => !pinnedIds.has(h.id));
    const pinnedAbove = inGroup.length - list.length;
    if (list.length || pinnedAbove) sections.push({ id: g.id, title: g.name, hosts: list, ...(pinnedAbove ? { pinnedAbove } : {}) });
  }
  if (filter === "all") {
    const known = new Set(groups.map((g) => g.id));
    const ungrouped = visible.filter((h) => !h.groupId || !known.has(h.groupId)).sort(byName);
    const rest = ungrouped.filter((h) => !pinnedIds.has(h.id));
    const pinnedAbove = ungrouped.length - rest.length;
    if (rest.length || pinnedAbove)
      sections.push({
        id: "ungrouped",
        title: groups.length ? "Ungrouped" : "All hosts",
        hosts: rest,
        ...(pinnedAbove ? { pinnedAbove } : {}),
      });
  }
  return sections;
}

/** The section ids a host can be dropped on to move it: real groups, and the ungrouped list. Pinned, Connected now and Recent are views, not places. */
export function isDropSection(sectionId: string): boolean {
  return sectionId !== "pinned" && sectionId !== "connected" && sectionId !== "recent";
}

/** The group id to move a host to when it is dropped on a section: null for the ungrouped list. */
export function sectionGroupId(sectionId: string): string | null {
  return sectionId === "ungrouped" ? null : sectionId;
}
