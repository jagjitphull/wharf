/**
 * Lets code outside a terminal pane (the command palette) type into it: each
 * mounted pane registers how to do that, keyed by its session id.
 */
type Inserter = (text: string, run: boolean) => void;

const inserters = new Map<string, Inserter>();

export function registerTerminalInserter(sessionId: string, insert: Inserter): () => void {
  inserters.set(sessionId, insert);
  return () => {
    if (inserters.get(sessionId) === insert) inserters.delete(sessionId);
  };
}

/** Types `text` into the pane, then presses Enter when `run` is set. False when that pane isn't mounted. */
export function insertIntoTerminal(sessionId: string, text: string, run: boolean): boolean {
  const insert = inserters.get(sessionId);
  if (!insert) return false;
  insert(text, run);
  return true;
}
