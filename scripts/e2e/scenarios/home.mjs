export const name = "home";

export async function run(t, start) {
  const app = await start();
  const cards = () => app.evJson(`[...document.querySelectorAll('.host-card-name')].map((e) => e.textContent)`);
  const railActive = () =>
    app.ev(`[...document.querySelectorAll('.icon-rail .rail-btn.active')].map((b) => b.getAttribute('aria-label')).join(',')`);
  await app.until(() => app.q(".home"), 15_000);

  t.ok("starts on Home", await app.q(".home"));
  t.ok(
    "Home tab and the rail's Hosts are active",
    (await app.q(".home-tab", "(e) => e.classList.contains('active')")) && (await railActive()) === "Hosts",
    await railActive(),
  );
  t.ok("the host sidebar is hidden on Home", !(await app.q(".sidebar, aside")));
  t.ok("the empty state offers a first host", (await app.q(".home-empty h2", "(e) => e?.textContent")) === "Add your first host");

  const group = await app.ev(`window.wharf.groups.create({ name: "Production", parentId: null }).then((g) => g.id)`);
  for (const [n, g, tags] of [
    ["web-01", group, ["nginx"]],
    ["db-primary", group, []],
    ["router", null, []],
  ]) {
    await app.ev(
      `window.wharf.hosts.create(${JSON.stringify({ name: n, hostname: "127.0.0.1", port: 1, username: "admin", authMethod: "agent", groupId: g, color: null, tags })})`,
    );
  }
  await app.reload();
  await app.until(async () => (await cards()).length === 3, 10_000);

  t.ok(
    "cards are grouped and sorted",
    JSON.stringify(await cards()) === JSON.stringify(["db-primary", "web-01", "router"]),
    JSON.stringify(await cards()),
  );
  t.ok("the summary counts hosts", (await app.q(".home-sub", "(e) => e.textContent")).startsWith("3 hosts"));
  t.ok("there is a greeting", /^(Good|Working)/.test(await app.q(".home h1", "(e) => e.textContent")));

  await app.setInput(".home-search input", "nginx");
  await app.until(async () => (await cards()).length === 1, 3000);
  t.ok("search filters by tag", JSON.stringify(await cards()) === '["web-01"]', JSON.stringify(await cards()));
  await app.setInput(".home-search input", "zzz");
  await app.until(() => app.q(".home-none"), 3000);
  t.ok("a search with no match says so", /No hosts match/.test(await app.q(".home-none", "(e) => e?.textContent ?? ''")));
  await app.setInput(".home-search input", "");
  await app.clickText(".home-chip", "Production");
  await app.until(async () => (await cards()).length === 2, 3000);
  t.ok("a group chip filters", JSON.stringify(await cards()) === '["db-primary","web-01"]', JSON.stringify(await cards()));
  await app.clickText(".home-chip", "All");

  await app.click(".home-new");
  t.ok("New host opens the host dialog", await app.until(() => app.q(".dialog"), 3000));
  t.ok(
    "the host dialog is grouped into Connection, Sign-in and Organize",
    JSON.stringify(await app.evJson(`[...document.querySelectorAll('.host-dialog .host-section h3')].map((h) => h.textContent)`)) ===
      '["Connection","Sign-in","Organize"]',
  );
  t.ok(
    "Jump host and Mosh are tucked under a closed Advanced",
    (await app.evJson(
      `(() => { const d = document.querySelector('.host-dialog .host-advanced'); return !!d && !d.open && /Jump host/.test(d.textContent) && /Mosh/.test(d.textContent); })()`,
    )) === true,
  );
  await app.shot("host-dialog-grouped");
  await app.press("Escape");
  await app.ev(`document.querySelector('.dialog button:not(.primary)')?.click()`);
  await app.until(async () => !(await app.q(".dialog")), 3000);

  await app.click(".host-card");
  t.ok(
    "a failed connect shows its error on Home and stays there",
    await app.until(() => app.q(".home-error"), 15_000),
    await app.q(".home-error", "(e) => e?.textContent"),
  );
  t.ok(
    "cards show reachability (port 1 is closed, so offline)",
    await app.until(async () => (await app.q(".host-card-reach", "(e) => e?.textContent")) === "offline", 10_000),
  );

  await app.newLocalShell();
  t.ok(
    "a new local shell lands on the terminal view with its tab active",
    !(await app.q(".home")) && (await app.q(".tab-strip .tab", "(e) => e.classList.contains('active')")),
  );
  t.ok(
    "the tab bar lives in the title bar, not the terminal",
    (await app.q(".title-bar .tab-strip")) && !(await app.q(".terminal-panel .tab-bar")),
  );
  t.ok("the host sidebar returns on the terminal view", await app.q(".sidebar, aside"));
  t.ok("the rail's Hosts stays lit on a terminal", (await railActive()) === "Hosts", await railActive());
  for (const view of ["Tunnels", "SSH keys", "History", "Workspaces", "Settings"]) {
    await app.rail(view);
    await app.sleep(150);
    t.ok(`the host sidebar stays out of the way on ${view}`, !(await app.q(".sidebar")));
  }
  await app.rail("Tunnels");
  t.ok(
    "Tunnels with none says what they are for and offers a first one",
    (await app.q(".empty-state-title", "(e) => e?.textContent")) === "No port forwards yet" &&
      (await app.q(".empty-state-actions .btn.primary")),
  );
  await app.rail("History");
  await app.until(() => app.q(".empty-state-title"), 3000);
  t.ok(
    "History with nothing recorded has a friendly empty state",
    /No commands recorded yet/.test(await app.q(".empty-state-title", "(e) => e?.textContent")),
  );
  await app.rail("Settings");
  t.ok(
    "Settings no longer lists the shortcuts, but offers the full reference",
    !(await app.q(".settings-preview-pane .shortcut-row")) &&
      (await app.evJson(
        `[...document.querySelectorAll('.settings-preview-pane button')].some((b) => /keyboard shortcuts/i.test(b.textContent))`,
      )),
  );
  await app.clickText(".settings-preview-pane button", "View all keyboard shortcuts");
  t.ok("…and the button opens it", await app.until(() => app.q(".shortcuts-dialog, .dialog"), 3000));
  await app.press("Escape");
  await app.until(async () => !(await app.q(".dialog")), 3000);
  await app.rail("Tunnels");
  t.ok(
    "Tunnels via the rail; neither a tab nor Home is lit",
    (await railActive()) === "Tunnels" && !(await app.q(".tab-strip .tab.active")) && !(await app.q(".home-tab.active")),
    await railActive(),
  );
  await app.click(".tab-strip .tab");
  t.ok(
    "clicking the tab returns to the terminal",
    (await railActive()) === "Hosts" && (await app.q(".tab-strip .tab", "(e) => e.classList.contains('active')")),
  );
  await app.click(".tab-strip .tab-close");
  t.ok("closing the last tab returns to Home", await app.until(() => app.q(".home"), 5000));
  await app.rail("Settings");
  t.ok("Settings is lit on the rail", (await railActive()) === "Settings");

  // --- window controls neither take focus nor show a focus ring when pressed
  const control = await app.evJson(
    `(() => { const b = document.querySelectorAll('.title-bar-controls .win-btn')[1].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
  );
  await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: control.x, y: control.y, button: "left", clickCount: 1 });
  const focus = await app.evJson(
    `({ tag: document.activeElement?.tagName, onControl: !!document.activeElement?.closest('.win-btn'), ring: document.querySelector('.win-btn:focus-visible') !== null })`,
  );
  await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 400, button: "left", clickCount: 1 }); // released elsewhere: no click, so the window is left alone
  t.ok("pressing a window control doesn't focus it or draw a focus ring", !focus.onControl && !focus.ring, JSON.stringify(focus));
  t.ok(
    "window controls are not tab stops",
    (await app.evJson(`[...document.querySelectorAll('.win-btn')].every((b) => b.tabIndex === -1)`)) === true,
  );
}
