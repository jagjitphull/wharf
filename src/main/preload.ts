import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/types";
import type { WharfApi } from "../shared/api";

function on(channel: string, cb: (...args: unknown[]) => void) {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: WharfApi = {
  hosts: {
    list: () => ipcRenderer.invoke(IPC.hosts.list),
    create: (input) => ipcRenderer.invoke(IPC.hosts.create, input),
    update: (id, input) => ipcRenderer.invoke(IPC.hosts.update, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.hosts.remove, id),
  },
  groups: {
    list: () => ipcRenderer.invoke(IPC.groups.list),
    create: (input) => ipcRenderer.invoke(IPC.groups.create, input),
    update: (id, input) => ipcRenderer.invoke(IPC.groups.update, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.groups.remove, id),
  },
  ssh: {
    connect: (hostId, cols, rows) => ipcRenderer.invoke(IPC.ssh.connect, hostId, cols, rows),
    write: (sessionId, data) => ipcRenderer.send(IPC.ssh.write, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.ssh.resize, sessionId, cols, rows),
    disconnect: (sessionId) => ipcRenderer.invoke(IPC.ssh.disconnect, sessionId),
    onData: (cb) => on(IPC.ssh.onData, cb as (...args: unknown[]) => void),
    onClosed: (cb) => on(IPC.ssh.onClosed, cb as (...args: unknown[]) => void),
  },
  sftp: {
    list: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.list, hostId, remotePath),
    mkdir: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.mkdir, hostId, remotePath),
    rmdir: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.rmdir, hostId, remotePath),
    unlink: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.unlink, hostId, remotePath),
    rename: (hostId, oldPath, newPath) => ipcRenderer.invoke(IPC.sftp.rename, hostId, oldPath, newPath),
    upload: (hostId, remoteDir) => ipcRenderer.invoke(IPC.sftp.upload, hostId, remoteDir),
    download: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.download, hostId, remotePath),
    onProgress: (cb) => on(IPC.sftp.onProgress, cb as (...args: unknown[]) => void),
  },
  tunnels: {
    list: () => ipcRenderer.invoke(IPC.tunnels.list),
    create: (input) => ipcRenderer.invoke(IPC.tunnels.create, input),
    remove: (tunnelId) => ipcRenderer.invoke(IPC.tunnels.remove, tunnelId),
    start: (tunnelId) => ipcRenderer.invoke(IPC.tunnels.start, tunnelId),
    stop: (tunnelId) => ipcRenderer.invoke(IPC.tunnels.stop, tunnelId),
    onState: (cb) => on(IPC.tunnels.onState, cb as (...args: unknown[]) => void),
  },
  license: {
    getState: () => ipcRenderer.invoke(IPC.license.getState),
    activate: (licenseKey) => ipcRenderer.invoke(IPC.license.activate, licenseKey),
    deactivate: () => ipcRenderer.invoke(IPC.license.deactivate),
  },
};

contextBridge.exposeInMainWorld("wharf", api);
