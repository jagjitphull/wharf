import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// sshConfigParser.ts expands `~` and resolves relative Include paths via
// os.homedir() (which reads $HOME on POSIX) — pointing HOME at a fresh temp
// directory per test sandboxes it from the real ~/.ssh without touching the
// module's source, same approach as knownHosts.test.ts.
let tmpHome: string;
let sshDir: string;
let configPath: string;
let mod: typeof import("./sshConfigParser");

function writeConfig(contents: string, file = configPath): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

beforeEach(async () => {
  tmpHome = mkdtempSync(path.join(tmpdir(), "wharf-sshconfig-test-"));
  sshDir = path.join(tmpHome, ".ssh");
  mkdirSync(sshDir, { recursive: true });
  configPath = path.join(sshDir, "config");
  vi.stubEnv("HOME", tmpHome);
  vi.resetModules();
  mod = await import("./sshConfigParser");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("parseSshConfig", () => {
  it("returns an empty list when the config file doesn't exist", () => {
    expect(mod.parseSshConfig(configPath)).toEqual([]);
  });

  it("parses a basic Host block with every modeled directive", () => {
    writeConfig(
      [
        "Host web",
        "  HostName web.example.com",
        "  User deploy",
        "  Port 2222",
        "  IdentityFile ~/.ssh/id_web",
        "  ProxyJump bastion",
      ].join("\n"),
    );
    expect(mod.parseSshConfig(configPath)).toEqual([
      {
        alias: "web",
        hostname: "web.example.com",
        port: 2222,
        username: "deploy",
        identityFile: path.join(tmpHome, ".ssh/id_web"),
        proxyJump: "bastion",
        alreadyImported: false,
      },
    ]);
  });

  it("falls back to the alias as the hostname and to port 22, like ssh itself", () => {
    writeConfig("Host box\n  User me\n");
    const [c] = mod.parseSshConfig(configPath);
    expect(c.hostname).toBe("box");
    expect(c.port).toBe(22);
  });

  it("ignores comments, blank lines, and unmodeled directives", () => {
    writeConfig(
      ["# a comment", "", "Host a", "  # inner comment", "  HostName a.example.com", "  ForwardAgent yes", "  ServerAliveInterval 30"].join(
        "\n",
      ),
    );
    expect(mod.parseSshConfig(configPath)).toHaveLength(1);
    expect(mod.parseSshConfig(configPath)[0].hostname).toBe("a.example.com");
  });

  it("accepts keyword=value syntax, case-insensitive keywords, and quoted values", () => {
    writeConfig(["host quoted", '  HOSTNAME="q.example.com"', "  user = bob", "  port=2200"].join("\n"));
    const [c] = mod.parseSshConfig(configPath);
    expect(c).toMatchObject({ alias: "quoted", hostname: "q.example.com", username: "bob", port: 2200 });
  });

  it("handles CRLF line endings", () => {
    writeConfig("Host a\r\n  HostName a.example.com\r\n  User u\r\n");
    expect(mod.parseSshConfig(configPath)[0]).toMatchObject({ hostname: "a.example.com", username: "u" });
  });

  it("keeps only the first IdentityFile when a block lists several", () => {
    writeConfig(["Host a", "  IdentityFile ~/.ssh/first", "  IdentityFile ~/.ssh/second"].join("\n"));
    expect(mod.parseSshConfig(configPath)[0].identityFile).toBe(path.join(tmpHome, ".ssh/first"));
  });

  it("keeps only the first hop of a comma-separated ProxyJump", () => {
    writeConfig(["Host a", "  ProxyJump hop1, hop2"].join("\n"));
    expect(mod.parseSshConfig(configPath)[0].proxyJump).toBe("hop1");
  });

  it("ignores a non-numeric Port rather than producing NaN", () => {
    writeConfig(["Host a", "  Port notaport"].join("\n"));
    expect(mod.parseSshConfig(configPath)[0].port).toBe(22);
  });

  it("ignores directives that appear before any Host block", () => {
    writeConfig(["User orphan", "Host a", "  HostName a.example.com"].join("\n"));
    expect(mod.parseSshConfig(configPath)[0].username).toBeUndefined();
  });

  it("skips wildcard-only Host blocks, but picks the concrete alias out of a mixed pattern list", () => {
    writeConfig(["Host *.internal", "  User wild", "Host app *.example.com", "  HostName app.example.com"].join("\n"));
    const result = mod.parseSshConfig(configPath);
    expect(result.map((c) => c.alias)).toEqual(["app"]);
  });

  it("merges a `Host *` block's values as defaults into the concrete blocks that follow it", () => {
    writeConfig(["Host *", "  User shared", "  Port 2022", "Host a", "  HostName a.example.com", "Host b", "  User override"].join("\n"));
    const [a, b] = mod.parseSshConfig(configPath);
    expect(a).toMatchObject({ alias: "a", username: "shared", port: 2022 });
    expect(b).toMatchObject({ alias: "b", username: "override", port: 2022 });
  });

  it("does not apply a `Host *` block to concrete blocks that came before it (documented limitation)", () => {
    writeConfig(["Host a", "  HostName a.example.com", "Host *", "  User late"].join("\n"));
    expect(mod.parseSshConfig(configPath)[0].username).toBeUndefined();
  });

  it("does not let a Match block's directives leak into the Host block above it", () => {
    writeConfig(["Host a", "  HostName a.example.com", "Match host b", "  HostName leaked.example.com", "  User leaked"].join("\n"));
    const [a] = mod.parseSshConfig(configPath);
    expect(a.hostname).toBe("a.example.com");
    expect(a.username).toBeUndefined();
  });
});

describe("parseSshConfig Include handling", () => {
  it("follows a relative Include (resolved against ~/.ssh) and an absolute one", () => {
    const absolute = path.join(tmpHome, "elsewhere", "abs.conf");
    writeConfig("Host abs\n  HostName abs.example.com\n", absolute);
    writeConfig("Host rel\n  HostName rel.example.com\n", path.join(sshDir, "rel.conf"));
    writeConfig([`Include rel.conf`, `Include ${absolute}`].join("\n"));
    expect(mod.parseSshConfig(configPath).map((c) => c.alias)).toEqual(["rel", "abs"]);
  });

  it("expands a `*` glob in Include in sorted order", () => {
    writeConfig("Host b\n", path.join(sshDir, "conf.d", "b.conf"));
    writeConfig("Host a\n", path.join(sshDir, "conf.d", "a.conf"));
    writeConfig("Include conf.d/*.conf\n");
    expect(mod.parseSshConfig(configPath).map((c) => c.alias)).toEqual(["a", "b"]);
  });

  it("silently skips an Include that matches nothing", () => {
    writeConfig(["Include missing.conf", "Include nodir/*", "Host a", "  HostName a.example.com"].join("\n"));
    expect(mod.parseSshConfig(configPath).map((c) => c.alias)).toEqual(["a"]);
  });

  it("doesn't loop forever on a file that includes itself", () => {
    writeConfig(["Include config", "Host a", "  HostName a.example.com"].join("\n"));
    expect(mod.parseSshConfig(configPath).map((c) => c.alias)).toEqual(["a"]);
  });
});
