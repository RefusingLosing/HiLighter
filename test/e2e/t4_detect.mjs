// Issue 4: "Find painted colour" — finds pale tints, keeps close shades apart, hatching, picking
// a colour (greys too), leaving areas out, one markup per area or per colour, names, lifting the
// paint out of the drawing with undo, and speed on a heavy A1 sheet.
import { launch, waitDoc, shot, check, summary, clickSheet, waitMarkups, quit, DATA } from './lib.mjs';

const R = [];
let allErrors = [];
const px = (mm) => (mm * 400) / 25.4;
// plan metres -> sheet px box [x0, y0, x1, y1] (A3, 400 dpi)
const box = (a, b, c, d) => [px(45 + 20 * a), px(297 - (70 + 20 * d)), px(45 + 20 * b), px(297 - (70 + 20 * c))];
const iou = (p, q) => {
  const ix = Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0])), iy = Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]));
  const I = ix * iy, U = (p[2] - p[0]) * (p[3] - p[1]) + (q[2] - q[0]) * (q[3] - q[1]) - I;
  return I / U;
};
const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

async function openD(page) {
  await page.keyboard.press('d');
  await page.waitForSelector('.det-panel');
  return waitRun(page);
}
async function waitRun(page) {
  await page.waitForFunction(() => { const p = document.querySelector('.det-panel'); return p && !p.querySelector('.fp-body .busy-bar'); }, null, { timeout: 120000 });
  await page.waitForTimeout(100);
  return page.evaluate(() => window.__plantint.T.detectPreview || []);
}
const groupsInfo = (page) => page.evaluate(() => [...document.querySelectorAll('.det-row')].map((r) => ({ key: +r.getAttribute('data-key'), name: r.querySelector('.det-name').textContent, meta: r.querySelector('.det-meta').textContent, sw: getComputedStyle(r.querySelector('.det-sw')).backgroundColor })));
const rgbOf = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
const sample = (page, x, y) => page.evaluate(([x, y]) => window.__plantint.engine.call('sample', { x, y }), [x, y]);
const optBtn = (page, label) => page.click(`.det-opts .seg:text-is("${label}")`);
const convertLabel = (page) => page.textContent('.det-panel .btn.primary');

