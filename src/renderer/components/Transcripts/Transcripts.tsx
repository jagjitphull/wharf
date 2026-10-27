import { useEffect, useRef, useState } from "react";
import type { TranscriptInfo, TranscriptSearchResult, TranscriptSettings } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { useAppStore } from "../../state/store";
import { toast } from "../../state/toastStore";
import { IconSearch, IconTrash } from "../Icons/Icons";
import { highlightRuns } from "./highlight";
import { TranscriptViewer } from "./TranscriptViewer";
import "./Transcripts.css";

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightRuns(text, query).map((run, i) =>
        run.hit ? (
          <mark key={i} className="transcript-mark">
            {run.text}
          </mark>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

export function Transcripts() {
  const setActiveView = useAppStore((s) => s.setActiveView);
  const [settings, setSettings] = useState<TranscriptSettings | null>(null);
  const [list, setList] = useState<TranscriptInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TranscriptSearchResult | null>(null);
  const [open, setOpen] = useState<{ id: string; line?: number } | null>(null);
  const searchSeq = useRef(0);

  async function refresh() {
    setLoading(true);
    try {
      setList(await wharf.transcripts.list());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void wharf.transcripts.getSettings().then(setSettings);
    void refresh();
  }, []);

  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) {
      searchSeq.current++;
      setResult(null);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void wharf.transcripts.search(trimmed).then((r) => {
        if (seq === searchSeq.current) setResult(r); // a newer keystroke already replaced this search
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmed]);

  async function remove(info: TranscriptInfo) {
    if (!confirm(`Delete the transcript of ${info.hostName} from ${formatWhen(info.startedAt)}? This can't be undone.`)) return;
    try {
      await wharf.transcripts.remove(info.id);
      setOpen(null);
      await refresh();
    } catch (err) {
      toast.error(ipcErrorMessage(err));
    }
  }

  async function clearAll() {
    if (!confirm("Delete all session transcripts? This can't be undone.")) return;
    await wharf.transcripts.clear();
    setResult(null);
    setOpen(null);
    await refresh();
    toast.success("Transcripts deleted");
  }

  if (open) {
    return (
      <TranscriptViewer
        id={open.id}
        focusLine={open.line}
        query={trimmed}
        onBack={() => {
          setOpen(null);
          void refresh();
        }}
        onRemove={remove}
      />
    );
  }

  const byTranscript = new Map<string, { info: { hostName: string; startedAt: number }; matches: NonNullable<typeof result>["matches"] }>();
  for (const m of result?.matches ?? []) {
    const group = byTranscript.get(m.transcriptId) ?? { info: { hostName: m.hostName, startedAt: m.startedAt }, matches: [] };
    group.matches.push(m);
    byTranscript.set(m.transcriptId, group);
  }

  return (
    <div className="history-panel transcripts-panel">
      <div className="history-header">
        <div>
          <h2>Session output</h2>
          <div className="history-count">
            {list.length === 0 ? "Nothing recorded yet" : `${list.length} ${list.length === 1 ? "session" : "sessions"} recorded`}
          </div>
        </div>
        <button className="btn small danger" onClick={() => void clearAll()} disabled={list.length === 0}>
          <IconTrash size={13} />
          Delete all
        </button>
      </div>

      {settings && !settings.enabled && (
        <div className="transcripts-off" role="status">
          <span>Recording is off, so new sessions leave no searchable output.</span>
          <button className="btn small" onClick={() => setActiveView("settings")}>
            Turn it on in Settings
          </button>
        </div>
      )}
      <p className="history-hint">
        When recording is on, the text each terminal session printed is kept here so you can search it later — find where an error showed up
        or what a command returned last week. Full-screen programs (vim, top, less) are left out, and Mosh sessions are not recorded.
      </p>

      <label className="history-search transcripts-search">
        <IconSearch size={14} />
        <input
          className="history-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search everything your sessions printed…"
          aria-label="Search session output"
        />
      </label>

      {trimmed ? (
        <div className="transcripts-results" aria-live="polite">
          {result === null && <div className="history-empty">Searching…</div>}
          {result && result.matches.length === 0 && <div className="history-empty">No matches.</div>}
          {[...byTranscript.entries()].map(([id, group]) => (
            <section className="transcripts-group" key={id}>
              <h3 className="transcripts-group-title">
                <span className="history-host">{group.info.hostName}</span>
                <span className="transcripts-when">{formatWhen(group.info.startedAt)}</span>
              </h3>
              {group.matches.map((m) => (
                <button className="transcripts-match" key={`${id}:${m.line}`} onClick={() => setOpen({ id, line: m.line })}>
                  {m.before.map((l, i) => (
                    <span className="transcripts-ctx" key={`b${i}`}>
                      {l}
                    </span>
                  ))}
                  <span className="transcripts-hit">
                    <Highlighted text={m.text} query={trimmed} />
                  </span>
                  {m.after.map((l, i) => (
                    <span className="transcripts-ctx" key={`a${i}`}>
                      {l}
                    </span>
                  ))}
                </button>
              ))}
            </section>
          ))}
          {result?.truncated && (
            <div className="history-empty">Showing the first {result.matches.length} matches — narrow the search to see others.</div>
          )}
        </div>
      ) : (
        <div className="history-list">
          {loading && <div className="history-empty">Loading…</div>}
          {!loading && list.length === 0 && <div className="history-empty">No sessions recorded yet.</div>}
          {list.map((info) => (
            <div className="transcripts-row" key={info.id}>
              <button className="transcripts-open" onClick={() => setOpen({ id: info.id })}>
                <span className="transcripts-when">{formatWhen(info.startedAt)}</span>
                <span className="history-host" title={info.hostName}>
                  {info.hostName}
                </span>
                <span className="transcripts-size">{formatSize(info.bytes)}</span>
                {info.active && <span className="transcripts-live">recording</span>}
              </button>
              <button
                className="btn ghost small icon"
                title="Delete transcript"
                aria-label="Delete transcript"
                onClick={() => void remove(info)}
              >
                <IconTrash size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
