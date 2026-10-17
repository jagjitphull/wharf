import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { IPC, type SelfUpdateState } from "../../shared/types";

const h = vi.hoisted(() => ({
  isPackaged: true,
  sent: [] as { channel: string; payload: SelfUpdateState }[],
  created: [] as any[],
  /** What the fake updater's check and download do; reset before each test. */
  check: async (): Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } }> => ({
    isUpdateAvailable: true,
    updateInfo: { version: "0.2.0" },
  }),
  download: null as null | ((u: any) => Promise<unknown>),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return h.isPackaged;
    },
  },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: (channel: string, payload: SelfUpdateState) => h.sent.push({ channel, payload }) } }],
  },
}));
vi.mock("electron-log/main", () => ({ default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));

/** Stands in for electron-updater's AppImageUpdater. */
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  logger: unknown = null;
  checkForUpdates = vi.fn(() => h.check());
  downloadUpdate = vi.fn(async () => {
    if (h.download) return h.download(this);
    this.emit("download-progress", { percent: 41.6 });
    this.emit("download-progress", { percent: 100 });
    return ["file"];
  });
  quitAndInstall = vi.fn();
  constructor() {
    super();
    h.created.push(this);
  }
}
vi.mock("electron-updater", () => ({ AppImageUpdater: FakeUpdater }));

let mod: typeof import("./selfUpdate");
const updater = () => h.created[0] as FakeUpdater;
const phases = () => h.sent.map((e) => e.payload.phase);

beforeEach(async () => {
  h.isPackaged = true;
  h.sent = [];
  h.created = [];
  h.check = async () => ({ isUpdateAvailable: true, updateInfo: { version: "0.2.0" } });
  h.download = null;
  vi.stubEnv("APPIMAGE", "/home/me/Wharf-0.1.0.AppImage");
  vi.resetModules();
  mod = await import("./selfUpdate");
});

describe("canSelfUpdate", () => {
  it("is true for an installed AppImage on Linux", () => {
    if (process.platform !== "linux") return;
    expect(mod.canSelfUpdate()).toBe(true);
  });

  it("is false when not packaged (a dev checkout), whatever else is true", () => {
    h.isPackaged = false;
    expect(mod.canSelfUpdate()).toBe(false);
  });

  it("is false when not running from an AppImage (a .deb install, say)", () => {
    vi.stubEnv("APPIMAGE", "");
    expect(mod.canSelfUpdate()).toBe(false);
  });
});

describe("downloadUpdate", () => {
  it("checks, downloads and reports each step, ending ready with the new version", async () => {
    await mod.downloadUpdate();
    expect(phases()).toEqual(["checking", "downloading", "downloading", "downloading", "ready"]);
    expect(mod.selfUpdateState()).toEqual({ phase: "ready", version: "0.2.0" });
    expect(h.sent.every((e) => e.channel === IPC.update.onSelfUpdateState)).toBe(true);
    expect(updater().checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater().downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("reports rounded download progress", async () => {
    await mod.downloadUpdate();
    expect(h.sent.filter((e) => e.payload.phase === "downloading").map((e) => e.payload.percent)).toEqual([0, 42, 100]);
  });

  it("only ever updates when asked: nothing downloads on its own, and nothing installs on quit", async () => {
    await mod.downloadUpdate();
    expect(updater().autoDownload).toBe(false);
    expect(updater().autoInstallOnAppQuit).toBe(false);
  });

  it("never downgrades and never offers a pre-release", async () => {
    await mod.downloadUpdate();
    expect(updater().allowDowngrade).toBe(false);
    expect(updater().allowPrerelease).toBe(false);
  });

  it("reports an error, without downloading, when there is no newer version", async () => {
    h.check = async () => ({ isUpdateAvailable: false, updateInfo: { version: "0.1.0" } });
    await mod.downloadUpdate();
    expect(mod.selfUpdateState().phase).toBe("error");
    expect(mod.selfUpdateState().error).toMatch(/no newer version/i);
    expect(updater().downloadUpdate).not.toHaveBeenCalled();
  });

  it("turns a failed check into an error state instead of throwing", async () => {
    h.check = async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    };
    await expect(mod.downloadUpdate()).resolves.toBeUndefined();
    expect(mod.selfUpdateState()).toEqual({ phase: "error", error: "net::ERR_INTERNET_DISCONNECTED" });
  });

  it("turns a failed download (say, a checksum mismatch) into an error state and cannot be installed", async () => {
    h.download = async () => {
      throw new Error("sha512 checksum mismatch");
    };
    await mod.downloadUpdate();
    expect(mod.selfUpdateState().phase).toBe("error");
    expect(mod.selfUpdateState().error).toMatch(/checksum/);
    expect(() => mod.installUpdate()).toThrow(/no downloaded update/i);
  });

  it("refuses on a build that can't update itself, saying why", async () => {
    vi.stubEnv("APPIMAGE", "");
    await mod.downloadUpdate();
    expect(mod.selfUpdateState().phase).toBe("error");
    expect(mod.selfUpdateState().error).toMatch(/AppImage/);
    expect(h.created).toHaveLength(0);
  });

  it("ignores a second request while one is running, and one that has already finished", async () => {
    const first = mod.downloadUpdate();
    await mod.downloadUpdate();
    await first;
    await mod.downloadUpdate();
    expect(updater().checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe("installUpdate", () => {
  it("refuses before anything has been downloaded", () => {
    expect(() => mod.installUpdate()).toThrow(/no downloaded update/i);
  });

  it("restarts into the downloaded version, with the installer UI off and relaunch on", async () => {
    await mod.downloadUpdate();
    mod.installUpdate();
    expect(updater().quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});
