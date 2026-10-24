// 1.7: merging markups, and the markups window beside the drawing.
// - Merge: on the sheet (right-click "Merge into", Ctrl+M) and in the markups window (drag a row onto
//   another, or the Merge button). The areas become one markup and keep their own shapes: nothing is
//   filled in between them;
//   areas apart become parts of one markup. The one merged into keeps its name, colour and status.
// - The window opens beside the drawing, above PlanTint's window, resizable, works narrow, comes back
//   where it was left, hides with its tab; a click on a row brings the markup into view beside it.
import { launch, waitDoc, check, summary, clickSheet, toClient, quit, drawingPages, OUT, DATA } from './lib.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const R = [];
let allErrors = [];
const BOUNDS_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'PlanTint', 'markups-window.json');
const S_ = (page, fn, arg) => page.evaluate(fn, arg);
const waitFor = async (fn, what, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('timed out: ' + what);
};
const rect = (x0, y0, x1, y1) => [[x0, y0, x1, y0, x1, y1, x0, y1]];
// four areas: two neighbours with a thin line between them (8 px = 0.5 mm at 400 dpi), one 40 px
// (2.5 mm) further on, one far away
const AREAS = [
  { id: 'mA', name: 'Room 1', color: '#F25F5C', rings: rect(1000, 1000, 1600, 1400) },
  { id: 'mB', name: 'Room 2', color: '#3FA7E0', rings: rect(1608, 1000, 2200, 1400) },
  { id: 'mC', name: 'Store', color: '#FFD60A', rings: rect(2240, 1000, 2600, 1400) },
  { id: 'mD', name: 'Far', color: '#57CC99', rings: rect(4200, 2600, 4600, 3000) },
];
async function inject(page, list = AREAS) {
  await S_(page, (list) => {
    const t = window.__plantint;
    t.S.markups = list.map((m) => Object.freeze({ kind: 'polygon', opacity: 0.45, borderPt: 0, borderColor: null, borderStyle: 'solid', ...m }));
    t.S.selection = new Set();
    t.emit('doc'); t.emit('selection');
  }, list);
  await page.waitForTimeout(200);
}
const state = (page) => S_(page, () => {
  const t = window.__plantint;
  return t.S.markups.map((m) => ({ id: m.id, name: m.name, color: m.color, area: t.measure.measureAt(t.S.markups.indexOf(m)).area, parts: m.rings.length }));
});
const selection = (page) => S_(page, () => [...window.__plantint.S.selection]);
const centre = (id) => { const r = AREAS.find((a) => a.id === id).rings[0]; return [(r[0] + r[2]) / 2, (r[1] + r[5]) / 2]; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const A = 600 * 400, B = 592 * 400, C = 360 * 400, D = 400 * 400;

async function openWindow(app, page) {
  const popP = app.waitForEvent('window', { timeout: 15000 });
  await page.click('#mk-window');
  const pop = await popP;
  await pop.waitForSelector('.mw-top', { timeout: 15000 });
  return pop;
}
const popWin = (app, fn, arg) => app.evaluate(({ BrowserWindow }, [src, a]) => {
  const all = BrowserWindow.getAllWindows();
  const main = all.find((w) => !w.webContents.getURL().startsWith('about:'));
  const pop = all.find((w) => w.webContents.getURL().startsWith('about:'));
  return new Function('main', 'pop', 'a', src)(main, pop, a); // eslint-disable-line no-new-func
}, [fn, arg]);
/** The row of the markup named so (names are typed into inputs, so they are looked up by value). */
const rowOf = async (pop, name) => {
  const i = (await pop.$$eval('table.mw-t tbody tr', (rs) => rs.map((r) => r.querySelector('.mw-name').value))).indexOf(name);
  if (i < 0) throw new Error('no row named ' + name);
  return pop.locator('table.mw-t tbody tr').nth(i);
};
const rowNames = (pop) => pop.$$eval('table.mw-t tbody tr', (rs) => rs.map((r) => r.querySelector('.mw-name').value));
/** Drags a row (by its number) onto another row, as a person would, and says what the label by the pointer said. */
async function dragRow(pop, fromName, toName, { drop = true } = {}) {
  const a = await (await rowOf(pop, fromName)).locator('td.c-idx').boundingBox();
  const b = await (await rowOf(pop, toName)).locator('td.c-idx').boundingBox();
  await pop.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await pop.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await pop.mouse.move(a.x + a.width / 2 + (b.x - a.x) * (i / steps), a.y + a.height / 2 + (b.y - a.y) * (i / steps));
    await pop.waitForTimeout(16);
  }
  const ghost = await pop.textContent('.mw-ghost').catch(() => null);
  const dropRow = await pop.$eval('tr.drop .mw-name', (i) => i.value).catch(() => null);
  if (drop) await pop.mouse.up();
  return { ghost, dropRow };
}

