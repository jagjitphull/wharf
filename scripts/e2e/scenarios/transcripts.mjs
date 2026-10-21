import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const name = "transcripts";

// Session transcripts: off by default; when on, a local shell session's text is recorded, searchable
// from History → Session output, and deleted on request.
export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const call = (expr) =>
    app.ev(`(async () => { try { return { ok: await (${expr}) }; } catch (e) { return { err: String(e.message || e) }; } })()`);

  t.ok("recording is off by default", (await call("window.wharf.transcripts.getSettings()")).ok?.enabled === false);

  // --- off: a session leaves nothing behind
  let r = await call("window.wharf.localShell.connect(80, 24)");
  let sid = r.ok?.sessionId ?? r.ok;
  await app.sleep(800);
  await call(`window.wharf.ssh.write(${JSON.stringify(sid)}, "echo needle-off-4471\\r")`);
  await app.sleep(800);
  await call(`window.wharf.ssh.disconnect(${JSON.stringify(sid)})`);
  await app.sleep(500);
  t.ok("nothing is recorded while it is off", (await call("window.wharf.transcripts.list()")).ok?.length === 0);

  // --- on
  await call(`window.wharf.transcripts.setSettings({ enabled: true, retentionDays: 30 })`);
  r = await call("window.wharf.localShell.connect(80, 24)");
  sid = r.ok?.sessionId ?? r.ok;
  await app.sleep(800);
  await call(`window.wharf.ssh.write(${JSON.stringify(sid)}, "echo needle-on-$((40+2))\\r")`);
  await call(`window.wharf.ssh.write(${JSON.stringify(sid)}, "printf 'progress 10%%\\\\rprogress 100%%\\\\n'\\r")`);
  await app.until(async () => (await call(`window.wharf.transcripts.search("needle-on-42")`)).ok?.matches?.length > 0, 8000);
  const found = (await call(`window.wharf.transcripts.search("needle-on-42")`)).ok;
  const outputMatch = found.matches.find((m) => m.text === "needle-on-42");
  t.ok(
    "the output of a command is found (the typed command line is, too)",
    found.matches.length >= 1 && !!outputMatch,
    JSON.stringify(found.matches.map((m) => m.text)),
  );
  t.ok("the session is marked as still recording", (await call("window.wharf.transcripts.list()")).ok?.[0]?.active === true);
  t.ok(
    "a progress line keeps only its final state",
    (await call(`window.wharf.transcripts.search("progress 100")`)).ok?.matches?.some((m) => m.text === "progress 100%"),
  );
  t.ok(
    "…and not the intermediate one",
    !(await call(`window.wharf.transcripts.search("progress 10%")`)).ok?.matches?.some(
      (m) => m.text.startsWith("progress 10%") && !m.text.startsWith("progress 100"),
    ),
  );
  t.ok(
    "the earlier session's text, recorded while off, is not there",
    (await call(`window.wharf.transcripts.search("needle-off-4471")`)).ok?.matches?.length === 0,
  );

  // --- the History → Session output page
  await app.rail("History");
  await app.until(() => app.q(".history-tab"), 5000);
  await app.ev(`[...document.querySelectorAll('.history-tab')].find((b) => /Session output/.test(b.textContent))?.click()`);
  await app.until(() => app.q(".transcripts-search input"), 5000);
  t.ok("Session output lists the recorded session", (await app.q(".transcripts-row", "(e) => !!e")) === true);
  await app.setInput(".transcripts-search input", "needle-on-42");
  await app.until(() => app.q(".transcripts-match"), 5000);
  t.ok(
    "searching shows the match highlighted",
    (await app.q(".transcripts-match .transcript-mark", "(e) => e?.textContent")) === "needle-on-42",
  );
  await app.shot("transcripts-search");
  // the match whose line is the command output, not the echoed command
  await app.ev(
    `[...document.querySelectorAll('.transcripts-match')].find((b) => b.querySelector('.transcripts-hit')?.textContent === 'needle-on-42')?.click()`,
  );
  await app.until(() => app.q(".transcript-line.current"), 5000);
  t.ok(
    "opening a match shows the transcript scrolled to that line",
    (await app.q(".transcript-line.current .transcript-text", "(e) => e?.textContent")) === "needle-on-42",
  );
  await app.shot("transcript-viewer");

  // --- ending the session finishes it; delete removes it
  await call(`window.wharf.ssh.disconnect(${JSON.stringify(sid)})`);
  await app.sleep(500);
  const listed = (await call("window.wharf.transcripts.list()")).ok;
  t.ok("a closed session is no longer recording", listed.length === 1 && listed[0].active === false && listed[0].hostName === "Local");
  const id = listed[0].id;
  t.ok(
    "it reads back in full",
    (await call(`window.wharf.transcripts.read(${JSON.stringify(id)})`)).ok?.lines?.some((l) => l.text === "needle-on-42"),
  );
  t.ok("a path-like id reads nothing", (await call(`window.wharf.transcripts.read("../../wharf-data")`)).ok === null);
  await call(`window.wharf.transcripts.remove(${JSON.stringify(id)})`);
  t.ok("a transcript can be deleted", (await call("window.wharf.transcripts.list()")).ok?.length === 0);

  // --- with a master password the files are sealed, and not readable on disk
  r = await call("window.wharf.localShell.connect(80, 24)");
  sid = r.ok?.sessionId ?? r.ok;
  await app.sleep(800);
  await call(`window.wharf.ssh.write(${JSON.stringify(sid)}, "echo sealed-needle-9913\\r")`);
  await app.until(async () => (await call(`window.wharf.transcripts.search("sealed-needle-9913")`)).ok?.matches?.length > 0, 8000);
  const dir = path.join(app.profile, "transcripts");
  const text = () =>
    readdirSync(dir)
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
  t.ok("before a master password the file is plain text", text().includes("sealed-needle-9913"));
  await call(`window.wharf.secrets.setMasterPassword("correct horse battery")`);
  t.ok("setting one seals it on disk", !text().includes("sealed-needle-9913") && !text().includes("Local"));
  await call(`window.wharf.ssh.write(${JSON.stringify(sid)}, "echo sealed-needle-after-5520\\r")`);
  await app.until(async () => (await call(`window.wharf.transcripts.search("sealed-needle-after-5520")`)).ok?.matches?.length > 0, 8000);
  t.ok("the open session keeps recording, sealed", !text().includes("5520"));
  await call("window.wharf.secrets.lock()");
  t.ok(
    "locked: nothing can be listed or searched",
    (await call("window.wharf.transcripts.list()")).ok?.length === 0 &&
      (await call(`window.wharf.transcripts.search("sealed")`)).ok?.matches?.length === 0,
  );
  await call(`window.wharf.secrets.unlock("correct horse battery")`);
  t.ok(
    "unlocked: both lines are searchable again",
    (await call(`window.wharf.transcripts.search("sealed-needle")`)).ok?.matches?.length >= 2,
  );
  await call(`window.wharf.secrets.removeMasterPassword("correct horse battery")`);
  t.ok(
    "removing the password returns the file to plain text",
    text().includes("sealed-needle-9913"),
    JSON.stringify([readdirSync(dir), text().slice(0, 300)]),
  );
  await call(`window.wharf.ssh.disconnect(${JSON.stringify(sid)})`);
}
