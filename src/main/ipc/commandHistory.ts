import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { IPC, type CommandHistoryEntry, type CommandHistoryInput } from "../../shared/types";
import { addCommandHistoryEntry, clearCommandHistory, getCommandHistory } from "../services/store";

export function registerCommandHistoryIpc(): void {
  ipcMain.handle(IPC.commandHistory.add, (_event, input: CommandHistoryInput): void => {
    const entry: CommandHistoryEntry = { id: randomUUID(), timestamp: Date.now(), ...input };
    addCommandHistoryEntry(entry);
  });

  ipcMain.handle(IPC.commandHistory.list, (): CommandHistoryEntry[] => {
    return getCommandHistory();
  });

  ipcMain.handle(IPC.commandHistory.clear, (): void => {
    clearCommandHistory();
  });
}
