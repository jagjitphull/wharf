import { homedir } from "node:os";
import path from "node:path";
import { ipcMain } from "electron";
import { IPC, type GenerateKeyRequest, type InstallKeyResult, type SshKeyInfo } from "../../shared/types";
import { installPublicKey } from "../services/installKey";
import { createKeyManager } from "../services/sshKeys";
import { getHosts } from "../services/store";

const keys = createKeyManager(() => path.join(homedir(), ".ssh"));

export function registerSshKeysIpc(): void {
  ipcMain.handle(IPC.sshKeys.list, (): SshKeyInfo[] => keys.list(getHosts()));
  ipcMain.handle(IPC.sshKeys.generate, (_e, request: GenerateKeyRequest): SshKeyInfo => keys.generate(request));
  ipcMain.handle(IPC.sshKeys.publicKey, (_e, name: string): string | null => keys.publicKey(String(name)));
  ipcMain.handle(IPC.sshKeys.remove, (_e, name: string): void => keys.remove(String(name)));
  ipcMain.handle(IPC.sshKeys.install, (_e, name: string, hostId: string): Promise<InstallKeyResult> => {
    const publicKey = keys.publicKey(String(name));
    if (!publicKey) throw new Error("That key's public half can't be read — it needs a .pub file next to it (or no passphrase).");
    return installPublicKey(String(hostId), publicKey);
  });
}
