/**
 * Fish/zsh-autosuggestions-style inline "ghost text" — as you type, the end
 * of the most recent matching command from history is shown dimmed right
 * after the cursor; Right Arrow or End accepts it. Pure history-prefix
 * matching, no AI involved (instant, free, works offline).
 *
 * The same decoration also covers Warp's "next command" prediction: at an
 * *empty* prompt (nothing typed yet), the most common command that's
 * historically followed whatever you just ran is shown ghosted in full —
 * same accept key, same free/local/offline matching, just keyed by the
 * previous command instead of a typed prefix. See GhostTransitionMap below.
 * This half needs a reliable "the shell is actually sitting at an
 * interactive prompt right now, not mid-output" signal that only OSC 133
 * shell integration provides (Terminal.tsx's atPromptRef) — prefix matching
 * doesn't need that signal since it only ever runs once the user has
 * already typed something, which is itself proof the shell was ready.
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

// ---------------------------------------------------------------------------
// "Next command" prediction — what usually gets run right after this one.
// ---------------------------------------------------------------------------

/** previous command -> (next command -> how many times it's followed it). */
export type GhostTransitionMap = Map<string, Map<string, number>>;

function addTransition(map: GhostTransitionMap, from: string, to: string): void {
  if (from === to) return; // re-running the same command isn't a "next step" worth predicting
  let counts = map.get(from);
  if (!counts) {
    counts = new Map();
    map.set(from, counts);
  }
  counts.set(to, (counts.get(to) ?? 0) + 1);
}

/** Builds the transition map from a chronological (oldest-first) command
 * list — same list shape commandHistory's raw entries already come in. */
export function createGhostTransitionMap(commandsOldestFirst: string[]): GhostTransitionMap {
  const map: GhostTransitionMap = new Map();
  for (let i = 0; i < commandsOldestFirst.length - 1; i++) {
    addTransition(map, commandsOldestFirst[i], commandsOldestFirst[i + 1]);
  }
  return map;
}

/** Records one more real transition (mutates in place) as commands run live,
 * same as pushToGhostHistoryCache does for the prefix-match cache. A null
 * `from` (nothing's run yet this session) is a no-op — there's no prior
 * command to key a transition off of. */
export function recordGhostTransition(map: GhostTransitionMap, from: string | null, to: string): void {
  if (from) addTransition(map, from, to);
}

/** The most common command historically run right after `lastCommand`, or
 * null if there isn't one (including when `lastCommand` itself is null —
 * nothing's run yet this session to predict from). Ties keep whichever was
 * seen first, which is fine: this is a "probably useful" nudge, not a
 * precise ranking. */
export function findNextCommandSuggestion(lastCommand: string | null, map: GhostTransitionMap): string | null {
  if (!lastCommand) return null;
  const counts = map.get(lastCommand);
  if (!counts) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [command, count] of counts) {
    if (count > bestCount) {
      best = command;
      bestCount = count;
    }
  }
  return best;
}
