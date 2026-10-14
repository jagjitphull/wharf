import { describe, expect, it, vi } from "vitest";
import { checkForUpdate, compareVersions } from "./updateCheck";

describe("compareVersions", () => {
  it.each([
    ["1.0.0", "1.0.0", 0],
    ["1.0.1", "1.0.0", 1],
    ["1.0.0", "1.0.1", -1],
    ["1.2.0", "1.1.9", 1],
    ["2.0.0", "1.99.99", 1],
    ["0.10.0", "0.9.0", 1], // numeric, not string, comparison
    ["v1.2.3", "1.2.3", 0], // leading v allowed
    ["1.2.3+build5", "1.2.3", 0], // build metadata ignored
  ])("compares %s to %s as %i", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it("sorts a pre-release before its own release", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
  });

  it("orders pre-releases per the semver rules", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1); // numeric before alphanumeric
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.11")).toBe(-1); // numeric identifiers compare as numbers
    expect(compareVersions("1.0.0-rc.1", "1.0.0-beta.9")).toBe(1);
  });

  it("returns null when either side isn't a version", () => {
    expect(compareVersions("latest", "1.0.0")).toBeNull();
    expect(compareVersions("1.0", "1.0.0")).toBeNull();
    expect(compareVersions("", "1.0.0")).toBeNull();
  });
});

function reply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe("checkForUpdate", () => {
  it("reports a newer release and links to it", async () => {
    const fetchImpl = reply(200, { tag_name: "v0.2.0", html_url: "https://github.com/jagjitphull/wharf/releases/tag/v0.2.0" });
    expect(await checkForUpdate("0.1.0", fetchImpl)).toEqual({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/jagjitphull/wharf/releases/tag/v0.2.0",
    });
  });

  it("asks the right endpoint with a User-Agent (GitHub rejects requests without one)", async () => {
    const fetchImpl = reply(200, { tag_name: "v0.1.0" });
    await checkForUpdate("0.1.0", fetchImpl, "me/app");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/me/app/releases/latest");
    expect(init.headers["User-Agent"]).toBeTruthy();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("says no update when already on the latest, or ahead of it (a dev build)", async () => {
    expect((await checkForUpdate("0.2.0", reply(200, { tag_name: "v0.2.0" }))).updateAvailable).toBe(false);
    const ahead = await checkForUpdate("0.3.0", reply(200, { tag_name: "v0.2.0" }));
    expect(ahead.updateAvailable).toBe(false);
    expect(ahead.latestVersion).toBe("0.2.0");
    expect(ahead.error).toBeUndefined();
  });

  it("treats a 404 as 'nothing published yet', not a failure of the app", async () => {
    const r = await checkForUpdate("0.1.0", reply(404, { message: "Not Found" }));
    expect(r).toMatchObject({ latestVersion: null, updateAvailable: false, releaseUrl: null });
    expect(r.error).toMatch(/no release/i);
  });

  it("reports other HTTP errors (e.g. rate limiting) with the status", async () => {
    const r = await checkForUpdate("0.1.0", reply(403, {}));
    expect(r.updateAvailable).toBe(false);
    expect(r.error).toContain("403");
  });

  it("never throws when the network is down", async () => {
    const r = await checkForUpdate("0.1.0", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com")));
    expect(r.updateAvailable).toBe(false);
    expect(r.error).toContain("ENOTFOUND");
  });

  it("never throws on an unreadable or unexpected response body", async () => {
    const badJson = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    expect((await checkForUpdate("0.1.0", badJson)).error).toBeTruthy();
    expect((await checkForUpdate("0.1.0", reply(200, {}))).error).toBeTruthy();
    expect((await checkForUpdate("0.1.0", reply(200, null))).error).toBeTruthy();
    expect((await checkForUpdate("0.1.0", reply(200, { tag_name: "nightly" }))).error).toBeTruthy();
  });

  it("only returns a link on the repository itself, falling back to its releases page", async () => {
    const evil = await checkForUpdate("0.1.0", reply(200, { tag_name: "v9.0.0", html_url: "https://evil.example/download" }));
    expect(evil.releaseUrl).toBe("https://github.com/jagjitphull/wharf/releases");
    const lookalike = await checkForUpdate(
      "0.1.0",
      reply(200, { tag_name: "v9.0.0", html_url: "https://github.com/jagjitphull/wharf-evil/releases/x" }),
    );
    expect(lookalike.releaseUrl).toBe("https://github.com/jagjitphull/wharf/releases");
    const missing = await checkForUpdate("0.1.0", reply(200, { tag_name: "v9.0.0" }));
    expect(missing.releaseUrl).toBe("https://github.com/jagjitphull/wharf/releases");
  });
});
