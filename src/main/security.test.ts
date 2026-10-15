import { describe, expect, it } from "vitest";
import { isAppUrl, isPermissionAllowed, isSafeExternalUrl } from "./security";

describe("isSafeExternalUrl", () => {
  it("allows http and https", () => {
    expect(isSafeExternalUrl("https://example.com/path?q=1")).toBe(true);
    expect(isSafeExternalUrl("http://192.168.1.10:8080/")).toBe(true);
    expect(isSafeExternalUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("refuses every other scheme", () => {
    for (const url of [
      "file:///etc/passwd",
      "smb://host/share",
      "ssh://user@host",
      "ms-msdt:/id PCWDiagnostic",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "vscode://file/x",
      "mailto:a@b.c",
    ]) {
      expect(isSafeExternalUrl(url), url).toBe(false);
    }
  });

  it("refuses strings that aren't URLs, and non-strings", () => {
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl("example.com")).toBe(false);
    expect(isSafeExternalUrl("https//example.com")).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl({ toString: () => "https://example.com" })).toBe(false);
  });

  it("doesn't let a scheme hide behind leading whitespace tricks", () => {
    expect(isSafeExternalUrl(" javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("java\nscript:alert(1)")).toBe(false);
  });
});

describe("isAppUrl", () => {
  it("accepts the bundled file in a packaged build and rejects the dev server and web pages", () => {
    expect(isAppUrl("file:///opt/Wharf/resources/app.asar/dist-electron/renderer/index.html", false)).toBe(true);
    expect(isAppUrl("http://localhost:5173/", false)).toBe(false);
    expect(isAppUrl("https://example.com/", false)).toBe(false);
  });

  it("accepts only the dev server's origin in development", () => {
    expect(isAppUrl("http://localhost:5173/index.html", true)).toBe(true);
    expect(isAppUrl("http://localhost:5174/", true)).toBe(false);
    expect(isAppUrl("http://localhost:5173.evil.com/", true)).toBe(false);
    expect(isAppUrl("file:///tmp/x.html", true)).toBe(false);
  });

  it("rejects strings that aren't URLs", () => {
    expect(isAppUrl("", false)).toBe(false);
    expect(isAppUrl("not a url", true)).toBe(false);
  });
});

describe("isPermissionAllowed", () => {
  const app = "file:///opt/Wharf/resources/app.asar/dist-electron/renderer/index.html";

  it("allows notifications for the app's own page only", () => {
    expect(isPermissionAllowed("notifications", app, false)).toBe(true);
    expect(isPermissionAllowed("notifications", "https://example.com/", false)).toBe(false);
  });

  it("denies everything else, even for the app's own page", () => {
    for (const permission of ["media", "geolocation", "midi", "clipboard-read", "openExternal", "fullscreen", "camera"]) {
      expect(isPermissionAllowed(permission, app, false), permission).toBe(false);
    }
  });
});