// ======================================================================== merging on the sheet
{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    await inject(page);
    await page.keyboard.press('s');
    // select the two neighbours: click one, Shift+click the other; right-click the second
    await clickSheet(page, ...centre('mA'));
    await page.keyboard.down('Shift');
    await clickSheet(page, ...centre('mB'));
    await page.keyboard.up('Shift');
    const c = await toClient(page, ...centre('mB'));
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await page.waitForSelector('.menu');
    const item = page.locator('.menu-item', { hasText: 'Merge 2 into' });
    check(await item.isVisible() && /“Room 2”/.test(await item.textContent()), `right-click on two selected markups offers to merge them into the one clicked (${(await item.textContent()).trim()})`, R);
    await item.click();
    await page.waitForTimeout(300);
    let st = await state(page);
    const m = st.find((q) => q.id === 'mB');
    check(st.length === 3 && m && m.name === 'Room 2' && m.color === '#3FA7E0', `they become one markup, named and coloured as the one clicked (${st.map((q) => q.name).join(', ')})`, R);
    check(m && near(m.area, A + B, 2) && m.parts === 2, `each keeps its shape: the line between the neighbours is not filled (${m && Math.round(m.area)} px² = ${A} + ${B}, ${m && m.parts} parts)`, R);
    check(JSON.stringify(await selection(page)) === '["mB"]', 'the merged markup is selected', R);
    check(/Merged 2 markups into “Room 2”/.test(await page.textContent('.toasts')), 'a message says what was merged, with Undo', R);
    await page.screenshot({ path: OUT + '/t12_merged_sheet.png' });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    st = await state(page);
    check(st.length === 4 && near(st[0].area, A, 1) && near(st[1].area, B, 1), 'undo brings both back as they were', R);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(300);
    check((await state(page)).length === 3, 'redo merges them again', R);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // Ctrl+M: into the one selected first; areas apart stay apart, as parts of one markup
    await S_(page, () => { const t = window.__plantint; t.S.selection = new Set(['mC', 'mA']); t.emit('selection'); });
    await page.keyboard.press('Control+m');
    await page.waitForTimeout(300);
    st = await state(page);
    const mc = st.find((q) => q.id === 'mC');
    check(st.length === 3 && mc && !st.some((q) => q.id === 'mA') && mc.name === 'Store', `Ctrl+M merges into the one selected first (${st.map((q) => q.name).join(', ')})`, R);
    check(mc && near(mc.area, A + C, 2) && mc.parts === 2, `areas 2.5 mm apart: nothing between them is added, one markup in two parts (${mc && Math.round(mc.area)} px², ${mc && mc.parts} parts)`, R);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    // one selected: nothing happens, a message says how
    await S_(page, () => { const t = window.__plantint; t.S.selection = new Set(['mA']); t.emit('selection'); });
    await page.keyboard.press('Control+m');
    await page.waitForTimeout(250);
    check((await state(page)).length === 4 && /two or more/.test(await page.textContent('.toasts')), 'Ctrl+M with one markup selected explains how to merge', R);
    allErrors = allErrors.concat(errors);
  } catch (e) {
    check(false, 'sheet: ' + e.stack, R);
  } finally {
    await quit(app);
  }
}

