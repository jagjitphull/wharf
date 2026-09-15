import { ipcMain } from "electron";
import { IPC, type AiProvider, type AiProviderConfig, type AiSuggestRequest } from "../../shared/types";
import * as aiSuggest from "../services/aiSuggest";

export function registerAiIpc(): void {
  ipcMain.handle(IPC.ai.suggest, async (_event, request: AiSuggestRequest): Promise<string[]> => {
    return aiSuggest.suggest(request);
  });

  ipcMain.handle(IPC.ai.getProvider, (): AiProvider => {
    return aiSuggest.getProvider();
  });

  ipcMain.handle(IPC.ai.setProvider, (_event, provider: AiProvider): void => {
    aiSuggest.setProvider(provider);
  });

  ipcMain.handle(IPC.ai.hasApiKey, (_event, provider: AiProvider): boolean => {
    return aiSuggest.hasApiKey(provider);
  });

  ipcMain.handle(IPC.ai.setApiKey, (_event, provider: AiProvider, key: string): void => {
    aiSuggest.setApiKey(provider, key);
  });

  ipcMain.handle(IPC.ai.clearApiKey, (_event, provider: AiProvider): void => {
    aiSuggest.clearApiKey(provider);
  });

  ipcMain.handle(IPC.ai.getProviderConfig, (_event, provider: AiProvider): AiProviderConfig => {
    return aiSuggest.getProviderConfig(provider);
  });

  ipcMain.handle(IPC.ai.setProviderConfig, (_event, provider: AiProvider, config: AiProviderConfig): void => {
    aiSuggest.setProviderConfig(provider, config);
  });
}
