export const name = "home-polish";

// Home: pin favourites, a compact list layout, and dragging hosts between groups.
export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const create = (h) =>
    app.evJson(`window.wharf.hosts.create(${JSON.stringify({ port: 22, username: "admin", authMethod: "agent", ...h })})`);
  const prod = await app.evJson(`window.wharf.groups.create({ name: "Prod", parentId: null })`);
  const lab = await app.evJson(`window.wharf.groups.create({ name: "Lab", parentId: null })`);
  const web = await create({ name: "web-01", hostname: "web-01.example", groupId: prod.id });
  await create({ name: "db-01", hostname: "db-01.example", groupId: prod.id });
  const rocky = await create({ name: "rocky", hostname: "rocky.example", groupId: lab.id });
  const loose = await create({ name: "router", hostname: "router.example", groupId: null });
  await app.reload();
  await app.until(() => app.q(".host-card"), 10_000);

  const sections = () =>
    app.evJson(
      `[...document.querySelectorAll('.home-section')].map((s) => ({ id: s.dataset.section, title: s.querySelector('h3').firstChild.textContent, hosts: [...s.querySelectorAll('.host-card-name, .host-row-name')].map((n) => n.textContent) }))`,
    );
  const hostsNow = () => app.evJson(`window.wharf.hosts.list()`);
  const toasts = () => app.evJson(`[...document.querySelectorAll('.toast')].map((e) => e.textContent).join('|')`);
  const cardOf = (hostName) =>
    `[...document.querySelectorAll('.host-card, .host-row')].find((c) => c.querySelector('.host-card-name, .host-row-name').textContent.trim() === ${JSON.stringify(hostName)})`;

  // --- pinning
  t.ok("with nothing pinned there is no Pinned section", !(await sections()).some((s) => s.title === "Pinned"));
  await app.ev(`${cardOf("rocky")}.querySelector('button[aria-label="Pin"]').click()`);
  await app.until(async () => (await sections())[0]?.title === "Pinned", 5000);
  let s = await sections();
  t.ok(
    "a pinned host appears under Pinned, first",
    s[0].title === "Pinned" && JSON.stringify(s[0].hosts) === '["rocky"]',
    JSON.stringify(s[0]),
  );
  t.ok("…and still in its own group", s.find((x) => x.title === "Lab").hosts.includes("rocky"));
  t.ok("it is saved on the host", (await hostsNow()).find((h) => h.id === rocky.id).pinned === true);
  await app.reload();
  await app.until(() => app.q(".host-card"), 10_000);
  t.ok("pins survive a restart", (await sections())[0].title === "Pinned");

  await app.rightClick(".home-section:first-of-type .host-card");
  t.ok(
    "the right-click menu offers Unpin for a pinned host",
    (await app.menuItems()).includes("Unpin"),
    JSON.stringify(await app.menuItems()),
  );
  await app.press("Escape");
  await app.rightClick(`.home-section[data-section="ungrouped"] .host-card`);
  await app.clickText(".context-menu-item", "Pin to top");
  await app.until(async () => (await sections())[0].hosts.length === 2, 5000);
  t.ok(
    "Pin to top in the menu pins it; Pinned is sorted by name",
    JSON.stringify((await sections())[0].hosts) === '["rocky","router"]',
    JSON.stringify((await sections())[0].hosts),
  );
  await app.shot("home-pinned-cards");

  // --- list layout
  await app.ev(`document.querySelector('.home-view-toggle button[aria-label="List"]').click()`);
  await app.until(() => app.q(".host-row"), 3000);
  t.ok("the List toggle swaps cards for compact rows", !!(await app.q(".host-row")) && !(await app.q(".host-card")));
  const row = await app.evJson(
    `(() => { const r = ${cardOf("web-01")}; return { addr: r.querySelector('.host-row-addr').textContent, h: r.getBoundingClientRect().height }; })()`,
  );
  t.ok("a row shows user@host:port on one short line", row.addr === "admin@web-01.example:22" && row.h < 48, JSON.stringify(row));
  t.ok("pinned hosts are marked in the list", (await app.evJson(`document.querySelectorAll('.host-row-name svg').length`)) >= 2);
  await app.shot("home-pinned-list");
  await app.reload();
  await app.until(() => app.q(".host-row, .host-card"), 10_000);
  t.ok("the layout choice is remembered", !!(await app.q(".host-row")));
  await app.ev(`${cardOf("router")}.querySelector('button[aria-label="Unpin"]').click()`);
  await app.until(async () => (await sections())[0].hosts.length === 1, 5000);
  t.ok("Unpin from a row removes it from Pinned", JSON.stringify((await sections())[0].hosts) === '["rocky"]');

  // --- drag and drop (synthetic DOM drag events: the page code runs exactly as it would for a real drag)
  const drag = async (fromSelector, toSelector) =>
    app.ev(`(async () => {
      const dt = new DataTransfer();
      const from = ${fromSelector};
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 150));
      const to = ${toSelector};
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
      to.dispatchEvent(over);
      const accepted = over.defaultPrevented;
      await new Promise((r) => setTimeout(r, 100));
      if (accepted) to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return accepted;
    })()`);

  await app.ev(`document.querySelector('.home-view-toggle button[aria-label="Cards"]').click()`);
  await app.until(() => app.q(".host-card"), 3000);
  const card = (n) => `(${cardOf(n)})`;

  const accepted = await drag(card("web-01"), `document.querySelector('.home-section[data-section="${lab.id}"]')`);
  await app.until(async () => (await hostsNow()).find((h) => h.id === web.id).groupId === lab.id, 5000);
  t.ok(
    "dropping a card on another group's section moves the host there",
    accepted === true && (await hostsNow()).find((h) => h.id === web.id).groupId === lab.id,
  );
  t.ok("a toast says where it went", /Moved web-01 to Lab/.test(await toasts()), await toasts());
  t.ok("the section lists it under its new group", (await sections()).find((x) => x.title === "Lab").hosts.includes("web-01"));

  await drag(card("web-01"), `[...document.querySelectorAll('.home-chip')].find((c) => c.textContent === 'Prod')`);
  await app.until(async () => (await hostsNow()).find((h) => h.id === web.id).groupId === prod.id, 5000);
  t.ok(
    "dropping on a group chip moves it too (this works for an empty group)",
    (await hostsNow()).find((h) => h.id === web.id).groupId === prod.id,
  );

  await drag(card("web-01"), `[...document.querySelectorAll('.home-drop-pill')].find((p) => p.textContent === 'No group')`);
  await app.until(async () => (await hostsNow()).find((h) => h.id === web.id).groupId === null, 5000);
  t.ok("the drop bar's No group takes it out of its group", (await hostsNow()).find((h) => h.id === web.id).groupId === null);

  const before = await toasts();
  const sameGroup = await drag(card("rocky"), `document.querySelector('.home-section[data-section="${lab.id}"]')`);
  await app.sleep(300);
  t.ok(
    "dropping on the group it is already in changes nothing",
    sameGroup === true && (await hostsNow()).find((h) => h.id === rocky.id).groupId === lab.id && (await toasts()) === before,
  );

  const onPinned = await drag(card("router"), `document.querySelector('.home-section[data-section="pinned"]')`);
  t.ok(
    "Pinned, Connected and Recent are not drop targets",
    onPinned === false && (await hostsNow()).find((h) => h.id === loose.id).groupId === null,
  );

  await app.sleep(200);
  t.ok("the drop bar is gone once the drag ends", !(await app.q(".home-drop-bar")));
}
