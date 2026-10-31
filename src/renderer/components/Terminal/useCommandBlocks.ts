import { useRef, useState, type RefObject } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import { wharf } from "../../api/wharf";
import type { CommandCaptureState } from "./commandCapture";
import { createCommandBlocksState, notePendingCommand, readBlockOutput, type CommandBlock } from "./commandBlocks";

/**
 * The pane's Command Blocks (see commandBlocks.ts) and what the Blocks panel
 * can do with one. Every action is triggered by clicking a button inside that
 * panel, not the terminal, so each ends with an explicit focus() — otherwise
 * keyboard input would stay on the (now-closed) panel button with nothing to
 * receive it until the user clicked the terminal.
 */
export function useCommandBlocks({
  sessionId,
  termRef,
  commandCaptureRef,
}: {
  sessionId: string;
  termRef: RefObject<XTerm | null>;
  commandCaptureRef: RefObject<CommandCaptureState>;
}) {
  const commandBlocksRef = useRef(createCommandBlocksState());
  const [blocks, setBlocks] = useState<CommandBlock[]>([]);
  const [blocksPanelOpen, setBlocksPanelOpen] = useState(false);

  /** Scrolls the terminal so a block's command line is visible — a block
   * whose start marker has scrolled out of the retained scrollback just
   * can't be jumped to any more, same limit normal scrolling already has. */
  function jumpToBlock(block: CommandBlock) {
    if (!block.startMarker.isDisposed) termRef.current?.scrollToLine(block.startMarker.line);
    termRef.current?.focus();
  }

  function copyBlockCommand(block: CommandBlock) {
    void wharf.clipboard.writeText(block.command);
    termRef.current?.focus();
  }

  function copyBlockOutput(block: CommandBlock) {
    const term = termRef.current;
    if (!term) return;
    void wharf.clipboard.writeText(readBlockOutput(term, block));
    term.focus();
  }

  /** Re-running is a deliberate, explicit action on a command the user
   * already ran once — unlike an AI suggestion (never auto-submitted, since
   * the user hasn't reviewed it yet), this both types and submits it. */
  function rerunBlock(block: CommandBlock) {
    termRef.current?.paste(block.command);
    // paste() feeds the command text through onData (so it reaches the pty
    // and lands in commandCaptureRef's buffer), but the synthetic "\r" below
    // is written directly and never passes through onData/feedCommandCapture
    // — so the buffer would never flush and would pollute the next real
    // command's capture. Clear it and supply the pending text for the
    // resulting block ourselves instead.
    commandCaptureRef.current.buffer = "";
    notePendingCommand(commandBlocksRef.current, block.command);
    wharf.ssh.write(sessionId, "\r");
    termRef.current?.focus();
  }

  function toggleBlockBookmark(block: CommandBlock) {
    setBlocks((prev) => prev.map((b) => (b.id === block.id ? { ...b, bookmarked: !b.bookmarked } : b)));
    termRef.current?.focus();
  }

  return {
    commandBlocksRef,
    blocks,
    setBlocks,
    blocksPanelOpen,
    setBlocksPanelOpen,
    jumpToBlock,
    copyBlockCommand,
    copyBlockOutput,
    rerunBlock,
    toggleBlockBookmark,
  };
}
