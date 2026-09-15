import { useEffect } from "react";
import { wharf } from "../../api/wharf";
import "../../styles/dialog.css";
import "./KeyboardShortcuts.css";

const isMac = wharf.window.platform === "darwin";
const MOD = isMac ? "Cmd" : "Ctrl";

interface Shortcut {
  keys: string;
  description: string;
}

interface Group {
  title: string;
  shortcuts: Shortcut[];
}

const GROUPS: Group[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: `${MOD}+K`, description: "Quick Connect — jump to a host from anywhere" },
      { keys: `${MOD}+B`, description: "Show/hide the sidebar" },
      { keys: `${MOD}+1 … ${MOD}+9`, description: "Switch to tab 1 through 9" },
      { keys: `${MOD}+Tab`, description: "Next tab" },
      { keys: `${MOD}+Shift+Tab`, description: "Previous tab" },
      { keys: `${MOD}+/`, description: "Show this shortcuts reference" },
    ],
  },
  {
    title: "Terminal",
    shortcuts: [
      { keys: `${MOD}+F`, description: "Find in the terminal" },
      { keys: "Esc", description: "Close find, or dismiss the AI suggestions popup" },
      { keys: `${MOD}+Space`, description: "Ask the AI for autocomplete suggestions" },
      { keys: "Tab / Enter", description: "Accept the top AI suggestion" },
      { keys: "1 … 9", description: "Accept AI suggestion N (while the popup is open)" },
      { keys: `${MOD}+=`, description: "Increase terminal font size" },
      { keys: `${MOD}+-`, description: "Decrease terminal font size" },
      { keys: `${MOD}+0`, description: "Reset terminal font size" },
      { keys: "Right-click", description: "Copy/paste/select all/clear, split pane, insert snippet, theme, logging" },
    ],
  },
  {
    title: "SFTP file editor",
    shortcuts: [
      { keys: `${MOD}+S`, description: "Save the file" },
      { keys: "Esc", description: "Close (asks first if there are unsaved changes)" },
      { keys: "Tab", description: "Insert a literal tab character" },
    ],
  },
  {
    title: "Pickers (Quick Connect, snippets, etc.)",
    shortcuts: [
      { keys: "↑ / ↓", description: "Move the selection" },
      { keys: "Enter", description: "Choose the selected item" },
      { keys: "Esc", description: "Close" },
    ],
  },
];

interface Props {
  onClose(): void;
}

export function KeyboardShortcuts({ onClose }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog shortcuts-dialog">
        <div className="shortcuts-header">
          <h2>Keyboard shortcuts</h2>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="shortcuts-groups">
          {GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-group">
              <h3>{group.title}</h3>
              {group.shortcuts.map((s) => (
                <div key={s.keys} className="shortcut-row">
                  <kbd>{s.keys}</kbd>
                  <span>{s.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
