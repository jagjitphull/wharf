import { useEffect, useState } from "react";
import type { UpdateCheckResult } from "@shared/types";
import { wharf } from "../../api/wharf";

export function UpdateSettings() {
  const [version, setVersion] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null); // null while loading
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    void wharf.update.getVersion().then(setVersion);
    void wharf.update.getAutoCheck().then(setAuto);
  }, []);

  async function check() {
    setChecking(true);
    try {
      setResult(await wharf.update.check());
    } finally {
      setChecking(false);
    }
  }

  async function toggleAuto(next: boolean) {
    setAuto(next);
    await wharf.update.setAutoCheck(next);
  }

  return (
    <>
      <p className="hint">Wharf {version ? `v${version}` : ""}</p>
      <div className="backup-actions">
        <button className="btn ghost small" onClick={check} disabled={checking}>
          {checking ? "Checking…" : "Check for updates"}
        </button>
        {result?.updateAvailable && result.releaseUrl && (
          <button className="btn small" onClick={() => void wharf.shell.openExternal(result.releaseUrl!)}>
            Get v{result.latestVersion}
          </button>
        )}
      </div>
      {result && (
        <div className="backup-message">
          {result.error
            ? `Couldn't check: ${result.error}.`
            : result.updateAvailable
              ? `Version ${result.latestVersion} is available (you have ${result.currentVersion}).`
              : `You're up to date (${result.currentVersion}).`}
        </div>
      )}
      <div className="appearance-row">
        <span className="appearance-label">Check on launch</span>
        <label className="toggle-switch">
          <input type="checkbox" checked={auto ?? true} disabled={auto === null} onChange={(e) => toggleAuto(e.target.checked)} />
          <span className="toggle-switch-track" />
        </label>
      </div>
      <p className="hint">
        Wharf never updates itself. A check asks GitHub whether a newer release exists (one request to api.github.com, nothing about you or
        your hosts is sent) and, if so, links to its download page. Launch checks only run in an installed build.
      </p>
    </>
  );
}
