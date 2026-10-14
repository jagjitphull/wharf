/**
 * A live terminal's serialized content (see @xterm/addon-serialize) lives in
 * the xterm instance itself, inside Terminal.tsx's component tree — the
 * zustand store that persists the "last session" snapshot has no access to
 * that DOM/xterm layer and shouldn't need one. This is the narrow bridge
 * between them: each mounted TerminalView registers a getter for its own
 * current serialized content, keyed by sessionId; the store's persist logic
 * calls it just before writing a snapshot, and never needs to know anything
 * about xterm itself.
 */

const registry = new Map<string, () => string>();

/** Called from a TerminalView's mount effect; returns the matching
 * unregister function to call from that same effect's cleanup. */
export function registerScrollbackSource(sessionId: string, getSerialized: () => string): () => void {
  registry.set(sessionId, getSerialized);
  return () => {
    // Only clear if this registration is still the current one — a fast
    // unmount+remount (e.g. React StrictMode) could otherwise have the old
    // cleanup clobber the new registration.
    if (registry.get(sessionId) === getSerialized) registry.delete(sessionId);
  };
}

/** Best-effort — undefined for a session with no registered pane (already
 * closed, or never had a scrollback-producing terminal in the first place). */
export function getScrollback(sessionId: string): string | undefined {
  return registry.get(sessionId)?.();
}
