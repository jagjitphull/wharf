import { BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/types";

/**
 * Per-window controls for the custom (frameless) title bar. Every handler
 * resolves the target window from the sending webContents rather than
 * "the focused window" — correct with multiple app windows open, since a
 * renderer's minimize/close button must always act on its own window.
 */
export function registerWindowIpc(createWindow: () => void): void {
  ipcMain.on(IPC.window.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IPC.window.toggleMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on(IPC.window.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(IPC.window.isMaximized, (event): boolean => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.on(IPC.window.newWindow, () => {
    createWindow();
  });
}
