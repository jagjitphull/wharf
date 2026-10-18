import { ipcMain } from "electron";
import { IPC, type SecretStorageStatus } from "../../shared/types";
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
    onUnlocked();
  });
  ipcMain.handle(IPC.secrets.lock, () => lock());
  ipcMain.handle(IPC.secrets.reset, () => resetSecrets());
}
