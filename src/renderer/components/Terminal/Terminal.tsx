import { useEffect, useRef } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { wharf } from "../../api/wharf";
import { useThemeStore } from "../../state/themeStore";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface Props {
  sessionId: string;
  visible: boolean;
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
 * duplicated as hex literals in JS. */
function readXtermTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const theme: Record<string, string> = {};
  for (const [key, cssVar] of TERM_CSS_VARS) {
    const value = styles.getPropertyValue(cssVar).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

export function TerminalView({ sessionId, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const accent = useThemeStore((s) => s.accent);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  // Mounts the xterm instance exactly once per session (this component is
  // kept alive-but-hidden by the parent while its tab is in the background,
  // so scrollback/state survives switching tabs).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({
      fontFamily: "'SF Mono', Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: readXtermTheme(),
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fitRef.current = fit;
    fit.fit();
    wharf.ssh.resize(sessionId, term.cols, term.rows);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Live theme updates: re-read the CSS vars and hand xterm a new theme
  // object whenever the resolved light/dark mode or accent color changes,
  // without recreating the terminal (which would lose scrollback).
  useEffect(() => {
    termRef.current && (termRef.current.options.theme = readXtermTheme());
  }, [resolvedTheme, accent]);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => fitRef.current?.fit());
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
      { label: "Select All", onClick: () => term.selectAll() },
      { label: "Clear", onClick: () => term.clear() },
    ]);
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
    </>
  );
}
