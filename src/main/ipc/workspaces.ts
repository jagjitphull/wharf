import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { IPC, type WorkspaceInput, type WorkspaceRecord, type WorkspaceTab } from "../../shared/types";
import { readProtected, writeProtected } from "../services/protectedData";

const LOCKED = "Unlock Wharf with your master password first.";

function saveWorkspaces(workspaces: WorkspaceRecord[]): void {
  if (!writeProtected("workspaces", workspaces)) throw new Error(LOCKED);
}

export function registerWorkspacesIpc(): void {
  ipcMain.handle(IPC.workspaces.list, (): WorkspaceRecord[] => {
    return readProtected("workspaces");
  });

  ipcMain.handle(IPC.workspaces.create, (_event, input: WorkspaceInput): WorkspaceRecord => {
    const record: WorkspaceRecord = {
      id: randomUUID(),
      name: input.name,
      tabs: input.tabs,
      createdAt: Date.now(),
    };
    saveWorkspaces([...readProtected("workspaces"), record]);
    return record;
  });

  ipcMain.handle(IPC.workspaces.remove, (_event, id: string): void => {
    saveWorkspaces(readProtected("workspaces").filter((w) => w.id !== id));
  });

  ipcMain.handle(IPC.session.getLast, (): WorkspaceTab[] => {
    return readProtected("lastSessionTabs");
  });

  ipcMain.handle(IPC.session.saveLast, (_event, tabs: WorkspaceTab[]): void => {
    // Dropped while locked: the snapshot sealed on disk must not be replaced by whatever the locked window holds.
    writeProtected("lastSessionTabs", tabs);
  });
}
