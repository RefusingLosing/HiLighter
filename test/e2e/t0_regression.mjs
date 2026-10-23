// The 1.0 requirements, checked again after the 1.1 changes.
import { launch, waitDoc, shot, check, summary, clickSheet, toClient, waitMarkups, stubSave, quit, setRange, OUT, DATA, RECOVERY_DIR } from './lib.mjs';
import fs from 'fs';

const R = [];
let allErrors = [];
const px = (mm, dpi = 400) => (mm * dpi) / 25.4;
const P = (mx, my) => [px(45 + 20 * mx), px(297 - (70 + 20 * my))];
const M = (page) => page.evaluate(() => window.__plantint.S.markups.map((m) => ({ id: m.id, name: m.name, color: m.color, opacity: m.opacity, borderPt: m.borderPt, rings: m.rings })));
const SEL = (page) => page.evaluate(() => [...window.__plantint.S.selection]);
const bb = (rings) => { const b = [1e9, 1e9, -1e9, -1e9]; for (const r of rings) for (let i = 0; i < r.length; i += 2) { b[0] = Math.min(b[0], r[i]); b[2] = Math.max(b[2], r[i]); b[1] = Math.min(b[1], r[i + 1]); b[3] = Math.max(b[3], r[i + 1]); } return b; };

// ---------------------------------------------------------------- multi-page PDF: page picker
{
  const { app, page, errors } = await launch(DATA + '/plan_A3_2pages.pdf');
  try {
    await page.waitForSelector('.page-card', { timeout: 30000 });
    const n = await page.$$eval('.page-card', (c) => c.length);
    check(n === 2, `multi-page PDF asks which page (${n} pages shown)`, R);
    await page.click('.page-card[data-i="1"]');
    await page.click('#open-page-btn');
    await waitDoc(page);
    const d = await page.evaluate(() => ({ i: window.__plantint.S.doc.pageIndex, dpi: window.__plantint.S.doc.dpi, W: window.__plantint.S.doc.W, scale: window.__plantint.S.doc.scale }));
    check(d.i === 1 && d.dpi >= 300, `page 2 opened at ${d.dpi} dpi (${d.W} px wide); scale read as 1:${d.scale}`, R);
  } catch (e) { check(false, 'pages: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

// ---------------------------------------------------------------- picture at full resolution
{
  const { app, page, errors } = await launch(DATA + '/scan_2pages.tif');
  try {
    await page.waitForSelector('.page-card', { timeout: 30000 });
    await page.click('#open-page-btn');
    await waitDoc(page);
    const d = await page.evaluate(() => ({ W: window.__plantint.S.doc.W, H: window.__plantint.S.doc.H, dpi: window.__plantint.S.doc.dpi }));
    check(d.W === 3308 && d.H === 2339 && d.dpi === 200, `TIFF page opens at its own size and resolution (${d.W} × ${d.H}, ${d.dpi} dpi)`, R);
  } catch (e) { check(false, 'tiff: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

// ---------------------------------------------------------------- tools and editing
{
  const { app, page, errors } = await launch(DATA + '/plan_A3_single.pdf');
  try {
    await waitDoc(page);
    // fill
    await page.keyboard.press('f');
    await clickSheet(page, ...P(10.5, 7.6));
    await waitMarkups(page, 1);
    let ms = await M(page);
    check(ms[0].name === 'LIVING ROOM', `fill names the area from its label (${ms[0].name})`, R);
    // double-click on a fill must not change its opacity
    await page.keyboard.press('s');
    const op0 = ms[0].opacity;
    const lc = await toClient(page, ...P(10.5, 7.6));
    await page.mouse.dblclick(lc.x, lc.y);
    await page.waitForTimeout(250);
    ms = await M(page);
    check(ms[0].opacity === op0, `double-click on a fill keeps its opacity (${ms[0].opacity})`, R);
    // polygon with edge locks: H, V and close with Enter
    await page.keyboard.press('Escape');
    await page.keyboard.press('p');
    const A = P(0.8, 4.0);
    await clickSheet(page, ...A, { modifiers: ['Control'] });
    await page.keyboard.press('h');
    await clickSheet(page, ...P(3.8, 3.7), { modifiers: ['Control'] });
    await page.keyboard.press('v');
    await clickSheet(page, ...P(3.6, 1.0), { modifiers: ['Control'] });
    await clickSheet(page, ...P(0.8, 1.0), { modifiers: ['Control'] });
    await page.keyboard.press('Enter');
    await waitMarkups(page, 2);
    ms = await M(page);
    const ring = ms[1].rings[0];
    check(Math.abs(ring[1] - ring[3]) < 0.01, 'H locks the next edge horizontal', R);
    check(Math.abs(ring[2] - ring[4]) < 0.01, 'V locks the next edge vertical', R);
    // pick colour from the sheet (I): kitchen paint
    await page.keyboard.press('i');
    await clickSheet(page, ...P(2.2, 5.5));
    await page.waitForTimeout(250);
    const picked = await page.evaluate(() => window.__plantint.S.style.color);
    check(picked === '#FFF0A8' || /^#FF[EF]/.test(picked), `picking a colour from the sheet sets the next colour (${picked})`, R);
    // rectangle in that colour
    await page.keyboard.press('r');
    await clickSheet(page, ...P(5.0, 2.6), { modifiers: ['Control'] });
    await clickSheet(page, ...P(6.2, 1.2), { modifiers: ['Control'] });
    await waitMarkups(page, 3);
    ms = await M(page);
    check(ms[2].color === picked, 'the next markup uses the picked colour', R);
    // selection: click, shift-add, ctrl-toggle, range in the list
    await page.keyboard.press('s');
    await page.click('.mk-row:nth-child(1) .mk-name');
    await page.click('.mk-row:nth-child(3) .mk-name', { modifiers: ['Shift'] });
    check((await SEL(page)).length === 3, 'Shift+click in the list selects a range', R);
    await page.click('.mk-row:nth-child(2) .mk-name', { modifiers: ['Control'] });
    check((await SEL(page)).length === 2, 'Ctrl+click removes one from the selection', R);
    // border thickness only for the selected markup
    await page.click('.mk-row:nth-child(2) .mk-name');
    await setRange(page, '#bd-range', 2.5);
    ms = await M(page);
    check(ms[1].borderPt === 2.5 && ms[0].borderPt === 0 && ms[2].borderPt === 0, 'border thickness changes only the selected markup', R);
    // move two markups at once by dragging one of them
    await page.click('.mk-row:nth-child(2) .mk-name');
    await page.click('.mk-row:nth-child(3) .mk-name', { modifiers: ['Shift'] });
    const b0 = bb(ms[1].rings), c0 = bb(ms[2].rings);
    const from = await toClient(page, (c0[0] + c0[2]) / 2, (c0[1] + c0[3]) / 2);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 25, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    ms = await M(page);
    const b1 = bb(ms[1].rings), c1 = bb(ms[2].rings);
    check(Math.abs((b1[0] - b0[0]) - (c1[0] - c0[0])) < 0.01 && b1[0] - b0[0] > 10, `dragging moves all selected markups together (+${Math.round(b1[0] - b0[0])} px)`, R);
    // drag a polygon corner (Ctrl: no snapping)
    await page.click('.mk-row:nth-child(2) .mk-name');
    ms = await M(page);
    const v = [ms[1].rings[0][0], ms[1].rings[0][1]];
    const vc = await toClient(page, ...v);
    await page.mouse.move(vc.x, vc.y); await page.mouse.down();
    await page.keyboard.down('Control'); // Ctrl while dragging: no snapping
    await page.mouse.move(vc.x - 30, vc.y - 20, { steps: 5 }); await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    ms = await M(page);
    check(ms[1].rings[0][0] < v[0] - 20 && ms[1].rings[0][1] < v[1] - 10, 'dragging a corner reshapes the polygon', R);
    // rename with the pen; the name survives a colour change
    await page.hover('.mk-row:nth-child(1)');
    await page.click('.mk-row:nth-child(1) .mk-btn.pen');
    await page.fill('.mk-input', 'Open-plan living');
    await page.keyboard.press('Enter');
    await page.click('.mk-row:nth-child(1) .mk-name');
    await page.click('.sw[data-hex="#57CC99"]');
    ms = await M(page);
    check(ms[0].name === 'Open-plan living' && ms[0].color === '#57CC99', `renamed with the pen; the name survives a colour change (${ms[0].name}, ${ms[0].color})`, R);
    // band selection (left to right: fully inside)
    await page.keyboard.press('Escape');
    const t1 = await toClient(page, ...P(-0.5, 4.6)), t2 = await toClient(page, ...P(7.0, 0.1));
    await page.mouse.move(t1.x, t1.y); await page.mouse.down(); await page.mouse.move(t2.x, t2.y, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const sel = await SEL(page);
    check(sel.length === 2, `dragging a box selects the markups inside it (${sel.length})`, R);
    // legend: on, move, resize, text sizes
    await page.keyboard.press('Escape');
    await page.keyboard.press('l');
    await page.waitForTimeout(300);
    const L0 = await page.evaluate(() => ({ ...window.__plantint.S.legend }));
    const lr = await page.evaluate(() => window.__plantint.legendRect());
    const lp = await toClient(page, (lr[0] + lr[2]) / 2, (lr[1] + lr[3]) / 2);
    await page.mouse.move(lp.x, lp.y); await page.mouse.down(); await page.mouse.move(lp.x - 120, lp.y + 60, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const L1 = await page.evaluate(() => ({ ...window.__plantint.S.legend }));
    check(L1.x < L0.x - 100 && L1.y > L0.y + 40, 'the legend moves by dragging', R);
    await page.click('button[aria-label="Larger Column titles"]');
    await page.click('button[aria-label="Larger Names"]');
    await page.click('button[aria-label="Larger Names"]');
    const L2 = await page.evaluate(() => ({ ...window.__plantint.S.legend }));
    check(L2.titlePx > L1.titlePx && L2.namePx > L1.namePx, 'title and name sizes change separately', R);
    const lr2 = await page.evaluate(() => window.__plantint.legendRect());
    const hc = await toClient(page, lr2[2], lr2[3]);
    await page.mouse.move(hc.x + 3, hc.y + 3); await page.mouse.down(); await page.mouse.move(hc.x + 80, hc.y + 50, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const L3 = await page.evaluate(() => ({ ...window.__plantint.S.legend }));
    check(L3.namePx > L2.namePx, 'dragging the legend corner resizes it', R);
    const rows = await page.evaluate(() => window.__plantint.legendRect && document.querySelectorAll('.mk-row').length);
    check(rows === 3, 'legend lists the markups', R);
    // undo / redo walk back several steps
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const L4 = await page.evaluate(() => ({ ...window.__plantint.S.legend }));
    check(Math.abs(L4.namePx - L1.namePx) < 0.01, 'undo steps back through legend changes', R);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+y');
    await page.waitForTimeout(300);
    await shot(page, 't0_tools');
    // crash recovery copy
    await page.evaluate(() => window.__plantint.writeRecovery());
    check(fs.existsSync(RECOVERY_DIR) && fs.readdirSync(RECOVERY_DIR).some((n) => n.endsWith('.plantint')), 'a recovery copy is written while work is unsaved', R);
    // kill without closing
    app.process().kill('SIGKILL');
  } catch (e) { check(false, 'tools: ' + e.stack, R); await shot(page, 't0_err'); await quit(app); }
  allErrors = allErrors.concat(errors);
}

// ---------------------------------------------------------------- recovery after a crash, then the exit questions
{
  const { app, page, errors } = await launch(null, { clearRecovery: false });
  try {
    await page.waitForSelector('.modal-title:text("Restore unsaved marking?")', { timeout: 30000 });
    check(true, 'after a crash PlanTint offers to restore the unsaved marking', R);
    await page.click('.modal .btn.primary');
    await waitDoc(page);
    const n = await page.evaluate(() => window.__plantint.S.markups.length);
    check(n === 3, `restored ${n} markups`, R);
    // close: asks to save; "Don't save" closes
    const closed = new Promise((res) => app.process().once('exit', () => res(true)));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.waitForSelector('.modal-title', { timeout: 10000 });
    const t = await page.textContent('.modal-title');
    check(/Save changes/.test(t) && /closing/.test(t), `closing asks to save ("${t}")`, R);
    await page.click('.modal .btn:text("Don’t save")');
    check(await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 10000))]), '“Don’t save” closes PlanTint', R);
  } catch (e) { check(false, 'recovery/exit: ' + e.stack, R); await quit(app); }
  allErrors = allErrors.concat(errors);
}
{
  // close with "Save…": asks the type and the place, saves, then closes
  const { app, page, errors } = await launch(DATA + '/plan_A3_single.pdf');
  try {
    await waitDoc(page);
    await page.keyboard.press('f');
    await clickSheet(page, ...P(10.5, 7.6));
    await waitMarkups(page, 1);
    const proj = OUT + '/t0_exit.plantint';
    fs.rmSync(proj, { force: true });
    await stubSave(app, proj);
    const closed = new Promise((res) => app.process().once('exit', () => res(true)));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.waitForSelector('.modal-title');
    await page.click('.modal .btn.primary'); // Save…
    await page.waitForSelector('.save-type');
    const types = await page.$$eval('.save-type', (b) => b.map((x) => x.getAttribute('data-id')));
    check(types.join(',') === 'plantint,pdf,pdfflat,png,jpg', `save asks the file type (${types.join(', ')})`, R);
    await page.click('.save-type[data-id="plantint"]');
    await page.click('.modal .btn.primary');
    const ok = await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 20000))]);
    check(ok && fs.existsSync(proj), '“Save…” writes the project and then closes', R);
  } catch (e) { check(false, 'exit-save: ' + e.stack, R); await quit(app); }
  allErrors = allErrors.concat(errors);
}
process.exit(summary(R, allErrors) ? 0 : 1);
