import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
import type { AppImageUpdater } from "electron-updater";
import { IPC, type SelfUpdateState } from "../../shared/types";

/**
 * In-place updating for the AppImage build: download the newer AppImage from
 * the GitHub release, swap it in for the file that is running, and relaunch.
 *
 * Only AppImages can do this. A .deb is owned by the package manager (and
 * installing one needs root), and a dev checkout has no release to update to,
 * so those keep the plain "a newer version exists, here's the download page"
 * behavior of updateCheck.ts. electron-updater's `AppImageUpdater` is used
 * directly instead of its platform-detected `autoUpdater`, which would pick a
 * .deb updater for .deb installs.
 *
 * Nothing here runs by itself: checking, downloading and restarting each
 * wait for the user's click. What it trusts is the same thing downloading the
 * file by hand trusts — the release on GitHub — plus the SHA-512 in the
 * release's latest-linux.yml, which electron-updater checks before it will
 * install anything. (There's no code signature on Linux to check beyond that.)
 */

/** Whether this process is an installed AppImage that can replace itself. */
export function canSelfUpdate(): boolean {
  return process.platform === "linux" && app.isPackaged && Boolean(process.env.APPIMAGE);
}

let state: SelfUpdateState = { phase: "idle" };
let updater: AppImageUpdater | null = null;

function setState(next: SelfUpdateState): void {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.update.onSelfUpdateState, state);
}

export function selfUpdateState(): SelfUpdateState {
  return state;
}

async function getUpdater(): Promise<AppImageUpdater> {
  if (updater) return updater;
  // Loaded on first use: it isn't needed unless someone asks to update.
  const { AppImageUpdater } = await import("electron-updater");
  const created = new AppImageUpdater();
  created.autoDownload = false;
  created.autoInstallOnAppQuit = false;
  created.allowDowngrade = false;
  created.allowPrerelease = false;
  created.logger = log;
  created.on("download-progress", (progress: { percent: number }) => {
    if (state.phase === "downloading") setState({ ...state, percent: Math.round(progress.percent) });
  });
  updater = created;
  return created;
}

/**
 * Checks for a newer release and downloads it. Progress and the outcome are
 * reported through the state (and IPC.update.onSelfUpdateState); this never
 * throws, so a caller that only cares about the state can ignore the result.
 * A second call while one is running, or after one has finished, does nothing.
 */
export async function downloadUpdate(): Promise<void> {
  if (!canSelfUpdate()) {
    setState({ phase: "error", error: "Updating in place only works from the AppImage build." });
    return;
  }
  if (state.phase === "checking" || state.phase === "downloading" || state.phase === "ready") return;

  setState({ phase: "checking" });
  try {
    const u = await getUpdater();
    const result = await u.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      setState({ phase: "error", error: "No newer version was found." });
      return;
    }
    const version = result.updateInfo.version;
    setState({ phase: "downloading", version, percent: 0 });
    await u.downloadUpdate();
    setState({ phase: "ready", version });
  } catch (err) {
    log.error("Self-update failed:", err);
    setState({ phase: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

/** Quits, swaps the downloaded AppImage in for the running one, and starts it. */
export function installUpdate(): void {
  if (state.phase !== "ready" || !updater) throw new Error("There is no downloaded update to install.");
  // (isSilent, isForceRunAfter): no installer UI exists for an AppImage, and
  // the point is to come back running the new version.
  updater.quitAndInstall(false, true);
}
