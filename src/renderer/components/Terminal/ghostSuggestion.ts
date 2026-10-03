/**
 * Fish/zsh-autosuggestions-style inline "ghost text" — as you type, the end
 * of the most recent matching command from history is shown dimmed right
 * after the cursor; Right Arrow or End accepts it. Pure history-prefix
 * matching, no AI involved (instant, free, works offline).
 *
 * Rendered via xterm.js's decoration API (registerDecoration), the same
 * marker-anchored overlay mechanism keywordHighlight.ts already uses for
 * highlight rules — xterm handles the pixel positioning and scroll-following
 * itself, and since it's a DOM overlay rather than real buffer content, it
 * can never race with or corrupt the shell's own echoed output.
 */

const MAX_HISTORY_CACHE = 500;

/** A small, deduped, most-recent-first cache of past command strings kept in
 * the renderer for instant (no-IPC) prefix matching on every keystroke. */
export type GhostHistoryCache = string[];

export function createGhostHistoryCache(commands: string[]): GhostHistoryCache {
  const cache: GhostHistoryCache = [];
  // `commands` is assumed oldest-first (as CommandHistoryEntry[] naturally
  // is) — walk it newest-first so the first occurrence of a repeated
  // command is its most recent run.
  for (let i = commands.length - 1; i >= 0; i--) {
    pushToGhostHistoryCache(cache, commands[i]);
  }
  return cache;
}

/** Adds a newly-run command to the front of the cache, de-duplicating (a
 * re-run moves to the front rather than appearing twice) and capping size —
 * mutates and returns the same array for convenience at call sites. */
export function pushToGhostHistoryCache(cache: GhostHistoryCache, command: string): GhostHistoryCache {
  const existing = cache.indexOf(command);
  if (existing !== -1) cache.splice(existing, 1);
  cache.unshift(command);
  if (cache.length > MAX_HISTORY_CACHE) cache.length = MAX_HISTORY_CACHE;
  return cache;
}

/** Returns the most recent history command that starts with `buffer` and has
 * more to it (nothing to suggest once buffer already equals the whole
 * command) — case-sensitive, matching normal shell/history conventions. */
export function findGhostSuggestion(buffer: string, cache: GhostHistoryCache): string | null {
  if (!buffer) return null;
  for (const command of cache) {
    if (command.length > buffer.length && command.startsWith(buffer)) return command;
  }
  return null;
}