// ---------------------------------------------------------------- plan with painted zones
{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    const t0 = Date.now();
    let prev = await openD(page);
    const secs = (Date.now() - t0) / 1000;
    const rows = await groupsInfo(page);
    console.log('  found:', rows.map((r) => `${r.name} [${r.meta}]`).join(' | '), `(${secs.toFixed(1)} s)`);
    const want = {
      kitchen: ['#FFF0A8', box(0.3, 4.4, 4.6, 8.2)], bedroom1: ['#EAF2FB', box(0.3, 4.4, 0.3, 4.6)], corridor: ['#CDEBC5', box(4.4, 9.0, 3.0, 5.2)],
      bedroom2: ['#A9DB9C', box(6.6, 9.0, 0.3, 3.0)], bath: ['#BFE3F5', box(9.0, 11.7, 0.3, 3.0)],
    };
    const regs = await page.evaluate(() => window.__plantint.T.detectPreview.map((r) => ({ rid: r.rid, rings: r.rings })));
    const bboxOf = (rings) => { const b = [1e9, 1e9, -1e9, -1e9]; for (const r of rings) for (let i = 0; i < r.length; i += 2) { b[0] = Math.min(b[0], r[i]); b[2] = Math.max(b[2], r[i]); b[1] = Math.min(b[1], r[i + 1]); b[3] = Math.max(b[3], r[i + 1]); } return b; };
    for (const [name, [hx, bx]] of Object.entries(want)) {
      const best = regs.map((r) => iou(bboxOf(r.rings), bx)).sort((a, b) => b - a)[0] || 0;
      const col = rows.map((r) => cdist(rgbOf(r.sw), hex(hx))).sort((a, b) => a - b)[0];
      check(best > 0.85 && col < 16, `${name}: found as its own colour (${hx}, nearest ${col.toFixed(0)}) with the right outline (IoU ${best.toFixed(2)})`, R);
    }
    check(!rows.some((r) => { const c = rgbOf(r.sw); return Math.max(...c) - Math.min(...c) < 10 && Math.max(...c) < 120; }), 'walls and line work are not taken for paint', R);
    check(secs < 15, `search took ${secs.toFixed(1)} s on an A3 sheet at 400 dpi`, R);
    // hatching
    await page.click('.det-opts input[type=checkbox]');
    prev = await waitRun(page);
    const rowsH = await groupsInfo(page);
    const hb = box(9.12, 11.7, 3.12, 5.2);
    const hreg = prev.map((r) => iou(bboxOf(r.rings), hb)).sort((a, b) => b - a)[0] || 0;
    check(rowsH.some((r) => /hatched/.test(r.meta)) && hreg > 0.75, `hatching on: the orange hatched zone is found (IoU ${hreg.toFixed(2)})`, R);
    await shot(page, 't4_preview');
    // leave bedroom 1 out by clicking it on the sheet
    const before = await convertLabel(page);
    const c1 = centre(want.bedroom1[1]);
    await clickSheet(page, c1[0] + 300, c1[1] + 200);
    await page.waitForTimeout(150);
    const after = await convertLabel(page);
    const n0 = +before.match(/\d+/)[0], n1 = +after.match(/\d+/)[0];
    check(n1 === n0 - 1, `clicking an outlined area leaves it out (${before} → ${after})`, R);
    // one markup per colour
    await optBtn(page, 'One per colour');
    const perColour = await convertLabel(page);
    check(+perColour.match(/\d+/)[0] <= n1 && +perColour.match(/\d+/)[0] >= 5, `one per colour: ${perColour}`, R);
    await optBtn(page, 'One per area');
    // strict / loose both run
    await optBtn(page, 'Strict'); await waitRun(page);
    const strict = (await groupsInfo(page)).length;
    await optBtn(page, 'Loose'); await waitRun(page);
    const loose = (await groupsInfo(page)).length;
    check(strict >= loose && loose >= 4, `colour match: strict finds ${strict} colours, loose ${loose}`, R);
    await optBtn(page, 'Normal'); await waitRun(page);
    // bedroom 1 off again (options re-ran the search), then convert
    await clickSheet(page, c1[0] + 300, c1[1] + 200);
    await page.waitForTimeout(150);
    const yk = centre(want.kitchen[1]);
    const kBefore = await sample(page, yk[0] + 250, yk[1] + 300);
    await page.click('.det-panel .btn.primary');
    await page.waitForFunction(() => !document.querySelector('.det-panel'), null, { timeout: 60000 });
    await page.waitForTimeout(400);
    const ms = await page.evaluate(() => window.__plantint.S.markups.map((m) => ({ name: m.name, color: m.color, op: m.opacity, kind: m.kind })));
    console.log('  made:', ms.map((m) => `${m.name} ${m.color}`).join(', '));
    const names = ms.map((m) => m.name);
    check(['KITCHEN', 'CORRIDOR', 'BEDROOM 2', 'BATH'].every((n) => names.includes(n)) && !names.includes('BEDROOM 1'), 'markups named from the room labels; the left-out area made none', R);
    const hatchM = ms.filter((m) => cdist(hex(m.color), hex('#E8590C')) < 20 && m.op < 1);
    check(ms.every((m) => m.kind === 'painted') && ms.filter((m) => m.op === 1).length === ms.length - 1, 'painted markups recreate solid paint at full strength', R);
    check(hatchM.length === 1 && hatchM[0].op === 0.45, `the hatched zone becomes a see-through highlight (${hatchM.map((m) => m.name + ' ' + m.op)})`, R);
    const kAfter = await sample(page, yk[0] + 250, yk[1] + 300);
    const b1 = await sample(page, c1[0] + 300, c1[1] + 200);
    check(Math.min(...kAfter) > 245 && Math.min(...kBefore) < 200, `kitchen paint lifted out of the drawing (${kBefore} → ${kAfter})`, R);
    check(cdist(b1, hex('#EAF2FB')) < 12, `bedroom 1 (left out) keeps its paint (${b1})`, R);
    await shot(page, 't4_converted');
    // deleting a painted markup: its colour stays out of the drawing; undo brings the markup back
    await page.click('.mk-row:has(.mk-name:text-is("KITCHEN")) .mk-name');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    const k2 = await sample(page, yk[0] + 250, yk[1] + 300);
    const n2 = await page.evaluate(() => window.__plantint.S.markups.length);
    check(n2 === ms.length - 1 && Math.min(...k2) > 245, 'deleting the KITCHEN markup removes its colour from the sheet (lines and paper stay)', R);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    check((await page.evaluate(() => window.__plantint.S.markups.length)) === ms.length, 'undo brings the markup back', R);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(600);
    const k3 = await sample(page, yk[0] + 250, yk[1] + 300);
    const n3 = await page.evaluate(() => window.__plantint.S.markups.length);
    check(n3 === 0 && cdist(k3, kBefore) < 6, `undoing the conversion puts the paint back into the drawing (${k3})`, R);
    await page.keyboard.press('Control+y'); await page.waitForTimeout(600);
    const k4 = await sample(page, yk[0] + 250, yk[1] + 300);
    check(Math.min(...k4) > 245 && (await page.evaluate(() => window.__plantint.S.markups.length)) === ms.length, 'redo lifts it again', R);
  } catch (e) { check(false, 'zones: ' + e.stack, R); await shot(page, 't4_err'); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

// ---------------------------------------------------------------- greys and coloured text
{
  const { app, page, errors } = await launch(DATA + '/plan_grey.pdf');
  try {
    await waitDoc(page);
    await openD(page);
    const rows = await groupsInfo(page);
    console.log('  grey plan, auto:', rows.map((r) => `${r.name} [${r.meta}]`).join(' | '));
    check(rows.some((r) => cdist(rgbOf(r.sw), hex('#FFE08A')) < 16), 'yellow kitchen found', R);
    check(!rows.some((r) => cdist(rgbOf(r.sw), hex('#1F5FBF')) < 40), 'blue text inside the kitchen is not taken for a painted area', R);
    check(!rows.some((r) => { const c = rgbOf(r.sw); return Math.max(...c) - Math.min(...c) < 8; }), 'greys are not picked up automatically (they would catch walls and poché)', R);
    // pick the light grey and the mid grey
    const lg = centre(box(6.6, 9.0, 0.3, 3.0)), mg = centre(box(9.0, 11.7, 0.3, 3.0));
    const nRows = () => page.evaluate(() => document.querySelectorAll('.det-row').length);
    const pickAt = async (x, y) => {
      const n = await nRows();
      await page.click('.det-pick');
      await clickSheet(page, x, y);
      await page.waitForFunction((n) => document.querySelectorAll('.det-row').length > n, n, { timeout: 60000 });
      await waitRun(page);
    };
    await pickAt(lg[0] - 150, lg[1] + 120);
    await pickAt(mg[0] + 160, mg[1] - 200);
    const rows2 = await groupsInfo(page);
    console.log('  after picking greys:', rows2.map((r) => `${r.name} [${r.meta}]`).join(' | '));
    const picked = rows2.filter((r) => /picked/.test(r.name));
    check(picked.length === 2, `both picked greys are listed (${picked.map((r) => r.name).join(', ')})`, R);
    await shot(page, 't4_grey');
    await page.click('.det-panel .btn.primary');
    await page.waitForFunction(() => !document.querySelector('.det-panel'), null, { timeout: 60000 });
    await page.waitForTimeout(300);
    const s1 = await sample(page, lg[0] - 150, lg[1] + 120), s2 = await sample(page, mg[0] + 160, mg[1] - 200);
    check(Math.min(...s1) > 245 && Math.min(...s2) > 245, `grey zones lifted (${s1} / ${s2})`, R);
    const wall = await sample(page, px(45 + 20 * 9.0 + 1.2), px(297 - 70 - 20 * 0.6));
    check(Math.max(...wall) < 100, `walls next to the grey zones are untouched (${wall})`, R);
    const names = await page.evaluate(() => window.__plantint.S.markups.map((m) => m.name));
    check(names.includes('BEDROOM 2') && names.includes('BATH'), `grey markups named ${names.join(', ')}`, R);
  } catch (e) { check(false, 'grey: ' + e.stack, R); await shot(page, 't4_grey_err'); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

// ---------------------------------------------------------------- a scan (JPEG, slightly turned) and a 1-bit scan
{
  const { app, page, errors } = await launch(DATA + '/scan_plan.jpg');
  try {
    await waitDoc(page);
    await openD(page);
    const rows = await groupsInfo(page);
    console.log('  scan:', rows.map((r) => `${r.name} [${r.meta}]`).join(' | '));
    const wantCols = ['#FFF0A8', '#EAF2FB', '#CDEBC5', '#A9DB9C', '#BFE3F5'];
    const hits = wantCols.filter((hx) => rows.some((r) => cdist(rgbOf(r.sw), hex(hx)) < 22));
    check(hits.length === 5, `JPEG scan: all five painted rooms found (${hits.length}/5)`, R);
  } catch (e) { check(false, 'scan: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}
{
  const { app, page, errors } = await launch(DATA + '/bilevel_g4.tif');
  try {
    await waitDoc(page);
    await openD(page);
    const title = await page.textContent('.det-panel .fp-title');
    check(/No painted colour/.test(title), `black-and-white scan: "${title}"`, R);
  } catch (e) { check(false, 'g4: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

// ---------------------------------------------------------------- speed on a heavy A1 sheet
{
  const { app, page, errors } = await launch(DATA + '/heavy_A1.pdf');
  try {
    await waitDoc(page, 180000);
    const d = await page.evaluate(() => ({ W: window.__plantint.S.doc.W, H: window.__plantint.S.doc.H }));
    const t0 = Date.now();
    await openD(page);
    const secs = (Date.now() - t0) / 1000;
    const rows = await groupsInfo(page);
    check(secs < 30 && rows.length >= 1, `heavy A1 (${d.W} × ${d.H} px): ${rows.length} colour(s) in ${secs.toFixed(1)} s`, R);
  } catch (e) { check(false, 'heavy: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}
process.exit(summary(R, allErrors) ? 0 : 1);
