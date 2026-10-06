import { clipboard, ipcMain } from "electron";
import { IPC } from "../../shared/types";

// Electron's clipboard module is Promise-based now (readText/writeText/etc.
// all return Promises, modeled on the W3C navigator.clipboard API) — used to
// be synchronous. ipcMain.on's writeText stays fire-and-forget (the renderer
// side already calls it via ipcRenderer.send, not invoke, so nothing's
// awaiting a result) but still needs to not leave the promise floating.
export function registerClipboardIpc(): void {
  ipcMain.on(IPC.clipboard.writeText, (_event, text: string) => {
    void clipboard.writeText(text);
  });

  ipcMain.handle(IPC.clipboard.readText, (): Promise<string> => {
    return clipboard.readText();
  });
}
