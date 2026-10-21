import { readFileSync } from "node:fs";
import path from "node:path";

export const name = "protected-data";

// With a master password, Command History, saved workspaces and the last session's tabs are
// sealed in the data file and unreadable while locked.
export async function run(t, start) {
  let app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const call = (expr) =>
    app.ev(`(async () => { try { return { ok: await (${expr}) }; } catch (e) { return { err: String(e.message || e) }; } })()`);
  const dataFile = () => readFileSync(path.join(app.profile, "wharf-data.json"), "utf8");
  const PASSWORD = "correct horse battery";
  const tab = (marker) => `{ layout: { type: "leaf", hostId: null, scrollback: "${marker}" } }`;

  await call(`window.wharf.commandHistory.add({ sessionId: "s1", hostId: null, hostName: "Local", command: "echo needle-history-8841" })`);
  await call(`window.wharf.workspaces.create({ name: "needle-workspace-8841", tabs: [${tab("needle-tab-8841")}] })`);
  await call(`window.wharf.session.saveLast([${tab("needle-session-8841")}])`);

  const plain = dataFile();
  t.ok(
    "before a master password they are stored as plain JSON",
    plain.includes("needle-history-8841") && plain.includes("needle-workspace-8841") && plain.includes("needle-session-8841"),
  );

  t.ok("a master password can be set", (await call(`window.wharf.secrets.setMasterPassword("${PASSWORD}")`)).err === undefined);
  const sealed = dataFile();
  t.ok("…and none of them is readable in the data file any more", !sealed.includes("8841"), sealed.match(/.{20}8841.{20}/)?.[0]);
  t.ok(
    "…while unlocked they still read back",
    (await call(`window.wharf.commandHistory.list()`)).ok?.[0]?.command === "echo needle-history-8841",
  );
  t.ok("…including workspaces", (await call(`window.wharf.workspaces.list()`)).ok?.[0]?.name === "needle-workspace-8841");

  await call(`window.wharf.commandHistory.add({ sessionId: "s1", hostId: null, hostName: "Local", command: "echo needle-new-8841" })`);
  t.ok(
    "new History entries are sealed too",
    !dataFile().includes("8841") && (await call(`window.wharf.commandHistory.list()`)).ok?.length === 2,
  );

  await call("window.wharf.secrets.lock()");
  t.ok("while locked History reads empty", (await call(`window.wharf.commandHistory.list()`)).ok?.length === 0);
  t.ok(
    "…and so do workspaces and the last session",
    (await call(`window.wharf.workspaces.list()`)).ok?.length === 0 && (await call(`window.wharf.session.getLast()`)).ok?.length === 0,
  );
  await call(`window.wharf.session.saveLast([])`); // what a locked window would try to save
  await call(`window.wharf.commandHistory.clear()`);
  t.ok(
    "a write while locked cannot wipe the sealed copy",
    (await call(`window.wharf.workspaces.create({ name: "x", tabs: [] })`)).err !== undefined,
  );
  await call(`window.wharf.secrets.unlock("${PASSWORD}")`);
  t.ok(
    "after unlocking everything is still there",
    (await call(`window.wharf.commandHistory.list()`)).ok?.length === 2 &&
      (await call(`window.wharf.session.getLast()`)).ok?.length === 1 &&
      (await call(`window.wharf.workspaces.list()`)).ok?.length === 1,
  );

  // restart: comes up locked, data comes back with the password
  await app.stop();
  const { profile, home } = app;
  app = await start({ profile, home });
  await app.until(() => app.q(".lock-screen"), 15_000);
  t.ok("after a restart nothing readable is on disk", !dataFile().includes("8841"));
  await app.setInput(".lock-dialog input", PASSWORD);
  await app.click(".lock-dialog button[type=submit]");
  await app.until(async () => !(await app.q(".lock-screen")), 10_000);
  t.ok("unlocking at launch restores History", (await call(`window.wharf.commandHistory.list()`)).ok?.length === 2);

  t.ok(
    "changing the password keeps them",
    (await call(`window.wharf.secrets.changeMasterPassword("${PASSWORD}", "another long one 77")`)).err === undefined &&
      (await call(`window.wharf.workspaces.list()`)).ok?.length === 1,
  );
  t.ok(
    "removing it returns them to plain data",
    (await call(`window.wharf.secrets.removeMasterPassword("another long one 77")`)).err === undefined,
  );
  const back = dataFile();
  t.ok(
    "…readable again",
    back.includes("needle-history-8841") && back.includes("needle-workspace-8841") && back.includes("needle-session-8841"),
  );
  t.ok("…and no sealed copy is left", !/"sealedData":\s*\{\s*"/.test(back));
}
