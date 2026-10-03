import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { IPC, type HostRecord, type SshConfigCandidate, type SshConfigImportResult } from "../../shared/types";
import { getHosts, setHosts } from "../services/store";
import { parseSshConfig } from "../services/sshConfigParser";

function isAlreadyImported(candidate: SshConfigCandidate, existing: HostRecord[]): boolean {
  return existing.some(
    (h) =>
      h.hostname === candidate.hostname &&
      h.port === candidate.port &&
      (candidate.username === undefined || h.username === candidate.username),
  );
}

export function registerSshConfigIpc(): void {
  ipcMain.handle(IPC.sshConfig.parse, (): SshConfigCandidate[] => {
    const existing = getHosts();
    return parseSshConfig().map((c) => ({ ...c, alreadyImported: isAlreadyImported(c, existing) }));
  });

  ipcMain.handle(IPC.sshConfig.import, (_event, aliases: string[]): SshConfigImportResult => {
    const wanted = new Set(aliases);
    const candidates = parseSshConfig().filter((c) => wanted.has(c.alias));

    // Map alias -> the new host id, so a ProxyJump between two candidates
    // imported together resolves to a real jumpHostId. A jump target not
    // in this batch (already saved separately, or not selected) is left
    // unlinked — Wharf has no way to represent an arbitrary unresolved
    // jump alias, and guessing wrong would be worse than leaving it blank.
    const aliasToId = new Map(candidates.map((c) => [c.alias, randomUUID()]));

    const now = Date.now();
    const newHosts: HostRecord[] = candidates.map((c) => ({
      id: aliasToId.get(c.alias)!,
      name: c.alias,
      hostname: c.hostname,
      port: c.port,
      username: c.username ?? "",
      groupId: null,
      // No password/passphrase lives in an SSH config file. An IdentityFile
      // entry gets wired up as a private-key host directly; otherwise default
      // to "agent" — closer to how running `ssh <alias>` from a terminal
      // actually authenticates (whatever's already loaded in ssh-agent) than
      // defaulting to a blank password the user would have to fill in either way.
      authMethod: c.identityFile ? "privateKey" : "agent",
      secretId: null,
      privateKeyPath: c.identityFile,
      jumpHostId: c.proxyJump ? (aliasToId.get(c.proxyJump) ?? null) : null,
      createdAt: now,
      updatedAt: now,
    }));

    setHosts([...getHosts(), ...newHosts]);
    return { importedHosts: newHosts.length };
  });
}
