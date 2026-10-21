/** `text` split into runs, with every case-insensitive occurrence of `needle` flagged — for <mark>ing a search term. */
export function highlightRuns(text: string, needle: string): { text: string; hit: boolean }[] {
  const q = needle.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const runs: { text: string; hit: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) runs.push({ text: text.slice(from, at), hit: false });
    runs.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
  }
  if (from < text.length) runs.push({ text: text.slice(from), hit: false });
  return runs.length > 0 ? runs : [{ text, hit: false }];
}
