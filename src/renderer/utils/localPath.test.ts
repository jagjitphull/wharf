import { describe, expect, it } from "vitest";
import { isLocalRoot, localBaseName, localJoin, localParent } from "./localPath";

describe("localPath (POSIX)", () => {
  it("joins with a single separator", () => {
    expect(localJoin("/home/me", "docs")).toBe("/home/me/docs");
    expect(localJoin("/home/me/", "docs")).toBe("/home/me/docs");
    expect(localJoin("/", "etc")).toBe("/etc");
  });

  it("finds the parent, stopping at the root", () => {
    expect(localParent("/home/me/docs")).toBe("/home/me");
    expect(localParent("/home/me/docs/")).toBe("/home/me");
    expect(localParent("/home")).toBe("/");
    expect(localParent("/")).toBe("/");
  });

  it("extracts the base name", () => {
    expect(localBaseName("/home/me/file.txt")).toBe("file.txt");
    expect(localBaseName("/home/me/dir/")).toBe("dir");
    expect(localBaseName("/")).toBe("");
    expect(localBaseName("relative")).toBe("relative");
  });

  it("recognizes only / as the root", () => {
    expect(isLocalRoot("/")).toBe(true);
    expect(isLocalRoot("/home")).toBe(false);
  });
});

describe("localPath (Windows)", () => {
  it("joins with backslashes", () => {
    expect(localJoin("C:\\Users", "me")).toBe("C:\\Users\\me");
    expect(localJoin("C:\\", "Users")).toBe("C:\\Users");
  });

  it("finds the parent, stopping at the drive root", () => {
    expect(localParent("C:\\Users\\me")).toBe("C:\\Users");
    expect(localParent("C:\\Users")).toBe("C:\\");
    expect(localParent("C:\\")).toBe("C:\\");
  });

  it("extracts the base name", () => {
    expect(localBaseName("C:\\Users\\me\\file.txt")).toBe("file.txt");
    expect(localBaseName("C:\\Users\\")).toBe("Users");
  });

  it("recognizes a drive root", () => {
    expect(isLocalRoot("C:\\")).toBe(true);
    expect(isLocalRoot("C:")).toBe(false); // no separator -> treated as POSIX, not a root
    expect(isLocalRoot("C:\\Users")).toBe(false);
  });
});
