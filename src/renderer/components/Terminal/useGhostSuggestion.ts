import { useEffect, useRef, type RefObject } from "react";
import type { IDecoration, IMarker, Terminal as XTerm } from "@xterm/xterm";
import { useGhostSuggestionPrefsStore } from "../../state/ghostSuggestionPrefsStore";
import type { CommandCaptureState } from "./commandCapture";
import { findGhostSuggestion, findNextCommandSuggestion, type GhostHistoryCache, type GhostTransitionMap } from "./ghostSuggestion";
import { guessMatchesScreen, readTypedLine } from "./typedLine";

/** The currently-rendered ghost suggestion, if any — tracks enough to erase
 * it (marker/decoration) and to check it still fits the line on accept. */
interface GhostSuggestionState {
  marker: IMarker;
  decoration: IDecoration;
  fullCommand: string;
}

/**
 * The inline (ghost text) suggestion for the line being typed: what to show,
 * drawing it as an xterm decoration, and accepting it. Everything it reads
 * about the session — the prompt, the typed-line guess, history — arrives as
 * refs, since the terminal's handlers are registered once at mount.
 */
export function useGhostSuggestion({
  termRef,
  commandCaptureRef,
  integrationSeenRef,
  promptEndRef,
  atPromptRef,
  historyCacheRef,
  transitionMapRef,
  lastRunCommandRef,
  suppressed,
}: {
  termRef: RefObject<XTerm | null>;
  commandCaptureRef: RefObject<CommandCaptureState>;
  integrationSeenRef: RefObject<boolean>;
  promptEndRef: RefObject<{ marker: IMarker; column: number } | null>;
  atPromptRef: RefObject<boolean>;
  historyCacheRef: RefObject<GhostHistoryCache>;
  transitionMapRef: RefObject<GhostTransitionMap>;
  lastRunCommandRef: RefObject<string | null>;
  /** True while another popup (AI suggestions, generate command, find) owns the keyboard. */
  suppressed(): boolean;
}) {
  const ghostEnabled = useGhostSuggestionPrefsStore((s) => s.enabled);
  const ghostEnabledRef = useRef(ghostEnabled);
  const ghostSuggestionRef = useRef<GhostSuggestionState | null>(null);

  /** Erases the currently-rendered ghost suggestion, if any — always safe to
   * call even when nothing is showing. */
  function dispose() {
    const ghost = ghostSuggestionRef.current;
    if (!ghost) return;
    ghost.decoration.dispose();
    ghost.marker.dispose();
    ghostSuggestionRef.current = null;
  }

  /**
   * What is typed at the prompt right now, or null when that can't be known well enough to act on
   * (a program is running, the cursor isn't at the end of the line, the screen disagrees with
   * the keystrokes). With shell integration it is read off the screen, so Tab completion and
   * history recall are seen; without it, the keystroke guess is used only while the screen
   * confirms it.
   */
  function currentTypedText(): string | null {
    const term = termRef.current;
    if (!term) return null;
    const active = term.buffer.active;
    if (integrationSeenRef.current) {
      const prompt = promptEndRef.current;
      if (!atPromptRef.current || !prompt || prompt.marker.isDisposed) return null;
      const typed = readTypedLine(active, { line: prompt.marker.line, column: prompt.column });
      return typed && typed.cursorAtEnd ? typed.text : null;
    }
    const guess = commandCaptureRef.current.buffer;
    return guessMatchesScreen(active, guess) || guess === "" ? guess : null;
  }

  /** Re-evaluates the ghost suggestion — prefix-matched against the current
   * typed buffer, or (buffer empty, at a real prompt) a "next command"
   * prediction — and (re)renders it via an xterm decoration anchored to the
   * cursor's current row/column — xterm handles the pixel positioning and
   * scroll-following itself, and since a decoration is a DOM overlay rather
   * than real buffer content, it can never race with or corrupt the shell's
   * own echoed output. Called after every real write to the terminal (see
   * the wharf.ssh.onData handler below) rather than on the user's own
   * keystroke, since for a remote pty the cursor doesn't actually move
   * until the shell's echo of that keystroke comes back — recomputing only
   * once real content has landed keeps the suggestion's position always
   * trustworthy, at the cost of it updating in the same lockstep as the
   * user's own typed characters already do over a laggy connection. */
  function recompute() {
    const term = termRef.current;
    dispose();
    if (!term) return;
    if (!ghostEnabledRef.current || suppressed()) return;
    const buffer = currentTypedText();
    if (buffer === null) return;
    const match = buffer
      ? findGhostSuggestion(buffer, historyCacheRef.current)
      : atPromptRef.current
        ? findNextCommandSuggestion(lastRunCommandRef.current, transitionMapRef.current)
        : null;
    if (!match) return;
    const remainder = match.slice(buffer.length);
    const marker = term.registerMarker(0);
    if (!marker) return;
    const decoration = term.registerDecoration({ marker, x: term.buffer.active.cursorX, width: remainder.length, anchor: "left" });
    if (!decoration) {
      marker.dispose();
      return;
    }
    decoration.onRender((el) => {
      el.textContent = remainder;
      el.classList.add("ghost-suggestion-text");
    });
    ghostSuggestionRef.current = { marker, decoration, fullCommand: match };
  }

  /** Right Arrow / End while a ghost suggestion is showing types its
   * remainder into the line the same way an accepted AI suggestion is —
   * pasted, never auto-submitted. */
  function accept() {
    const ghost = ghostSuggestionRef.current;
    dispose();
    termRef.current?.focus();
    if (!ghost) return;
    // Read the line again rather than trusting what it was when the suggestion was drawn: if it
    // no longer leads into the suggestion, typing the rest would produce a wrong command.
    const typed = currentTypedText();
    if (typed === null || !ghost.fullCommand.startsWith(typed)) return;
    const delta = ghost.fullCommand.slice(typed.length);
    if (delta) termRef.current?.paste(delta);
  }

  useEffect(() => {
    ghostEnabledRef.current = ghostEnabled;
    if (!ghostEnabled) dispose();
  }, [ghostEnabled]);

  return { ghostSuggestionRef, recompute, accept, dispose };
}
