// Issue 1: highlights must be in exported PDFs. Builds a realistic marked sheet in the app and saves every type.
import { launch, waitDoc, shot, check, summary, planPt, clickSheet, waitMarkups, saveVia, setRange, quit, OUT, DATA } from './lib.mjs';
import fs from 'fs';

const R = [];
const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
try {
  await waitDoc(page);
  // 1) fill the living room (default yellow, 45%)
  await page.keyboard.press('f');
  let [x, y] = await planPt(page, 10.5, 7.6);
  await clickSheet(page, x, y);
  await waitMarkups(page, 1);
  // 2) a rectangle in bedroom 1, blue, 2 pt dashed border
  await page.keyboard.press('r');
  [x, y] = await planPt(page, 0.7, 4.2);
  await clickSheet(page, x, y, { modifiers: [] });
  const [x2, y2] = await planPt(page, 3.9, 1.0);
  await clickSheet(page, x2, y2);
  await waitMarkups(page, 2);
  await page.click('.mk-row:nth-child(2) .mk-name');
  await page.fill('#hex-input', '#3FA7E0');
  await page.press('#hex-input', 'Enter');
  await setRange(page, '#bd-range', 2);
  await page.click('.seg-line[data-style="dashed"]');
  const m2 = await page.evaluate(() => window.__plantint.S.markups[1]);
  await page.keyboard.press('Escape');
  check(m2.color === '#3FA7E0' && m2.borderPt === 2 && m2.borderStyle === 'dashed', `rectangle styled blue, 2 pt, dashed (${m2.color}, ${m2.borderPt}, ${m2.borderStyle})`, R);
  // 3) painted colour -> markups (lifts colour out of the vector drawing)
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await page.waitForSelector('.det-panel .btn.primary:not([disabled])', { timeout: 60000 });
  const groups = await page.$$eval('.det-row', (rs) => rs.map((r) => r.textContent));
  console.log('painted groups:', groups.join(' | '));
  await page.click('.det-panel .btn.primary');
  await page.waitForFunction(() => !document.querySelector('.det-panel') && window.__plantint.S.rasterOps.length === 1, null, { timeout: 60000 });
  const n = await page.evaluate(() => window.__plantint.S.markups.length);
  check(n >= 6, `painted colour became markups (${n} markups in total)`, R);
  // 4) legend on
  await page.keyboard.press('l');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__plantint.hooks.toggleLegend(true));
  await shot(page, 't1_marked');
  // 5) save every type
  const files = { vector: OUT + '/t1_vector.pdf', flat: OUT + '/t1_flat.pdf', png: OUT + '/t1.png' };
  let sz = await saveVia(app, page, 'Save as PDF…', files.vector);
  check(sz > 5000, `vector PDF written (${sz} bytes)`, R);
  sz = await saveVia(app, page, 'Save as flattened PDF…', files.flat);
  check(sz > 5000, `flattened PDF written (${sz} bytes)`, R);
  sz = await saveVia(app, page, 'Save as PNG picture…', files.png);
  check(sz > 5000, `PNG written (${sz} bytes)`, R);
  fs.writeFileSync(OUT + '/t1_markups.json', JSON.stringify(await page.evaluate(() => ({ doc: { W: window.__plantint.S.doc.W, H: window.__plantint.S.doc.H, dpi: window.__plantint.S.doc.dpi }, markups: window.__plantint.S.markups, legend: window.__plantint.S.legend }))));
} catch (e) {
  check(false, 'exception: ' + e.message, R);
  await shot(page, 't1_err');
}
const ok = summary(R, errors);
await quit(app);
process.exit(ok ? 0 : 1);
