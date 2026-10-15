import { ipcMain } from "electron";
import { IPC, type SecretStorageStatus } from "../../shared/types";
import { countUnencryptedSecrets, isEncryptionAvailable } from "../services/secretStore";

export function registerSecretsIpc(): void {
  ipcMain.handle(IPC.secrets.status, (): SecretStorageStatus => ({
    encrypted: isEncryptionAvailable(),
    unencryptedCount: countUnencryptedSecrets(),
  }));
}
