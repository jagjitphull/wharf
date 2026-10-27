import { IconClose } from "../Icons/Icons";

export interface AiPopupState {
  status: "loading" | "ready" | "error";
  suggestions: string[];
  error?: string;
  /** The current line as of when this request was fired — used both to
   * compute the keystroke delta on accept and to detect staleness (the
   * user kept typing while waiting on the API, so the suggestions no
   * longer apply to what's actually on the line). */
  requestLine: string;
}

export interface ExplainPopupState {
  status: "loading" | "ready" | "error";
  command: string;
  explanation?: string;
  suggestedFix?: string;
  error?: string;
}

export interface NlPopupState {
  status: "input" | "loading" | "error";
  description: string;
  error?: string;
}

export function AiSuggestPopup({ popup, onClose, onAccept }: { popup: AiPopupState; onClose(): void; onAccept(suggestion: string): void }) {
  return (
    <div className="ai-suggest-popup">
      <div className="ai-suggest-header">
        <span>AI suggestions</span>
        <button title="Close (Esc)" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {popup.status === "loading" && <div className="ai-suggest-status">Thinking…</div>}
      {popup.status === "error" && <div className="ai-suggest-status ai-suggest-error">{popup.error}</div>}
      {popup.status === "ready" && popup.suggestions.length === 0 && <div className="ai-suggest-status">No suggestions.</div>}
      {popup.status === "ready" &&
        popup.suggestions.map((s, i) => (
          <button key={i} className="ai-suggest-row" onClick={() => onAccept(s)}>
            <span className="ai-suggest-index">{i + 1}</span>
            <span className="ai-suggest-text">{s}</span>
          </button>
        ))}
      {popup.status === "ready" && popup.suggestions.length > 0 && (
        <div className="ai-suggest-hint">Tab/Enter · 1-{popup.suggestions.length} · Esc</div>
      )}
    </div>
  );
}

export function NlPopup({
  popup,
  onChange,
  onSubmit,
  onCancel,
  onBlur,
  onClose,
}: {
  popup: NlPopupState;
  onChange(description: string): void;
  onSubmit(description: string): void;
  /** Escape in the input: close and give the terminal focus back. */
  onCancel(): void;
  onBlur(): void;
  onClose(): void;
}) {
  return (
    <div className="ai-suggest-popup">
      <div className="ai-suggest-header">
        <span>Generate command</span>
        <button title="Close (Esc)" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {popup.status === "input" && (
        <div className="ai-suggest-status">
          <input
            autoFocus
            className="ai-nl-input"
            value={popup.description}
            placeholder="Describe what you want to do…"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              } else if (e.key === "Enter" && popup.description.trim()) {
                e.preventDefault();
                onSubmit(popup.description.trim());
              }
            }}
            onBlur={onBlur}
          />
        </div>
      )}
      {popup.status === "loading" && <div className="ai-suggest-status">Thinking…</div>}
      {popup.status === "error" && <div className="ai-suggest-status ai-suggest-error">{popup.error}</div>}
      {popup.status !== "loading" && <div className="ai-suggest-hint">Enter to generate · Esc to close</div>}
    </div>
  );
}

export function ExplainPopup({ popup, onClose, onInsertFix }: { popup: ExplainPopupState; onClose(): void; onInsertFix(): void }) {
  return (
    <div className="ai-suggest-popup">
      <div className="ai-suggest-header">
        <span>Explain failure</span>
        <button title="Close (Esc)" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      {popup.status === "loading" && <div className="ai-suggest-status">Thinking…</div>}
      {popup.status === "error" && <div className="ai-suggest-status ai-suggest-error">{popup.error}</div>}
      {popup.status === "ready" && (
        <>
          <div className="ai-explain-text">{popup.explanation}</div>
          {popup.suggestedFix && (
            <button className="ai-suggest-row" onClick={onInsertFix}>
              <span className="ai-suggest-index">Fix</span>
              <span className="ai-suggest-text">{popup.suggestedFix}</span>
            </button>
          )}
          <div className="ai-suggest-hint">{popup.suggestedFix ? "Click to insert the fix · " : ""}Esc to close</div>
        </>
      )}
    </div>
  );
}
