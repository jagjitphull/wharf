import { useEffect, useState } from "react";
import type { SelfUpdateState, UpdateCheckResult } from "@shared/types";
import { wharf } from "../../api/wharf";

export function UpdateSettings() {
  const [version, setVersion] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null); // null while loading
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  // An installed AppImage can replace itself; any other build gets a link to the download page.
  const [canSelfUpdate, setCanSelfUpdate] = useState(false);
  const [selfUpdate, setSelfUpdate] = useState<SelfUpdateState>({ phase: "idle" });

  useEffect(() => {
    void wharf.update.getVersion().then(setVersion);
    void wharf.update.getAutoCheck().then(setAuto);
    void wharf.update.canSelfUpdate().then(setCanSelfUpdate);
    void wharf.update.selfUpdateState().then(setSelfUpdate);
    return wharf.update.onSelfUpdateState(setSelfUpdate);
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
        {result?.updateAvailable && canSelfUpdate && (
          <>
            {selfUpdate.phase === "ready" ? (
              <button className="btn small" onClick={() => void wharf.update.installUpdate()}>
                Restart to install v{selfUpdate.version}
              </button>
            ) : (
              <button
                className="btn small"
                disabled={selfUpdate.phase === "checking" || selfUpdate.phase === "downloading"}
                onClick={() => void wharf.update.downloadUpdate()}
              >
                {selfUpdate.phase === "checking"
                  ? "Checking…"
                  : selfUpdate.phase === "downloading"
                    ? `Downloading… ${selfUpdate.percent ?? 0}%`
                    : `Download and install v${result.latestVersion}`}
              </button>
            )}
          </>
        )}
        {result?.updateAvailable && result.releaseUrl && (!canSelfUpdate || selfUpdate.phase === "error") && (
          <button className="btn small" onClick={() => void wharf.shell.openExternal(result.releaseUrl!)}>
            Get v{result.latestVersion}
          </button>
        )}
      </div>
      {canSelfUpdate && selfUpdate.phase === "error" && (
        <div className="secret-warning" role="alert">
          Couldn't update in place: {selfUpdate.error} You can still download the new version from the release page.
        </div>
      )}
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
        Wharf never installs anything without a click. A check asks GitHub whether a newer release exists (one request to api.github.com,
        nothing about you or your hosts is sent). The AppImage build can then download and install it in place, verified against the
        checksum published with the release; other builds link to the download page. Launch checks only run in an installed build.
      </p>
    </>
  );
}
