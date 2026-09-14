import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { wharf } from "../../api/wharf";
import { useThemeStore } from "../../state/themeStore";
import { useTerminalPrefsStore } from "../../state/terminalPrefsStore";
import { getTerminalThemePreset } from "../../state/terminalThemes";
import { useAppStore } from "../../state/store";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { SnippetPicker } from "../SnippetPicker/SnippetPicker";
import { buildTerminalThemeMenuItems } from "./TerminalThemeSwatches";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface Props {
  sessionId: string;
  visible: boolean;
  /** Per-tab color theme override (from TerminalTab.themeId), taking
   * priority over the global Settings choice. undefined defers to it. */
  themeOverrideId?: string;
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

export function TerminalView({ sessionId, visible, themeOverrideId }: Props) {
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
  const setTabThemeId = useAppStore((s) => s.setTabThemeId);
  const terminalThemeId = themeOverrideId ?? globalTerminalThemeId;
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [snippetPickerOpen, setSnippetPickerOpen] = useState(false);
  const searchOpenRef = useRef(false);

  useEffect(() => {
    searchOpenRef.current = searchOpen;
    if (searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
    else termRef.current?.focus();
  }, [searchOpen]);

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
      return true;
    });

    const offData = wharf.ssh.onData((event) => {
      if (event.sessionId === sessionId) term.write(event.chunk);
    });
    const offClosed = wharf.ssh.onClosed((event) => {
      if (event.sessionId === sessionId) {
        term.write(`\r\n\x1b[31m[session closed${event.error ? `: ${event.error}` : ""}]\x1b[0m\r\n`);
      }
    });

    const dataDisposable = term.onData((data) => {
      wharf.ssh.write(sessionId, data);
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
      dataDisposable.dispose();
      resizeObserver.disconnect();
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
      { label: "Select All", onClick: () => term.selectAll() },
      { label: "Clear", onClick: () => term.clear() },
      // Picking any preset here — "Match App Theme" included — sets an
      // explicit per-tab override, same as picking one always would; a tab
      // only falls back to the global Settings choice until its own menu
      // is used for the first time.
      ...buildTerminalThemeMenuItems(terminalThemeId, (id) => setTabThemeId(sessionId, id)),
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
    </>
  );
}
