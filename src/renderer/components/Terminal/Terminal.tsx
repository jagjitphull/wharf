import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { wharf } from "../../api/wharf";
import { useThemeStore } from "../../state/themeStore";
import { useUiPrefsStore } from "../../state/uiPrefsStore";
import { useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { resolveXtermTheme } from "../../state/terminalThemes";
import { flattenPanes, useAppStore } from "../../state/store";
import { useKeywordHighlightStore } from "../../state/keywordHighlightStore";
import { useNotificationPrefsStore } from "../../state/notificationPrefsStore";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { SnippetPicker } from "../SnippetPicker/SnippetPicker";
import { buildTerminalThemeMenuItems } from "./TerminalThemeSwatches";
import {
  compileRules,
  createHighlightState,
  disposeAllDecorations,
  rescanViewport,
  scanAfterWrite,
  type CompiledRule,
} from "./keywordHighlight";
import { appendOutputTail, looksLikeSecretPrompt, shouldRecordTypedLine } from "./historyPolicy";
import { createBlockDecorator } from "./blockDecorations";
import { createCommandCaptureState, feedCommandCaptureDetailed } from "./commandCapture";
import { decodeOsc133CommandText, handleOsc133, notePendingCommand, type CommandBlock } from "./commandBlocks";
import {
  createGhostHistoryCache,
  createGhostTransitionMap,
  pushToGhostHistoryCache,
  recordGhostTransition,
  type GhostHistoryCache,
  type GhostTransitionMap,
} from "./ghostSuggestion";
import { BlocksPanel } from "./BlocksPanel";
import { AiSuggestPopup, ExplainPopup, NlPopup } from "./AiPopups";
import { TerminalSearchBar } from "./TerminalSearchBar";
import { useAiAssist } from "./useAiAssist";
import { useCommandBlocks } from "./useCommandBlocks";
import { useGhostSuggestion } from "./useGhostSuggestion";
import { notifyCommandFinished } from "./notifyCommandFinished";
import { registerScrollbackSource } from "./scrollbackRegistry";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

/** Cap on how much of a pane's scrollback gets captured into the "last
 * session" snapshot (see scrollbackRegistry.ts / state/store.ts) — a
 * reminder of recent context on restart, not a full transcript, so this
 * stays small regardless of how long a session's actually been scrolled
 * back for. */
const RESTORED_SCROLLBACK_MAX_LINES = 300;

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

/** Whether xterm's viewport is currently scrolled all the way down (i.e.
 * "following" live output) — checked before a resize so the fix below can
 * decide whether to re-anchor to the bottom afterward. FitAddon.fit()
 * changes the row count but doesn't itself preserve "am I following the
 * tail", so a pane that grows (e.g. the window being maximized) can leave
 * the newest lines — including the active prompt — scrolled just out of
 * view below the visible area, which reads as the prompt having vanished
 * behind whatever sits right below the pane (the status bar). */
function isScrolledToBottom(container: HTMLElement): boolean {
  const viewport = container.querySelector<HTMLElement>(".xterm-viewport");
  if (!viewport) return true;
  return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2;
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
  // The page itself is zoomed by Interface size, which would scale the terminal's text with it;
  // dividing it back out keeps a terminal exactly as big as its own font-size setting says.
  const uiZoom = useUiPrefsStore((s) => s.uiZoom);
  const fontFamily = useTerminalPrefsStore((s) => s.fontFamily);
  const globalTerminalThemeId = useTerminalPrefsStore((s) => s.terminalThemeId);
  const setPaneThemeId = useAppStore((s) => s.setPaneThemeId);
  const setPaneLogPath = useAppStore((s) => s.setPaneLogPath);
  const splitPane = useAppStore((s) => s.splitPane);
  const closeTerminal = useAppStore((s) => s.closeTerminal);
  const broadcastInput = useAppStore((s) => s.tabs.find((t) => t.tabId === tabId)?.broadcastInput ?? false);
  const toggleBroadcastInput = useAppStore((s) => s.toggleBroadcastInput);
  const keywordEnabled = useKeywordHighlightStore((s) => s.enabled);
  const keywordRules = useKeywordHighlightStore((s) => s.rules);
  const highlightStateRef = useRef(createHighlightState());
  const compiledRulesRef = useRef<CompiledRule[]>([]);
  const commandCaptureRef = useRef(createCommandCaptureState());
  const terminalThemeId = themeOverrideId ?? globalTerminalThemeId;
  const notifyOnLongCommand = useNotificationPrefsStore((s) => s.notifyOnLongCommand);
  const notifyOnLongCommandRef = useRef(notifyOnLongCommand);
  const visibleRef = useRef(visible);
  const historyCacheRef = useRef<GhostHistoryCache>([]);
  // "Next command" prediction (see ghostSuggestion.ts) — transitionMapRef
  // is built from this session's command history and updated as new
  // commands run; lastRunCommandRef is what to look a prediction up for;
  // atPromptRef is only true between an OSC 133 prompt-end (;B) and the next
  // command-start (;C), the one reliable "not mid-output" signal available.
  const transitionMapRef = useRef<GhostTransitionMap>(new Map());
  const lastRunCommandRef = useRef<string | null>(null);
  const atPromptRef = useRef(false);
  // What decides whether a typed line is a command or, say, a password (see
  // historyPolicy.ts): whether the shell reports its prompts at all, the tail of
  // the output so far.
  const integrationSeenRef = useRef(false);
  // Where the shell's prompt last ended (OSC 133;B): typing starts here, so what is on the
  // screen from here to the cursor is the real line (see typedLine.ts).
  const promptEndRef = useRef<{ marker: IMarker; column: number } | null>(null);
  const outputTailRef = useRef("");
  const secretPromptShownRef = useRef(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [snippetPickerOpen, setSnippetPickerOpen] = useState(false);
  const searchOpenRef = useRef(false);

  const {
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
  } = useCommandBlocks({ sessionId, termRef, commandCaptureRef });
  const {
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
  } = useAiAssist({ sessionId, termRef, commandCaptureRef });
  const {
    ghostSuggestionRef,
    recompute: recomputeGhostSuggestion,
    accept: acceptGhostSuggestion,
    dispose: disposeGhostSuggestion,
  } = useGhostSuggestion({
    termRef,
    commandCaptureRef,
    integrationSeenRef,
    promptEndRef,
    atPromptRef,
    historyCacheRef,
    transitionMapRef,
    lastRunCommandRef,
    suppressed: () => !!(aiPopupRef.current || nlPopupRef.current || searchOpenRef.current),
  });

  useEffect(() => {
    searchOpenRef.current = searchOpen;
    if (searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
    else termRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    notifyOnLongCommandRef.current = notifyOnLongCommand;
  }, [notifyOnLongCommand]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const notifyFinished = (block: CommandBlock) =>
    notifyCommandFinished(block, { sessionId, tabId, enabled: notifyOnLongCommandRef.current, visible: visibleRef.current });

  // Mounts the xterm instance exactly once per session (this component is
  // kept alive-but-hidden by the parent while its tab is in the background,
  // so scrollback/state survives switching tabs).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const initialTheme = resolveXtermTheme(terminalThemeId);
    const term = new XTerm({
      fontFamily: useTerminalPrefsStore.getState().fontFamily,
      fontSize: useTerminalPrefsStore.getState().fontSize / useUiPrefsStore.getState().uiZoom,
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
    // Default matcher (http/https only) — the main-process handler behind
    // this also refuses anything else, so this is belt-and-suspenders, not
    // the only guard against handing arbitrary terminal output to the OS.
    term.loadAddon(new WebLinksAddon((_event, uri) => void wharf.shell.openExternal(uri)));
    term.open(el);
    fitRef.current = fit;
    fit.fit();
    wharf.ssh.resize(sessionId, term.cols, term.rows);

    // Feeds this pane's live content into the "last session" snapshot (see
    // state/store.ts's persistLastSession) — capped so a long scrollback
    // doesn't bloat every periodic save, just enough to be a useful
    // reminder of recent context, not a full transcript.
    const serialize = new SerializeAddon();
    term.loadAddon(serialize);
    const unregisterScrollbackSource = registerScrollbackSource(sessionId, () =>
      serialize.serialize({ scrollback: RESTORED_SCROLLBACK_MAX_LINES }),
    );

    // Replays what was on screen right before this pane's previous
    // incarnation closed (see WorkspaceNode's own doc comment on
    // `scrollback`) — restoreLastSession() set this on paneMeta when it
    // reconnected this session; cleared immediately after so nothing ever
    // re-reads or reapplies it from here on.
    const restoredMeta = useAppStore.getState().paneMeta[sessionId];
    if (restoredMeta?.restoredScrollback) {
      term.write(restoredMeta.restoredScrollback);
      const when = restoredMeta.restoredScrollbackCapturedAt;
      term.write(
        `\x1b[2m\r\n── Previous session${when ? ` from ${new Date(when).toLocaleString()}` : ""} — resumed below ──\x1b[0m\r\n\r\n`,
      );
    }
    // This pane's original host couldn't be reconnected on restore and fell
    // back to a local shell (see connectWorkspaceNode) — surfaced here
    // rather than silently, so a changed pane is never a mysterious one.
    if (restoredMeta?.restoreNotice) {
      term.write(`\x1b[33m[${restoredMeta.restoreNotice}]\x1b[0m\r\n\r\n`);
    }
    if (restoredMeta?.restoredScrollback || restoredMeta?.restoreNotice) {
      useAppStore.getState().clearRestoreInfo(sessionId);
    }

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
    const who = () => {
      // hostId/hostName are read fresh here rather than threaded through
      // this closure's deps — they're set once when the pane connects and
      // never change for its lifetime, so a stale read is never actually
      // stale in practice.
      const meta = useAppStore.getState().paneMeta[sessionId];
      return { sessionId, hostId: meta?.hostId ?? null, hostName: meta?.title ?? "Unknown" };
    };
    // Offers a typed command to Command History (the main process decides whether to keep it)
    // and, if it was kept, to the things built from history.
    const recordCommand = (command: string, hidden: boolean) => {
      void wharf.commandHistory.add({ ...who(), command, hidden }).then((stored) => {
        if (!stored) return;
        // Makes a just-run command suggestible immediately, without waiting
        // on a re-fetch of the full history list.
        pushToGhostHistoryCache(historyCacheRef.current, command);
        // Same immediacy for "next command" prediction — this command now
        // becomes a real data point for whatever follows it, and the thing
        // to predict from once the shell's back at a prompt.
        recordGhostTransition(transitionMapRef.current, lastRunCommandRef.current, command);
        lastRunCommandRef.current = command;
      });
    };
    const blockDecorator = createBlockDecorator(term);
    const oscDisposable = term.parser.registerOscHandler(133, (payload) => {
      // A ";C;<base64>" payload also carries the shell's own authoritative
      // text for the command it's about to run — arrives a beat after
      // commandHistory.add() already recorded the keystroke-buffer's guess
      // (see the onData handler below), so this corrects that entry in
      // place rather than replacing the original synchronous write, which
      // keeps history responsive even over a slow SSH round trip.
      integrationSeenRef.current = true;
      if (payload.startsWith("C")) {
        atPromptRef.current = false;
        const [, arg] = payload.split(";");
        const shellCommandText = decodeOsc133CommandText(arg);
        // The main process pairs this with the guess recorded for the line (replacing it),
        // or records it on its own if there was none (typed ahead, or a re-run block).
        if (shellCommandText) void wharf.commandHistory.shellText(who(), shellCommandText);
      } else if (payload === "B") {
        promptEndRef.current?.marker.dispose();
        const marker = term.registerMarker(0);
        promptEndRef.current = marker ? { marker, column: term.buffer.active.cursorX } : null;
        // Prompt fully drawn, shell is ready for input right now — the one
        // reliable "not mid-output" signal a "next command" ghost suggestion
        // (see recomputeGhostSuggestion) needs before it's safe to show one.
        atPromptRef.current = true;
      }
      const updated = handleOsc133(term, commandBlocksRef.current, payload);
      if (updated) {
        setBlocks(updated);
        // "C" opens a block and "D" closes one; either way it's the newest entry
        // (only one can be open at a time), so that's the one to draw.
        const newest = updated[updated.length - 1];
        if (newest && payload.startsWith("C")) blockDecorator.start(newest);
        else if (newest && payload.startsWith("D")) blockDecorator.end(newest);
        blockDecorator.prune(new Set(updated.map((b) => b.id)));
      }
      // "D" always closes whatever block "C" most recently opened (only one
      // can be open at a time), so it's always the last entry once handled.
      if (updated && payload.startsWith("D")) {
        const closed = updated[updated.length - 1];
        if (closed) notifyFinished(closed);
      }
      return true;
    });

    const offData = wharf.ssh.onData((event) => {
      if (event.sessionId === sessionId) {
        outputTailRef.current = appendOutputTail(outputTailRef.current, event.chunk);
        secretPromptShownRef.current = looksLikeSecretPrompt(outputTailRef.current);
        term.write(event.chunk, () => {
          scanAfterWrite(term, compiledRulesRef.current, highlightStateRef.current);
          recomputeGhostSuggestion();
        });
      }
    });
    const offClosed = wharf.ssh.onClosed((event) => {
      if (event.sessionId === sessionId) {
        // A ghost suggestion anchored to the line the user was on stays
        // registered against its old marker/column otherwise — the write
        // below doesn't go through the onData/recomputeGhostSuggestion path
        // above, so nothing would ever clear it once the session's gone.
        disposeGhostSuggestion();
        term.write(`\r\n\x1b[31m[session closed${event.error ? `: ${event.error}` : ""}]\x1b[0m\r\n`);
      }
    });
    const offReconnecting = wharf.ssh.onReconnecting((event) => {
      if (event.sessionId === sessionId) {
        disposeGhostSuggestion();
        term.write(`\r\n\x1b[33m[connection lost — reconnecting… (attempt ${event.attempt}/${event.maxAttempts})]\x1b[0m\r\n`);
      }
    });
    const offReconnected = wharf.ssh.onReconnected((event) => {
      if (event.sessionId === sessionId) {
        term.write(`\r\n\x1b[32m[reconnected]\x1b[0m\r\n`);
      }
    });

    const dataDisposable = term.onData((data) => {
      // The suggestion currently showing (if any) was positioned against the
      // cursor/buffer state from before this keystroke — recomputeGhostSuggestion()
      // only re-runs once the shell's echo of this keystroke comes back (see
      // its own doc comment), which for anything less than perfectly instant
      // local echo leaves a window where the old decoration's text no longer
      // matches what's actually being typed. Clearing it immediately here
      // means it can only ever be stale by "briefly hidden while echo is in
      // flight", never by "showing the wrong text/position" — the flicker is
      // imperceptible locally and correct behavior over a laggier SSH link.
      disposeGhostSuggestion();
      wharf.ssh.write(sessionId, data);
      // Broadcast Input (tab context menu / right-click a pane) — mirrors
      // whatever's typed here to every other pane in this same tab. Read
      // fresh via getState() rather than a prop/ref, since which tab this
      // pane belongs to and that tab's broadcast flag can both change
      // without this pane remounting.
      const tab = useAppStore.getState().tabs.find((t) => t.tabId === tabId);
      if (tab?.broadcastInput) {
        for (const otherSessionId of flattenPanes(tab.layout)) {
          if (otherSessionId !== sessionId) wharf.ssh.write(otherSessionId, data);
        }
      }
      for (const { command, hidden } of feedCommandCaptureDetailed(commandCaptureRef.current, data)) {
        // A line typed while a command is running, or in answer to a password
        // prompt, is input to that program, not a command — never record it.
        const record = shouldRecordTypedLine({
          integrationSeen: integrationSeenRef.current,
          atPrompt: atPromptRef.current,
          secretPromptShown: secretPromptShownRef.current,
        });
        secretPromptShownRef.current = false;
        if (!record) continue;
        recordCommand(command, hidden);
        // Paired up with the next OSC 133;C (if this shell has integration)
        // to give the resulting block its command text — see commandBlocks.ts.
        if (!hidden) notePendingCommand(commandBlocksRef.current, command);
      }
    });

    // Seeds the ghost-suggestion history cache, the next-command transition
    // map, and "what was last run" from this host's (or, for a local shell,
    // this session's) past commands — scoped the same way the AI features'
    // "recent commands" context already is, so a suggestion never surfaces
    // something typed/run against an unrelated host.
    void wharf.commandHistory.list().then((entries) => {
      const meta = useAppStore.getState().paneMeta[sessionId];
      const scoped = entries.filter((e) => e.hostId === (meta?.hostId ?? null)).map((e) => e.command);
      historyCacheRef.current = createGhostHistoryCache(scoped);
      transitionMapRef.current = createGhostTransitionMap(scoped);
      lastRunCommandRef.current = scoped.length > 0 ? scoped[scoped.length - 1] : null;
    });

    const refit = () => {
      if (el.offsetParent === null) return; // hidden tab, skip
      const wasAtBottom = isScrolledToBottom(el);
      // A showing ghost suggestion was positioned (marker row + cursorX) for
      // the pixel-per-cell grid before this resize — fit() can change that
      // grid (and reflow which column onscreen content actually wraps to),
      // so the decoration's old coordinates can land on top of unrelated
      // real text instead of cleanly after the cursor. Safe to just drop it
      // here: the next real pty echo recomputes it fresh at the right spot.
      disposeGhostSuggestion();
      fit.fit();
      if (wasAtBottom) term.scrollToBottom();
      wharf.ssh.resize(sessionId, term.cols, term.rows);
    };

    const resizeObserver = new ResizeObserver(refit);
    resizeObserver.observe(el);

    // Belt-and-suspenders for window managers (reported on Pop!_OS/GNOME)
    // that animate a maximize/restore over several compositor frames:
    // ResizeObserver is supposed to fire for the true final size, but a
    // maximize that settles into a size matching an already-seen transient
    // frame won't fire again, leaving the pane fit to that transient size.
    // win.on("maximize"/"unmaximize") (see main/index.ts) fires once the OS
    // itself reports the state change, so a refit a beat after that — long
    // enough to outlast a typical WM animation — is a reliable correction
    // independent of ResizeObserver's own timing.
    const offMaximizedChange = wharf.window.onMaximizedChange(() => {
      setTimeout(refit, 250);
    });

    return () => {
      offData();
      offClosed();
      offReconnecting();
      offReconnected();
      dataDisposable.dispose();
      oscDisposable.dispose();
      blockDecorator.dispose();
      resizeObserver.disconnect();
      offMaximizedChange();
      // highlightStateRef's object identity never changes after the
      // useRef(createHighlightState()) call above — only its Map's entries
      // do — so reading .current here in cleanup isn't the stale-ref
      // hazard the lint rule is generally right to flag.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      disposeAllDecorations(highlightStateRef.current);
      disposeGhostSuggestion();
      unregisterScrollbackSource();
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
    term.options.fontSize = fontSize / uiZoom;
    const wasAtBottom = containerRef.current ? isScrolledToBottom(containerRef.current) : true;
    // Same reasoning as refit()'s own disposeGhostSuggestion() — a font/size
    // change resizes the cell grid a showing suggestion was positioned for.
    disposeGhostSuggestion();
    fitRef.current?.fit();
    if (wasAtBottom) term.scrollToBottom();
    wharf.ssh.resize(sessionId, term.cols, term.rows);
  }, [fontSize, uiZoom, fontFamily, sessionId]);

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
        // Same reasoning as refit()'s own disposeGhostSuggestion() — a
        // showing suggestion's position can't be trusted across a resize,
        // forced or real, and this pane may have kept receiving pty output
        // (and recomputing against a hidden, un-painted decoration) the
        // whole time it sat in a background tab.
        disposeGhostSuggestion();
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
      {
        label: broadcastInput ? "Stop Broadcasting Input" : "Broadcast Input to All Panes",
        onClick: () => toggleBroadcastInput(tabId),
      },
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
      <div ref={containerRef} className="terminal-pane" style={{ display: visible ? "block" : "none" }} onContextMenu={handleContextMenu} />
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
        <TerminalSearchBar
          inputRef={searchInputRef}
          query={searchQuery}
          onQueryChange={(q) => {
            setSearchQuery(q);
            findNext(q);
          }}
          onNext={findNext}
          onPrevious={findPrevious}
          onClose={() => setSearchOpen(false)}
        />
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
      {visible && aiPopup && <AiSuggestPopup popup={aiPopup} onClose={() => setAiPopup(null)} onAccept={acceptAiSuggestion} />}
      {visible && nlPopup && (
        <NlPopup
          popup={nlPopup}
          onChange={(description) => setNlPopup({ status: "input", description })}
          onSubmit={(description) => void generateFromDescription(description)}
          onCancel={() => {
            setNlPopup(null);
            termRef.current?.focus();
          }}
          onBlur={() => termRef.current?.focus()}
          onClose={() => setNlPopup(null)}
        />
      )}
      {visible && explainPopup && (
        <ExplainPopup popup={explainPopup} onClose={() => setExplainPopup(null)} onInsertFix={insertExplainFix} />
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
