import type { HostRecord, SnippetRecord } from "@shared/types";

export interface PaletteAction {
  id: string;
  title: string;
  /** One line under the title saying what it does. */
  subtitle?: string;
  /** Shortcut hint shown on the right, e.g. "Ctrl K". */
  keys?: string;
  /** Extra words that should find this action but aren't shown. */
  keywords?: string;
  /** Shown when the box is empty (the rest appear once you type). */
  featured?: boolean;
  run(): void;
}

export type PaletteEntry =
  { type: "action"; action: PaletteAction } | { type: "snippet"; snippet: SnippetRecord } | { type: "host"; host: HostRecord };

/** Snippets offered at once; the rest need a more specific query. */
export const MAX_SNIPPET_RESULTS = 6;

export interface PaletteSection {
  title: string;
  entries: PaletteEntry[];
}

const terms = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * How well `query` matches `text`: 0 for no match, otherwise higher is better.
 * Every word of the query must appear; a word scores most when the text starts
 * with it, then when it starts a word, then anywhere.
 */
export function scoreText(text: string, query: string): number {
  const words = terms(query);
  if (words.length === 0) return 1;
  const hay = text.toLowerCase();
  let total = 0;
  for (const w of words) {
    if (hay.startsWith(w)) total += 3;
    else if (new RegExp(`(^|[\\s\\-_./@:])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hay)) total += 2;
    else if (hay.includes(w)) total += 1;
    else return 0;
  }
  return total;
}

export function rankActions(actions: PaletteAction[], query: string): PaletteAction[] {
  if (!query.trim()) return actions.filter((a) => a.featured);
  return actions
    .map((a) => ({
      a,
      score: Math.max(scoreText(a.title, query) * 2, scoreText(`${a.title} ${a.subtitle ?? ""} ${a.keywords ?? ""}`, query)),
    }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.title.length - y.a.title.length || x.a.title.localeCompare(y.a.title))
    .map((x) => x.a);
}

/** Snippets that match every word of `query` (name counts more than the command text); none for an empty query. */
export function rankSnippets(snippets: SnippetRecord[], query: string): SnippetRecord[] {
  if (!query.trim()) return [];
  return snippets
    .map((s) => ({ s, score: Math.max(scoreText(s.name, query) * 2, scoreText(`${s.name} ${s.command}`, query)) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.s.name.localeCompare(y.s.name))
    .slice(0, MAX_SNIPPET_RESULTS)
    .map((x) => x.s);
}

export function rankHosts(hosts: HostRecord[], query: string): HostRecord[] {
  return hosts
    .map((h) => ({
      h,
      score: scoreText(`${h.name} ${h.username} ${h.hostname} ${(h.tags ?? []).join(" ")}`, query) + (scoreText(h.name, query) > 0 ? 2 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.h.name.localeCompare(y.h.name))
    .map((x) => x.h);
}

/**
 * The palette's sections for a query. A leading ">" asks for actions only;
 * otherwise actions come first (a short featured list while the box is empty),
 * then matching snippets, then hosts.
 */
export function buildSections(
  actions: PaletteAction[],
  hosts: HostRecord[],
  rawQuery: string,
  snippets: SnippetRecord[] = [],
): PaletteSection[] {
  const actionsOnly = rawQuery.trimStart().startsWith(">");
  const query = actionsOnly ? rawQuery.trimStart().slice(1) : rawQuery;
  const sections: PaletteSection[] = [];

  const matchedActions = actionsOnly && !query.trim() ? actions : rankActions(actions, query);
  if (matchedActions.length) sections.push({ title: "Actions", entries: matchedActions.map((action) => ({ type: "action", action })) });
  if (!actionsOnly) {
    const matchedSnippets = rankSnippets(snippets, query);
    if (matchedSnippets.length)
      sections.push({ title: "Snippets", entries: matchedSnippets.map((snippet) => ({ type: "snippet", snippet })) });
    const matchedHosts = rankHosts(hosts, query);
    if (matchedHosts.length) sections.push({ title: "Hosts", entries: matchedHosts.map((host) => ({ type: "host", host })) });
  }
  return sections;
}

export const flatten = (sections: PaletteSection[]): PaletteEntry[] => sections.flatMap((s) => s.entries);
