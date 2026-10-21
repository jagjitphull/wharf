// End-to-end scenarios against a packaged Wharf.
//
//   xvfb-run -a npm run e2e -- [path/to/wharf] [scenario-name ...]
//
// Each scenario in ./scenarios starts its own fresh app (own profile and $HOME), drives the
// real UI and IPC over the DevTools Protocol, and reports PASS/FAIL per check. Exit status is
// non-zero if any check failed, a scenario threw, or the renderer logged an exception.
//
// Environment:
//   E2E_EXE         the executable (instead of the first argument); default release/linux-unpacked/wharf
//   E2E_NO_SANDBOX  1 to pass --no-sandbox (also applied automatically when running as root)
//   E2E_SHOTS       directory to write screenshots to (scenarios that take them)

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./harness.mjs";

if (process.platform !== "linux") {
  console.log("The e2e scenarios drive a local bash shell under xvfb and only run on Linux; skipping.");
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const args = process.argv.slice(2);
const exeArg = args.find((a) => a.includes("/") || a.includes("\\"));
const exe = path.resolve(exeArg ?? process.env.E2E_EXE ?? path.join(root, "release", "linux-unpacked", "wharf"));
const wanted = args.filter((a) => a !== exeArg);
const shotsDir = process.env.E2E_SHOTS;

if (!existsSync(exe)) {
  console.error(`No Wharf build at ${exe}. Run \`npm run package\` first.`);
  process.exit(2);
}

const files = readdirSync(path.join(here, "scenarios"))
  .filter((f) => f.endsWith(".mjs"))
  .sort();
const scenarios = [];
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(here, "scenarios", f)).href);
  if (wanted.length === 0 || wanted.includes(mod.name)) scenarios.push(mod);
}
if (scenarios.length === 0) {
  console.error(`No scenario matches ${wanted.join(", ")}. Available: ${files.map((f) => f.replace(/\.mjs$/, "")).join(", ")}`);
  process.exit(2);
}

let failed = 0;
let total = 0;
for (const scenario of scenarios) {
  console.log(`\n== ${scenario.name}`);
  const t = {
    ok(name, condition, detail = "") {
      total++;
      if (!condition) failed++;
      console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? `  ${String(detail).slice(0, 240)}` : ""}`);
    },
    info: (text) => console.log(`info  ${text}`),
  };
  const started = [];
  const start = async (opts = {}) => {
    const app = await launch({ exe, shotsDir, ...opts });
    started.push(app);
    return app;
  };
  try {
    await scenario.run(t, start);
    for (const app of started) t.ok("no renderer exceptions", app.errors.length === 0, app.errors.join(" | "));
  } catch (err) {
    total++;
    failed++;
    console.log(`FAIL  scenario threw: ${err?.stack ?? err}`);
    for (const app of started) console.log(`--- app output (tail)\n${app.output().slice(-1500)}`);
  } finally {
    for (const app of started) await app.close();
  }
}

console.log(`\n${failed === 0 ? "ALL PASS" : "FAILURES"}: ${total - failed}/${total} checks passed`);
process.exit(failed === 0 ? 0 : 1);
