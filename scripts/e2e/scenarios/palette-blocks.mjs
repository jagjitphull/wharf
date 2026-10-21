export const name = "palette-blocks";

export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const sections = () => app.evJson(`[...document.querySelectorAll('.palette-section-title')].map((e) => e.textContent)`);
  const titles = () => app.evJson(`[...document.querySelectorAll('.palette-row .palette-title')].map((e) => e.textContent)`);
  const openPalette = async () => {
    await app.press("k", { ctrl: true });
    await app.until(() => app.q(".palette"), 3000);
  };
  const typeInPalette = async (text) => {
    await app.ev(`document.querySelector('.palette-input input').focus()`);
    await app.send("Input.insertText", { text });
    await app.sleep(200);
  };

  await app.ev(
    `window.wharf.hosts.create(${JSON.stringify({ name: "web-01", hostname: "127.0.0.1", port: 1, username: "admin", authMethod: "agent", groupId: null })})`,
  );
  await app.reload();

  // --- the palette
  await openPalette();
  t.ok("Ctrl+K opens the palette", await app.q(".palette"));
  t.ok(
    "with nothing typed: Actions, then Hosts",
    JSON.stringify(await sections()) === '["Actions","Hosts"]',
    JSON.stringify(await sections()),
  );
  t.ok("no tab actions without a tab", !(await titles()).includes("Reconnect tab"), JSON.stringify(await titles()));
  t.ok("the host is listed", (await titles()).includes("web-01"));
  await app.shot("palette");
  await app.press("Escape");
  await app.until(async () => !(await app.q(".palette")), 3000);
  t.ok("Esc closes it", !(await app.q(".palette")));

  await openPalette();
  await typeInPalette(">toggle theme");
  const before = await app.ev(`document.documentElement.dataset.theme`);
  t.ok(
    "a leading > lists only actions",
    JSON.stringify(await sections()) === '["Actions"]' && (await titles())[0] === "Toggle theme",
    JSON.stringify(await titles()),
  );
  await app.press("Enter");
  await app.until(async () => (await app.ev(`document.documentElement.dataset.theme`)) !== before, 3000);
  t.ok(
    "running Toggle theme flips the theme and closes the palette",
    (await app.ev(`document.documentElement.dataset.theme`)) !== before && !(await app.q(".palette")),
  );

  await openPalette();
  await typeInPalette("settings");
  await app.press("Enter");
  await app.until(async () => (await app.q(".rail-btn.active", "(e) => e?.getAttribute('aria-label')")) === "Settings", 3000);
  t.ok("Go to Settings navigates", (await app.q(".rail-btn.active", "(e) => e?.getAttribute('aria-label')")) === "Settings");

  // --- command blocks drawn in the terminal
  await app.ev(`window.__confirmCalls = 0; window.confirm = () => { window.__confirmCalls++; return true; }`);
  await app.newLocalShell();
  await app.run("echo hello block");
  await app.run("sh -c 'echo oops; exit 3'");
  await app.run("sleep 1.2", { wait: false });
  await app.sleep(500);
  t.ok("a running command is marked while it runs", await app.until(() => app.q(".cmd-block.running"), 3000));
  await app.until(async () => !(await app.q(".cmd-block.running")), 8000);
  await app.sleep(400);
  const marks = await app.evJson(`[...document.querySelectorAll('.cmd-block')].map((e) => {
    const r = e.getBoundingClientRect();
    return { cls: [...e.classList].filter((c) => ['ok', 'failed', 'running'].includes(c))[0], top: r.top, h: r.height, pill: e.querySelector('.cmd-block-pill')?.textContent ?? null };
  })`);
  t.info(JSON.stringify(marks));
  const ok0 = marks.filter((m) => m.cls === "ok");
  const bad = marks.filter((m) => m.cls === "failed");
  t.ok(
    "finished successes get a rail and a ✓ pill",
    ok0.length >= 2 && ok0.every((m) => /^✓ 0 · /.test(m.pill ?? "")),
    JSON.stringify(ok0),
  );
  t.ok("the failure is marked ✕ 3", bad.length === 1 && /^✕ 3 · /.test(bad[0].pill ?? ""), JSON.stringify(bad));
  t.ok("nothing is left marked running", !(await app.q(".cmd-block.running")));
  const rows = await app.evJson(
    `[...document.querySelectorAll('.tab-pane-container[style*="flex"] .xterm-rows > div')].map((d) => { const r = d.getBoundingClientRect(); return { text: d.textContent, top: r.top, h: r.height }; })`,
  );
  const rowH = rows[0].h;
  const failRow = rows.find((r) => r.text.includes("exit 3"));
  t.ok(
    "the failure spans its command row and its output row, starting on the command",
    !!failRow && Math.abs(bad[0].top - failRow.top) < 2 && Math.abs(bad[0].h - 2 * rowH) < 3,
    `mark ${bad[0]?.top}/${bad[0]?.h} vs row ${failRow?.top}/${rowH}`,
  );
  const helloRow = rows.find((r) => r.text.includes("echo hello block"));
  t.ok(
    "a one-line output block spans two rows from its command row",
    !!helloRow && Math.abs(ok0[0].top - helloRow.top) < 2 && Math.abs(ok0[0].h - 2 * rowH) < 3,
  );
  const railGap = await app.evJson(`(() => {
    const mark = document.querySelector('.cmd-block').getBoundingClientRect();
    const screen = document.querySelector('.tab-pane-container[style*="flex"] .xterm-screen').getBoundingClientRect();
    const pane = document.querySelector('.tab-pane-container[style*="flex"] .terminal-pane').getBoundingClientRect();
    return { railRight: mark.left + 3, textLeft: screen.left, markLeft: mark.left, paneLeft: pane.left };
  })()`);
  t.ok(
    "the rail sits beside the first column, not over its text",
    railGap.railRight <= railGap.textLeft + 0.5 && railGap.markLeft >= railGap.paneLeft,
    JSON.stringify(railGap),
  );
  t.ok("marks never intercept the mouse", await app.q(".cmd-block", "(e) => getComputedStyle(e).pointerEvents === 'none'"));
  await app.shot("block-marks");

  // --- an action that needs a tab, and a toast
  await openPalette();
  await typeInPalette(">reconnect");
  t.ok("Reconnect tab is offered once a tab exists", (await titles())[0] === "Reconnect tab", JSON.stringify(await titles()));
  await app.press("Enter");
  await app.until(() => app.q(".toast.success"), 15_000);
  t.ok("reconnecting a live session asked first", (await app.ev(`window.__confirmCalls`)) === 1);
  t.ok("a success toast appears", (await app.q(".toaster .toast.success .toast-message", "(e) => e?.textContent")) === "Reconnected");
  await app.shot("toast");
  await app.click(".toast-close");
  await app.until(async () => !(await app.q(".toast")), 3000);
  t.ok("toasts can be dismissed", !(await app.q(".toast")));
}
