// 1.8: Preferences. The gear button's menu and the Preferences dialog: shortcuts (any key, by its place on
// the keyboard, so another keyboard language works too), favourite colours, the side panel (sections,
// side, width), what new highlights and Fill start with, names of new areas and interface size. Changes
// apply at once, reach the other tabs, and are kept for the next start.
import { launch, waitDoc, check, summary, clickSheet, waitMarkups, quit, drawingPages, OUT, DATA, UI_STATE_FILE } from './lib.mjs';
import fs from 'fs';

const R = [];
let allErrors = [];
const px = (mm) => (mm * 400) / 25.4;
const P = (mx, my) => [px(45 + 20 * mx), px(297 - (70 + 20 * my))];
const ROOMS = [[1.0, 5.2], [10.5, 7.6], [2.2, 3.0], [8.7, 1.5], [10.2, 0.8]];
const S_ = (page, fn, arg) => page.evaluate(fn, arg);
const tool = (page) => S_(page, () => window.__plantint.S.tool);
const keyOf = (page, id) => S_(page, (id) => window.__plantint.prefs.keys.keyLabel(id), id);
const markups = (page) => S_(page, () => window.__plantint.S.markups.map((m) => ({ id: m.id, name: m.name, color: m.color, opacity: m.opacity })));
const waitFor = async (fn, what, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); }
  throw new Error('timed out: ' + what);
};

async function openPrefs(page, p) {
  await S_(page, (p) => window.__plantint.hooks.prefs(p), p);
  await page.waitForSelector('.prefs');
  await page.waitForTimeout(120);
}
async function closePrefs(page) {
  await page.click('.modal .btn:text("Done")');
  await page.waitForSelector('.prefs', { state: 'detached' });
}
async function recordKey(page, id, keys) {
  await page.click(`.keycap[data-action="${id}"]`);
  await page.keyboard.press(keys);
  await page.waitForTimeout(120);
}
const msgText = async (page) => ((await page.$('.prefs-msg')) ? (await page.textContent('.prefs-msg')).trim() : '');
async function setRange(page, label, value) {
  await S_(page, ([t, v]) => {
    const row = [...document.querySelectorAll('.prefs-row')].find((r) => r.querySelector('.lab').textContent === t);
    const i = row.querySelector('input[type=range]');
    i.value = v;
    i.dispatchEvent(new Event('input'));
  }, [label, value]);
}
async function fillRoom(page, i, n) {
  await page.keyboard.press('Escape');
  await S_(page, () => window.__plantint.setTool('fill'));
  await clickSheet(page, ...P(...ROOMS[i]));
  await waitMarkups(page, n);
}
const mainWin = (app, src, arg) => app.evaluate(({ BrowserWindow }, [s, a]) => {
  const w = BrowserWindow.getAllWindows().find((x) => /tabs\.html$/.test(x.webContents.getURL()));
  return new Function('w', 'a', s)(w, a); // eslint-disable-line no-new-func
}, [src, arg]);

