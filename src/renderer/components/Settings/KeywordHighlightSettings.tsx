import { useState } from "react";
import { useKeywordHighlightStore } from "../../state/keywordHighlightStore";
import "./KeywordHighlightSettings.css";

const NEW_RULE_COLOR_PRESETS = [
  "#f2545b",
  "#e8d44d",
  "#4fd88a",
  "#54d6e8",
  "#b18cf0",
  "#f16fe0",
  "#e08a3c",
  "#8a92a3",
];

export function KeywordHighlightSettings() {
  const { enabled, rules, setEnabled, toggleRule, setRuleColor, addCustomRule, updateCustomRule, removeRule } =
    useKeywordHighlightStore();
  const [addingRule, setAddingRule] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newColor, setNewColor] = useState(NEW_RULE_COLOR_PRESETS[0]);
  const [patternError, setPatternError] = useState<string | null>(null);

  const builtIns = rules.filter((r) => r.builtIn);
  const custom = rules.filter((r) => !r.builtIn);

  function validatePattern(pattern: string): boolean {
    try {
      new RegExp(pattern);
      setPatternError(null);
      return true;
    } catch (err) {
      setPatternError(err instanceof Error ? err.message : "Invalid pattern");
      return false;
    }
  }

  function handleAddRule() {
    const label = newLabel.trim();
    const pattern = newPattern.trim();
    if (!label || !pattern || !validatePattern(pattern)) return;
    addCustomRule(label, pattern, newColor);
    setNewLabel("");
    setNewPattern("");
    setNewColor(NEW_RULE_COLOR_PRESETS[0]);
    setPatternError(null);
    setAddingRule(false);
  }

  return (
    <div className="keyword-highlight-settings">
      <div className="appearance-row">
        <span className="appearance-label">Keyword highlighting</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="toggle-switch-track" />
        </label>
      </div>

      <div className={`keyword-rule-list ${enabled ? "" : "disabled"}`}>
        {builtIns.map((rule) => (
          <div key={rule.id} className="keyword-rule-row">
            <label className="keyword-rule-checkbox">
              <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.id)} disabled={!enabled} />
              <span>{rule.label}</span>
            </label>
            <input
              type="color"
              className="keyword-rule-color"
              value={rule.color}
              disabled={!enabled}
              onChange={(e) => setRuleColor(rule.id, e.target.value)}
              title={`${rule.label} highlight color`}
            />
          </div>
        ))}

        {custom.length > 0 && <div className="keyword-rule-divider" />}

        {custom.map((rule) => (
          <div key={rule.id} className="keyword-rule-row">
            <label className="keyword-rule-checkbox">
              <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.id)} disabled={!enabled} />
              <span>{rule.label}</span>
              <code className="keyword-rule-pattern">{rule.pattern}</code>
            </label>
            <input
              type="color"
              className="keyword-rule-color"
              value={rule.color}
              disabled={!enabled}
              onChange={(e) => setRuleColor(rule.id, e.target.value)}
              title={`${rule.label} highlight color`}
            />
            <button
              type="button"
              className="keyword-rule-remove"
              title="Remove rule"
              disabled={!enabled}
              onClick={() => removeRule(rule.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {!addingRule ? (
        <p className="hint">
          Would you like to add custom rules to highlight output in the terminal?{" "}
          <button type="button" className="link-btn" disabled={!enabled} onClick={() => setAddingRule(true)}>
            Add a rule…
          </button>
        </p>
      ) : (
        <div className="keyword-rule-form">
          <div className="keyword-rule-form-row">
            <input
              placeholder="Label (e.g. Timeout)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <input
              type="color"
              className="keyword-rule-color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
            />
          </div>
          <input
            placeholder="Pattern (regex, e.g. \btimeout\b)"
            value={newPattern}
            onChange={(e) => {
              setNewPattern(e.target.value);
              if (patternError) validatePattern(e.target.value);
            }}
          />
          {patternError && <div className="dialog-error">{patternError}</div>}
          <div className="keyword-rule-form-actions">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                setAddingRule(false);
                setPatternError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary small"
              disabled={!newLabel.trim() || !newPattern.trim()}
              onClick={handleAddRule}
            >
              Add rule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
