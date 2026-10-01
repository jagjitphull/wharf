import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { IPC, type WorkspaceInput, type WorkspaceRecord, type WorkspaceTab } from "../../shared/types";
import { getLastSessionTabs, getWorkspaces, setLastSessionTabs, setWorkspaces } from "../services/store";

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

  ipcMain.handle(IPC.session.getLast, (): WorkspaceTab[] => {
    return getLastSessionTabs();
  });

  ipcMain.handle(IPC.session.saveLast, (_event, tabs: WorkspaceTab[]): void => {
    setLastSessionTabs(tabs);
  });
}
