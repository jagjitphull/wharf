import { ipcMain } from "electron";
import { IPC, type TunnelInput, type TunnelRecord } from "../../shared/types";
import * as tunnelManager from "../services/tunnelManager";

export function registerTunnelsIpc(): void {
  ipcMain.handle(IPC.tunnels.list, (): TunnelRecord[] => tunnelManager.list());

  ipcMain.handle(IPC.tunnels.create, (_event, input: TunnelInput): TunnelRecord => tunnelManager.create(input));

  ipcMain.handle(IPC.tunnels.remove, (_event, tunnelId: string): void => tunnelManager.remove(tunnelId));

  ipcMain.handle(IPC.tunnels.start, (_event, tunnelId: string): Promise<void> => tunnelManager.start(tunnelId));

  ipcMain.handle(IPC.tunnels.stop, (_event, tunnelId: string): void => tunnelManager.stop(tunnelId));
}