// ======================================================================== shortcuts
{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    // the gear button's menu
    await page.click('#btn-prefs');
    await page.waitForSelector('.menu');
    const items = await page.$$eval('.menu-item .menu-label', (l) => l.map((x) => x.textContent));
    check(['Shortcuts…', 'Favourite colours…', 'Side panel…', 'New highlights and Fill…', 'Names of new areas…', 'Interface size…', 'Snags in the side panel', 'Markups window'].every((t) => items.includes(t)),
      `the gear button opens the preferences menu (${items.length} items)`, R);
    await page.click('.menu-item:has-text("Shortcuts…")');
    await page.waitForSelector('.prefs');
    check(await page.isVisible('.prefs-tab.on:has-text("Shortcuts")'), 'its first item opens Preferences at Shortcuts', R);
    await page.screenshot({ path: OUT + '/t13_shortcuts.png' });

    // a new key: click Fill's key, press Q
    await recordKey(page, 'tool.fill', 'q');
    check((await page.textContent('.keycap[data-action="tool.fill"]')).trim() === 'Q', 'clicking Fill\'s key and pressing Q gives Fill the key Q', R);
    // a key another action has moves, and the message says so
    await recordKey(page, 'tool.rect', 's');
    let m = await msgText(page);
    check(/S is now “Rectangle”/.test(m) && /“Select and move” has no key now/.test(m), `a key in use moves to the new action, and says so (${m})`, R);
    // a key with its own meaning is refused
    await recordKey(page, 'tool.dim', 'h');
    m = await msgText(page);
    check(/H is used while drawing a polygon/.test(m) && (await keyOf(page, 'tool.dim')) === 'K', `a key that keeps its own meaning is refused (${m})`, R);
    // Esc stops recording, and does not close Preferences
    await page.click('.keycap[data-action="tool.pin"]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check(await page.isVisible('.prefs') && (await keyOf(page, 'tool.pin')) === 'X', 'Esc stops without changing the key or closing Preferences', R);
    // with Ctrl
    await recordKey(page, 'edit.merge', 'Control+j');
    check((await keyOf(page, 'edit.merge')) === 'Ctrl+J', 'a key with Ctrl (Merge: Ctrl+J)', R);
    // no key, and back to the usual one
    await page.click('.key-row:has(.keycap[data-action="detect"]) .mini[title="No key"]');
    check((await keyOf(page, 'detect')) === '', 'the × takes an action\'s key away', R);
    await page.click('.key-row:has(.keycap[data-action="detect"]) .mini[title^="Back to"]');
    check((await keyOf(page, 'detect')) === 'D', 'and the back arrow gives it its usual key again', R);
    await closePrefs(page);

    // on the sheet
    await page.keyboard.press('q');
    check((await tool(page)) === 'fill', 'Q now picks Fill', R);
    await page.keyboard.press('s');
    check((await tool(page)) === 'rect', 'S now picks Rectangle', R);
    await page.keyboard.press('f');
    check((await tool(page)) === 'rect', 'F no longer does anything', R);
    // the keyboard set to Arabic: the Q key types ض, and is still Fill
    await S_(page, () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ض', code: 'KeyQ', bubbles: true })));
    check((await tool(page)) === 'fill', 'with the keyboard set to Arabic the same key works (ض on the Q key)', R);
    await S_(page, () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ط', code: 'KeyM', bubbles: true })));
    check(await S_(page, () => window.__plantint.S.loupe.on), 'and so do the usual keys (M for the magnifier, ط on an Arabic keyboard)', R);
    await page.keyboard.press('m');
    // tooltips, hints and the help sheet show the keys in use
    check(await S_(page, () => window.__plantint.prefs.keys.keyLabel(document.querySelector('.rail-btn[data-tool="fill"]').getAttribute('data-act')) === 'Q'), 'the Fill button\'s tooltip shows Q', R);
    await S_(page, () => window.__plantint.setTool('select'));
    check(/Ctrl\+J merges the selected/.test(await page.textContent('#hint')), 'the Select tool\'s hint names Ctrl+J for merging', R);
    await page.keyboard.press('F1');
    await page.waitForSelector('.help-grid');
    const helpFill = await page.$$eval('.help-grid dt', (dts) => { const i = dts.findIndex((d) => d.nextElementSibling && d.nextElementSibling.textContent === 'Fill an enclosed area'); return i >= 0 ? dts[i].textContent : null; });
    check(helpFill === 'Q', `the help sheet lists Q for Fill (${helpFill})`, R);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.help-grid', { state: 'detached' });
    // Ctrl+J merges
    await page.keyboard.press('q');
    await clickSheet(page, ...P(...ROOMS[0]));
    await waitMarkups(page, 1);
    await clickSheet(page, ...P(...ROOMS[2]));
    await waitMarkups(page, 2);
    await S_(page, () => { const t = window.__plantint; t.S.selection = new Set(t.S.markups.map((x) => x.id)); t.emit('selection'); });
    await page.keyboard.press('Control+j');
    await page.waitForTimeout(300);
    check((await markups(page)).length === 1, 'Ctrl+J merges the selected markups', R);
    await page.keyboard.press('Control+m');
    await page.waitForTimeout(200);
    check((await markups(page)).length === 1, 'Ctrl+M no longer does', R);

    // reset all
    await openPrefs(page, 'keys');
    await page.click('.prefs-page .btn:has-text("Reset all shortcuts")');
    check((await keyOf(page, 'tool.fill')) === 'F' && (await keyOf(page, 'tool.select')) === 'S' && (await keyOf(page, 'edit.merge')) === 'Ctrl+M', 'Reset all shortcuts brings back every usual key', R);
    await closePrefs(page);
    await page.keyboard.press('f');
    check((await tool(page)) === 'fill', 'F picks Fill again', R);
    allErrors = allErrors.concat(errors);
  } catch (e) {
    check(false, 'shortcuts: ' + e.stack, R);
  } finally {
    await S_(page, () => window.__plantint.prefs.reset()).catch(() => {});
    await quit(app);
  }
}

// ======================================================================== colours, side panel, new work, names, interface size
{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    const palette = () => page.$$eval('#panel .palette .sw', (b) => b.map((x) => x.getAttribute('data-hex')));
    const std = await palette();

    // ---- favourite colours
    await openPrefs(page, 'colours');
    await S_(page, () => { const i = document.querySelectorAll('.prefs-page input[type=color]')[1]; i.value = '#123456'; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(150);
    let pal = await palette();
    check(pal.length === std.length + 1 && pal[pal.length - 1] === '#123456', `a colour added in Preferences shows in the side panel (${pal.length} colours)`, R);
    await page.click('.prefs-page .btn[title="Move left"]');
    pal = await palette();
    check(pal[pal.length - 2] === '#123456', 'moving it left moves it in the panel too', R);
    await page.fill('.fav-info .prefs-field', 'Plot boundary');
    await page.press('.fav-info .prefs-field', 'Enter');
    await page.waitForTimeout(100);
    check(await S_(page, () => window.__plantint.prefs.get().colours.some((c) => c.hex === '#123456' && c.name === 'Plot boundary')), 'and it can be named', R);
    // the first colour changed: it is what the next new tab starts with
    await page.click('.fav-sw >> nth=0');
    await S_(page, () => { const i = document.querySelectorAll('.prefs-page input[type=color]')[0]; i.value = '#e03131'; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(150);
    pal = await palette();
    check(pal[0] === '#E03131', 'the first colour changed to red', R);
    await page.screenshot({ path: OUT + '/t13_colours.png' });
    await closePrefs(page);
    // the markups window shows them too
    const popP = app.waitForEvent('window', { timeout: 15000 });
    await page.click('#mk-window');
    const pop = await popP;
    await pop.waitForSelector('.mw-top');
    const popPal = await pop.$$eval('.mw-act .mw-sw', (b) => b.map((x) => x.getAttribute('aria-label')));
    check(popPal.includes('Plot boundary') && popPal.length === pal.length, `the markups window has the same colours (${popPal.length})`, R);
    await pop.close();

    // ---- the side panel: sections, side, width
    await openPrefs(page, 'panel');
    await page.click('.prefs-checks label:has-text("Snags") input');
    await page.click('.prefs-checks label:has-text("Progress map") input');
    await page.waitForTimeout(100);
    const vis = (sel) => S_(page, (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, sel);
    check(!(await vis('#sn-sec')) && !(await vis('#pg-sec')) && (await vis('#ms-sec')), 'unticking Snags and Progress map takes them out of the side panel', R);
    const canvasBefore = await S_(page, () => document.getElementById('ui').getBoundingClientRect().left);
    await page.click('.prefs-page .seg:text-is("Left")');
    await setRange(page, 'Width', 400);
    await page.waitForTimeout(300);
    const lay = await S_(page, () => ({ panel: document.getElementById('panel').getBoundingClientRect(), ui: document.getElementById('ui').getBoundingClientRect() }));
    check(lay.panel.left < lay.ui.left && Math.round(lay.panel.width) === 400 && lay.ui.left > canvasBefore, `the panel moves to the left at 400 px (${Math.round(lay.panel.left)}–${Math.round(lay.panel.right)}, sheet from ${Math.round(lay.ui.left)})`, R);
    await closePrefs(page);
    await page.screenshot({ path: OUT + '/t13_panel_left.png' });
    // the sheet still works where it now is: a fill lands where it is clicked
    await fillRoom(page, 0, 1);
    const hit = await S_(page, ([x, y]) => {
      const r = window.__plantint.S.markups[0].rings;
      let inside = false;
      for (const q of r) for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) { const yi = q[i + 1], yj = q[j + 1]; if ((yi > y) !== (yj > y) && x < q[i] + ((y - yi) * (q[j] - q[i])) / (yj - yi)) inside = !inside; }
      return inside;
    }, P(...ROOMS[0]));
    check(hit, 'with the panel on the left, a fill lands where the sheet is clicked', R);
    // the gear menu shows a section again in one click
    await page.click('#btn-prefs');
    await page.click('.menu-item:has-text("Snags in the side panel")');
    await page.waitForTimeout(100);
    check(await vis('#sn-sec'), 'the gear menu shows Snags again in one click', R);

    // ---- what new work starts with
    await openPrefs(page, 'newWork');
    await setRange(page, 'Opacity', 60);
    await page.click('.prefs-row:has-text("Close gaps") .seg:text-is("Large")');
    await page.click('.prefs-page label:has-text("Use labels as names") input');
    await page.waitForTimeout(100);
    const st = await S_(page, () => ({ op: window.__plantint.S.style.opacity, gaps: window.__plantint.S.fill.gaps, auto: window.__plantint.S.fill.autoName }));
    check(st.op === 0.6 && st.gaps === 3 && st.auto === false, `the next highlight takes them at once (opacity ${st.op}, close gaps ${st.gaps}, labels as names ${st.auto})`, R);

    // ---- names of new areas
    await openPrefs(page, 'naming');
    await page.fill('.prefs-row:has-text("Before the number") input', 'B-');
    await page.selectOption('.prefs-row:has-text("Digits") select', '3');
    await page.waitForTimeout(100);
    const prev = (await page.textContent('.prefs-preview')).replace(/\s+/g, ' ').trim();
    check(prev === 'B-001, B-002, B-003 …', `the page shows the names to come (${prev})`, R);
    await closePrefs(page);
    await fillRoom(page, 1, 2);
    await fillRoom(page, 2, 3);
    let ms = await markups(page);
    check(ms[1].name === 'B-001' && ms[2].name === 'B-002', `new areas are named B-001, B-002 (${ms.map((x) => x.name).join(', ')})`, R);
    check(ms[1].opacity === 0.6, 'and have the opacity set in Preferences', R);

    // ---- interface size
    await openPrefs(page, 'ui');
    await page.click('.prefs-page .seg:text-is("125%")');
    await waitFor(async () => (await mainWin(app, 'return w.webContents.getZoomFactor();')) === 1.25, 'the zoom');
    const z = await app.evaluate(({ BrowserWindow, webContents }) => {
      const w = BrowserWindow.getAllWindows().find((x) => /tabs\.html$/.test(x.webContents.getURL()));
      const tab = webContents.getAllWebContents().find((x) => /index\.html$/.test(x.getURL()));
      return { strip: w.webContents.getZoomFactor(), tab: tab.getZoomFactor(), y: w.contentView.children[0].getBounds().y };
    });
    check(z.strip === 1.25 && z.tab === 1.25 && z.y === 55, `125%: every page is zoomed and the tab strip grows (${JSON.stringify(z)})`, R);
    check(JSON.parse(fs.readFileSync(UI_STATE_FILE, 'utf8')).zoom === 1.25, 'and it is kept for the next start', R);
    await closePrefs(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: OUT + '/t13_size125.png' });
    await fillRoom(page, 3, 4);
    check(true, 'at 125% the sheet still fills where it is clicked', R);
    ms = await markups(page);
    check(ms[3].name === 'B-003', 'and names go on: B-003', R);

    // ---- another tab: same preferences, and a change there reaches this tab
    await page.keyboard.press('Control+n');
    await waitFor(() => drawingPages(app).length === 2, 'a second tab');
    const page2 = drawingPages(app).find((p) => p !== page);
    await page2.waitForFunction(() => window.__plantint && window.__plantint.S, null, { timeout: 60000 });
    const t2 = await S_(page2, () => ({ colour: window.__plantint.S.style.color, op: window.__plantint.S.style.opacity, left: document.getElementById('workspace').classList.contains('panel-left'), dpr: window.devicePixelRatio }));
    check(t2.colour === '#E03131' && t2.op === 0.6 && t2.left, `a new tab starts with the preferences: first colour, opacity, panel on the left (${JSON.stringify(t2)})`, R);
    await S_(page2, () => window.__plantint.prefs.set({ panel: { meas: false } }));
    await page.waitForTimeout(300);
    check(!(await vis('#ms-sec')), 'a change made in the other tab reaches this one at once', R);
    allErrors = allErrors.concat(errors);
  } catch (e) {
    check(false, 'preferences: ' + e.stack, R);
  } finally {
    await quit(app);
  }
}

// ======================================================================== kept for the next start
{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf', { keepPrefs: true });
  try {
    await waitDoc(page);
    const p = await S_(page, () => { const q = window.__plantint.prefs.get(); return { side: q.panel.side, width: q.panel.width, first: q.colours && q.colours[0].hex, prefix: q.naming.prefix, op: window.__plantint.S.style.opacity }; });
    check(p.side === 'left' && p.width === 400 && p.first === '#E03131' && p.prefix === 'B-' && p.op === 0.6, `after a restart the preferences are still there (${JSON.stringify(p)})`, R);
    const z = await waitFor(async () => (await mainWin(app, 'return w.webContents.getZoomFactor();')) === 1.25, 'the zoom at start').catch(() => false);
    check(z, 'and so is the interface size', R);
    // back to how PlanTint comes
    await openPrefs(page, 'ui');
    await page.click('.prefs-page .btn:has-text("Reset all preferences")');
    await page.click('.prefs-page .btn:has-text("Click again")');
    await page.waitForTimeout(300);
    const after = await S_(page, () => { const q = window.__plantint.prefs.get(); return { side: q.panel.side, colours: q.colours, prefix: q.naming.prefix }; });
    const z1 = await waitFor(async () => (await mainWin(app, 'return w.webContents.getZoomFactor();')) === 1, 'the zoom back');
    check(after.side === 'right' && after.colours === null && after.prefix === 'Area ' && z1, 'Reset all preferences brings everything back, interface size too', R);
    await closePrefs(page);
    allErrors = allErrors.concat(errors);
  } catch (e) {
    check(false, 'restart: ' + e.stack, R);
  } finally {
    await S_(page, () => window.__plantint.prefs.reset()).catch(() => {});
    await quit(app);
    fs.rmSync(UI_STATE_FILE, { force: true });
  }
}

process.exit(summary(R, allErrors) ? 0 : 1);
