// 1.6: the markups window. The button at the top of the markup list opens every markup in a window
// of its own: find by name, filter by colour and status, select (the sheet shows the same selection),
// rename, recolour, set the status, zoom to and delete, all with undo; changes on the sheet show in
// the window; it stays quick with hundreds of markups.
import { launch, waitDoc, check, summary, clickSheet, waitMarkups, quit, OUT, DATA } from './lib.mjs';

const R = [];
let allErrors = [];
const px = (mm) => (mm * 400) / 25.4;
const P = (mx, my) => [px(45 + 20 * mx), px(297 - (70 + 20 * my))];
const S_ = (page, fn, arg) => page.evaluate(fn, arg);
const markups = (page) => S_(page, () => window.__plantint.S.markups.map((m) => ({ id: m.id, name: m.name, color: m.color, st: m.prog ? m.prog.st : null })));
const selection = (page) => S_(page, () => [...window.__plantint.S.selection]);
const rowNames = (pop) => pop.$$eval('table.mw-t tbody tr', (rs) => rs.map((r) => r.querySelector('.mw-name').value));
/** Waits until the window shows what the drawing has (it updates on the next turn). */
const settle = (pop) => pop.waitForTimeout(150);

async function openWindow(app, page) {
  const popP = app.waitForEvent('window', { timeout: 15000 });
  await page.click('#mk-window');
  const pop = await popP;
  await pop.waitForSelector('.mw-top', { timeout: 15000 });
  await pop.setViewportSize({ width: 1060, height: 700 }).catch(() => {});
  return pop;
}

