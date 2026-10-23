// Issue 3: border line style (not only thickness), on screen, in the legend, in every export,
// with undo and in saved projects.
import { launch, waitDoc, shot, check, summary, planPt, clickSheet, waitMarkups, saveVia, setRange, quit, stubSave, OUT, DATA } from './lib.mjs';
import fs from 'fs';
import { execFileSync } from 'child_process';

const R = [];
const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
const sel = () => page.evaluate(() => window.__plantint.S.markups.map((m) => ({ id: m.id, st: m.borderStyle, pt: m.borderPt })));
try {
  await waitDoc(page);
  // two rectangles
  await page.keyboard.press('r');
  for (const [a, b] of [[[0.6, 4.2], [4.1, 0.5]], [[4.7, 7.9], [8.8, 5.5]]]) {
    let [x, y] = await planPt(page, ...a); await clickSheet(page, x, y, { modifiers: ['Control'] });
    [x, y] = await planPt(page, ...b); await clickSheet(page, x, y, { modifiers: ['Control'] });
  }
  await waitMarkups(page, 2);
  await page.keyboard.press('s');
  await page.click('.mk-row:nth-child(1) .mk-name');
  // picking a style on a borderless markup gives it a visible border
  await page.click('.seg-line[data-style="dashed"]');
  let ms = await sel();
  check(ms[0].st === 'dashed' && ms[0].pt === 1.5, `dashed on a borderless markup gives a 1.5 pt dashed border (${ms[0].st}, ${ms[0].pt} pt)`, R);
  check(ms[1].st === 'solid' && ms[1].pt === 0, 'only the selected markup changed', R);
  const onBtn = await page.$eval('.seg-line.on', (b) => b.getAttribute('data-style'));
  check(onBtn === 'dashed', 'the line style control shows the selected markup’s style', R);
  const chipDash = await page.$eval('#chip-border', (el) => el.innerHTML);
  check(/stroke-dasharray/.test(chipDash), 'the preview chip draws the dashes', R);
  // every style, thicker border
  await setRange(page, '#bd-range', 3);
  for (const st of ['solid', 'short', 'dotted', 'dashdot', 'dashdotdot', 'dashed']) {
    await page.click(`.seg-line[data-style="${st}"]`);
    ms = await sel();
    check(ms[0].st === st && ms[0].pt === 3, `style ${st} applied (keeps 3 pt)`, R);
    if (st === 'dotted') await shot(page, 't3_dotted');
  }
  // undo / redo of a style change
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  ms = await sel();
  check(ms[0].st === 'dashdotdot', `undo restores the previous style (${ms[0].st})`, R);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(150);
  ms = await sel();
  check(ms[0].st === 'dashed', 'redo applies it again', R);
  // both selected: one click styles both
  await page.click('.mk-row:nth-child(2) .mk-name', { modifiers: ['Shift'] });
  await page.click('.seg-line[data-style="dashdot"]');
  ms = await sel();
  check(ms.every((m) => m.st === 'dashdot') && ms[1].pt === 1.5 && ms[0].pt === 3, 'multi-selection: both get dash-dot, the borderless one gets 1.5 pt', R);
  // screen: the border on the canvas really is broken into dashes
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const runs = await page.evaluate(() => {
    const { S, V } = window.__plantint;
    const m = S.markups[0];
    const r = m.rings[0];
    const x0 = Math.min(r[0], r[2], r[4], r[6]), x1 = Math.max(r[0], r[2], r[4], r[6]), y0 = Math.min(r[1], r[3], r[5], r[7]);
    const sc = document.getElementById('scene').getContext('2d');
    const uc = document.getElementById('ui').getContext('2d');
    const yy = Math.round(y0 * V.scale + V.ty);
    const a = Math.round(x0 * V.scale + V.tx) + 6, b = Math.round(x1 * V.scale + V.tx) - 6;
    // sample the top edge on the scene canvas
    const d = sc.getImageData(a, yy - 1, b - a, 3).data;
    const w = b - a;
    let dark = [], changes = 0;
    for (let x = 0; x < w; x++) {
      let mn = 765;
      for (let k = 0; k < 3; k++) { const i = (k * w + x) * 4; mn = Math.min(mn, d[i] + d[i + 1] + d[i + 2]); }
      dark.push(mn < 450);
    }
    for (let x = 1; x < w; x++) if (dark[x] !== dark[x - 1]) changes++;
    return { changes, darkShare: dark.filter(Boolean).length / w };
  });
  check(runs.changes >= 8 && runs.darkShare > 0.3 && runs.darkShare < 0.95, `screen border is dashed (${runs.changes} breaks, ${Math.round(runs.darkShare * 100)}% inked)`, R);
  // legend shows the style
  await page.evaluate(() => window.__plantint.hooks.toggleLegend(true));
  await page.waitForTimeout(300);
  await shot(page, 't3_legend');
  // exports
  const png = OUT + '/t3.png', pdf = OUT + '/t3.pdf';
  await saveVia(app, page, 'Save as PNG picture…', png);
  await saveVia(app, page, 'Save as PDF…', pdf);
  const pdfText = execFileSync('qpdf', ['--qdf', '--object-streams=disable', pdf, '-'], { maxBuffer: 1 << 30 }).toString('latin1');
  check(/\[[\d. ]+\] 0 d/.test(pdfText), 'the PDF strokes the border with a dash pattern', R);
  // project round trip
  const proj = OUT + '/t3.plantint';
  fs.rmSync(proj, { force: true });
  await stubSave(app, proj);
  await page.keyboard.press('Control+Shift+S');
  await page.waitForSelector('.save-type[data-id="plantint"]');
  await page.click('.save-type[data-id="plantint"]');
  await page.click('.modal .btn.primary');
  for (let i = 0; i < 100 && !fs.existsSync(proj); i++) await page.waitForTimeout(100);
  check(fs.existsSync(proj), 'project saved', R);
} catch (e) {
  check(false, 'exception: ' + e.stack, R);
  await shot(page, 't3_err');
}
let ok = summary(R, errors);
await quit(app);
// reopen the project: styles come back
const R2 = [];
const s2 = await launch(OUT + '/t3.plantint');
try {
  await waitDoc(s2.page);
  const ms = await s2.page.evaluate(() => window.__plantint.S.markups.map((m) => [m.borderStyle, m.borderPt]));
  check(JSON.stringify(ms) === JSON.stringify([['dashdot', 3], ['dashdot', 1.5]]), `reopened project keeps line styles ${JSON.stringify(ms)}`, R2);
} catch (e) { check(false, 'reopen: ' + e.message, R2); }
ok = summary(R2, s2.errors) && ok;
await quit(s2.app);
process.exit(ok ? 0 : 1);
