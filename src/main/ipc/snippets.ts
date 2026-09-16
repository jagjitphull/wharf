import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { IPC, type SnippetInput, type SnippetRecord } from "../../shared/types";
import { getSnippets, setSnippets } from "../services/store";

export function registerSnippetsIpc(): void {
  ipcMain.handle(IPC.snippets.list, (): SnippetRecord[] => {
    return getSnippets();
  });

  ipcMain.handle(IPC.snippets.create, (_event, input: SnippetInput): SnippetRecord => {
    const now = Date.now();
    const record: SnippetRecord = {
      id: randomUUID(),
      name: input.name,
      command: input.command,
      createdAt: now,
      updatedAt: now,
    };
    setSnippets([...getSnippets(), record]);
    return record;
  });

  ipcMain.handle(IPC.snippets.update, (_event, id: string, input: SnippetInput): SnippetRecord => {
    const snippets = getSnippets();
    const idx = snippets.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Snippet ${id} not found`);
    const updated: SnippetRecord = { ...snippets[idx], name: input.name, command: input.command, updatedAt: Date.now() };
    const next = [...snippets];
    next[idx] = updated;
    setSnippets(next);
    return updated;
  });

  ipcMain.handle(IPC.snippets.remove, (_event, id: string): void => {
    setSnippets(getSnippets().filter((s) => s.id !== id));
  });
}
