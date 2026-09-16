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
    onReconnecting: (cb) => on(IPC.ssh.onReconnecting, cb as (...args: unknown[]) => void),
    onReconnected: (cb) => on(IPC.ssh.onReconnected, cb as (...args: unknown[]) => void),
    startLogging: (sessionId) => ipcRenderer.invoke(IPC.ssh.startLogging, sessionId),
    stopLogging: (sessionId) => ipcRenderer.invoke(IPC.ssh.stopLogging, sessionId),
  },
  localShell: {
    connect: (cols, rows) => ipcRenderer.invoke(IPC.localShell.connect, cols, rows),
  },
  sshConfig: {
    parse: () => ipcRenderer.invoke(IPC.sshConfig.parse),
    import: (aliases) => ipcRenderer.invoke(IPC.sshConfig.import, aliases),
  },
  sftp: {
    list: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.list, hostId, remotePath),
    mkdir: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.mkdir, hostId, remotePath),
    rmdir: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.rmdir, hostId, remotePath),
    unlink: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.unlink, hostId, remotePath),
    rename: (hostId, oldPath, newPath) => ipcRenderer.invoke(IPC.sftp.rename, hostId, oldPath, newPath),
    upload: (hostId, remoteDir) => ipcRenderer.invoke(IPC.sftp.upload, hostId, remoteDir),
    uploadPath: (hostId, localPath, remoteDir) => ipcRenderer.invoke(IPC.sftp.uploadPath, hostId, localPath, remoteDir),
    download: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.download, hostId, remotePath),
    downloadToPath: (hostId, remotePath, localDir) =>
      ipcRenderer.invoke(IPC.sftp.downloadToPath, hostId, remotePath, localDir),
    onProgress: (cb) => on(IPC.sftp.onProgress, cb as (...args: unknown[]) => void),
    search: (hostId, rootPath, query) => ipcRenderer.invoke(IPC.sftp.search, hostId, rootPath, query),
    readFile: (hostId, remotePath) => ipcRenderer.invoke(IPC.sftp.readFile, hostId, remotePath),
    writeFile: (hostId, remotePath, content) => ipcRenderer.invoke(IPC.sftp.writeFile, hostId, remotePath, content),
  },
  localFs: {
    list: (dirPath) => ipcRenderer.invoke(IPC.localFs.list, dirPath),
    mkdir: (dirPath) => ipcRenderer.invoke(IPC.localFs.mkdir, dirPath),
    rmdir: (dirPath) => ipcRenderer.invoke(IPC.localFs.rmdir, dirPath),
    unlink: (filePath) => ipcRenderer.invoke(IPC.localFs.unlink, filePath),
    rename: (oldPath, newPath) => ipcRenderer.invoke(IPC.localFs.rename, oldPath, newPath),
    homeDir: () => ipcRenderer.invoke(IPC.localFs.homeDir),
  },
  tunnels: {
    list: () => ipcRenderer.invoke(IPC.tunnels.list),
    create: (input) => ipcRenderer.invoke(IPC.tunnels.create, input),
    remove: (tunnelId) => ipcRenderer.invoke(IPC.tunnels.remove, tunnelId),
    start: (tunnelId) => ipcRenderer.invoke(IPC.tunnels.start, tunnelId),
    stop: (tunnelId) => ipcRenderer.invoke(IPC.tunnels.stop, tunnelId),
    onState: (cb) => on(IPC.tunnels.onState, cb as (...args: unknown[]) => void),
  },
  window: {
    platform: process.platform,
    minimize: () => ipcRenderer.send(IPC.window.minimize),
    toggleMaximize: () => ipcRenderer.send(IPC.window.toggleMaximize),
    close: () => ipcRenderer.send(IPC.window.close),
    isMaximized: () => ipcRenderer.invoke(IPC.window.isMaximized),
    newWindow: () => ipcRenderer.send(IPC.window.newWindow),
    onMaximizedChange: (cb) => on(IPC.window.onMaximizedChange, cb as (...args: unknown[]) => void),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.send(IPC.clipboard.writeText, text),
    readText: () => ipcRenderer.invoke(IPC.clipboard.readText),
  },
  backup: {
    export: () => ipcRenderer.invoke(IPC.backup.export),
    import: () => ipcRenderer.invoke(IPC.backup.import),
  },
  snippets: {
    list: () => ipcRenderer.invoke(IPC.snippets.list),
    create: (input) => ipcRenderer.invoke(IPC.snippets.create, input),
    update: (id, input) => ipcRenderer.invoke(IPC.snippets.update, id, input),
    remove: (id) => ipcRenderer.invoke(IPC.snippets.remove, id),
  },
  commandHistory: {
    add: (input) => ipcRenderer.invoke(IPC.commandHistory.add, input),
    list: () => ipcRenderer.invoke(IPC.commandHistory.list),
    clear: () => ipcRenderer.invoke(IPC.commandHistory.clear),
  },
  ai: {
    suggest: (request) => ipcRenderer.invoke(IPC.ai.suggest, request),
    getProvider: () => ipcRenderer.invoke(IPC.ai.getProvider),
    setProvider: (provider) => ipcRenderer.invoke(IPC.ai.setProvider, provider),
    hasApiKey: (provider) => ipcRenderer.invoke(IPC.ai.hasApiKey, provider),
    setApiKey: (provider, key) => ipcRenderer.invoke(IPC.ai.setApiKey, provider, key),
    clearApiKey: (provider) => ipcRenderer.invoke(IPC.ai.clearApiKey, provider),
    getProviderConfig: (provider) => ipcRenderer.invoke(IPC.ai.getProviderConfig, provider),
    setProviderConfig: (provider, config) => ipcRenderer.invoke(IPC.ai.setProviderConfig, provider, config),
    explainFailure: (request) => ipcRenderer.invoke(IPC.ai.explainFailure, request),
    generateCommand: (request) => ipcRenderer.invoke(IPC.ai.generateCommand, request),
  },
  commandBlocks: {
    getEnabled: () => ipcRenderer.invoke(IPC.commandBlocks.getEnabled),
    setEnabled: (enabled) => ipcRenderer.invoke(IPC.commandBlocks.setEnabled, enabled),
  },
};

contextBridge.exposeInMainWorld("wharf", api);
