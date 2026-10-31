import { useEffect, useRef, useState, type RefObject } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { useAppStore } from "../../state/store";
import { useAiPrefsStore } from "../../state/aiPrefsStore";
import type { CommandCaptureState } from "./commandCapture";
import { readBlockOutput, type CommandBlock } from "./commandBlocks";
import type { AiPopupState, ExplainPopupState, NlPopupState } from "./AiPopups";

/**
 * The terminal's three AI popups — completions for the line being typed, a
 * command generated from a description, and an explanation of a failed
 * command — with the state and actions behind them. The refs mirror the state
 * for the terminal's key handler, which is registered once at mount and would
 * otherwise see a stale closure.
 */
export function useAiAssist({
  sessionId,
  termRef,
  commandCaptureRef,
}: {
  sessionId: string;
  termRef: RefObject<XTerm | null>;
  commandCaptureRef: RefObject<CommandCaptureState>;
}) {
  const aiEnabled = useAiPrefsStore((s) => s.enabled);
  const [aiPopup, setAiPopup] = useState<AiPopupState | null>(null);
  const [explainPopup, setExplainPopup] = useState<ExplainPopupState | null>(null);
  const [explainBusyId, setExplainBusyId] = useState<string | null>(null);
  const [nlPopup, setNlPopup] = useState<NlPopupState | null>(null);
  const aiPopupRef = useRef<AiPopupState | null>(null);
  const aiEnabledRef = useRef(aiEnabled);
  const nlPopupRef = useRef<NlPopupState | null>(null);

  useEffect(() => {
    aiPopupRef.current = aiPopup;
  }, [aiPopup]);

  useEffect(() => {
    aiEnabledRef.current = aiEnabled;
  }, [aiEnabled]);

  useEffect(() => {
    nlPopupRef.current = nlPopup;
  }, [nlPopup]);

  // Unlike the other popups (which either have their own <input> to catch
  // Escape, or are handled in the terminal's custom key handler),
  // explainPopup is opened from the Blocks panel — a plain mouse click, no
  // keyboard state to piggyback on — so it gets its own small Escape
  // listener instead.
  useEffect(() => {
    if (!explainPopup) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExplainPopup(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [explainPopup]);

  /** Fires an AI autocomplete request for whatever's currently typed
   * (unsent) on this pane's line, sourced from the same buffer the command-
   * history capture already maintains — no separate tracking needed. */
  async function requestAiSuggestions() {
    const requestLine = commandCaptureRef.current.buffer;
    if (!requestLine) return; // nothing to complete
    setAiPopup({ status: "loading", suggestions: [], requestLine });
    try {
      const provider = await wharf.ai.getProvider();
      const hasKey = await wharf.ai.hasApiKey(provider);
      if (!hasKey) {
        setAiPopup({ status: "error", suggestions: [], requestLine, error: "No API key configured — add one in Settings." });
        return;
      }
      const history = await wharf.commandHistory.list();
      const recentCommands = history
        .filter((h) => h.sessionId === sessionId)
        .slice(-10)
        .map((h) => h.command);
      const meta = useAppStore.getState().paneMeta[sessionId];
      const suggestions = await wharf.ai.suggest({
        currentLine: requestLine,
        recentCommands,
        hostName: meta?.title ?? "unknown",
        platform: wharf.window.platform,
      });
      // The user may have kept typing while this was in flight — stale
      // suggestions for a line that no longer exists would be actively
      // misleading, so just drop them rather than show them anyway.
      if (commandCaptureRef.current.buffer !== requestLine) {
        setAiPopup(null);
        return;
      }
      setAiPopup({ status: "ready", suggestions, requestLine });
    } catch (err) {
      setAiPopup({ status: "error", suggestions: [], requestLine, error: ipcErrorMessage(err) });
    }
  }

  /** Types the remainder of `suggestion` (past what's already on the line)
   * into the terminal via paste — not a direct wharf.ssh.write, so it goes
   * through the same onData path a real paste would, keeping the command-
   * history capture buffer in sync automatically. Never sends Enter itself:
   * the user reviews/edits before running it. */
  function acceptAiSuggestion(suggestion: string) {
    const popup = aiPopupRef.current;
    setAiPopup(null);
    // Clicking a suggestion row moves DOM focus to that (now-unmounting)
    // button rather than the terminal — without this, further typing goes
    // nowhere until the user clicks the terminal again.
    termRef.current?.focus();
    if (!popup || commandCaptureRef.current.buffer !== popup.requestLine) return;
    const delta = suggestion.slice(popup.requestLine.length);
    if (delta) termRef.current?.paste(delta);
  }

  /** Sends a failed block's command/output/exit code to the AI and shows
   * its explanation (and a corrected command, if it has a confident one)
   * in a popup — same positioning family as the AI suggestions popup. */
  async function explainBlock(block: CommandBlock) {
    const term = termRef.current;
    if (!term || block.exitCode === null) return;
    setExplainBusyId(block.id);
    setExplainPopup({ status: "loading", command: block.command });
    try {
      const meta = useAppStore.getState().paneMeta[sessionId];
      const result = await wharf.ai.explainFailure({
        command: block.command,
        output: readBlockOutput(term, block),
        exitCode: block.exitCode,
        hostName: meta?.title ?? "unknown",
        platform: wharf.window.platform,
      });
      setExplainPopup({ status: "ready", command: block.command, explanation: result.explanation, suggestedFix: result.suggestedFix });
    } catch (err) {
      setExplainPopup({ status: "error", command: block.command, error: ipcErrorMessage(err) });
    } finally {
      setExplainBusyId(null);
    }
  }

  function insertExplainFix() {
    const popup = explainPopup;
    setExplainPopup(null);
    termRef.current?.focus();
    if (popup?.suggestedFix) termRef.current?.paste(popup.suggestedFix);
  }

  /** Turns a plain-English description into one real command via the AI,
   * then inserts it the same way an accepted AI suggestion is — pasted, not
   * auto-submitted, so the user reviews it before running it. */
  async function generateFromDescription(description: string) {
    setNlPopup({ status: "loading", description });
    // The popup's own <input> (which had focus, being autoFocus) only
    // renders in the "input" status — moving to "loading" unmounts it, and
    // a removed focused element reverts focus to document.body rather than
    // the terminal, so it has to be reclaimed explicitly here.
    termRef.current?.focus();
    try {
      const history = await wharf.commandHistory.list();
      const recentCommands = history
        .filter((h) => h.sessionId === sessionId)
        .slice(-10)
        .map((h) => h.command);
      const meta = useAppStore.getState().paneMeta[sessionId];
      const command = await wharf.ai.generateCommand({
        description,
        recentCommands,
        hostName: meta?.title ?? "unknown",
        platform: wharf.window.platform,
      });
      setNlPopup(null);
      if (command) termRef.current?.paste(command);
    } catch (err) {
      setNlPopup({ status: "error", description, error: ipcErrorMessage(err) });
    }
  }

  return {
    aiPopup,
    setAiPopup,
    nlPopup,
    setNlPopup,
    explainPopup,
    setExplainPopup,
    explainBusyId,
    aiPopupRef,
    aiEnabledRef,
    nlPopupRef,
    requestAiSuggestions,
    acceptAiSuggestion,
    explainBlock,
    insertExplainFix,
    generateFromDescription,
  };
}
