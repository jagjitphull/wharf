import { describe, expect, it } from "vitest";
import { hasVariables, renderSnippet, snippetVariables, usesClipboard, type SnippetBuiltins } from "./snippetTemplate";

const builtins: SnippetBuiltins = {
  host: "web-01",
  hostname: "10.0.0.5",
  user: "deploy",
  now: new Date(2026, 2, 9, 7, 5, 3),
  clipboard: "from-clipboard",
};

describe("snippetVariables", () => {
  it("finds each asked-for variable once, in order", () => {
    expect(snippetVariables("docker exec {{container}} {{cmd}} && echo {{container}}")).toEqual([{ name: "container" }, { name: "cmd" }]);
  });

  it("reads defaults and option lists", () => {
    expect(snippetVariables("deploy {{env=prod|staging| dev }} --tag {{tag:latest}} {{empty:}}")).toEqual([
      { name: "env", options: ["prod", "staging", "dev"], default: "prod" },
      { name: "tag", default: "latest" },
      { name: "empty", default: "" },
    ]);
  });

  it("keeps a colon inside a default", () => {
    expect(snippetVariables("curl {{url:http://localhost:8080}}")).toEqual([{ name: "url", default: "http://localhost:8080" }]);
  });

  it("allows spaces inside the braces and dashes in names", () => {
    expect(snippetVariables("x {{ my-name }}")).toEqual([{ name: "my-name" }]);
  });

  it("doesn't ask for built-ins or for things that aren't variables", () => {
    expect(snippetVariables("echo {{$host}} {{$date}} ${HOME} {not} {{ }} {{1bad}}")).toEqual([]);
    expect(hasVariables("echo {{$host}}")).toBe(false);
    expect(hasVariables("echo {{x}}")).toBe(true);
  });

  it("an option list with nothing in it is just a plain variable", () => {
    expect(snippetVariables("x {{a=}}")).toEqual([{ name: "a" }]);
  });
});

describe("renderSnippet", () => {
  it("fills asked-for variables, every occurrence", () => {
    expect(renderSnippet("logs {{c}} | grep {{c}}", { c: "api" }, builtins)).toBe("logs api | grep api");
  });

  it("falls back to the default when no value was given", () => {
    expect(renderSnippet("tag {{t:latest}}", {}, builtins)).toBe("tag latest");
    expect(renderSnippet("tag {{t:latest}}", { t: "v2" }, builtins)).toBe("tag v2");
    expect(renderSnippet("env {{e=prod|dev}}", {}, builtins)).toBe("env prod");
  });

  it("an empty value is respected (it is not replaced by the default)", () => {
    expect(renderSnippet("tag{{t:latest}}", { t: "" }, builtins)).toBe("tag");
  });

  it("fills built-ins", () => {
    expect(renderSnippet("{{$host}} {{$hostname}} {{$user}}", {}, builtins)).toBe("web-01 10.0.0.5 deploy");
    expect(renderSnippet("{{$date}} {{$time}} {{$timestamp}}", {}, builtins)).toBe("2026-03-09 07:05:03 20260309-070503");
    expect(renderSnippet("echo {{$clipboard}}", {}, builtins)).toBe("echo from-clipboard");
  });

  it("leaves an unknown built-in and a missing plain variable as written", () => {
    expect(renderSnippet("{{$nope}} {{plain}}", { other: "x" }, builtins)).toBe("{{$nope}} {{plain}}");
  });

  it("does not interpret the replacement (no $& or $1 tricks)", () => {
    expect(renderSnippet("echo {{x}}", { x: "$& $1 $$" }, builtins)).toBe("echo $& $1 $$");
  });

  it("leaves shell syntax alone", () => {
    expect(renderSnippet('for f in *.log; do echo "${f}"; done # {{n}}', { n: "1" }, builtins)).toBe(
      'for f in *.log; do echo "${f}"; done # 1',
    );
  });
});

describe("usesClipboard", () => {
  it("is true only for the clipboard built-in", () => {
    expect(usesClipboard("echo {{$clipboard}}")).toBe(true);
    expect(usesClipboard("echo {{ $clipboard }}")).toBe(true);
    expect(usesClipboard("echo {{clipboard}} {{$host}}")).toBe(false);
  });
});
