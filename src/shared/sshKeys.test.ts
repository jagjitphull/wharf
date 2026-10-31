import { describe, expect, it } from "vitest";
import { installKeyCommand, isSafePublicKeyLine, suggestKeyName, validateGenerateRequest, validateKeyName } from "./sshKeys";

describe("validateKeyName", () => {
  it("accepts ordinary names", () => {
    for (const n of ["id_ed25519", "work-laptop", "prod.key", "k1"]) expect(validateKeyName(n)).toBeNull();
  });

  it("refuses anything path-like or hidden, and names SSH uses itself", () => {
    for (const n of ["", "../x", "a/b", "a\\b", ".hidden", "sp ace", "x".repeat(65), "a\0b", "~/x"])
      expect(validateKeyName(n)).not.toBeNull();
    for (const n of ["config", "known_hosts", "known_hosts.old", "authorized_keys", "environment", "key.pub"])
      expect(validateKeyName(n)).not.toBeNull();
  });
});

describe("validateGenerateRequest", () => {
  const ok = { name: "k", type: "ed25519" as const };
  it("accepts the supported combinations", () => {
    expect(validateGenerateRequest(ok)).toBeNull();
    expect(validateGenerateRequest({ name: "k", type: "rsa", bits: 4096, passphrase: "hunter22" })).toBeNull();
    expect(validateGenerateRequest({ name: "k", type: "ecdsa", bits: 384, comment: "me@host" })).toBeNull();
  });

  it("checks sizes per type, the passphrase length and the comment", () => {
    expect(validateGenerateRequest({ name: "k", type: "rsa", bits: 1024 })).toMatch(/RSA/);
    expect(validateGenerateRequest({ name: "k", type: "rsa" })).toMatch(/RSA/);
    expect(validateGenerateRequest({ name: "k", type: "ecdsa", bits: 4096 })).toMatch(/ECDSA/);
    expect(validateGenerateRequest({ ...ok, passphrase: "abc" })).toMatch(/passphrase/);
    expect(validateGenerateRequest({ ...ok, passphrase: "" })).toBeNull();
    expect(validateGenerateRequest({ ...ok, comment: "a\nb" })).toMatch(/single line/);
    expect(validateGenerateRequest({ ...ok, type: "dsa" as never })).toMatch(/type/);
  });
});

describe("public key lines in shell commands", () => {
  const line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOWnV0mYb3bGvJtLzPzZ4qS6Cw7tQ4mXy9aBcDeFgHiJ me@laptop";

  it("accepts real key lines, with or without a comment", () => {
    expect(isSafePublicKeyLine(line)).toBe(true);
    expect(isSafePublicKeyLine("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ==")).toBe(true);
    expect(isSafePublicKeyLine("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY= work key")).toBe(true);
  });

  it("refuses anything that could break out of the quoting", () => {
    for (const bad of [
      `${line}'; rm -rf ~; echo '`,
      `${line}\nssh-rsa AAAA evil`,
      `${line} $(id)`,
      `${line} \`id\``,
      "ssh-ed25519 AAAA$(id)",
      "ssh-ed25519",
      "not-a-key AAAA",
      `${line};`,
      `${line} "x"`,
    ]) {
      expect(isSafePublicKeyLine(bad)).toBe(false);
      expect(() => installKeyCommand(bad)).toThrow();
    }
  });

  it("builds a command that creates the folder safely and appends only once", () => {
    const cmd = installKeyCommand(line);
    expect(cmd).toContain("chmod 700 ~/.ssh");
    expect(cmd).toContain("chmod 600 ~/.ssh/authorized_keys");
    expect(cmd).toContain(`grep -qxF '${line}'`);
    expect(cmd).toMatch(/echo present/);
    expect(cmd).toMatch(/echo added/);
  });
});

describe("suggestKeyName", () => {
  it("follows ssh-keygen's names and skips ones that are taken", () => {
    expect(suggestKeyName("ed25519", [])).toBe("id_ed25519");
    expect(suggestKeyName("ed25519", ["id_ed25519"])).toBe("id_ed25519_2");
    expect(suggestKeyName("ed25519", ["id_ed25519", "id_ed25519_2"])).toBe("id_ed25519_3");
    expect(suggestKeyName("rsa", ["id_ed25519"])).toBe("id_rsa");
  });

  it("always yields a name the validator accepts", () => {
    const taken = ["id_ecdsa", ...Array.from({ length: 98 }, (_, i) => `id_ecdsa_${i + 2}`)];
    expect(validateKeyName(suggestKeyName("ecdsa", taken))).toBeNull();
  });
});
