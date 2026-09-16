import type { Terminal as XTerm, IMarker } from "@xterm/xterm";

/**
 * Groups each command a shell runs with its own output into a "block",
 * driven by real OSC 133 shell-integration sequences (see
 * main/services/shellIntegration.ts) rather than guessing from keystrokes:
 * ;A prompt-start, ;B prompt-end, ;C command-start, ;D;<exitcode>
 * command-end. A session without integration (unsupported shell, or the
 * feature turned off in Settings) simply never receives these sequences —
 * no blocks are ever created, and everything else about the terminal works
 * exactly as it always has.
 *
 * Block boundaries are xterm markers (IMarker), not stored line numbers —
 * they track their row automatically as the buffer scrolls, and read back
 * as -1/isDisposed once scrolled out of the retained scrollback, which is
 * the natural, honest limit on how far back a block's output can still be
 * recovered (same limit normal scrolling already has).
 */

export interface CommandBlock {
  id: string;
  command: string;
  startMarker: IMarker;
  endMarker: IMarker | null;
  /** null while the command is still running, or if shell integration never reported one (a next command started before a ;D was seen — bash's DEBUG-trap approach can occasionally do this for compound commands). */
  exitCode: number | null;
  timestamp: number;
  bookmarked: boolean;
}

export interface CommandBlocksState {
  blocks: CommandBlock[];
  /** The block currently between ;C and ;D, if any — at most one at a time. */
  openBlockId: string | null;
  /** Command text captured from the keystroke buffer (via commandCapture's
   * Enter-flush) that hasn't yet been paired with an incoming ;C. Almost
   * always paired within one network round trip; if a ;C somehow arrives
   * with nothing pending (shouldn't happen in practice), the block is
   * created with a placeholder command text rather than dropped. */
  pendingCommand: string | null;
  /** Whether a real (non-placeholder) block has ever been created yet — see
   * the startup-quirk note in handleOsc133(). */
  sawFirstCommand: boolean;
}

export function createCommandBlocksState(): CommandBlocksState {
  return { blocks: [], openBlockId: null, pendingCommand: null, sawFirstCommand: false };
}

/** Called from the same place commandCapture.ts's Enter-flush already
 * fires, so a block's command text is exactly what command-history/AI
 * autocomplete already agree a "command" is — one less thing to keep in
 * sync. */
export function notePendingCommand(state: CommandBlocksState, command: string): void {
  state.pendingCommand = command;
}

const MAX_BLOCKS = 200;

/** Feed one xterm OSC-133 payload (the string after "133;", e.g. "A", "B",
 * "C", "D;0") into the state machine. Returns a new blocks array only when
 * it actually changed (new/updated block), so callers can skip a re-render
 * on plain "A"/"B" cycles. */
export function handleOsc133(term: XTerm, state: CommandBlocksState, payload: string): CommandBlock[] | null {
  const [code, arg] = payload.split(";");

  if (code === "C") {
    if (state.openBlockId) return null; // already inside a block — see the DEBUG-trap note in shellIntegration.ts
    if (!state.pendingCommand && !state.sawFirstCommand) {
      // The shell's own startup (loading the integration script, the first
      // PROMPT_COMMAND/precmd cycle) can fire one ;C/;D pair before any real
      // command was ever typed — skip creating a block for it rather than
      // showing a permanent "(unknown command)" placeholder. Once a real
      // command has come through once, later unpaired ;C (the actual, rarer
      // edge case this fallback exists for — e.g. a run triggered some way
      // that bypassed keystroke capture) still gets a placeholder block
      // rather than silently losing exit-code visibility for it.
      return null;
    }
    state.sawFirstCommand = true;
    const block: CommandBlock = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      command: state.pendingCommand ?? "(unknown command)",
      startMarker: term.registerMarker(0),
      endMarker: null,
      exitCode: null,
      timestamp: Date.now(),
      bookmarked: false,
    };
    state.pendingCommand = null;
    state.openBlockId = block.id;
    state.blocks = [...state.blocks, block];
    if (state.blocks.length > MAX_BLOCKS) {
      // Dispose markers for anything falling off the front so they don't
      // linger as dead xterm listeners.
      for (const dropped of state.blocks.slice(0, state.blocks.length - MAX_BLOCKS)) {
        dropped.startMarker.dispose();
        dropped.endMarker?.dispose();
      }
      state.blocks = state.blocks.slice(-MAX_BLOCKS);
    }
    return state.blocks;
  }

  if (code === "D") {
    if (!state.openBlockId) return null;
    const idx = state.blocks.findIndex((b) => b.id === state.openBlockId);
    state.openBlockId = null;
    if (idx === -1) return null;
    const exitCode = arg !== undefined && arg !== "" ? Number(arg) : null;
    const updated: CommandBlock = { ...state.blocks[idx], endMarker: term.registerMarker(0), exitCode: Number.isNaN(exitCode) ? null : exitCode };
    state.blocks = [...state.blocks.slice(0, idx), updated, ...state.blocks.slice(idx + 1)];
    return state.blocks;
  }

  return null; // "A"/"B" — no block-relevant state change
}

/** Reads a block's output text straight from the live xterm buffer, between
 * its start and end markers (or down to the last row if still running).
 * Returns "" once either marker has scrolled out of the retained
 * scrollback — the block's own metadata (command, exit code) still shows
 * in the panel, just without recoverable output text past that point. */
export function readBlockOutput(term: XTerm, block: CommandBlock): string {
  if (block.startMarker.isDisposed) return "";
  // By the time the shell's ;C hook runs, the terminal has already processed
  // the newline from the Enter keystroke (echoed well before the shell's own
  // trap/hook executes) — so the marker lands on the first output row itself,
  // not the command's echo row above it.
  const startLine = block.startMarker.line;
  const endLine = block.endMarker && !block.endMarker.isDisposed ? block.endMarker.line : term.buffer.active.baseY + term.rows;
  const lines: string[] = [];
  for (let y = startLine; y < endLine; y++) {
    const line = term.buffer.active.getLine(y);
    if (line) lines.push(line.translateToString(true));
  }
  // Trailing blank lines are just unused rows below short output, not part of it.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
