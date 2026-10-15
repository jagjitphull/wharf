import type { Session } from "electron";

/** Where the renderer is served from in development (see `npm run dev`). */
const DEV_ORIGIN = "http://localhost:5173";

/**
 * Whether `url` is safe to hand to the OS to open (`shell.openExternal`):
 * http(s) only. The OS resolves other schemes — `file:`, `smb:`, `ms-msdt:`,
 * app-specific handlers — to whatever program is registered for them, so a
 * link that came from terminal output or the network must never reach it.
 */
export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Whether `url` is the app's own renderer: the bundled file in a packaged
 * build, the Vite dev server in development. */
export function isAppUrl(url: string, isDev: boolean): boolean {
  try {
    const parsed = new URL(url);
    return isDev ? parsed.origin === DEV_ORIGIN : parsed.protocol === "file:";
  } catch {
    return false;
  }
}

/** The only web permission the renderer is ever given, and only to the app's
 * own page: desktop notifications when a long command finishes. Electron
 * otherwise grants every permission Chromium asks about (camera, microphone,
 * location, ...), none of which Wharf uses. */
export function isPermissionAllowed(permission: string, requestingUrl: string, isDev: boolean): boolean {
  return permission === "notifications" && isAppUrl(requestingUrl, isDev);
}

/** Denies every permission request and check except the one above. */
export function installPermissionHandlers(ses: Session, isDev: boolean): void {
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(isPermissionAllowed(permission, webContents.getURL(), isDev));
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => isPermissionAllowed(permission, requestingOrigin, isDev));
}
