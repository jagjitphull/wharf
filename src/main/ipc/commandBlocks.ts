import { ipcMain } from "electron";
import { IPC } from "../../shared/types";
import { getCommandBlocksEnabled, setCommandBlocksEnabled } from "../services/store";

export function registerCommandBlocksIpc(): void {
  ipcMain.handle(IPC.commandBlocks.getEnabled, (): boolean => {
    return getCommandBlocksEnabled();
  });

  ipcMain.handle(IPC.commandBlocks.setEnabled, (_event, enabled: boolean): void => {
    setCommandBlocksEnabled(enabled);
  });
}
