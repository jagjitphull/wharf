import path from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { IPC } from "../shared/types";
import { registerHostsIpc } from "./ipc/hosts";
import { registerGroupsIpc } from "./ipc/groups";
import { registerSshIpc } from "./ipc/ssh";
import { registerSftpIpc } from "./ipc/sftp";
import { registerLocalFsIpc } from "./ipc/localFs";
import { registerTunnelsIpc } from "./ipc/tunnels";
import { registerWindowIpc } from "./ipc/window";
import { registerClipboardIpc } from "./ipc/clipboard";
import { registerBackupIpc } from "./ipc/backup";
import { registerSnippetsIpc } from "./ipc/snippets";
import { registerSshConfigIpc } from "./ipc/sshConfig";
import { registerCommandHistoryIpc } from "./ipc/commandHistory";
import { stopAll as stopAllTunnels } from "./services/tunnelManager";
import { closeAllSftp } from "./services/sftpManager";
import { getWindowBounds, setWindowBounds } from "./services/store";

const isDev = process.env.NODE_ENV === "development";
const isMac = process.platform === "darwin";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

/**
 * @param primary Restore the exact saved position (x/y) as well as size —
 * used for the app's first window. Secondary windows ("New Window") only
 * reuse the saved size so the OS can cascade their position normally
 * instead of stacking them exactly on top of the first.
 */
function createWindow(primary: boolean): BrowserWindow {
  const saved = getWindowBounds();
  const sizeAndPosition = saved
    ? primary
      ? saved
      : { width: saved.width, height: saved.height }
    : { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };

  const win = new BrowserWindow({
    ...sizeAndPosition,
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

  // Persist size/position (debounced) as the user resizes or moves the
  // window, and once more on close so the very last adjustment sticks.
  // getNormalBounds() (not getBounds()) so a maximized window doesn't
  // overwrite the saved "restored" size with the full-screen one.
  let saveBoundsTimer: NodeJS.Timeout | null = null;
  function scheduleSaveBounds() {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized()) setWindowBounds(win.getNormalBounds());
    }, 400);
  }
  win.on("resize", scheduleSaveBounds);
  win.on("move", scheduleSaveBounds);
  win.on("close", () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    if (!win.isMinimized()) setWindowBounds(win.getNormalBounds());
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
        { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => createWindow(false) },
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
  registerLocalFsIpc();
  registerTunnelsIpc();
  registerWindowIpc(() => createWindow(false));
  registerClipboardIpc();
  registerBackupIpc();
  registerSnippetsIpc();
  registerSshConfigIpc();
  registerCommandHistoryIpc();

  installAppMenu();
  createWindow(true);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopAllTunnels();
  closeAllSftp();
});
