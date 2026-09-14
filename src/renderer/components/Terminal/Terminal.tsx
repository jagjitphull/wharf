import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { wharf } from "../../api/wharf";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface Props {
  sessionId: string;
  visible: boolean;
}

export function TerminalView({ sessionId, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);

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
      theme: {
        background: "#0d0f14",
        foreground: "#d8dee9",
      },
    });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => fitRef.current?.fit());
    }
  }, [visible]);

  return <div ref={containerRef} className="terminal-pane" style={{ display: visible ? "block" : "none" }} />;
}
