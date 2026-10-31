import { ipcMain } from "electron";
import { IPC, type CommandHistoryEntry, type CommandHistoryInput, type HistorySettings } from "../../shared/types";
import { createHistoryRecorder } from "../services/historyRecorder";
import { readProtected, writeProtected } from "../services/protectedData";
import { getHistorySettings, setHistorySettings } from "../services/store";

const recorder = createHistoryRecorder({
  entries: () => readProtected("commandHistory"),
  setEntries: (entries) => void writeProtected("commandHistory", entries),
  settings: getHistorySettings,
  now: Date.now,
});

export function registerCommandHistoryIpc(): void {
  // Honors a retention limit that has come due since the last launch.
  recorder.prune();

  ipcMain.handle(IPC.commandHistory.add, (_event, input: CommandHistoryInput & { hidden?: boolean }): boolean => {
    return recorder.record(input);
  });

  ipcMain.handle(IPC.commandHistory.list, (): CommandHistoryEntry[] => {
    return readProtected("commandHistory");
  });

  ipcMain.handle(IPC.commandHistory.clear, (): void => {
    writeProtected("commandHistory", []);
  });

  ipcMain.handle(
    IPC.commandHistory.shellText,
    (_event, input: Pick<CommandHistoryInput, "sessionId" | "hostId" | "hostName">, command: string): void => {
      recorder.shellText(input, command);
    },
  );

  ipcMain.handle(IPC.commandHistory.getSettings, (): HistorySettings => getHistorySettings());

  ipcMain.handle(IPC.commandHistory.setSettings, (_event, settings: HistorySettings): HistorySettings => {
    const saved = setHistorySettings(settings);
    recorder.prune(); // a shorter retention applies to what is already stored
    return saved;
  });
}
