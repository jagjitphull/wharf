import { ipcMain } from "electron";
import { nanoid } from "nanoid";
import { IPC, type GroupInput, type GroupRecord } from "../../shared/types";
import { getGroups, getHosts, setGroups, setHosts } from "../services/store";
import { getCurrentLicenseState } from "../licensing/currentLicense";
import { getGroupLimit, LimitReachedError } from "../licensing/featureFlags";

export function registerGroupsIpc(): void {
  ipcMain.handle(IPC.groups.list, (): GroupRecord[] => {
    return getGroups();
  });

  ipcMain.handle(IPC.groups.create, (_event, input: GroupInput): GroupRecord => {
    const groups = getGroups();

    const limit = getGroupLimit(getCurrentLicenseState());
    if (limit !== null && groups.length >= limit) {
      throw new LimitReachedError("groups", limit);
    }

    const now = Date.now();
    const record: GroupRecord = {
      id: nanoid(),
      name: input.name,
      parentId: input.parentId,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    };
    setGroups([...groups, record]);
    return record;
  });

  ipcMain.handle(IPC.groups.update, (_event, id: string, input: GroupInput): GroupRecord => {
    const groups = getGroups();
    const idx = groups.findIndex((g) => g.id === id);
    if (idx === -1) throw new Error(`Group ${id} not found`);

    const updated: GroupRecord = {
      ...groups[idx],
      name: input.name,
      parentId: input.parentId,
      color: input.color,
      updatedAt: Date.now(),
    };
    const next = [...groups];
    next[idx] = updated;
    setGroups(next);
    return updated;
  });

  ipcMain.handle(IPC.groups.remove, (_event, id: string): void => {
    setGroups(getGroups().filter((g) => g.id !== id));
    // Ungroup any hosts that belonged to this group rather than deleting them.
    setHosts(getHosts().map((h) => (h.groupId === id ? { ...h, groupId: null } : h)));
  });
}