{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    await page.keyboard.press('f');
    const spots = [[1.0, 5.2, '#F25F5C'], [10.5, 7.6, '#3FA7E0'], [2.2, 3.0, '#F25F5C'], [8.7, 1.5, '#FFD60A'], [10.2, 0.8, '#B07CE0']];
    for (let i = 0; i < spots.length; i++) {
      await S_(page, (c) => { const t = window.__plantint; t.S.style = { ...t.S.style, color: c }; t.emit('style'); }, spots[i][2]);
      await clickSheet(page, ...P(spots[i][0], spots[i][1]));
      await waitMarkups(page, i + 1);
    }
    const ms = await markups(page);

    // ---- the button opens the window; it lists every markup in drawing order
    const pop = await openWindow(app, page);
    check((await pop.title()).startsWith('Markups — plan_zones'), `the list's window button opens a window of its own (${await pop.title()})`, R);
    check(JSON.stringify(await rowNames(pop)) === JSON.stringify(ms.map((m) => m.name)), `it lists every markup in drawing order (${(await rowNames(pop)).join(', ')})`, R);
    check(await pop.$$eval('.mw-t th', (t) => t.some((x) => x.textContent.startsWith('Area'))), 'with areas (the drawing has a scale)', R);
    check(/5 markups/.test(await pop.textContent('.mw-count')), 'the count of markups', R);
    check(await S_(page, () => window.__plantint.S.selection.size === 0), 'opening it does not select anything', R);
    // the same button brings it to the front instead of opening a second one
    await page.click('#mk-window');
    await page.waitForTimeout(400);
    check(app.windows().filter((w) => w.url() === 'about:blank').length === 1, 'the button again: still one window', R);

    // ---- find by name
    await pop.fill('.mw-search', 'bed');
    await settle(pop);
    let names = await rowNames(pop);
    const beds = ms.filter((m) => /bed/i.test(m.name)).map((m) => m.name);
    check(beds.length >= 1 && JSON.stringify(names) === JSON.stringify(beds), `finding "bed" shows only the markups named so (${names.join(', ')})`, R);
    await pop.click('.mw-clear');
    await settle(pop);
    check((await rowNames(pop)).length === 5, 'clearing the search shows all again', R);

    // ---- filter by colour
    const red = pop.locator('.mw-chip', { hasText: 'Red' });
    await red.click();
    await settle(pop);
    names = await rowNames(pop);
    check(names.length === 2, `the Red chip shows the two red markups (${names.join(', ')})`, R);
    await red.click();
    await settle(pop);

    // ---- select: a click, Ctrl+click, Shift+click; the sheet shows the same selection
    let rows = await pop.$$('table.mw-t tbody tr');
    await rows[0].click({ position: { x: 120, y: 10 } });
    await settle(pop);
    check(JSON.stringify(await selection(page)) === JSON.stringify([ms[0].id]), 'a click on a row selects it on the sheet', R);
    await rows[2].click({ position: { x: 120, y: 10 }, modifiers: ['Control'] });
    await settle(pop);
    check((await selection(page)).length === 2, 'Ctrl+click adds a row', R);
    await rows[4].click({ position: { x: 120, y: 10 }, modifiers: ['Shift'] });
    await settle(pop);
    check((await selection(page)).length === 3, `Shift+click selects a range (${(await selection(page)).length})`, R);
    check((await pop.$$eval('tr.sel', (r) => r.length)) === 3 && /3 selected/.test(await pop.textContent('.mw-sel-title')), 'the window shows the selection', R);
    // selecting on the sheet shows in the window
    await S_(page, (id) => { const t = window.__plantint; t.S.selection = new Set([id]); t.emit('selection'); }, ms[1].id);
    await settle(pop);
    check((await pop.$$eval('tr.sel', (r) => r.map((x) => x.getAttribute('data-id')))).join() === ms[1].id, 'a selection made on the sheet shows in the window', R);

    // ---- recolour the selected markups, one undo step
    await pop.keyboard.press('Control+a');
    await settle(pop);
    check((await selection(page)).length === 5, 'Ctrl+A in the window selects every markup shown', R);
    await pop.click('.mw-act .mw-sw[aria-label="Teal"]');
    await settle(pop);
    let now = await markups(page);
    check(now.every((m) => m.color === '#2EC4B6'), 'a colour in the bar recolours all the selected markups', R);
    await pop.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    now = await markups(page);
    check(now.map((m) => m.color).join() === ms.map((m) => m.color).join(), 'Ctrl+Z in the window undoes it in one step', R);
    await pop.keyboard.press('Escape');
    await settle(pop);
    check((await selection(page)).length === 0, 'Esc clears the selection', R);

    // ---- one markup's colour from its swatch
    rows = await pop.$$('table.mw-t tbody tr');
    await (await rows[3].$('.mw-swb')).click();
    await pop.waitForSelector('.mw-pop');
    await pop.click('.mw-pop .mw-sw[aria-label="Purple"]');
    await settle(pop);
    now = await markups(page);
    check(now[3].color === '#B07CE0' && now[0].color === ms[0].color, 'the swatch of a row recolours only that markup', R);

    // ---- rename in place
    const name0 = pop.locator('table.mw-t tbody tr').nth(1).locator('.mw-name');
    await name0.click();
    await name0.fill('Master living');
    await name0.press('Enter');
    await settle(pop);
    now = await markups(page);
    check(now[1].name === 'Master living', `typing a name renames the markup (${now[1].name})`, R);
    const panelName = await page.textContent(`#mk-list .mk-row[data-id="${ms[1].id}"] .mk-name`);
    check(panelName === 'Master living', 'the side panel shows the new name too', R);

    // ---- sort by name (natural order), then back to drawing order
    await pop.locator('.mw-t th', { hasText: 'Name' }).click();
    await settle(pop);
    names = await rowNames(pop);
    const want = [...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
    check(JSON.stringify(names) === JSON.stringify(want), `sorting by name (${names.join(', ')})`, R);
    await pop.locator('.mw-t th', { hasText: '#' }).click();
    await settle(pop);

    // ---- zoom to a markup on the sheet
    const before = await S_(page, () => window.__plantint.V.scale);
    await pop.locator('table.mw-t tbody tr').nth(4).dblclick({ position: { x: 120, y: 10 } });
    await page.waitForTimeout(400);
    const after = await S_(page, () => window.__plantint.V.scale);
    check(after > before * 1.5, `double-clicking a row zooms the sheet to it (${before.toFixed(3)} → ${after.toFixed(3)})`, R);

    // ---- progress map: status column, per row and for the selection
    await page.click('#pg-switch');
    await settle(pop);
    check(await pop.$$eval('.mw-t th', (t) => t.some((x) => x.textContent.startsWith('Status'))), 'with the progress map on, the table has a status column', R);
    await pop.locator('table.mw-t tbody tr').nth(0).locator('select.mw-sel').selectOption('done');
    await settle(pop);
    now = await markups(page);
    check(now[0].st === 'done' && !now[1].st, 'a row’s status menu sets that zone', R);
    await pop.locator('table.mw-t tbody tr').nth(1).click({ position: { x: 120, y: 10 } });
    await pop.locator('table.mw-t tbody tr').nth(2).click({ position: { x: 120, y: 10 }, modifiers: ['Control'] });
    await pop.locator('.mw-st-btn', { hasText: 'In progress' }).click();
    await settle(pop);
    now = await markups(page);
    check(now[1].st === 'doing' && now[2].st === 'doing', 'the status buttons set every selected zone', R);
    const pct = pop.locator('table.mw-t tbody tr').nth(1).locator('input.mw-numin');
    await pct.fill('80');
    await pct.press('Enter');
    await settle(pop);
    check(await S_(page, () => window.__plantint.S.markups[1].prog.pct === 80), 'the % done of a zone in progress can be typed', R);
    await pop.locator('.mw-chip', { hasText: 'In progress' }).click();
    await settle(pop);
    check((await rowNames(pop)).length === 2, 'the status chips filter the table', R);
    await pop.locator('.mw-chip', { hasText: 'In progress' }).click();
    await page.click('#pg-switch');
    await settle(pop);

    // ---- delete from the window, then undo from its message
    await pop.locator('table.mw-t tbody tr').nth(4).locator('.mw-icon.del').click();
    await settle(pop);
    check((await markups(page)).length === 4 && (await rowNames(pop)).length === 4, 'the bin of a row deletes that markup', R);
    await pop.locator('.mw-msg .mw-link', { hasText: 'Undo' }).click();
    await page.waitForTimeout(400);
    check((await markups(page)).length === 5 && (await rowNames(pop)).length === 5, 'Undo in the window’s message brings it back', R);

    // ---- a change on the sheet shows in the window
    await S_(page, () => { const t = window.__plantint; t.S.selection = new Set([t.S.markups[0].id]); t.emit('selection'); });
    await page.keyboard.press('Delete');
    await settle(pop);
    check((await rowNames(pop)).length === 4, 'deleting on the sheet takes the row out of the window', R);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    check((await rowNames(pop)).length === 5, 'undo on the sheet puts it back in the window', R);
    await pop.screenshot({ path: OUT + '/t11_window.png' });

    // ---- closing it, and opening it again
    await pop.close();
    await page.waitForTimeout(1300);
    check(!(await S_(page, () => window.__plantint.markupsWin.isOpen())), 'closing the window is noticed', R);
    const pop2 = await openWindow(app, page);
    check((await rowNames(pop2)).length === 5, 'it opens again', R);
    allErrors = allErrors.concat(errors);
  } finally {
    await quit(app);
  }
}

