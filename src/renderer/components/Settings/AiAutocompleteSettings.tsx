import { useEffect, useState } from "react";
import type { AiProvider } from "../../../shared/types";
import { useAiPrefsStore } from "../../state/aiPrefsStore";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import "./AiAutocompleteSettings.css";

interface ProviderMeta {
  id: AiProvider;
  label: string;
  /** Cloud providers only — Ollama has no key. */
  keyUrl?: string;
  keyPlaceholder?: string;
  defaultModel: string;
  modelHint: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "claude",
    label: "Claude (Anthropic)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    defaultModel: "claude-opus-5",
    modelHint: "Leave blank to use the default.",
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    defaultModel: "gpt-4o-mini",
    modelHint: "Leave blank to use the default.",
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    defaultModel: "gemini-2.5-flash",
    modelHint: "Leave blank to use the default.",
  },
  {
    id: "ollama",
    label: "Ollama (local, no key)",
    defaultModel: "",
    modelHint: "Required — the name of a model you've already pulled, e.g. llama3.1 or qwen2.5-coder.",
  },
];

export function AiAutocompleteSettings() {
  const { enabled, setEnabled } = useAiPrefsStore();
  const [provider, setProviderState] = useState<AiProvider | null>(null); // null while loading
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void wharf.ai.getProvider().then(setProviderState);
  }, []);

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    setConfigured(null);
    setKeyInput("");
    setMessage(null);
    setError(null);
    void Promise.all([wharf.ai.hasApiKey(provider), wharf.ai.getProviderConfig(provider)]).then(([hasKey, config]) => {
      if (cancelled) return;
      setConfigured(hasKey);
      setModelInput(config.model ?? "");
      setBaseUrlInput(config.baseUrl ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  async function changeProvider(next: AiProvider) {
    setProviderState(next);
    try {
      await wharf.ai.setProvider(next);
    } catch {
      /* the select still reflects `next`; a failed persist just means it reverts to the old provider next launch */
    }
  }

  async function saveKey() {
    if (!provider) return;
    const key = keyInput.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await wharf.ai.setApiKey(provider, key);
      setKeyInput("");
      setConfigured(true);
      setMessage("API key saved.");
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    if (!provider) return;
    if (!confirm("Remove the saved API key? Autocomplete stops working for this provider until you add a new one.")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await wharf.ai.clearApiKey(provider);
      setConfigured(false);
      setMessage("API key removed.");
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    if (!provider) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await wharf.ai.setProviderConfig(provider, {
        model: modelInput.trim() || undefined,
        baseUrl: provider === "ollama" ? baseUrlInput.trim() || undefined : undefined,
      });
      setMessage("Saved.");
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const meta = PROVIDERS.find((p) => p.id === provider) ?? null;

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
        Press <code>Ctrl/Cmd+Space</code> in any terminal to ask the active provider below for up to 3 completions of
        the command you're typing — grounded in your recent commands from this session. Nothing is sent unless you
        trigger it; each request sends only the current line, your recent command history, the host name, and your
        OS.
      </p>

      <div className="appearance-row">
        <span className="appearance-label">Provider</span>
        <select
          className="font-family-select"
          value={provider ?? ""}
          onChange={(e) => changeProvider(e.target.value as AiProvider)}
          disabled={!provider}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {meta && (
        <div className="appearance-row column">
          {meta.keyUrl ? (
            <>
              <span className="appearance-label">
                {meta.label} API key{" "}
                {configured === true && <span className="ai-key-status ai-key-status-ok">configured</span>}
                {configured === false && <span className="ai-key-status">not configured</span>}
              </span>
              <div className="ai-key-row">
                <input
                  type="password"
                  className="ai-key-input"
                  placeholder={configured ? "Enter a new key to replace it…" : meta.keyPlaceholder}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveKey()}
                />
                <button className="btn primary small" onClick={saveKey} disabled={busy || !keyInput.trim()}>
                  Save
                </button>
                {configured && (
                  <button className="btn ghost small" onClick={clearKey} disabled={busy}>
                    Clear
                  </button>
                )}
              </div>
              <p className="hint">
                Stored encrypted at rest the same way host passwords are — never leaves this device except in
                requests you trigger, sent directly to {meta.label.replace(/\s*\(.*\)/, "")}'s API.{" "}
                <a href={meta.keyUrl} target="_blank" rel="noreferrer">
                  Get an API key
                </a>
                .
              </p>
              <span className="appearance-label" style={{ marginTop: 4 }}>
                Model (default: {meta.defaultModel})
              </span>
              <div className="ai-key-row">
                <input
                  type="text"
                  className="ai-key-input"
                  placeholder={meta.defaultModel}
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveConfig()}
                />
                <button className="btn ghost small" onClick={saveConfig} disabled={busy}>
                  Save
                </button>
              </div>
              <p className="hint">{meta.modelHint}</p>
            </>
          ) : (
            <>
              <span className="appearance-label">Ollama server</span>
              <div className="ai-key-row">
                <input
                  type="text"
                  className="ai-key-input"
                  placeholder="Base URL, e.g. http://localhost:11434"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                />
              </div>
              <div className="ai-key-row" style={{ marginTop: 6 }}>
                <input
                  type="text"
                  className="ai-key-input"
                  placeholder="Model, e.g. llama3.1"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveConfig()}
                />
                <button className="btn ghost small" onClick={saveConfig} disabled={busy}>
                  Save
                </button>
              </div>
              <p className="hint">
                Base URL defaults to the standard local port if left blank. Model is required —{" "}
                {meta.modelHint.replace("Required — ", "")}
              </p>
            </>
          )}
        </div>
      )}

      {message && <div className="backup-message">{message}</div>}
      {error && <div className="dialog-error">{error}</div>}
    </div>
  );
}
