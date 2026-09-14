import path from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { IPC } from "../shared/types";
import { registerHostsIpc } from "./ipc/hosts";
import { registerGroupsIpc } from "./ipc/groups";
import { registerSshIpc } from "./ipc/ssh";
import { registerSftpIpc } from "./ipc/sftp";
import { registerTunnelsIpc } from "./ipc/tunnels";
import { registerWindowIpc } from "./ipc/window";
import { registerClipboardIpc } from "./ipc/clipboard";
import { stopAll as stopAllTunnels } from "./services/tunnelManager";
import { closeAllSftp } from "./services/sftpManager";

const isDev = process.env.NODE_ENV === "development";
const isMac = process.platform === "darwin";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#111318",
    title: "Wharf",
    show: false,
    // Frameless everywhere: we draw our own title bar in the renderer so
    // minimize/maximize/close are always visible regardless of the host
    // window manager's decoration behavior. On macOS, hiddenInset keeps
    // the native traffic-light buttons (users expect those) while still
    // hiding the rest of the standard title bar.
    frame: false,
    ...(isMac ? { titleBarStyle: "hiddenInset" as const } : {}),
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

  win.on("maximize", () => win.webContents.send(IPC.window.onMaximizedChange, true));
  win.on("unmaximize", () => win.webContents.send(IPC.window.onMaximizedChange, false));
  win.once("ready-to-show", () => win.show());

  if (isDev) {
    void win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // dist-electron/main/index.js's __dirname is dist-electron/main; the
    // renderer build output is a sibling directory at dist-electron/renderer.
    void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  return win;
}

function installAppMenu(): void {
  // frame: false already hides the menu bar UI on Windows/Linux, so this
  // exists mainly for macOS: without an Edit-role menu, Cmd+C/Cmd+V/Cmd+A
  // don't work in text inputs on macOS (Electron relies on the app menu's
  // roles for the standard-edit-actions responder chain). New Window's
  // accelerator is a bonus on top of the in-app "+" button.
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => createWindow() },
        { type: "separator" as const },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    { role: "editMenu" as const },
    { role: "windowMenu" as const },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  registerHostsIpc();
  registerGroupsIpc();
  registerSshIpc();
  registerSftpIpc();
  registerTunnelsIpc();
  registerWindowIpc(createWindow);
  registerClipboardIpc();

  installAppMenu();
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
