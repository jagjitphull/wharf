export const name = "snippets";

// Snippet variables ({{name}}, {{name:default}}, {{name=a|b}}, {{$builtin}}), "run right away", and quick-run
// from the command palette into the focused terminal.
export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const create = (s) => app.ev(`window.wharf.snippets.create(${JSON.stringify(s)})`);
  const openPalette = async () => {
    await app.press("k", { ctrl: true });
    await app.until(() => app.q(".palette"), 3000);
  };
  const typeInPalette = async (text) => {
    await app.ev(`document.querySelector('.palette-input input').focus()`);
    await app.send("Input.insertText", { text });
    await app.sleep(250);
  };
  const paletteTitles = () => app.evJson(`[...document.querySelectorAll('.palette-row .palette-title')].map((e) => e.textContent)`);

  await create({ name: "Greet", command: "echo greet-{{who:world}}-{{env=prod|stage}}", run: true });
  await create({ name: "Where am I", command: "echo where-{{$host}}-{{$hostname}}-{{$date}}", run: false });
  await create({ name: "Needs thing", command: "echo thing-{{thing}}", run: true });
  await create({ name: "Plain", command: "echo plain-snippet", run: true });
  await app.reload();

  // --- palette with no terminal open: the snippet is listed but says it has nowhere to go
  await openPalette();
  await typeInPalette("greet");
  t.ok(
    "a snippet appears in its own section",
    (await app.q(".palette-section-title", "(e) => e?.textContent")) !== null && (await paletteTitles()).includes("Greet"),
  );
  t.ok(
    "…and says a terminal is needed",
    /open a terminal first/.test((await app.q(".palette-row .palette-group", "(e) => e?.textContent")) ?? ""),
  );
  await app.press("Escape");
  await app.until(async () => !(await app.q(".palette")), 3000);

  await app.newLocalShell();

  // --- a plain, run-right-away snippet
  await openPalette();
  await typeInPalette("plain");
  await app.press("Enter");
  await app.until(async () => !(await app.q(".palette")), 3000);
  await app.waitScreen(/^plain-snippet$/m, 8000);
  t.ok("a plain snippet runs in the focused terminal", /^plain-snippet$/m.test(await app.screen()));

  // --- variables: the palette turns into a form, with defaults and a choice
  await openPalette();
  await typeInPalette("greet");
  await app.press("Enter");
  await app.until(() => app.q(".palette-fill"), 3000);
  const fields = await app.evJson(
    `[...document.querySelectorAll('.palette-fill-field')].map((f) => ({ name: f.querySelector('span').textContent, tag: (f.querySelector('select') ?? f.querySelector('input')).tagName, value: (f.querySelector('select') ?? f.querySelector('input')).value }))`,
  );
  t.ok(
    "a snippet with variables asks for them, pre-filled with the defaults",
    JSON.stringify(fields) ===
      JSON.stringify([
        { name: "who", tag: "INPUT", value: "world" },
        { name: "env", tag: "SELECT", value: "prod" },
      ]),
    JSON.stringify(fields),
  );
  await app.shot("snippet-fill");
  await app.press("Escape");
  t.ok("Esc goes back to the list, not out of the palette", !!(await app.q(".palette")) && !(await app.q(".palette-fill")));
  await app.press("Enter");
  await app.until(() => app.q(".palette-fill"), 3000);
  await app.ev(`(() => { const i = document.querySelector('.palette-fill-field input'); i.focus(); i.select(); })()`);
  await app.send("Input.insertText", { text: "wharf" });
  await app.ev(
    `(() => { const s = document.querySelector('.palette-fill-field select'); s.value = 'stage'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
  await app.press("Enter");
  await app.until(async () => !(await app.q(".palette")), 3000);
  await app.waitScreen(/^greet-wharf-stage$/m, 8000);
  t.ok("the filled-in values are used, and the command runs", /^greet-wharf-stage$/m.test(await app.screen()));

  // --- a required variable can't be left empty
  await openPalette();
  await typeInPalette("needs thing");
  await app.press("Enter");
  await app.until(() => app.q(".palette-fill"), 3000);
  await app.click(".palette-fill button[type=submit]");
  await app.sleep(300);
  t.ok("an empty required variable keeps the form open", !!(await app.q(".palette-fill")));
  await app.send("Input.insertText", { text: "xyz" });
  await app.press("Enter");
  await app.waitScreen(/^thing-xyz$/m, 8000);
  t.ok("…and once filled, it runs", /^thing-xyz$/m.test(await app.screen()));

  // --- insert without running, with built-ins
  await openPalette();
  await typeInPalette("where am i");
  await app.press("Enter");
  await app.until(async () => !(await app.q(".palette")), 3000);
  await app.waitScreen(/echo where-/, 8000);
  const screen = await app.screen();
  const today = await app.ev(`new Date().toISOString().slice(0, 10)`);
  t.ok(
    "a snippet that isn't set to run is typed but left for you to run",
    /echo where-Local Shell-localhost-\d{4}-\d{2}-\d{2}\s*$/.test(screen.trimEnd()) && !/^where-/m.test(screen),
    screen.trimEnd().split("\n").pop(),
  );
  t.ok(
    "built-ins are filled in (host name, hostname, date)",
    screen.includes(`-localhost-`) && /\d{4}-\d{2}-\d{2}/.test(screen) && today.length === 10,
  );
  await app.press("Enter");
  await app.waitScreen(/^where-Local Shell-localhost-/m, 8000);
  t.ok("pressing Enter then runs it", /^where-Local Shell-localhost-\d{4}-\d{2}-\d{2}$/m.test(await app.screen()));

  // --- the picker in the terminal's right-click menu uses the same variables
  await app.rightClick(".tab-pane-container[style*='flex'] .xterm");
  await app.clickText(".context-menu-item", "Insert Snippet…");
  await app.until(() => app.q(".snippet-picker"), 3000);
  t.ok(
    "the picker marks workflow snippets and run-at-once ones",
    (await app.evJson(`[...document.querySelectorAll('.snippet-workflow-badge')].map((b) => b.textContent)`)).includes("⏎ runs"),
  );
  await app.ev(`[...document.querySelectorAll('.snippet-row')].find((r) => r.textContent.includes('Greet'))?.click()`);
  await app.until(() => app.q(".snippet-form select"), 3000);
  t.ok("it offers the choice as a list too", (await app.q(".snippet-form select", "(e) => e.value")) === "prod");
  await app.click(".snippet-form button[type=submit]");
  await app.waitScreen(/^greet-world-prod$/m, 8000);
  t.ok("its defaults run as given", /^greet-world-prod$/m.test(await app.screen()));

  // --- edit: the run flag round-trips
  const list = await app.evJson(`window.wharf.snippets.list()`);
  const greet = list.find((s) => s.name === "Greet");
  const where = list.find((s) => s.name === "Where am I");
  t.ok("the run setting is saved", greet.run === true && where.run === undefined);
  await app.ev(
    `window.wharf.snippets.update(${JSON.stringify(greet.id)}, { name: "Greet", command: ${JSON.stringify(greet.command)}, run: false })`,
  );
  t.ok(
    "…and can be turned off again",
    (await app.evJson(`window.wharf.snippets.list()`)).find((s) => s.name === "Greet").run === undefined,
  );
}