// ======================================================================== real fills: a building split by its number
{
  const { app, page, errors } = await launch(DATA + '/layout_coloured.png');
  try {
    await waitDoc(page);
    await S_(page, () => { const t = window.__plantint; t.S.style = { ...t.S.style, color: '#E03131', opacity: 0.6, cover: true }; t.emit('style'); });
    await page.keyboard.press('f');
    // building 2 (x 230..379, y 150..259): its number, a 7 px stroke, splits it; each side is filled on its own
    await clickSheet(page, 245, 240);
    await waitFor(async () => (await S_(page, () => window.__plantint.S.markups.length)) === 1, 'the first fill');
    await clickSheet(page, 365, 165);
    await waitFor(async () => (await S_(page, () => window.__plantint.S.markups.length)) === 2, 'the second fill');
    const sides = await S_(page, () => window.__plantint.S.markups.map((m) => m.id));
    await S_(page, (ids) => { const t = window.__plantint; t.S.selection = new Set(ids); t.emit('selection'); }, sides);
    await page.keyboard.press('Control+m');
    await page.waitForTimeout(400);
    const res = await S_(page, () => {
      const t = window.__plantint;
      const m = t.S.markups[0];
      let inside = false;
      for (const r of m.rings) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const yi = r[i + 1], yj = r[j + 1];
        if ((yi > 205) !== (yj > 205) && 305 < r[i] + ((205 - yi) * (r[j] - r[i])) / (yj - yi)) inside = !inside;
      }
      const b = [1e9, 1e9, -1e9, -1e9];
      for (const r of m.rings) for (let i = 0; i < r.length; i += 2) { b[0] = Math.min(b[0], r[i]); b[2] = Math.max(b[2], r[i]); b[1] = Math.min(b[1], r[i + 1]); b[3] = Math.max(b[3], r[i + 1]); }
      return { n: t.S.markups.length, outer: m.rings.filter((r) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a) > 400; }).length, inside, b: b.map(Math.round) };
    });
    check(res.n === 1 && res.outer === 2 && !res.inside, `the two filled sides of a building become one markup in two parts; the number between them is not filled (${res.n} markup, ${res.outer} parts)`, R);
    check(res.b[0] >= 226 && res.b[2] <= 384 && res.b[1] >= 146 && res.b[3] <= 264, `and it stays inside the building (${res.b.join(', ')})`, R);
    await page.screenshot({ path: OUT + '/t12_building.png' });
    allErrors = allErrors.concat(errors);
  } catch (e) {
    check(false, 'fills: ' + e.stack, R);
  } finally {
    await quit(app);
  }
}

