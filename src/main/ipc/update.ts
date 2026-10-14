import { app, BrowserWindow, ipcMain, net } from "electron";
import log from "electron-log/main";
import { IPC, type UpdateCheckResult } from "../../shared/types";
import { getUpdateCheckEnabled, setUpdateCheckEnabled } from "../services/store";
import { checkForUpdate } from "../services/updateCheck";

// Chromium's network stack (rather than Node's bundled fetch) so the user's
// OS proxy settings, and their certificate store, are honored.
const fetchViaChromium = net.fetch.bind(net);

/** The newer release the launch-time check found, kept so a window opened
 * after the check ran (New Window) can still show it. */
let available: UpdateCheckResult | null = null;

export function registerUpdateIpc(): void {
  ipcMain.handle(IPC.update.check, (): Promise<UpdateCheckResult> => checkForUpdate(app.getVersion(), fetchViaChromium));
  ipcMain.handle(IPC.update.getVersion, (): string => app.getVersion());
  ipcMain.handle(IPC.update.getAvailable, (): UpdateCheckResult | null => available);
  ipcMain.handle(IPC.update.getAutoCheck, (): boolean => getUpdateCheckEnabled());
  ipcMain.handle(IPC.update.setAutoCheck, (_event, enabled: boolean): void => {
    setUpdateCheckEnabled(enabled);
  });
}

/** One quiet background check shortly after launch. Packaged builds only (a
 * dev checkout's version number says nothing about releases), and only if
 * the user hasn't turned it off. Failures — offline, nothing published yet —
 * are logged and otherwise ignored: a failed background check isn't
 * something to interrupt anyone about. */
export function scheduleLaunchUpdateCheck(): void {
  if (!app.isPackaged || !getUpdateCheckEnabled()) return;
  setTimeout(() => {
    void checkForUpdate(app.getVersion(), fetchViaChromium).then((result) => {
      if (result.error) {
        log.info(`Launch update check: ${result.error}`);
        return;
      }
      if (!result.updateAvailable) return;
      available = result;
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.update.onAvailable, result);
    });
  }, 5000);
}
