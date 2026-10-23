// Issue 1, other kinds of drawings: rotated and cropped PDFs, a JPEG scan and a 1-bit TIFF.
// Each gets a fill, a polygon with a dotted border and the legend, then every export type.
import { launch, waitDoc, shot, check, summary, clickSheet, waitMarkups, saveVia, setRange, quit, OUT, DATA } from './lib.mjs';

const R = [];
const sources = [
  ['plan_rotated.pdf', 'rot', 90], ['plan_cropped.pdf', 'crop', 0], ['scan_plan.jpg', 'jpg', 0], ['bilevel_g4.tif', 'g4', 0], ['plan_layers.pdf', 'layers', 0],
];
let allErrors = [];
for (const [file, tag, rot] of sources) {
  const { app, page, errors } = await launch(DATA + '/' + file);
  try {
    await waitDoc(page);
    const d = await page.evaluate(() => { const d = window.__plantint.S.doc; return { W: d.W, H: d.H, dpi: d.dpi }; });
    // plan metres -> sheet px; the cropped sheet starts 30 mm, 40 mm into the page (see make_plans.py)
    const mm = (v) => (v * d.dpi) / 25.4;
    const crop = tag === 'crop' ? [30, 40] : [0, 0];
    const at = (mx, my) => {
      const xmm = 45 + mx * 20 - crop[0], ymm = 70 + my * 20 - crop[1];
      if (rot === 90) return [d.W - mm(ymm), mm(xmm)]; // page turned a quarter clockwise
      const pageH = tag === 'crop' ? 250 : 297;
      return [mm(xmm), mm(pageH - ymm)];
    };
    await page.keyboard.press('f');
    let [x, y] = at(10.5, 7.6);
    await clickSheet(page, x, y);
    await waitMarkups(page, 1);
    await page.keyboard.press('p');
    for (const [mx, my] of [[0.6, 4.0], [3.8, 4.0], [3.8, 1.2], [0.6, 1.2]]) { [x, y] = at(mx, my); await clickSheet(page, x, y, { modifiers: ['Control'] }); }
    await page.keyboard.press('Enter');
    await waitMarkups(page, 2);
    await page.click('.mk-row:nth-child(2) .mk-name');
    await page.fill('#hex-input', '#E8590C');
    await page.press('#hex-input', 'Enter');
    await page.click('.seg-line[data-style="dotted"]');
    await setRange(page, '#bd-range', 3);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__plantint.hooks.toggleLegend(true));
    await page.waitForTimeout(300);
    await shot(page, `t1b_${tag}_screen`);
    for (const [label, ext] of [['Save as PDF…', '_vector.pdf'], ['Save as flattened PDF…', '_flat.pdf'], ['Save as PNG picture…', '.png']]) {
      const sz = await saveVia(app, page, label, `${OUT}/t1b_${tag}${ext}`);
      check(sz > 3000, `${file}: ${label.replace('Save as ', '').replace('…', '')} written (${sz} bytes)`, R);
    }
  } catch (e) {
    check(false, `${file}: exception ${e.message}`, R);
    await shot(page, `t1b_${tag}_err`);
  }
  allErrors = allErrors.concat(errors.map((e) => file + ': ' + e));
  await quit(app);
}
process.exit(summary(R, allErrors) ? 0 : 1);
