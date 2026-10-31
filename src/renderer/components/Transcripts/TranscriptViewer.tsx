import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TranscriptContent, TranscriptInfo } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { toast } from "../../state/toastStore";
import { IconArrowLeft, IconChevronDown, IconChevronUp, IconCopy, IconDownload, IconTrash } from "../Icons/Icons";
import { highlightRuns } from "./highlight";

/** Fixed, so a transcript of any length scrolls smoothly while only the visible rows exist. */
const ROW_HEIGHT = 20;
const OVERSCAN = 20;

interface Props {
  id: string;
  /** Line to scroll to and mark, when arriving from a search result. */
  focusLine?: number;
  query: string;
  onBack(): void;
  onRemove(info: TranscriptInfo): void;
}

export function TranscriptViewer({ id, focusLine, query, onBack, onRemove }: Props) {
  const [content, setContent] = useState<TranscriptContent | null | undefined>(undefined); // undefined = loading
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [current, setCurrent] = useState<number | null>(focusLine ?? null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void wharf.transcripts.read(id).then((c) => {
      if (!cancelled) setContent(c);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const lines = content?.lines;
  const needle = query.trim().toLowerCase();
  const matchLines = useMemo(() => {
    if (!lines || !needle) return [];
    const found: number[] = [];
    lines.forEach((l, i) => {
      if (l.text.toLowerCase().includes(needle)) found.push(i);
    });
    return found;
  }, [lines, needle]);

  const scrollToLine = useCallback((line: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = Math.max(0, line * ROW_HEIGHT - el.clientHeight / 2);
    setCurrent(line);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !lines) return;
    setViewportHeight(el.clientHeight);
    if (focusLine !== undefined) scrollToLine(focusLine);
    else el.scrollTop = Math.max(0, lines.length * ROW_HEIGHT - el.clientHeight); // a transcript opens at its end, like a terminal
    // opened once per transcript
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [content]);

  function step(direction: 1 | -1) {
    if (matchLines.length === 0) return;
    const from = current ?? (direction === 1 ? -1 : lines!.length);
    const next =
      direction === 1
        ? (matchLines.find((l) => l > from) ?? matchLines[0])
        : ([...matchLines].reverse().find((l) => l < from) ?? matchLines[matchLines.length - 1]);
    scrollToLine(next);
  }

  async function saveAs() {
    try {
      const path = await wharf.transcripts.saveAs(id);
      if (path) toast.success(`Saved to ${path}`);
    } catch (err) {
      toast.error(ipcErrorMessage(err));
    }
  }

  function copyAll() {
    if (!lines) return;
    wharf.clipboard.writeText(lines.map((l) => l.text).join("\n"));
    toast.success("Transcript copied");
  }

  if (content === undefined) return <div className="history-panel">Loading…</div>;
  if (content === null) {
    return (
      <div className="history-panel">
        <button className="btn ghost small" onClick={onBack}>
          <IconArrowLeft size={13} />
          Back
        </button>
        <div className="history-empty">
          This transcript can't be read (it was deleted, or it is sealed by a master password that is locked).
        </div>
      </div>
    );
  }

  const { info } = content;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(content.lines.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const rows = [];
  for (let i = first; i < last; i++) {
    const text = content.lines[i].text;
    rows.push(
      <div
        key={i}
        className={`transcript-line ${i === current ? "current" : ""}`}
        style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
        data-line={i}
      >
        <span className="transcript-gutter">{i + 1}</span>
        <span className="transcript-text">
          {highlightRuns(text, query).map((run, k) =>
            run.hit ? (
              <mark key={k} className="transcript-mark">
                {run.text}
              </mark>
            ) : (
              run.text
            ),
          )}
        </span>
      </div>,
    );
  }

  return (
    <div className="history-panel transcript-viewer">
      <div className="transcript-toolbar">
        <button className="btn ghost small" onClick={onBack}>
          <IconArrowLeft size={13} />
          Back
        </button>
        <div className="transcript-title">
          <strong>{info.hostName}</strong>
          <span className="transcripts-when">{new Date(info.startedAt).toLocaleString()}</span>
          {info.active && <span className="transcripts-live">recording</span>}
        </div>
        {needle && (
          <div className="transcript-find" aria-live="polite">
            <span>
              {matchLines.length === 0
                ? "No matches here"
                : `${current !== null && matchLines.includes(current) ? matchLines.indexOf(current) + 1 : "–"} of ${matchLines.length}`}
            </span>
            <button
              className="btn ghost small icon"
              title="Previous match"
              aria-label="Previous match"
              disabled={matchLines.length === 0}
              onClick={() => step(-1)}
            >
              <IconChevronUp size={13} />
            </button>
            <button
              className="btn ghost small icon"
              title="Next match"
              aria-label="Next match"
              disabled={matchLines.length === 0}
              onClick={() => step(1)}
            >
              <IconChevronDown size={13} />
            </button>
          </div>
        )}
        <div className="transcript-actions">
          <button className="btn ghost small" onClick={copyAll}>
            <IconCopy size={13} />
            Copy
          </button>
          <button className="btn ghost small" onClick={() => void saveAs()}>
            <IconDownload size={13} />
            Save as text…
          </button>
          <button className="btn ghost small danger" onClick={() => onRemove(info)}>
            <IconTrash size={13} />
            Delete
          </button>
        </div>
      </div>
      {content.lines.length === 0 ? (
        <div className="history-empty">Nothing was printed in this session yet.</div>
      ) : (
        <div className="transcript-scroller" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} tabIndex={0}>
          <div className="transcript-canvas" style={{ height: content.lines.length * ROW_HEIGHT }}>
            {rows}
          </div>
        </div>
      )}
    </div>
  );
}