// ======================================================================== the markups window
{
  fs.rmSync(BOUNDS_FILE, { force: true });
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    await inject(page);
    let pop = await openWindow(app, page);

    // ---- beside the drawing, above PlanTint's window, resizable
    let w = await popWin(app, 'return { main: main.getBounds(), pop: pop.getBounds(), parent: pop.getParentWindow() === main, resizable: pop.isResizable() };');
    check(w.parent, 'the window stays above PlanTint\'s window (it belongs to it)', R);
    check(w.resizable, 'the window can be resized', R);
    const right = w.pop.x + w.pop.width;
    check(w.pop.width <= w.main.width * 0.5 && right <= w.main.x + w.main.width && right >= w.main.x + w.main.width - 60 && w.pop.y > w.main.y,
      `it opens over the right part of PlanTint's window, leaving most of the sheet in view (${JSON.stringify(w.pop)} in ${JSON.stringify(w.main)})`, R);

    // ---- narrow: the table and the buttons still fit
    await popWin(app, 'pop.setBounds({ x: a.x, y: a.y, width: 560, height: 640 });', { x: w.main.x + 900, y: w.main.y + 120 });
    await pop.waitForFunction(() => innerWidth <= 560, null, { timeout: 5000 });
    await pop.waitForTimeout(200);
    const narrow = await pop.evaluate(() => {
      const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
      return { palette: vis('.mw-act .pal-inline'), colour: vis('.mw-colour'), merge: vis('.mw-merge'), perim: vis('th.c-perim'), scroll: document.querySelector('.mw-wrap').scrollWidth - document.querySelector('.mw-wrap').clientWidth };
    });
    check(!narrow.palette && narrow.colour && narrow.merge && !narrow.perim && narrow.scroll <= 2, `a narrow window (560 px) keeps the buttons and the table in view (${JSON.stringify(narrow)})`, R);
    await pop.screenshot({ path: OUT + '/t12_window_narrow.png' });

    // ---- merge by dragging a row onto another
    let d = await dragRow(pop, 'Room 1', 'Room 2');
    check(d.dropRow === 'Room 2' && /Merge “Room 1” into “Room 2”/.test(d.ghost || ''), `while dragging, the row under the pointer is marked and a label says what will happen (${d.ghost})`, R);
    await pop.waitForTimeout(250);
    let st = await state(page);
    let m = st.find((q) => q.id === 'mB');
    check(st.length === 3 && m && m.name === 'Room 2' && m.color === '#3FA7E0' && near(m.area, A + B, 2) && m.parts === 2,
      `dropping Room 1 on Room 2 merges it into Room 2, both keeping their shapes (${st.map((q) => q.name).join(', ')}; ${m && Math.round(m.area)} px²)`, R);
    check(JSON.stringify(await rowNames(pop)) === JSON.stringify(['Room 2', 'Store', 'Far']), 'the window shows the merged markup in its place', R);
    check(/Merged 2 markups into “Room 2”/.test(await pop.textContent('.mw-msg')), 'and says so, with Undo', R);
    await pop.locator('.mw-msg .mw-link', { hasText: 'Undo' }).click();
    await page.waitForTimeout(300);
    check((await state(page)).length === 4, 'Undo in the window brings both back', R);

    // ---- several selected rows dragged together
    await (await rowOf(pop, 'Room 1')).locator('td.c-idx').click();
    await (await rowOf(pop, 'Store')).locator('td.c-idx').click({ modifiers: ['Control'] });
    d = await dragRow(pop, 'Store', 'Far');
    await pop.waitForTimeout(250);
    st = await state(page);
    m = st.find((q) => q.id === 'mD');
    check(/Merge 2 markups into “Far”/.test(d.ghost || '') && st.length === 2 && m && m.name === 'Far' && m.parts === 3 && near(m.area, A + C + D, 3),
      `dragging one of two selected rows takes both: Room 1 and Store go into Far, as three parts (${d.ghost}; ${st.map((q) => q.name).join(', ')})`, R);
    await pop.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // ---- dropping on nothing, on itself, or Esc: nothing is merged
    d = await dragRow(pop, 'Store', 'Store');
    await pop.waitForTimeout(150);
    check((await state(page)).length === 4 && !d.dropRow, 'dropping a row on itself merges nothing', R);
    d = await dragRow(pop, 'Room 1', 'Store', { drop: false });
    await pop.keyboard.press('Escape');
    await pop.mouse.up();
    await pop.waitForTimeout(150);
    check((await state(page)).length === 4 && !(await pop.$('.mw-ghost')), 'Esc while dragging stops it without merging', R);

    // ---- the Merge button: into the first selected row in the table
    await (await rowOf(pop, 'Room 2')).locator('td.c-idx').click();
    await (await rowOf(pop, 'Store')).locator('td.c-idx').click({ modifiers: ['Control'] });
    const tip = await pop.getAttribute('.mw-merge', 'title');
    await pop.click('.mw-merge');
    await pop.waitForTimeout(250);
    st = await state(page);
    m = st.find((q) => q.id === 'mB');
    check(/into “Room 2”/.test(tip) && st.length === 3 && m && near(m.area, B + C, 2) && m.parts === 2, `the Merge button merges the selected rows into the first of them (${st.map((q) => q.name).join(', ')})`, R);
    await pop.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // ---- Show on drawing: a click on a row brings its markup into view, beside the window
    await S_(page, () => { const t = window.__plantint; t.V.scale = t.V.scale * 3; t.V.tx = 0; t.V.ty = 0; t.emit('view'); });
    await page.waitForTimeout(150);
    const before = await S_(page, () => ({ tx: window.__plantint.V.tx, ty: window.__plantint.V.ty }));
    await (await rowOf(pop, 'Far')).locator('td.c-idx').click();
    await page.waitForTimeout(400);
    const shown = await S_(page, async () => {
      const t = window.__plantint, V = t.V;
      const m = t.S.markups.find((q) => q.id === 'mD');
      const r = m.rings[0];
      const box = [r[0] * V.scale + V.tx, r[1] * V.scale + V.ty, r[4] * V.scale + V.tx, r[5] * V.scale + V.ty].map((v) => v / V.dpr);
      const ui = document.getElementById('ui').getBoundingClientRect();
      const c = await window.plantint.markupsCover();
      const cov = c ? [c.x - ui.left, c.y - ui.top, c.x - ui.left + c.width, c.y - ui.top + c.height] : null;
      const inView = box[0] >= 0 && box[1] >= 0 && box[2] <= ui.width && box[3] <= ui.height;
      const under = cov && !(box[2] <= cov[0] || box[0] >= cov[2] || box[3] <= cov[1] || box[1] >= cov[3]);
      return { inView, under, box: box.map(Math.round), cov, flash: !!(t.T.flash && t.T.flash.pulse && t.T.flash.ids.includes('mD')) };
    });
    const moved = await S_(page, () => ({ tx: window.__plantint.V.tx, ty: window.__plantint.V.ty }));
    check(shown.inView && !shown.under && (moved.tx !== before.tx || moved.ty !== before.ty), `a click on a row out of view brings its markup into view, beside the window (${JSON.stringify(shown.box)}, window ${JSON.stringify(shown.cov)})`, R);
    check(shown.flash, 'and its outline flashes', R);
    await page.screenshot({ path: OUT + '/t12_shown.png' });
    // already in view: the sheet stays where it is
    const still = await S_(page, () => ({ tx: window.__plantint.V.tx, ty: window.__plantint.V.ty }));
    await (await rowOf(pop, 'Far')).locator('td.c-idx').click();
    await page.waitForTimeout(300);
    const again = await S_(page, () => ({ tx: window.__plantint.V.tx, ty: window.__plantint.V.ty }));
    check(again.tx === still.tx && again.ty === still.ty, 'a markup already in view: the sheet does not move', R);
    // unticked: a click selects only
    await pop.click('.mw-follow input');
    await S_(page, () => { const t = window.__plantint; t.V.tx = 0; t.V.ty = 0; t.emit('view'); });
    await (await rowOf(pop, 'Room 1')).locator('td.c-idx').click();
    await page.waitForTimeout(300);
    const off = await S_(page, () => ({ tx: window.__plantint.V.tx, ty: window.__plantint.V.ty, sel: [...window.__plantint.S.selection] }));
    check(off.tx === 0 && off.ty === 0 && off.sel.join() === 'mA', 'with Show on drawing unticked, a click only selects', R);
    await pop.click('.mw-follow input');

    // ---- it comes back where it was left, at its size
    w = await popWin(app, 'return pop.getBounds();');
    await pop.keyboard.press('Control+w').catch(() => {});
    await waitFor(() => pop.isClosed(), 'the window closes');
    pop = await openWindow(app, page);
    const w2 = await popWin(app, 'return pop.getBounds();');
    check(Math.abs(w2.x - w.x) <= 2 && Math.abs(w2.y - w.y) <= 2 && w2.width === w.width && w2.height === w.height, `opened again, it is where it was left (${JSON.stringify(w)} → ${JSON.stringify(w2)})`, R);

    // ---- it hides while another tab is shown, and comes back with its drawing
    await page.keyboard.press('Control+n');
    await waitFor(() => drawingPages(app).length === 2, 'a second tab');
    const page2 = drawingPages(app).find((p) => p !== page);
    await page2.waitForFunction(() => window.__plantint && window.__plantint.S, null, { timeout: 60000 });
    await waitFor(async () => !(await popWin(app, 'return pop.isVisible();')), 'the window hides');
    check(true, 'another tab in front: its drawing\'s markups window hides', R);
    await page2.keyboard.press('Control+Tab');
    await waitFor(async () => popWin(app, 'return pop.isVisible();'), 'the window shows again');
    check(!pop.isClosed(), 'back to the drawing: its window shows again', R);
    allErrors = allErrors.concat(errors);
  } catch (e) {
    check(false, 'window: ' + e.stack, R);
  } finally {
    await quit(app);
  }
}

