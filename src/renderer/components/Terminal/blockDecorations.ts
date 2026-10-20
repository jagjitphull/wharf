import type { IDecoration, IMarker, Terminal as XTerm } from "@xterm/xterm";
import type { CommandBlock } from "./commandBlocks";

export type BlockStatus = "running" | "ok" | "failed";

export function blockStatus(block: Pick<CommandBlock, "exitCode" | "endedAt">): BlockStatus {
  // A block the shell never reported an exit for (see CommandBlock.exitCode) is
  // finished but unknown; it's drawn like a success rather than as a failure.
  if (block.exitCode === null && block.endedAt === null) return "running";
  return block.exitCode === null || block.exitCode === 0 ? "ok" : "failed";
}

export function formatDuration(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(2)} s`;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return rest === 60 ? `${m + 1}m 00s` : `${m}m ${String(rest).padStart(2, "0")}s`;
}

/** The text of the pill at the right of a finished block's first row. */
export function blockPillText(block: Pick<CommandBlock, "exitCode" | "endedAt" | "timestamp">): string {
  const duration = block.endedAt !== null ? ` · ${formatDuration(block.endedAt - block.timestamp)}` : "";
  if (block.exitCode === null) return duration ? duration.slice(3) : "";
  return `${block.exitCode === 0 ? "✓" : "✕"} ${block.exitCode}${duration}`;
}

interface Entry {
  marker: IMarker;
  decoration: IDecoration | undefined;
}

/**
 * Draws each command block in the terminal itself: a status rail down its left
 * edge, a faint tint behind a failure, and a pill with the exit code and how
 * long it ran. Boundaries are xterm markers, so everything follows the text
 * through scrolling and goes away with it when it scrolls out of the buffer.
 *
 * The overlay is a DOM decoration (pointer-events:none, see Terminal.css), so it
 * never gets in the way of selecting or clicking terminal text.
 */
export function createBlockDecorator(term: XTerm) {
  const entries = new Map<string, Entry>();

  function draw(block: CommandBlock, entry: Entry, height: number): void {
    entry.decoration?.dispose();
    const decoration = term.registerDecoration({ marker: entry.marker, x: 0, width: term.cols, height });
    entry.decoration = decoration;
    if (!decoration) return;
    const status = blockStatus(block);
    decoration.onRender((el) => {
      // classList, not className: xterm's own "xterm-decoration" class is what
      // makes the element absolutely positioned on its row.
      el.classList.add("cmd-block", status);
      if (!el.firstChild) {
        const text = status === "running" ? "" : blockPillText(block);
        if (text) {
          const pill = document.createElement("span");
          pill.className = "cmd-block-pill";
          pill.textContent = text;
          el.appendChild(pill);
        }
      }
    });
  }

  return {
    /** A command has started: mark its row (the one above the first output row) as running. */
    start(block: CommandBlock): void {
      // By the time ;C arrives the cursor is already on the first output row,
      // so the command's own row is the one above it.
      const marker = term.registerMarker(-1);
      if (!marker) return;
      const entry: Entry = { marker, decoration: undefined };
      entries.set(block.id, entry);
      draw(block, entry, 1);
    },

    /** The command finished: redraw the mark across the command row and all its output. */
    end(block: CommandBlock): void {
      const entry = entries.get(block.id);
      if (!entry || entry.marker.isDisposed || !block.endMarker || block.endMarker.isDisposed) return;
      draw(block, entry, Math.max(1, block.endMarker.line - entry.marker.line));
    },

    /** Drops decorations for blocks that fell out of the retained list. */
    prune(keepIds: ReadonlySet<string>): void {
      for (const [id, entry] of entries) {
        if (keepIds.has(id)) continue;
        entry.decoration?.dispose();
        entry.marker.dispose();
        entries.delete(id);
      }
    },

    dispose(): void {
      for (const entry of entries.values()) {
        entry.decoration?.dispose();
        entry.marker.dispose();
      }
      entries.clear();
    },
  };
}
