import { clipboard, ipcMain } from "electron";
import { IPC } from "../../shared/types";

export function registerClipboardIpc(): void {
  ipcMain.on(IPC.clipboard.writeText, (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle(IPC.clipboard.readText, (): string => {
    return clipboard.readText();
  });
}
