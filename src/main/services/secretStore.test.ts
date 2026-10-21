import { beforeEach, describe, expect, it, vi } from "vitest";

// secretStore.ts only ever touches the store through a few keys ("secrets", the
// master-password config, and the History/workspace data it seals) — a plain in-memory stand-in is enough, and
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
let masterPassword: unknown = null;
/** Everything else the store holds: the History/workspace data and its sealed copies (see protectedData.ts). */
let other: Record<string, unknown>;
let mod: typeof import("./secretStore");

beforeEach(async () => {
  secrets = {};
  masterPassword = null;
  other = { sealedData: {}, commandHistory: [], workspaces: [], lastSessionTabs: [] };
  mockStoreGet.mockReset().mockImplementation((key: string) => {
    if (key === "masterPassword") return masterPassword;
    if (key === "secrets") return secrets;
    if (!(key in other)) throw new Error(`unexpected store.get(${key})`);
    return other[key];
  });
  mockStoreSet.mockReset().mockImplementation((key: string, value: unknown) => {
    if (key === "masterPassword") {
      masterPassword = value;
      return;
    }
    if (key === "secrets") {
      secrets = value as Record<string, string>;
      return;
    }
    if (!(key in other)) throw new Error(`unexpected store.set(${key})`);
    other[key] = value;
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

describe("upgradeUnencryptedSecrets / countUnencryptedSecrets", () => {
  function saveWithoutKeyring(value: string): string {
    mockIsEncryptionAvailable.mockReturnValue(false);
    const id = mod.saveSecret(value);
    mockIsEncryptionAvailable.mockReturnValue(true);
    return id;
  }

  it("counts only the base64-fallback entries", () => {
    saveWithoutKeyring("a");
    saveWithoutKeyring("b");
    mod.saveSecret("c"); // keyring available: encrypted
    expect(mod.countUnencryptedSecrets()).toBe(2);
  });

  it("re-encrypts fallback entries once a keyring is available, keeping their values", () => {
    const a = saveWithoutKeyring("alpha");
    const b = saveWithoutKeyring("béta ✓");
    expect(mod.upgradeUnencryptedSecrets()).toBe(2);
    expect(secrets[a]).toMatch(/^enc:/);
    expect(secrets[b]).toMatch(/^enc:/);
    expect(mod.readSecret(a)).toBe("alpha");
    expect(mod.readSecret(b)).toBe("béta ✓");
    expect(mod.countUnencryptedSecrets()).toBe(0);
  });

  it("leaves fallback entries alone while there is still no keyring", () => {
    const id = saveWithoutKeyring("alpha");
    mockIsEncryptionAvailable.mockReturnValue(false);
    expect(mod.upgradeUnencryptedSecrets()).toBe(0);
    expect(secrets[id]).toMatch(/^plain:/);
    expect(mockStoreSet).toHaveBeenCalledTimes(1); // only the original save
  });

  it("doesn't touch entries that are already encrypted, and writes nothing when there's nothing to do", () => {
    const id = mod.saveSecret("already");
    const before = secrets[id];
    mockStoreSet.mockClear();
    expect(mod.upgradeUnencryptedSecrets()).toBe(0);
    expect(secrets[id]).toBe(before);
    expect(mockStoreSet).not.toHaveBeenCalled();
  });

  it("keeps an entry as it was if encrypting it fails, and still upgrades the others", () => {
    const bad = saveWithoutKeyring("bad");
    const good = saveWithoutKeyring("good");
    const original = secrets[bad];
    mockEncryptString.mockImplementation((plaintext: string) => {
      if (plaintext === "bad") throw new Error("keyring went away");
      return Buffer.from(plaintext, "utf8");
    });
    expect(mod.upgradeUnencryptedSecrets()).toBe(1);
    expect(secrets[bad]).toBe(original);
    expect(secrets[good]).toMatch(/^enc:/);
    expect(mod.readSecret(bad)).toBe("bad");
  });
});

describe("isEncryptionAvailable", () => {
  it("reflects safeStorage", () => {
    expect(mod.isEncryptionAvailable()).toBe(true);
    mockIsEncryptionAvailable.mockReturnValue(false);
    expect(mod.isEncryptionAvailable()).toBe(false);
  });
});

describe("master password", () => {
  beforeEach(async () => {
    const { kdf } = await import("./masterKey");
    kdf.cost = 2 ** 10;
  });

  it("enabling it re-encrypts every saved secret and leaves Wharf unlocked", () => {
    const a = mod.saveSecret("alpha-password");
    const b = mod.saveSecret("beta-passphrase");
    expect(mod.masterPasswordState()).toBe("none");
    mod.enableMasterPassword("correct horse battery");
    expect(mod.masterPasswordState()).toBe("unlocked");
    expect(secrets[a]).toMatch(/^mp:/);
    expect(secrets[b]).toMatch(/^mp:/);
    expect(mod.readSecret(a)).toBe("alpha-password");
    expect(mod.readSecret(b)).toBe("beta-passphrase");
    expect(JSON.stringify({ secrets, masterPassword })).not.toContain("correct horse battery");
  });

  it("also takes over secrets stored in the no-keyring fallback", () => {
    mockIsEncryptionAvailable.mockReturnValue(false);
    const id = mod.saveSecret("was-base64");
    expect(secrets[id]).toMatch(/^plain:/);
    mod.enableMasterPassword("correct horse battery");
    expect(secrets[id]).toMatch(/^mp:/);
    expect(mod.countUnencryptedSecrets()).toBe(0);
    expect(mod.readSecret(id)).toBe("was-base64");
  });

  it("new secrets are sealed with it, even when a keyring exists", () => {
    mod.enableMasterPassword("correct horse battery");
    const id = mod.saveSecret("new one");
    expect(secrets[id]).toMatch(/^mp:/);
    expect(mockEncryptString).not.toHaveBeenCalled();
    mod.updateSecret(id, "changed");
    expect(mod.readSecret(id)).toBe("changed");
  });

  it("locks: secrets can't be read or written until the right password is entered", () => {
    const id = mod.saveSecret("locked away");
    mod.enableMasterPassword("correct horse battery");
    mod.lock();
    expect(mod.masterPasswordState()).toBe("locked");
    expect(() => mod.readSecret(id)).toThrow(/locked/i);
    expect(() => mod.saveSecret("x")).toThrow(/locked/i);
    expect(() => mod.unlock("wrong password")).toThrow(/Wrong master password/);
    expect(mod.masterPasswordState()).toBe("locked");
    mod.unlock("correct horse battery");
    expect(mod.masterPasswordState()).toBe("unlocked");
    expect(mod.readSecret(id)).toBe("locked away");
  });

  it("is locked again after a restart (the key lives only in memory)", async () => {
    const id = mod.saveSecret("persisted");
    mod.enableMasterPassword("correct horse battery");
    vi.resetModules();
    mod = await import("./secretStore");
    expect(mod.masterPasswordState()).toBe("locked");
    expect(() => mod.readSecret(id)).toThrow(/locked/i);
    mod.unlock("correct horse battery");
    expect(mod.readSecret(id)).toBe("persisted");
  });

  it("readSecret still treats a missing id as no secret, even while locked", () => {
    mod.enableMasterPassword("correct horse battery");
    mod.lock();
    expect(mod.readSecret(null)).toBeNull();
    expect(mod.readSecret("never-saved")).toBeNull();
  });

  it("rejects a short password and a second enable", () => {
    expect(() => mod.enableMasterPassword("short")).toThrow(/at least 8/);
    expect(mod.masterPasswordState()).toBe("none");
    mod.enableMasterPassword("correct horse battery");
    expect(() => mod.enableMasterPassword("another password")).toThrow(/already set/);
  });

  it("changing the password re-encrypts under the new one and needs the old one", () => {
    const id = mod.saveSecret("keep me");
    mod.enableMasterPassword("old password 1");
    expect(() => mod.changeMasterPassword("not the old one", "new password 2")).toThrow(/Wrong master password/);
    expect(() => mod.changeMasterPassword("old password 1", "short")).toThrow(/at least 8/);
    expect(mod.readSecret(id)).toBe("keep me"); // a refused change touched nothing
    mod.changeMasterPassword("old password 1", "new password 2");
    mod.lock();
    expect(() => mod.unlock("old password 1")).toThrow(/Wrong/);
    mod.unlock("new password 2");
    expect(mod.readSecret(id)).toBe("keep me");
  });

  it("removing it returns secrets to keyring storage", () => {
    const id = mod.saveSecret("back to the keyring");
    mod.enableMasterPassword("correct horse battery");
    expect(() => mod.removeMasterPassword("wrong password")).toThrow(/Wrong/);
    expect(mod.masterPasswordState()).toBe("unlocked");
    mod.removeMasterPassword("correct horse battery");
    expect(mod.masterPasswordState()).toBe("none");
    expect(secrets[id]).toMatch(/^enc:/);
    expect(mod.readSecret(id)).toBe("back to the keyring");
  });

  it("removing it without a keyring falls back to the marked base64 form", () => {
    const id = mod.saveSecret("fallback");
    mod.enableMasterPassword("correct horse battery");
    mockIsEncryptionAvailable.mockReturnValue(false);
    mod.removeMasterPassword("correct horse battery");
    expect(secrets[id]).toMatch(/^plain:/);
    expect(mod.readSecret(id)).toBe("fallback");
  });

  it("a secret that was already unreadable is carried over, not lost, when the password is enabled", () => {
    secrets.broken = "enc:" + Buffer.from("x").toString("base64");
    mockDecryptString.mockImplementation((buf: Buffer) => {
      if (buf.toString() === "x") throw new Error("keychain entry gone");
      return buf.toString("utf8");
    });
    const good = mod.saveSecret("fine");
    mod.enableMasterPassword("correct horse battery");
    expect(secrets.broken).toMatch(/^enc:/);
    expect(mod.readSecret(good)).toBe("fine");
  });

  it("reset erases every secret and the master password", () => {
    mod.saveSecret("gone soon");
    mod.enableMasterPassword("correct horse battery");
    mod.lock();
    mod.resetSecrets();
    expect(secrets).toEqual({});
    expect(mod.masterPasswordState()).toBe("none");
    const id = mod.saveSecret("fresh start");
    expect(mod.readSecret(id)).toBe("fresh start");
  });

  it("the no-keyring upgrade never touches entries once a master password is set", () => {
    mod.enableMasterPassword("correct horse battery");
    expect(mod.upgradeUnencryptedSecrets()).toBe(0);
  });
});

describe("History, workspaces and the last session follow the master password", () => {
  const entry = { id: "h1", sessionId: "s1", hostId: "host-1", hostName: "prod", command: "kubectl get secrets", timestamp: 1 };
  const workspace = { id: "w1", name: "release-night", tabs: [], createdAt: 1 };
  let protectedData: typeof import("./protectedData");
  let unlockedKey: typeof import("./unlockedKey");

  beforeEach(async () => {
    const { kdf } = await import("./masterKey");
    kdf.cost = 2 ** 10;
    protectedData = await import("./protectedData");
    unlockedKey = await import("./unlockedKey");
    other.commandHistory = [entry];
    other.workspaces = [workspace];
  });

  it("is plain data until a master password is set", () => {
    expect(protectedData.readProtected("commandHistory")).toEqual([entry]);
    expect(protectedData.writeProtected("workspaces", [])).toBe(true);
    expect(other.workspaces).toEqual([]);
  });

  it("turning it on seals them: nothing readable stays in the data file", () => {
    mod.enableMasterPassword("correct horse battery");
    const onDisk = JSON.stringify(other);
    expect(onDisk).not.toContain("kubectl");
    expect(onDisk).not.toContain("release-night");
    expect(other.commandHistory).toEqual([]);
    expect(other.workspaces).toEqual([]);
    expect(protectedData.readProtected("commandHistory")).toEqual([entry]);
    expect(protectedData.readProtected("workspaces")).toEqual([workspace]);
  });

  it("new writes go sealed too", () => {
    mod.enableMasterPassword("correct horse battery");
    expect(protectedData.writeProtected("commandHistory", [{ ...entry, command: "cat ~/.ssh/id_ed25519" }])).toBe(true);
    expect(JSON.stringify(other)).not.toContain("id_ed25519");
    expect(protectedData.readProtected("commandHistory")[0].command).toBe("cat ~/.ssh/id_ed25519");
  });

  it("while locked reads are empty and writes are refused, so the sealed copy survives", () => {
    mod.enableMasterPassword("correct horse battery");
    mod.lock();
    expect(protectedData.readProtected("commandHistory")).toEqual([]);
    expect(protectedData.writeProtected("commandHistory", [])).toBe(false);
    mod.unlock("correct horse battery");
    expect(protectedData.readProtected("commandHistory")).toEqual([entry]);
  });

  it("changing the password re-seals them under the new one", () => {
    mod.enableMasterPassword("correct horse battery");
    mod.changeMasterPassword("correct horse battery", "another long passphrase");
    mod.lock();
    expect(() => mod.unlock("correct horse battery")).toThrow(/Wrong master password/);
    mod.unlock("another long passphrase");
    expect(protectedData.readProtected("workspaces")).toEqual([workspace]);
  });

  it("removing it restores plain data and drops the sealed copies", () => {
    mod.enableMasterPassword("correct horse battery");
    mod.removeMasterPassword("correct horse battery");
    expect(other.commandHistory).toEqual([entry]);
    expect(other.workspaces).toEqual([workspace]);
    expect(other.sealedData).toEqual({});
    expect(protectedData.readProtected("commandHistory")).toEqual([entry]);
  });

  it("a forgotten password: reset erases what was sealed, and the app starts clean", () => {
    mod.enableMasterPassword("correct horse battery");
    mod.resetSecrets();
    expect(other.sealedData).toEqual({});
    expect(protectedData.readProtected("commandHistory")).toEqual([]);
    expect(protectedData.writeProtected("commandHistory", [entry])).toBe(true);
    expect(unlockedKey.getUnlockedKey()).toBeNull();
  });

  it("an unreadable sealed copy reads as empty instead of throwing", () => {
    mod.enableMasterPassword("correct horse battery");
    other.sealedData = { commandHistory: "mp:AAAA" };
    expect(protectedData.readProtected("commandHistory")).toEqual([]);
  });
});
