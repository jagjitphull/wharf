import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { IPC, type WorkspaceInput, type WorkspaceRecord } from "../../shared/types";
import { getWorkspaces, setWorkspaces } from "../services/store";

export function registerWorkspacesIpc(): void {
  ipcMain.handle(IPC.workspaces.list, (): WorkspaceRecord[] => {
    return getWorkspaces();
  });

  ipcMain.handle(IPC.workspaces.create, (_event, input: WorkspaceInput): WorkspaceRecord => {
    const record: WorkspaceRecord = {
      id: randomUUID(),
      name: input.name,
      tabs: input.tabs,
      createdAt: Date.now(),
    };
    setWorkspaces([...getWorkspaces(), record]);
    return record;
  });

  ipcMain.handle(IPC.workspaces.remove, (_event, id: string): void => {
    setWorkspaces(getWorkspaces().filter((w) => w.id !== id));
  });
}
