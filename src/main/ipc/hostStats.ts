import { ipcMain } from "electron";
import { IPC } from "../../shared/types";
import * as hostStats from "../services/hostStats";

export function registerHostStatsIpc(): void {
  ipcMain.on(IPC.hostStats.start, (_event, sessionId: string) => hostStats.start(sessionId));
  ipcMain.on(IPC.hostStats.stop, (_event, sessionId: string) => hostStats.stop(sessionId));
}
