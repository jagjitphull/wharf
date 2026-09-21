import { ipcMain, shell } from "electron";
import { IPC } from "../../shared/types";

export function registerShellIpc(): void {
  ipcMain.handle(IPC.shell.openExternal, (_event, url: string): void => {
    // Only ever what the terminal's link addon can actually produce (its
    // own matcher is already http(s)-only) — never hand an arbitrary
    // string from terminal output straight to the OS shell.
    if (!/^https?:\/\//i.test(url)) return;
    void shell.openExternal(url);
  });
}
