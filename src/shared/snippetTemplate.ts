/**
 * Variables in a saved snippet. Pure, so the renderer's picker and palette
 * share one definition and the tests exercise it directly.
 *
 *   {{name}}              asked for each time the snippet is used
 *   {{name:default}}      …with a value filled in already
 *   {{name=a|b|c}}        …chosen from a list (the first is preselected)
 *   {{$host}} {{$hostname}} {{$user}} {{$date}} {{$time}} {{$timestamp}} {{$clipboard}}
 *                         built in: filled from the terminal's host, the clock or the clipboard
 *
 * Built-ins start with `$` so they can never collide with a name someone
 * already used in a snippet. An unknown `$name` is left as written.
 */

export interface SnippetVariable {
  name: string;
  default?: string;
  /** Present for `{{name=a|b|c}}`: the allowed values. */
  options?: string[];
}

export interface SnippetBuiltins {
  /** The saved host's display name; "Local Shell" in a local shell. */
  host: string;
  hostname: string;
  user: string;
  now: Date;
  clipboard: string;
}

const VARIABLE_RE = /\{\{\s*(\$?[a-zA-Z_][\w-]*)\s*(?:([:=])([^{}]*))?\}\}/g;

const BUILTIN_NAMES = ["host", "hostname", "user", "date", "time", "timestamp", "clipboard"] as const;
type BuiltinName = (typeof BUILTIN_NAMES)[number];

const isBuiltin = (name: string): name is `$${BuiltinName}` =>
  name.startsWith("$") && (BUILTIN_NAMES as readonly string[]).includes(name.slice(1));

/** The variables the user is asked for, once each, in order of first appearance. */
export function snippetVariables(command: string): SnippetVariable[] {
  const seen = new Map<string, SnippetVariable>();
  for (const match of command.matchAll(VARIABLE_RE)) {
    const [, name, kind, rest] = match;
    if (name.startsWith("$") || seen.has(name)) continue;
    if (kind === "=") {
      const options = rest
        .split("|")
        .map((o) => o.trim())
        .filter(Boolean);
      seen.set(name, options.length > 0 ? { name, options, default: options[0] } : { name });
    } else if (kind === ":") {
      seen.set(name, { name, default: rest });
    } else {
      seen.set(name, { name });
    }
  }
  return [...seen.values()];
}

/** Whether using this snippet needs the fill-in form. */
export const hasVariables = (command: string): boolean => snippetVariables(command).length > 0;

const pad = (n: number): string => String(n).padStart(2, "0");

function builtinValue(name: BuiltinName, b: SnippetBuiltins): string {
  const d = b.now;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  switch (name) {
    case "host":
      return b.host;
    case "hostname":
      return b.hostname;
    case "user":
      return b.user;
    case "date":
      return date;
    case "time":
      return time;
    case "timestamp":
      return `${date.replace(/-/g, "")}-${time.replace(/:/g, "")}`;
    case "clipboard":
      return b.clipboard;
  }
}

/** Whether the command uses `{{$clipboard}}` — so the clipboard is only read when it is needed. */
export const usesClipboard = (command: string): boolean => /\{\{\s*\$clipboard\s*\}\}/.test(command);

/** The command with every variable replaced: asked-for ones from `values` (falling back to their default), built-ins from `builtins`. */
export function renderSnippet(command: string, values: Record<string, string>, builtins: SnippetBuiltins): string {
  const defaults = new Map(snippetVariables(command).flatMap((v) => (v.default === undefined ? [] : [[v.name, v.default] as const])));
  return command.replace(VARIABLE_RE, (whole, name: string) => {
    if (name.startsWith("$")) return isBuiltin(name) ? builtinValue(name.slice(1) as BuiltinName, builtins) : whole;
    return name in values ? values[name] : (defaults.get(name) ?? whole);
  });
}
