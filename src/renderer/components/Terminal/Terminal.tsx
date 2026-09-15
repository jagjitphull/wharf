import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { useThemeStore } from "../../state/themeStore";
import { useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { getTerminalThemePreset } from "../../state/terminalThemes";
import { useAppStore } from "../../state/store";
import { useKeywordHighlightStore } from "../../state/keywordHighlightStore";
import { useAiPrefsStore } from "../../state/aiPrefsStore";
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
import { createCommandCaptureState, feedCommandCapture } from "./commandCapture";
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

const TERM_CSS_VARS = [
  ["background", "--term-bg"],
  ["foreground", "--term-fg"],
  ["cursor", "--term-cursor"],
  ["selectionBackground", "--term-selection"],
  ["black", "--term-black"],
  ["red", "--term-red"],
  ["green", "--term-green"],
  ["yellow", "--term-yellow"],
  ["blue", "--term-blue"],
  ["magenta", "--term-magenta"],
  ["cyan", "--term-cyan"],
  ["white", "--term-white"],
  ["brightBlack", "--term-bright-black"],
  ["brightRed", "--term-bright-red"],
  ["brightGreen", "--term-bright-green"],
  ["brightYellow", "--term-bright-yellow"],
  ["brightBlue", "--term-bright-blue"],
  ["brightMagenta", "--term-bright-magenta"],
  ["brightCyan", "--term-bright-cyan"],
  ["brightWhite", "--term-bright-white"],
] as const;

/** Builds an xterm.js theme from the current CSS custom properties, so the
 * terminal's colors are a single source of truth (global.css) rather than
 * duplicated as hex literals in JS. Used for the "Match App Theme" preset. */
function readAppCssTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const theme: Record<string, string> = {};
  for (const [key, cssVar] of TERM_CSS_VARS) {
    const value = styles.getPropertyValue(cssVar).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

/** Resolves the active xterm theme: a fixed preset palette, or (for the
 * "app" preset) the app's own light/dark + accent CSS custom properties. */
function resolveXtermTheme(themeId: string): ITheme {
  const preset = getTerminalThemePreset(themeId);
  return preset.theme ?? readAppCssTheme();
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
  const terminalThemeId = themeOverrideId ?? globalTerminalThemeId;
  const aiEnabled = useAiPrefsStore((s) => s.enabled);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [snippetPickerOpen, setSnippetPickerOpen] = useState(false);
  const [aiPopup, setAiPopup] = useState<AiPopupState | null>(null);
  const searchOpenRef = useRef(false);
  // Mirrors aiPopup/aiEnabled for the custom key handler below, which is
  // registered once at mount (see the searchOpenRef comment on the same
  // pattern) and would otherwise see a stale closure.
  const aiPopupRef = useRef<AiPopupState | null>(null);
  const aiEnabledRef = useRef(aiEnabled);

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

  /** Fires an AI autocomplete request for whatever's currently typed
   * (unsent) on this pane's line, sourced from the same buffer the command-
   * history capture already maintains — no separate tracking needed. */
  async function requestAiSuggestions() {
    const requestLine = commandCaptureRef.current.buffer;
    if (!requestLine) return; // nothing to complete
    setAiPopup({ status: "loading", suggestions: [], requestLine });
    try {
      const hasKey = await wharf.ai.hasApiKey();
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
    if (!popup || commandCaptureRef.current.buffer !== popup.requestLine) return;
    const delta = suggestion.slice(popup.requestLine.length);
    if (delta) termRef.current?.paste(delta);
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
      if ((event.metaKey || event.ctrlKey) && event.code === "Space") {
        if (aiEnabledRef.current) void requestAiSuggestions();
        return false;
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
      return true;
    });

    const offData = wharf.ssh.onData((event) => {
      if (event.sessionId === sessionId) {
        term.write(event.chunk, () => scanAfterWrite(term, compiledRulesRef.current, highlightStateRef.current));
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
      }
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
      resizeObserver.disconnect();
      disposeAllDecorations(highlightStateRef.current);
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
      {visible && <ContextMenu menu={menu} onClose={closeMenu} />}
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
            ↑
          </button>
          <button title="Next match (Enter)" onClick={() => findNext(searchQuery)}>
            ↓
          </button>
          <button title="Close (Esc)" onClick={() => setSearchOpen(false)}>
            ×
          </button>
        </div>
      )}
      {visible && snippetPickerOpen && (
        <SnippetPicker
          onClose={() => setSnippetPickerOpen(false)}
          onInsert={(command) => {
            termRef.current?.paste(command);
            setSnippetPickerOpen(false);
          }}
        />
      )}
      {visible && aiPopup && (
        <div className="ai-suggest-popup">
          <div className="ai-suggest-header">
            <span>AI suggestions</span>
            <button title="Close (Esc)" onClick={() => setAiPopup(null)}>
              ×
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
    </>
  );
}
