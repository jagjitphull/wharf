import { useEffect, useState } from "react";
import { wharf } from "../../api/wharf";
import "./TitleBar.css";

const isMac = wharf.window.platform === "darwin";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    wharf.window.isMaximized().then(setMaximized);
    return wharf.window.onMaximizedChange(setMaximized);
  }, []);

  return (
    <div
      className={`title-bar ${isMac ? "mac" : ""}`}
      onDoubleClick={() => wharf.window.toggleMaximize()}
    >
      <div className="title-bar-left">
        <span className="title-bar-brand">⚓ Wharf</span>
        <button
          className="title-bar-icon-btn"
          title="New Window"
          onClick={(e) => {
            e.stopPropagation();
            wharf.window.newWindow();
          }}
        >
          ⧉
        </button>
      </div>

      {!isMac && (
        <div className="title-bar-controls">
          <button title="Minimize" onClick={() => wharf.window.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          <button title={maximized ? "Restore" : "Maximize"} onClick={() => wharf.window.toggleMaximize()}>
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="1.5" y="0" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect x="0" y="2.5" width="7" height="7" fill="var(--bg-sidebar)" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="0" y="0" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            )}
          </button>
          <button className="title-bar-close" title="Close" onClick={() => wharf.window.close()}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
              <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
