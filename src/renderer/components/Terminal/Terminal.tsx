import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type IDecoration, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { useThemeStore } from "../../state/themeStore";
import { useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { getTerminalThemePreset, resolveXtermTheme } from "../../state/terminalThemes";
import { useAppStore } from "../../state/store";
import { useKeywordHighlightStore } from "../../state/keywordHighlightStore";
import { useAiPrefsStore } from "../../state/aiPrefsStore";
import { useGhostSuggestionPrefsStore } from "../../state/ghostSuggestionPrefsStore";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { SnippetPicker } from "../SnippetPicker/SnippetPicker";
import { IconChevronDown, IconChevronUp, IconClose } from "../Icons/Icons";
import { buildTerminalThemeMenuItems } from "./TerminalThemeSwatches";
import {
  compileRules,
  createHighlightState,
  disposeAllDecorations,
  rescanViewport,
  scanAfterWrite,
  type CompiledRule,
} from "./keywordHighlight";
import { createCommandCaptureState, feedCommandCapture } from "./commandCapture";
import { createCommandBlocksState, handleOsc133, notePendingCommand, readBlockOutput, type CommandBlock } from "./commandBlocks";
import { createGhostHistoryCache, findGhostSuggestion, pushToGhostHistoryCache, type GhostHistoryCache } from "./ghostSuggestion";
import { BlocksPanel } from "./BlocksPanel";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface Props {
  sessionId: string;
  visible: boolean;
  /** Per-pane color theme override (from PaneMeta.themeId), taking
   * priority over the global Settings choice. undefined defers to it. */
  themeOverrideId?: string;
  /** Path this pane is currently logging its raw output to, if any (mirrors PaneMeta.logPath). */
  logPath?: string;
  /** Id of the tab this pane lives in — needed for the Split Right/Down
   * context-menu actions, which add a new pane into this tab's layout. */
  tabId: string;
}

interface AiPopupState {
  status: "loading" | "ready" | "error";
  suggestions: string[];
  error?: string;
  /** The current line as of when this request was fired — used both to
   * compute the keystroke delta on accept and to detect staleness (the
   * user kept typing while waiting on the API, so the suggestions no
   * longer apply to what's actually on the line). */
  requestLine: string;
}

interface ExplainPopupState {
  status: "loading" | "ready" | "error";
  command: string;
  explanation?: string;
  suggestedFix?: string;
  error?: string;
}

interface NlPopupState {
  status: "input" | "loading" | "error";
  description: string;
  error?: string;
}

/** The currently-rendered ghost suggestion, if any — tracks enough to erase
 * it (marker/decoration) and to compute the delta to insert on accept. */
interface GhostSuggestionState {
  marker: IMarker;
  decoration: IDecoration;
  fullCommand: string;
  typedLength: number;
}

export function TerminalView({ sessionId, visible, themeOverrideId, logPath, tabId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const accent = useThemeStore((s) => s.accent);
  const fontSize = useTerminalPrefsStore((s) => s.fontSize);
  const fontFamily = useTerminalPrefsStore((s) => s.fontFamily);
  const globalTerminalThemeId = useTerminalPrefsStore((s) => s.terminalThemeId);
  const setPaneThemeId = useAppStore((s) => s.setPaneThemeId);
  const setPaneLogPath = useAppStore((s) => s.setPaneLogPath);
  const splitPane = useAppStore((s) => s.splitPane);
  const closeTerminal = useAppStore((s) => s.closeTerminal);
  const keywordEnabled = useKeywordHighlightStore((s) => s.enabled);
  const keywordRules = useKeywordHighlightStore((s) => s.rules);
  const highlightStateRef = useRef(createHighlightState());
  const compiledRulesRef = useRef<CompiledRule[]>([]);
  const commandCaptureRef = useRef(createCommandCaptureState());
  const commandBlocksRef = useRef(createCommandBlocksState());
  const terminalThemeId = themeOverrideId ?? globalTerminalThemeId;
  const aiEnabled = useAiPrefsStore((s) => s.enabled);
  const ghostEnabled = useGhostSuggestionPrefsStore((s) => s.enabled);
  const ghostEnabledRef = useRef(ghostEnabled);
  const historyCacheRef = useRef<GhostHistoryCache>([]);
  const ghostSuggestionRef = useRef<GhostSuggestionState | null>(null);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [snippetPickerOpen, setSnippetPickerOpen] = useState(false);
  const [aiPopup, setAiPopup] = useState<AiPopupState | null>(null);
  const [blocks, setBlocks] = useState<CommandBlock[]>([]);
  const [blocksPanelOpen, setBlocksPanelOpen] = useState(false);
  const [explainPopup, setExplainPopup] = useState<ExplainPopupState | null>(null);
  const [explainBusyId, setExplainBusyId] = useState<string | null>(null);
  const [nlPopup, setNlPopup] = useState<NlPopupState | null>(null);
  const searchOpenRef = useRef(false);
  // Mirrors aiPopup/aiEnabled/nlPopup for the custom key handler below,
  // which is registered once at mount (see the searchOpenRef comment on
  // the same pattern) and would otherwise see a stale closure.
  const aiPopupRef = useRef<AiPopupState | null>(null);
  const aiEnabledRef = useRef(aiEnabled);
  const nlPopupRef = useRef<NlPopupState | null>(null);

  useEffect(() => {
    searchOpenRef.current = searchOpen;
    if (searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
    else termRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    aiPopupRef.current = aiPopup;
  }, [aiPopup]);

  useEffect(() => {
    aiEnabledRef.current = aiEnabled;
  }, [aiEnabled]);

  useEffect(() => {
    ghostEnabledRef.current = ghostEnabled;
    if (!ghostEnabled) disposeGhostSuggestion();
  }, [ghostEnabled]);

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

  /** Erases the currently-rendered ghost suggestion, if any — always safe to
   * call even when nothing is showing. */
  function disposeGhostSuggestion() {
    const ghost = ghostSuggestionRef.current;
    if (!ghost) return;
    ghost.decoration.dispose();
    ghost.marker.dispose();
    ghostSuggestionRef.current = null;
  }

  /** Re-evaluates the fish/zsh-autosuggestions-style ghost text against the
   * current typed buffer and (re)renders it via an xterm decoration anchored
   * to the cursor's current row/column — xterm handles the pixel positioning
   * and scroll-following itself, and since a decoration is a DOM overlay
   * rather than real buffer content, it can never race with or corrupt the
   * shell's own echoed output. Called after every real write to the
   * terminal (see the wharf.ssh.onData handler below) rather than on the
   * user's own keystroke, since for a remote pty the cursor doesn't actually
   * move until the shell's echo of that keystroke comes back — recomputing
   * only once real content has landed keeps the suggestion's position always
   * trustworthy, at the cost of it updating in the same lockstep as the
   * user's own typed characters already do over a laggy connection. */
  function recomputeGhostSuggestion() {
    const term = termRef.current;
    disposeGhostSuggestion();
    if (!term) return;
    if (!ghostEnabledRef.current || aiPopupRef.current || nlPopupRef.current || searchOpenRef.current) return;
    const buffer = commandCaptureRef.current.buffer;
    const match = buffer ? findGhostSuggestion(buffer, historyCacheRef.current) : null;
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
    ghostSuggestionRef.current = { marker, decoration, fullCommand: match, typedLength: buffer.length };
  }

  /** Right Arrow / End while a ghost suggestion is showing types its
   * remainder into the line the same way an accepted AI suggestion is —
   * pasted, never auto-submitted. */
  function acceptGhostSuggestion() {
    const ghost = ghostSuggestionRef.current;
    disposeGhostSuggestion();
    termRef.current?.focus();
    if (!ghost) return;
    const delta = ghost.fullCommand.slice(ghost.typedLength);
    if (delta) termRef.current?.paste(delta);
  }

  /** Scrolls the terminal so a block's command line is visible — a block
   * whose start marker has scrolled out of the retained scrollback just
   * can't be jumped to any more, same limit normal scrolling already has. */
  // Every Blocks-panel row action below is triggered by clicking a button
  // inside that panel, not the terminal — each ends with an explicit
  // termRef.current?.focus() so keyboard input actually goes back to the
  // terminal afterward, rather than being left on the (now-closed) panel
  // button with nothing to receive it until the user clicks the terminal.
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

  // Mounts the xterm instance exactly once per session (this component is
  // kept alive-but-hidden by the parent while its tab is in the background,
  // so scrollback/state survives switching tabs).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const initialTheme = resolveXtermTheme(terminalThemeId);
    const term = new XTerm({
      fontFamily: useTerminalPrefsStore.getState().fontFamily,
      fontSize: useTerminalPrefsStore.getState().fontSize,
      cursorBlink: true,
      theme: initialTheme,
      // registerMarker/registerDecoration (used for keyword highlighting)
      // are behind xterm.js's "proposed API" flag — without this they throw
      // synchronously inside the terminal's own write loop, which doesn't
      // just fail the highlight: it corrupts mid-flight rendering for
      // everything else too.
      allowProposedApi: true,
    });
    // The pane's own background (visible as an 8px border around xterm) is
    // set inline so it tracks a fixed preset's background too — the CSS
    // var it defaults to (--term-bg) never changes for a non-"app" preset.
    if (initialTheme.background) el.style.background = initialTheme.background;
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    searchAddonRef.current = search;
    term.open(el);
    fitRef.current = fit;
    fit.fit();
    wharf.ssh.resize(sessionId, term.cols, term.rows);

    // Intercept Ctrl/Cmd+F (open find bar) and Escape (close it) before
    // xterm forwards the keystroke to the remote shell. Reads searchOpenRef
    // rather than the `searchOpen` state directly since this handler is
    // registered once at mount and would otherwise see a stale closure.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        setSearchOpen(true);
        return false;
      }
      if (event.key === "Escape" && searchOpenRef.current) {
        setSearchOpen(false);
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Space") {
        if (aiEnabledRef.current) setNlPopup({ status: "input", description: "" });
        return false;
      }
      // Bare Right Arrow / End (no modifiers — leaves Cmd/Ctrl+Right's OS-
      // level word/line-navigation alone) accepts a showing ghost
      // suggestion, same convention fish/zsh-autosuggestions/PSReadLine use.
      if (
        (event.key === "ArrowRight" || event.key === "End") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        ghostSuggestionRef.current
      ) {
        acceptGhostSuggestion();
        return false;
      }
      if ((event.metaKey || event.ctrlKey) && event.code === "Space") {
        if (aiEnabledRef.current) void requestAiSuggestions();
        return false;
      }
      if (nlPopupRef.current) {
        // The popup's own <input> has focus while it's open, so this
        // branch only runs for keystrokes xterm's own textarea somehow
        // still sees (e.g. a stray keydown before focus has moved) —
        // dismiss defensively rather than let it leak into the shell.
        if (event.key === "Escape") {
          setNlPopup(null);
          return false;
        }
      }
      const popup = aiPopupRef.current;
      if (popup) {
        if (event.key === "Escape") {
          setAiPopup(null);
          return false;
        }
        if (popup.status === "ready" && popup.suggestions.length > 0) {
          if (event.key === "Tab" || event.key === "Enter") {
            acceptAiSuggestion(popup.suggestions[0]);
            return false;
          }
          if (event.key >= "1" && event.key <= "9") {
            const idx = Number(event.key) - 1;
            if (idx < popup.suggestions.length) {
              acceptAiSuggestion(popup.suggestions[idx]);
              return false;
            }
          }
        }
        // Any other keystroke while the popup is open (still loading, an
        // error, or just typing past it) dismisses it rather than eating
        // input the user clearly meant for the shell.
        setAiPopup(null);
      }
      // Let App.tsx's window-level listener handle its own global shortcuts
      // instead of xterm swallowing the keystroke itself and sending it to
      // the shell as a raw control character (several of these are real VT
      // control codes — e.g. Ctrl+3..8 are ESC/FS/GS/RS/US/DEL, Ctrl+K is VT
      // — that xterm stops the event for right there, so without this they
      // never reach the window; 1, 2, and 9 have no such VT mapping and
      // already worked without this).
      if (
        (event.metaKey || event.ctrlKey) &&
        ((event.key >= "1" && event.key <= "9") ||
          event.key === "Tab" ||
          event.key === "/" ||
          event.key.toLowerCase() === "k" ||
          event.key.toLowerCase() === "b")
      ) {
        return false;
      }
      return true;
    });

    // Command Blocks: driven by real OSC 133 shell-integration sequences
    // (see main/services/shellIntegration.ts) when the remote/local shell
    // supports them — a session without integration just never fires this,
    // so blocks/exit codes are additive, never required for the terminal to
    // otherwise work normally.
    const oscDisposable = term.parser.registerOscHandler(133, (payload) => {
      const updated = handleOsc133(term, commandBlocksRef.current, payload);
      if (updated) setBlocks(updated);
      return true;
    });

    const offData = wharf.ssh.onData((event) => {
      if (event.sessionId === sessionId) {
        term.write(event.chunk, () => {
          scanAfterWrite(term, compiledRulesRef.current, highlightStateRef.current);
          recomputeGhostSuggestion();
        });
      }
    });
    const offClosed = wharf.ssh.onClosed((event) => {
      if (event.sessionId === sessionId) {
        term.write(`\r\n\x1b[31m[session closed${event.error ? `: ${event.error}` : ""}]\x1b[0m\r\n`);
      }
    });
    const offReconnecting = wharf.ssh.onReconnecting((event) => {
      if (event.sessionId === sessionId) {
        term.write(
          `\r\n\x1b[33m[connection lost — reconnecting… (attempt ${event.attempt}/${event.maxAttempts})]\x1b[0m\r\n`,
        );
      }
    });
    const offReconnected = wharf.ssh.onReconnected((event) => {
      if (event.sessionId === sessionId) {
        term.write(`\r\n\x1b[32m[reconnected]\x1b[0m\r\n`);
      }
    });

    const dataDisposable = term.onData((data) => {
      wharf.ssh.write(sessionId, data);
      for (const command of feedCommandCapture(commandCaptureRef.current, data)) {
        // hostId/hostName are read fresh here rather than threaded through
        // this closure's deps — they're set once when the pane connects and
        // never change for its lifetime, so a stale read is never actually
        // stale in practice.
        const meta = useAppStore.getState().paneMeta[sessionId];
        void wharf.commandHistory.add({
          sessionId,
          hostId: meta?.hostId ?? null,
          hostName: meta?.title ?? "Unknown",
          command,
        });
        // Paired up with the next OSC 133;C (if this shell has integration)
        // to give the resulting block its command text — see commandBlocks.ts.
        notePendingCommand(commandBlocksRef.current, command);
        // Makes a just-run command suggestible immediately, without waiting
        // on a re-fetch of the full history list.
        pushToGhostHistoryCache(historyCacheRef.current, command);
      }
    });

    // Seeds the ghost-suggestion history cache from this host's (or, for a
    // local shell, this session's) past commands — scoped the same way the
    // AI features' "recent commands" context already is, so a suggestion
    // never surfaces something typed against an unrelated host.
    void wharf.commandHistory.list().then((entries) => {
      const meta = useAppStore.getState().paneMeta[sessionId];
      const scoped = entries.filter((e) => e.hostId === (meta?.hostId ?? null)).map((e) => e.command);
      historyCacheRef.current = createGhostHistoryCache(scoped);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (el.offsetParent === null) return; // hidden tab, skip
      fit.fit();
      wharf.ssh.resize(sessionId, term.cols, term.rows);
    });
    resizeObserver.observe(el);

    return () => {
      offData();
      offClosed();
      offReconnecting();
      offReconnected();
      dataDisposable.dispose();
      oscDisposable.dispose();
      resizeObserver.disconnect();
      disposeAllDecorations(highlightStateRef.current);
      disposeGhostSuggestion();
      term.dispose();
      termRef.current = null;
      searchAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Live theme updates: recompute the xterm theme whenever the resolved
  // light/dark mode, accent color, or chosen terminal color theme changes,
  // without recreating the terminal (which would lose scrollback).
  // resolvedTheme/accent only matter when terminalThemeId is "app" (they
  // drive the CSS custom properties resolveXtermTheme reads in that case),
  // but re-running on every dependency change is cheap and keeps this
  // simple.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const theme = resolveXtermTheme(terminalThemeId);
    term.options.theme = theme;
    if (containerRef.current && theme.background) containerRef.current.style.background = theme.background;
  }, [resolvedTheme, accent, terminalThemeId]);

  // Recompiles the active rule set whenever Settings' keyword-highlight
  // toggle or rules change, and immediately re-highlights what's on screen
  // (off-screen scrollback picks up the new rules the next time it scrolls
  // past new output, per rescanViewport's contract).
  useEffect(() => {
    compiledRulesRef.current = keywordEnabled ? compileRules(keywordRules) : [];
    const term = termRef.current;
    if (!term) return;
    if (compiledRulesRef.current.length > 0) {
      rescanViewport(term, compiledRulesRef.current, highlightStateRef.current);
    } else {
      disposeAllDecorations(highlightStateRef.current);
    }
  }, [keywordEnabled, keywordRules]);

  // Font size/family changes resize the character cell, so cols/rows change
  // too — refit and tell the remote pty about the new size, same as a
  // window resize would.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
    wharf.ssh.resize(sessionId, term.cols, term.rows);
  }, [fontSize, fontFamily, sessionId]);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        const term = termRef.current;
        if (!term) return;
        // Becoming the active tab should send keyboard input straight to
        // this terminal without an extra click — true whether it was
        // activated by clicking the tab or by a keyboard shortcut
        // (Ctrl/Cmd+1..9, Ctrl/Cmd+Tab), which otherwise left focus
        // wherever it was (often nowhere in particular) after switching.
        term.focus();
        // xterm's renderer stops painting while its container is
        // display:none (a background tab), and FitAddon.fit() is a no-op
        // whenever the computed cols/rows come out unchanged — the common
        // case here, since hiding/showing doesn't resize the pane. So a
        // theme, font, or scrollback change that happened off-screen never
        // gets repainted once the tab comes back. term.refresh() alone
        // doesn't force it either. The reliable fix (a known xterm.js
        // workaround): drive the core Terminal.resize() directly with a
        // dimension that's actually different, then resize back — two real
        // resizes the renderer can't treat as no-ops, guaranteeing a full
        // repaint against the current theme/content.
        const { cols, rows } = term;
        term.resize(cols + 1, rows);
        term.resize(cols, rows);
      });
    }
  }, [visible]);

  async function toggleLogging() {
    if (logPath) {
      await wharf.ssh.stopLogging(sessionId);
      setPaneLogPath(sessionId, undefined);
    } else {
      const path = await wharf.ssh.startLogging(sessionId);
      if (path) setPaneLogPath(sessionId, path);
    }
  }

  async function handleContextMenu(e: React.MouseEvent) {
    const term = termRef.current;
    if (!term) return;
    const selection = term.getSelection();
    openMenu(e, [
      {
        label: "Copy",
        disabled: !selection,
        onClick: () => selection && wharf.clipboard.writeText(selection),
      },
      {
        label: "Paste",
        onClick: async () => {
          const text = await wharf.clipboard.readText();
          if (text) term.paste(text);
        },
      },
      { separator: true },
      { label: "Find…", onClick: () => setSearchOpen(true) },
      { label: "Insert Snippet…", onClick: () => setSnippetPickerOpen(true) },
      { label: "AI Suggestions (Ctrl/Cmd+Space)", onClick: () => void requestAiSuggestions() },
      { label: "Generate Command… (Ctrl/Cmd+Shift+Space)", onClick: () => setNlPopup({ status: "input", description: "" }) },
      { label: blocksPanelOpen ? "Hide Command Blocks" : "Show Command Blocks", onClick: () => setBlocksPanelOpen((v) => !v) },
      { label: "Select All", onClick: () => term.selectAll() },
      {
        label: "Clear",
        onClick: () => {
          term.clear();
          disposeAllDecorations(highlightStateRef.current);
        },
      },
      { separator: true },
      { label: "Split Right", onClick: () => splitPane(tabId, sessionId, "row") },
      { label: "Split Down", onClick: () => splitPane(tabId, sessionId, "column") },
      { label: "Close Pane", onClick: () => closeTerminal(sessionId) },
      { separator: true },
      { label: logPath ? "Stop Logging" : "Start Logging…", onClick: toggleLogging },
      // Picking any preset here — "Match App Theme" included — sets an
      // explicit per-pane override, same as picking one always would; a
      // pane only falls back to the global Settings choice until its own
      // menu is used for the first time.
      ...buildTerminalThemeMenuItems(terminalThemeId, (id) => setPaneThemeId(sessionId, id)),
    ]);
  }

  function findNext(query: string) {
    searchAddonRef.current?.findNext(query, { incremental: true });
  }
  function findPrevious(query: string) {
    searchAddonRef.current?.findPrevious(query);
  }

  return (
    <>
      {/* xterm.js takes direct DOM ownership of this element via term.open() —
          it must have no React-rendered children, or reconciliation and
          xterm's own DOM writes will fight each other. */}
      <div
        ref={containerRef}
        className="terminal-pane"
        style={{ display: visible ? "block" : "none" }}
        onContextMenu={handleContextMenu}
      />
      {visible && (
        <ContextMenu
          menu={menu}
          onClose={() => {
            closeMenu();
            // Covers every menu item that doesn't open its own focus-taking
            // UI (Paste, Select All, Clear, theme swatches, …) — an item
            // that does (Find…, Insert Snippet…, Generate Command…) focuses
            // its own input via an effect/autoFocus that runs after this,
            // so it still wins out correctly.
            termRef.current?.focus();
          }}
        />
      )}
      {visible && searchOpen && (
        <div className="terminal-search-bar">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) findPrevious(searchQuery);
                else findNext(searchQuery);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setSearchOpen(false);
              }
            }}
            placeholder="Find in terminal…"
          />
          <button title="Previous match (Shift+Enter)" onClick={() => findPrevious(searchQuery)}>
            <IconChevronUp />
          </button>
          <button title="Next match (Enter)" onClick={() => findNext(searchQuery)}>
            <IconChevronDown />
          </button>
          <button title="Close (Esc)" onClick={() => setSearchOpen(false)}>
            <IconClose />
          </button>
        </div>
      )}
      {visible && snippetPickerOpen && (
        <SnippetPicker
          onClose={() => {
            setSnippetPickerOpen(false);
            termRef.current?.focus();
          }}
          onInsert={(command) => {
            setSnippetPickerOpen(false);
            termRef.current?.focus();
            termRef.current?.paste(command);
          }}
        />
      )}
      {visible && aiPopup && (
        <div className="ai-suggest-popup">
          <div className="ai-suggest-header">
            <span>AI suggestions</span>
            <button title="Close (Esc)" onClick={() => setAiPopup(null)}>
              <IconClose />
            </button>
          </div>
          {aiPopup.status === "loading" && <div className="ai-suggest-status">Thinking…</div>}
          {aiPopup.status === "error" && <div className="ai-suggest-status ai-suggest-error">{aiPopup.error}</div>}
          {aiPopup.status === "ready" && aiPopup.suggestions.length === 0 && (
            <div className="ai-suggest-status">No suggestions.</div>
          )}
          {aiPopup.status === "ready" &&
            aiPopup.suggestions.map((s, i) => (
              <button key={i} className="ai-suggest-row" onClick={() => acceptAiSuggestion(s)}>
                <span className="ai-suggest-index">{i + 1}</span>
                <span className="ai-suggest-text">{s}</span>
              </button>
            ))}
          {aiPopup.status === "ready" && aiPopup.suggestions.length > 0 && (
            <div className="ai-suggest-hint">Tab/Enter · 1-{aiPopup.suggestions.length} · Esc</div>
          )}
        </div>
      )}
      {visible && nlPopup && (
        <div className="ai-suggest-popup">
          <div className="ai-suggest-header">
            <span>Generate command</span>
            <button title="Close (Esc)" onClick={() => setNlPopup(null)}>
              <IconClose />
            </button>
          </div>
          {nlPopup.status === "input" && (
            <div className="ai-suggest-status">
              <input
                autoFocus
                className="ai-nl-input"
                value={nlPopup.description}
                placeholder="Describe what you want to do…"
                onChange={(e) => setNlPopup({ status: "input", description: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setNlPopup(null);
                    termRef.current?.focus();
                  } else if (e.key === "Enter" && nlPopup.description.trim()) {
                    e.preventDefault();
                    void generateFromDescription(nlPopup.description.trim());
                  }
                }}
                onBlur={() => termRef.current?.focus()}
              />
            </div>
          )}
          {nlPopup.status === "loading" && <div className="ai-suggest-status">Thinking…</div>}
          {nlPopup.status === "error" && <div className="ai-suggest-status ai-suggest-error">{nlPopup.error}</div>}
          {nlPopup.status !== "loading" && <div className="ai-suggest-hint">Enter to generate · Esc to close</div>}
        </div>
      )}
      {visible && explainPopup && (
        <div className="ai-suggest-popup">
          <div className="ai-suggest-header">
            <span>Explain failure</span>
            <button title="Close (Esc)" onClick={() => setExplainPopup(null)}>
              <IconClose />
            </button>
          </div>
          {explainPopup.status === "loading" && <div className="ai-suggest-status">Thinking…</div>}
          {explainPopup.status === "error" && <div className="ai-suggest-status ai-suggest-error">{explainPopup.error}</div>}
          {explainPopup.status === "ready" && (
            <>
              <div className="ai-explain-text">{explainPopup.explanation}</div>
              {explainPopup.suggestedFix && (
                <button className="ai-suggest-row" onClick={insertExplainFix}>
                  <span className="ai-suggest-index">Fix</span>
                  <span className="ai-suggest-text">{explainPopup.suggestedFix}</span>
                </button>
              )}
              <div className="ai-suggest-hint">{explainPopup.suggestedFix ? "Click to insert the fix · " : ""}Esc to close</div>
            </>
          )}
        </div>
      )}
      {visible && blocksPanelOpen && (
        <BlocksPanel
          blocks={blocks}
          onClose={() => setBlocksPanelOpen(false)}
          onJumpTo={jumpToBlock}
          onCopyCommand={copyBlockCommand}
          onCopyOutput={copyBlockOutput}
          onRerun={rerunBlock}
          onToggleBookmark={toggleBlockBookmark}
          onExplain={(block) => void explainBlock(block)}
          explainBusyId={explainBusyId}
        />
      )}
    </>
  );
}