// ---------------------------------------------------------------- hundreds of markups (a whole site layout)
{
  const { app, page, errors } = await launch(DATA + '/plan_A3_single.pdf');
  try {
    await waitDoc(page);
    // 650 buildings in rows, named V001 to V650, in three colours
    await S_(page, () => {
      const t = window.__plantint;
      const cols = ['#57CC99', '#FFD60A', '#F25F5C'];
      const out = [];
      for (let i = 0; i < 650; i++) {
        const x = 200 + (i % 50) * 120, y = 200 + Math.floor(i / 50) * 300;
        out.push(Object.freeze({ id: 'm' + i.toString(36) + 'x', name: 'V' + String(i + 1).padStart(3, '0'), kind: 'polygon', rings: [[x, y, x + 100, y, x + 100, y + 250, x, y + 250]], color: cols[i % 3], opacity: 0.45, borderPt: 0, borderColor: null, borderStyle: 'solid' }));
      }
      t.S.markups = out;
      t.emit('doc');
    });
    const t0 = Date.now();
    const pop = await openWindow(app, page);
    await pop.waitForFunction(() => document.querySelectorAll('table.mw-t tbody tr').length === 650, null, { timeout: 30000 });
    const openMs = Date.now() - t0;
    check(openMs < 8000, `650 markups: the window opens with every row (${openMs} ms)`, R);
    await pop.fill('.mw-search', 'V04');
    await pop.waitForFunction(() => document.querySelectorAll('table.mw-t tbody tr').length === 10, null, { timeout: 10000 });
    check(true, 'finding "V04" shows V040 to V049', R);
    await pop.click('.mw-clear');
    await pop.locator('.mw-chip', { hasText: 'Yellow' }).click();
    await pop.waitForFunction(() => document.querySelectorAll('table.mw-t tbody tr').length === 217, null, { timeout: 10000 });
    const t1 = Date.now();
    await pop.keyboard.press('Control+a');
    await pop.click('.mw-act .mw-sw[aria-label="Blue"]');
    await page.waitForFunction(() => window.__plantint.S.markups.filter((m) => m.color === '#3FA7E0').length === 217, null, { timeout: 15000 });
    const recolourMs = Date.now() - t1;
    check(recolourMs < 5000, `selecting the 217 yellow ones and recolouring them takes ${recolourMs} ms`, R);
    allErrors = allErrors.concat(errors);
  } finally {
    await quit(app);
  }
}

process.exit(summary(R, allErrors) ? 0 : 1);
