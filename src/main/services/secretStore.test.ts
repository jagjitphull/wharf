import { beforeEach, describe, expect, it, vi } from "vitest";

// secretStore.ts only ever touches the store through store.get("secrets")/
// store.set("secrets", ...) — a plain in-memory stand-in is enough, and
// sidesteps electron-store/conf's own Electron app/ipcMain requirements
// entirely (that's store.ts's concern, not this module's).
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();
vi.mock("./store", () => ({
  store: {
    get: (key: string) => mockStoreGet(key),
    set: (key: string, value: unknown) => mockStoreSet(key, value),
  },
}));

const mockIsEncryptionAvailable = vi.fn();
const mockEncryptString = vi.fn();
const mockDecryptString = vi.fn();
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockIsEncryptionAvailable(),
    encryptString: (plaintext: string) => mockEncryptString(plaintext),
    decryptString: (buf: Buffer) => mockDecryptString(buf),
  },
  // electron-log/main reads these optionally (all `?.`-guarded) at import
  // time — empty stand-ins are enough to let it load without needing a
  // real Electron app instance.
  app: {},
  ipcMain: {},
}));

let secrets: Record<string, string>;
let mod: typeof import("./secretStore");

beforeEach(async () => {
  secrets = {};
  mockStoreGet.mockReset().mockImplementation((key: string) => {
    if (key !== "secrets") throw new Error(`unexpected store.get(${key})`);
    return secrets;
  });
  mockStoreSet.mockReset().mockImplementation((key: string, value: unknown) => {
    if (key !== "secrets") throw new Error(`unexpected store.set(${key})`);
    secrets = value as Record<string, string>;
  });
  mockIsEncryptionAvailable.mockReset().mockReturnValue(true);
  mockEncryptString.mockReset().mockImplementation((plaintext: string) => Buffer.from(plaintext, "utf8"));
  mockDecryptString.mockReset().mockImplementation((buf: Buffer) => buf.toString("utf8"));
  vi.resetModules();
  mod = await import("./secretStore");
});

describe("saveSecret / readSecret", () => {
  it("round-trips a plaintext value through encryption when safeStorage is available", () => {
    const id = mod.saveSecret("hunter2");
    expect(mockEncryptString).toHaveBeenCalledWith("hunter2");
    expect(secrets[id]).toMatch(/^enc:/);
    expect(mod.readSecret(id)).toBe("hunter2");
  });

  it("falls back to a marked base64 encoding when safeStorage.isEncryptionAvailable() is false", () => {
    mockIsEncryptionAvailable.mockReturnValue(false);
    const id = mod.saveSecret("hunter2");
    expect(mockEncryptString).not.toHaveBeenCalled();
    expect(secrets[id]).toBe(`plain:${Buffer.from("hunter2", "utf8").toString("base64")}`);
    expect(mod.readSecret(id)).toBe("hunter2");
  });

  it("returns null for a null/undefined/unknown id without touching safeStorage", () => {
    expect(mod.readSecret(null)).toBeNull();
    expect(mod.readSecret(undefined)).toBeNull();
    expect(mod.readSecret("does-not-exist")).toBeNull();
    expect(mockDecryptString).not.toHaveBeenCalled();
  });
});

describe("updateSecret", () => {
  it("replaces the ciphertext for an existing id", () => {
    const id = mod.saveSecret("old-password");
    mod.updateSecret(id, "new-password");
    expect(mod.readSecret(id)).toBe("new-password");
  });
});

describe("deleteSecret", () => {
  it("removes the entry so readSecret reports it as absent", () => {
    const id = mod.saveSecret("hunter2");
    mod.deleteSecret(id);
    expect(secrets[id]).toBeUndefined();
    expect(mod.readSecret(id)).toBeNull();
  });

  it("is a no-op for a null/undefined id", () => {
    mod.deleteSecret(null);
    mod.deleteSecret(undefined);
    expect(mockStoreSet).not.toHaveBeenCalled();
  });
});

describe("decrypt failure handling", () => {
  it("replaces safeStorage's raw internal error with a clear, actionable one", () => {
    const id = mod.saveSecret("hunter2");
    mockDecryptString.mockImplementation(() => {
      throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString. Decryption is not available.");
    });
    expect(() => mod.readSecret(id)).toThrow(/Couldn't decrypt the saved password\/passphrase/);
  });

  it("never surfaces the raw safeStorage error message to the caller", () => {
    const id = mod.saveSecret("hunter2");
    mockDecryptString.mockImplementation(() => {
      throw new Error("Decryption is not available.");
    });
    try {
      mod.readSecret(id);
      expect.unreachable("readSecret should have thrown");
    } catch (err) {
      expect(String(err)).not.toContain("Decryption is not available");
    }
  });

  it("doesn't affect a plain: (unencrypted fallback) entry, which never calls safeStorage.decryptString", () => {
    mockIsEncryptionAvailable.mockReturnValue(false);
    const id = mod.saveSecret("hunter2");
    mockDecryptString.mockImplementation(() => {
      throw new Error("should never be called for a plain: entry");
    });
    expect(mod.readSecret(id)).toBe("hunter2");
  });
});
