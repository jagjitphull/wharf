import { BrowserWindow, ipcMain } from "electron";
import { IPC, type SecretStorageStatus } from "../../shared/types";
import { createAutoLock } from "../services/autoLock";
import { normalizeAutoLockMinutes } from "../../shared/autoLock";
import { getAutoLockMinutes, setAutoLockMinutes } from "../services/store";
import {
  changeMasterPassword,
  countUnencryptedSecrets,
  enableMasterPassword,
  isEncryptionAvailable,
  lock,
  masterPasswordState,
  removeMasterPassword,
  resetSecrets,
  unlock,
} from "../services/secretStore";

/** `onUnlocked` runs after the right password was entered, so anything that
 * needed a saved secret at launch (tunnels set to start automatically) and
 * had to be skipped while locked can run now. */
export function registerSecretsIpc(onUnlocked: () => void): void {
  // Only the end-to-end tests set this, to make "5 minutes" pass in seconds.
  const timeScale = Number(process.env.WHARF_E2E_TIME_SCALE) > 0 ? Number(process.env.WHARF_E2E_TIME_SCALE) : 1;
  const autoLock = createAutoLock({
    minutes: () => getAutoLockMinutes() * timeScale,
    isUnlocked: () => masterPasswordState() === "unlocked",
    lock,
    onLocked: () => broadcastLocked(),
    now: Date.now,
  });
  // Checked every few seconds rather than with one long timer, so a changed setting or activity needs no rescheduling.
  setInterval(() => autoLock.check(), Math.max(250, 15_000 * timeScale)).unref();
  ipcMain.on(IPC.secrets.activity, () => autoLock.touch());

  ipcMain.handle(IPC.secrets.status, (): SecretStorageStatus => {
    const masterPassword = masterPasswordState();
    return {
      encrypted: isEncryptionAvailable() || masterPassword !== "none",
      masterPassword,
      keyringAvailable: isEncryptionAvailable(),
      unencryptedCount: countUnencryptedSecrets(),
    };
  });
  ipcMain.handle(IPC.secrets.setMasterPassword, (_e, password: string) => enableMasterPassword(String(password)));
  ipcMain.handle(IPC.secrets.changeMasterPassword, (_e, current: string, next: string) =>
    changeMasterPassword(String(current), String(next)),
  );
  ipcMain.handle(IPC.secrets.removeMasterPassword, (_e, password: string) => removeMasterPassword(String(password)));
  ipcMain.handle(IPC.secrets.unlock, (_e, password: string) => {
    unlock(String(password));
    autoLock.touch(); // entering the password is activity
    broadcast(IPC.secrets.onUnlocked);
    onUnlocked();
  });
  ipcMain.handle(IPC.secrets.lock, () => {
    lock();
    broadcastLocked();
  });
  ipcMain.handle(IPC.secrets.getAutoLock, (): number => getAutoLockMinutes());
  ipcMain.handle(IPC.secrets.setAutoLock, (_e, minutes: number): number => {
    autoLock.touch(); // a fresh period starts from now
    return setAutoLockMinutes(normalizeAutoLockMinutes(minutes));
  });
  ipcMain.handle(IPC.secrets.reset, () => resetSecrets());
}

function broadcast(channel: string): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel);
}

function broadcastLocked(): void {
  broadcast(IPC.secrets.onLocked);
}