// ======================================================================== a long list: the rows scroll while dragging
{
  fs.rmSync(BOUNDS_FILE, { force: true });
  const { app, page, errors } = await launch(DATA + '/plan_A3_single.pdf');
  try {
    await waitDoc(page);
    const many = [];
    for (let i = 0; i < 120; i++) {
      const x = 200 + (i % 20) * 160, y = 200 + Math.floor(i / 20) * 300;
      many.push({ id: 'v' + i, name: 'V' + String(i + 1).padStart(3, '0'), color: '#57CC99', rings: rect(x, y, x + 150, y + 250) });
    }
    await inject(page, many);
    const pop = await openWindow(app, page);
    await popWin(app, 'pop.setBounds({ x: a.x, y: a.y, width: 640, height: 520 });', { x: 300, y: 200 });
    await pop.waitForFunction(() => innerHeight <= 520, null, { timeout: 5000 });
    // a markup selected on the sheet: the table scrolls to its row
    await S_(page, () => { const t = window.__plantint; t.S.selection = new Set(['v110']); t.emit('selection'); });
    await pop.waitForTimeout(300);
    const seen = await pop.evaluate(() => {
      const w = document.querySelector('.mw-wrap'), tr = document.querySelector('tr[data-id="v110"]');
      const a = w.getBoundingClientRect(), b = tr.getBoundingClientRect(), h = document.querySelector('.mw-t thead').getBoundingClientRect().height;
      return { top: w.scrollTop, visible: b.top >= a.top + h - 1 && b.bottom <= a.bottom + 1 };
    });
    check(seen.top > 0 && seen.visible, `a markup selected on the sheet: the window scrolls to its row (${JSON.stringify(seen)})`, R);
    await S_(page, () => { const t = window.__plantint; t.S.selection = new Set(); t.emit('selection'); });
    await pop.evaluate(() => { document.querySelector('.mw-wrap').scrollTop = 0; });
    await pop.waitForTimeout(200);
    const a = await (await rowOf(pop, 'V001')).locator('td.c-idx').boundingBox();
    const wrap = await pop.locator('.mw-wrap').boundingBox();
    await pop.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await pop.mouse.down();
    await pop.mouse.move(a.x + a.width / 2, a.y + 40, { steps: 4 });
    await pop.mouse.move(a.x + a.width / 2, wrap.y + wrap.height - 6, { steps: 6 });
    await pop.waitForTimeout(1500);
    const top = await pop.$eval('.mw-wrap', (e) => e.scrollTop);
    const target = await pop.$eval('tr.drop .mw-name', (i) => i.value).catch(() => null);
    await pop.mouse.up();
    await pop.waitForTimeout(300);
    const left = await S_(page, () => window.__plantint.S.markups.length);
    check(top > 300 && target && target !== 'V001', `holding a dragged row at the bottom of the table scrolls the rows (scrolled ${top} px, over ${target})`, R);
    check(left === 119 && !(await S_(page, () => window.__plantint.S.markups.some((m) => m.id === 'v0'))), `and it merges into the row it is dropped on (${left} markups left)`, R);
    allErrors = allErrors.concat(errors);
  } catch (e) {
    check(false, 'long list: ' + e.stack, R);
  } finally {
    await quit(app);
  }
}

process.exit(summary(R, allErrors) ? 0 : 1);
