export const name = "ghost";

// The inline (ghost) suggestion must be computed from what is really on the line, not from the
// keystrokes: Tab completion and history recall change the line without the keystrokes showing it.
export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  await app.newLocalShell();
  const ghost = () => app.q(".ghost-suggestion-text", "(e) => e?.textContent ?? null");
  const line = async () => {
    const rows = (await app.screen()).trimEnd().split("\n");
    return rows[rows.length - 1].replace(/^.*?[#$] ?/, "");
  };

  await app.run("touch pyfile_abc");
  await app.run("echo pyfile_abc zzz");
  await app.run("echo only-this-one");

  // --- the plain case: typing a prefix suggests the rest, Right accepts it
  await app.type("echo only-th");
  t.ok(
    "a typed prefix shows the rest of the matching command",
    await app.until(async () => (await ghost()) === "is-one", 4000),
    String(await ghost()),
  );
  await app.press("ArrowRight");
  await app.until(async () => (await line()) === "echo only-this-one", 3000);
  t.ok("Right arrow completes it exactly", (await line()) === "echo only-this-one", JSON.stringify(await line()));
  await app.press("Enter");
  await app.waitScreen(/only-this-one\s*\n[^\n]*[#$]\s*$/);

  // --- after Tab completion the line changed behind the keystrokes' back
  await app.type("echo pyf");
  await app.until(async () => (await ghost()) !== null, 4000);
  await app.press("Tab");
  await app.until(async () => (await line()) === "echo pyfile_abc", 4000);
  t.ok("Tab completion completed the filename", (await line()) === "echo pyfile_abc", JSON.stringify(await line()));
  await app.until(async () => (await ghost()) === "zzz", 4000);
  t.ok("the suggestion continues from the completed line, not from the keystrokes", (await ghost()) === "zzz", String(await ghost()));
  await app.press("ArrowRight");
  await app.until(async () => /zzz$/.test(await line()), 3000);
  t.ok(
    "accepting it gives a correct command (no doubled characters)",
    (await line()) === "echo pyfile_abc zzz",
    JSON.stringify(await line()),
  );
  await app.press("Enter");
  await app.waitScreen(/pyfile_abc zzz\s*\n[^\n]*[#$]\s*$/);

  // --- history recall: the line has text the keystrokes never saw
  await app.press("ArrowUp");
  await app.until(async () => (await line()) === "echo pyfile_abc zzz", 3000);
  await app.sleep(400);
  t.ok("no suggestion is drawn over a recalled command", (await ghost()) === null, String(await ghost()));
  await app.press("ArrowRight");
  await app.sleep(300);
  t.ok(
    "Right arrow on a recalled line just moves the cursor (nothing is pasted)",
    (await line()) === "echo pyfile_abc zzz",
    JSON.stringify(await line()),
  );

  // --- the same without shell integration: no prompt marker, so the keystroke guess is used,
  // but only while the screen agrees with it
  await app.ev(`window.wharf.commandBlocks.setEnabled(false)`);
  await app.newLocalShell();
  await app.run("echo pyfile_abc zzz");
  await app.type("echo pyfile_abc z");
  t.ok(
    "without integration a plainly typed prefix still gets its suggestion",
    await app.until(async () => (await ghost()) === "zz", 4000),
    String(await ghost()),
  );
  await app.press("ArrowRight");
  await app.until(async () => (await line()) === "echo pyfile_abc zzz", 3000);
  t.ok("…and accepting it is exact", (await line()) === "echo pyfile_abc zzz", JSON.stringify(await line()));
  await app.press("Enter");
  await app.waitScreen(/pyfile_abc zzz\s*\n[^\n]*[#$]\s*$/);
  await app.type("echo pyf");
  await app.until(async () => (await ghost()) !== null, 4000);
  await app.press("Tab");
  await app.until(async () => (await line()) === "echo pyfile_abc", 4000);
  await app.sleep(500);
  t.ok("after Tab completion there is no stale suggestion to accept", (await ghost()) === null, String(await ghost()));
  await app.press("ArrowRight");
  await app.sleep(300);
  t.ok("…and Right arrow adds nothing", (await line()) === "echo pyfile_abc", JSON.stringify(await line()));
}
