import { ipcMain } from "electron";
import { IPC, type AiSuggestRequest } from "../../shared/types";
import * as aiSuggest from "../services/aiSuggest";

export function registerAiIpc(): void {
  ipcMain.handle(IPC.ai.suggest, async (_event, request: AiSuggestRequest): Promise<string[]> => {
    return aiSuggest.suggest(request);
  });

  ipcMain.handle(IPC.ai.hasApiKey, (): boolean => {
    return aiSuggest.hasApiKey();
  });

  ipcMain.handle(IPC.ai.setApiKey, (_event, key: string): void => {
    aiSuggest.setApiKey(key);
  });

  ipcMain.handle(IPC.ai.clearApiKey, (): void => {
    aiSuggest.clearApiKey();
  });
}
