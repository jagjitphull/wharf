import { useEffect, useState } from "react";
import { useAiPrefsStore } from "../../state/aiPrefsStore";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import "./AiAutocompleteSettings.css";

export function AiAutocompleteSettings() {
  const { enabled, setEnabled } = useAiPrefsStore();
  const [configured, setConfigured] = useState<boolean | null>(null); // null while loading
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void wharf.ai.hasApiKey().then(setConfigured);
  }, []);

  async function save() {
    const key = keyInput.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await wharf.ai.setApiKey(key);
      setKeyInput("");
      setConfigured(true);
      setMessage("API key saved.");
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm("Remove the saved AI API key? Autocomplete stops working until you add a new one.")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await wharf.ai.clearApiKey();
      setConfigured(false);
      setMessage("API key removed.");
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-settings">
      <div className="appearance-row">
        <span className="appearance-label">AI autocomplete</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="toggle-switch-track" />
        </label>
      </div>

      <p className="hint">
        Press <code>Ctrl/Cmd+Space</code> in any terminal to ask Claude for up to 3 completions of the command
        you're typing — grounded in your recent commands from this session. Nothing is sent unless you trigger it;
        each request sends only the current line, your recent command history, the host name, and your OS.
      </p>

      <div className="appearance-row column">
        <span className="appearance-label">
          Claude API key{" "}
          {configured === true && <span className="ai-key-status ai-key-status-ok">configured</span>}
          {configured === false && <span className="ai-key-status">not configured</span>}
        </span>
        <div className="ai-key-row">
          <input
            type="password"
            className="ai-key-input"
            placeholder={configured ? "Enter a new key to replace it…" : "sk-ant-…"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <button className="btn primary small" onClick={save} disabled={busy || !keyInput.trim()}>
            Save
          </button>
          {configured && (
            <button className="btn ghost small" onClick={clear} disabled={busy}>
              Clear
            </button>
          )}
        </div>
        <p className="hint">
          Stored encrypted at rest the same way host passwords are — never leaves this device except in requests you
          trigger, sent directly to the Anthropic API.{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            Get an API key
          </a>
          .
        </p>
      </div>

      {message && <div className="backup-message">{message}</div>}
      {error && <div className="dialog-error">{error}</div>}
    </div>
  );
}
