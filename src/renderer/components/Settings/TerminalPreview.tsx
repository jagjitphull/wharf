import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { resolveXtermTheme } from "../../state/terminalThemes";
import "@xterm/xterm/css/xterm.css";

interface Props {
  themeId: string;
  fontFamily: string;
  fontSize: number;
}

// Written once on mount — a fixed little "session" that shows off the
// palette's full range (all 16 ANSI colors, not just whichever ones a real
// shell happens to use) rather than anything live. Re-rendered against
// whatever theme/font is picked via term.options below, xterm.js redraws
// this same buffer content in the new colors without needing to be
// rewritten.
const PREVIEW_LINES = [
  "\x1b[90m~/project\x1b[0m \x1b[92m❯\x1b[0m ls --color",
  "\x1b[34msrc\x1b[0m  \x1b[34mdist\x1b[0m  \x1b[32mbuild.sh\x1b[0m  README.md  package.json",
  "\x1b[90m~/project\x1b[0m \x1b[92m❯\x1b[0m git status -sb",
  "## main...origin/main",
  " \x1b[31mM\x1b[0m src/index.ts",
  " \x1b[32mA\x1b[0m src/theme.ts",
  "\x1b[90m~/project\x1b[0m \x1b[92m❯\x1b[0m npm test",
  "\x1b[32m✓\x1b[0m 12 passed  \x1b[31m✗\x1b[0m 1 failed  \x1b[33m⚠\x1b[0m 2 skipped",
  "\x1b[31merror\x1b[0m \x1b[33mwarn\x1b[0m \x1b[34minfo\x1b[0m \x1b[36mdebug\x1b[0m \x1b[35mtrace\x1b[0m",
  "\x1b[90m~/project\x1b[0m \x1b[92m❯\x1b[0m \x1b[7m \x1b[0m",
].join("\r\n");

/** A small, non-interactive xterm.js instance used purely to preview a
 * terminal color theme + font choice live — Settings itself isn't a
 * terminal, so without this the only way to see a theme/font change was to
 * close Settings and look at a real session. */
export function TerminalPreview({ themeId, fontFamily, fontSize }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      theme: resolveXtermTheme(themeId),
      fontFamily,
      fontSize,
      disableStdin: true,
      cursorBlink: false,
      scrollback: 0,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    term.write(PREVIEW_LINES);
    fit.fit();
    termRef.current = term;

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // Intentionally mount-once: theme/font/size are pushed onto the live
    // instance below rather than tearing it down and recreating it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Match App Theme" resolves off the app's own CSS custom properties —
  // those change whenever light/dark mode or accent color changes
  // elsewhere in this same Settings screen, so this preview needs to
  // re-resolve on every relevant render, not just when themeId itself
  // changes. Cheap enough (16 getComputedStyle reads) to just always do.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = resolveXtermTheme(themeId);
  });

  useEffect(() => {
    if (termRef.current) termRef.current.options.fontFamily = fontFamily;
  }, [fontFamily]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.fontSize = fontSize;
  }, [fontSize]);

  return <div className="settings-preview-term" ref={containerRef} />;
}
