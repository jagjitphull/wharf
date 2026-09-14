import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { registerHostsIpc } from "./ipc/hosts";
import { registerGroupsIpc } from "./ipc/groups";
import { registerSshIpc } from "./ipc/ssh";
import { registerSftpIpc } from "./ipc/sftp";
import { registerTunnelsIpc } from "./ipc/tunnels";
import { registerLicenseIpc } from "./ipc/license";
import { stopAll as stopAllTunnels } from "./services/tunnelManager";
import { closeAllSftp } from "./services/sftpManager";

const isDev = process.env.NODE_ENV === "development";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#111318",
    title: "Wharf",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Terminal sessions open arbitrary remote shells; don't let the app spawn
  // new BrowserWindows or navigate away from the renderer bundle.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isDev || !url.startsWith("http://localhost:5173")) event.preventDefault();
  });

  if (isDev) {
    void win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // dist-electron/main/index.js's __dirname is dist-electron/main; the
    // renderer build output is a sibling directory at dist-electron/renderer.
    void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  registerHostsIpc();
  registerGroupsIpc();
  registerSshIpc();
  registerSftpIpc();
  registerTunnelsIpc();
  registerLicenseIpc();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopAllTunnels();
  closeAllSftp();
});
