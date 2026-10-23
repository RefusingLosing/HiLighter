// Issue 5: the eraser removes colour that is already in an imported drawing (brush and whole
// area), keeps lines and paper, can be limited to highlights or to drawing colour, undoes in one
// step, and the result survives export and the project file.
import { launch, waitDoc, shot, check, summary, clickSheet, toClient, waitMarkups, saveVia, stubSave, quit, OUT, DATA } from './lib.mjs';
import fs from 'fs';
import { execFileSync } from 'child_process';

const R = [];
let allErrors = [];
const px = (mm) => (mm * 400) / 25.4;
const P = (mx, my) => [px(45 + 20 * mx), px(297 - (70 + 20 * my))]; // plan metres -> sheet px
const sample = (page, [x, y]) => page.evaluate(([x, y]) => window.__plantint.engine.call('sample', { x, y }), [x, y]);
const white = (c) => Math.min(...c) > 245;
const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ops = (page) => page.evaluate(() => window.__plantint.S.rasterOps.length);

async function stroke(page, pts, steps = 6) {
  const c0 = await toClient(page, ...pts[0]);
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) { const c = await toClient(page, ...p); await page.mouse.move(c.x, c.y, { steps }); }
  await page.mouse.up();
  await page.waitForFunction(() => !window.__plantint.T.busyAt, null, { timeout: 30000 });
  await page.waitForTimeout(250);
}
const setMode = (page, label) => page.click(`#tool-options .seg:text-is("${label}")`);

{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    await page.keyboard.press('e');
    // a bigger brush for a quick test
    for (let i = 0; i < 4; i++) await page.keyboard.press(']');
    const size = await page.evaluate(() => window.__plantint.S.eraser.size);
    check(size > 30, `] makes the brush larger (${size} px)`, R);
    // 1) brush over the yellow kitchen paint: paint goes, the red cloud line and black lines stay
    const k1 = P(0.8, 6.1), k2 = P(3.6, 6.1);
    const lineSpot = P(0.6, 7.6); // kitchen worktop outline (black line)
    const before = await sample(page, P(2.2, 6.1));
    await stroke(page, [k1, k2]);
    const after = await sample(page, P(2.2, 6.1));
    check(!white(before) && white(after), `brush lifts the kitchen paint (${before} → ${after})`, R);
    const n1 = await ops(page);
    check(n1 === 1, 'one erase step recorded', R);
    await shot(page, 't5_brush');
    // a line under the stroke stays: walls left of the kitchen
    const wall = await sample(page, [px(45 + 3), px(297 - (70 + 20 * 6.1))]);
    check(Math.max(...wall) < 120, `walls under the brush are kept (${wall})`, R);
    // undo restores the paint in one step
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
    const undone = await sample(page, P(2.2, 6.1));
    check(cdist(undone, before) < 5, `undo puts the paint back (${undone})`, R);
    await page.keyboard.press('Control+y'); await page.waitForTimeout(400);
    check(white(await sample(page, P(2.2, 6.1))), 'redo erases it again', R);
    // 2) "Highlights" mode leaves drawing colour alone
    await page.keyboard.press('f');
    await clickSheet(page, ...P(10.5, 7.6)); // living room fill
    await waitMarkups(page, 1);
    await page.keyboard.press('e');
    await setMode(page, 'Highlights');
    const bathBefore = await sample(page, P(10.4, 1.2));
    await stroke(page, [P(9.6, 1.2), P(11.2, 1.2)]);
    check(cdist(await sample(page, P(10.4, 1.2)), bathBefore) < 4, 'Highlights mode: the blue bath paint stays', R);
    // the living-room fill is cut where the brush passes (highlights mode)
    const areaBefore = await page.evaluate(() => { const r = window.__plantint.S.markups[0].rings; let a = 0; for (const q of r) { for (let i = 0; i < q.length; i += 2) { const j = (i + 2) % q.length; a += q[i] * q[j + 1] - q[j] * q[i + 1]; } } return Math.abs(a / 2); });
    await stroke(page, [P(5.0, 6.9), P(9.0, 6.9)]);
    const areaAfter = await page.evaluate(() => { const r = window.__plantint.S.markups[0].rings; let a = 0; for (const q of r) { for (let i = 0; i < q.length; i += 2) { const j = (i + 2) % q.length; a += q[i] * q[j + 1] - q[j] * q[i + 1]; } } return Math.abs(a / 2); });
    check(areaAfter < areaBefore * 0.97, `Highlights mode cuts the highlight (${Math.round(areaBefore)} → ${Math.round(areaAfter)} px²)`, R);
    // 3) "Drawing colour" mode leaves highlights alone and removes the bath paint
    await setMode(page, 'Drawing colour');
    const nM = await page.evaluate(() => JSON.stringify(window.__plantint.S.markups[0].rings).length);
    await stroke(page, [P(9.6, 1.2), P(11.2, 1.2)]);
    check(white(await sample(page, P(10.4, 1.2))), 'Drawing colour mode: the bath paint under the brush is removed', R);
    await stroke(page, [P(5.0, 7.4), P(9.0, 7.4)]);
    check((await page.evaluate(() => JSON.stringify(window.__plantint.S.markups[0].rings).length)) === nM, 'Drawing colour mode: highlights are not touched', R);
    // 4) Shift+click removes a whole painted area (bedroom 2, green; no highlight over it)
    await setMode(page, 'Both');
    const b2pt = P(7.9, 1.9);
    check(!white(await sample(page, b2pt)), 'bedroom 2 paint is there before', R);
    const waitOp = async (n) => { await page.waitForFunction((n) => window.__plantint.S.rasterOps.length > n, n, { timeout: 30000 }); await page.waitForTimeout(300); };
    let nOps = await ops(page);
    const c = await toClient(page, ...b2pt);
    await page.keyboard.down('Shift');
    await page.mouse.click(c.x, c.y);
    await page.keyboard.up('Shift');
    await waitOp(nOps);
    check(white(await sample(page, b2pt)) && white(await sample(page, P(8.6, 2.6))) && white(await sample(page, P(6.8, 0.5))), 'Shift+click removes the whole bedroom 2 colour', R);
    check((await page.evaluate(() => window.__plantint.S.markups.length)) === 1, 'Shift+click on paint leaves highlights alone', R);
    // 5) Shift+click on a highlight deletes the highlight (and only that)
    const lr = P(10.5, 7.9);
    const c2 = await toClient(page, ...lr);
    nOps = await ops(page);
    await page.keyboard.down('Shift'); await page.mouse.click(c2.x, c2.y); await page.keyboard.up('Shift');
    await page.waitForTimeout(300);
    check((await page.evaluate(() => window.__plantint.S.markups.length)) === 0 && (await ops(page)) === nOps, 'Shift+click on a highlight removes that highlight, not drawing colour', R);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    // 6) right-click menu on bare painted sheet: remove colour in this area (bath)
    await page.keyboard.press('s');
    nOps = await ops(page);
    const bt = await toClient(page, ...P(10.4, 2.4));
    await page.mouse.click(bt.x, bt.y, { button: 'right' });
    await page.getByText('Remove colour in this area of the drawing').click();
    await waitOp(nOps);
    check(white(await sample(page, P(10.4, 2.4))) && white(await sample(page, P(9.4, 0.6))), 'right-click “Remove colour in this area” clears the bath', R);
    await shot(page, 't5_after');
    // 7) export: the vector PDF shows the erased paint as paper
    const pdf = OUT + '/t5.pdf';
    await saveVia(app, page, 'Save as PDF…', pdf);
    execFileSync('pdftoppm', ['-r', '50', '-png', '-singlefile', pdf, OUT + '/t5_pdf50']);
    const pyOut = execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open('${OUT}/t5_pdf50.png').convert('RGB')
k = 50 / 25.4
pts = {'kitchen': (45 + 20 * 2.2, 297 - (70 + 20 * 6.1)), 'bath': (45 + 20 * 10.4, 297 - (70 + 20 * 2.4)), 'bedroom2': (45 + 20 * 7.9, 297 - (70 + 20 * 1.9)), 'bedroom1': (45 + 20 * 3.0, 297 - (70 + 20 * 1.2))}
for n, (x, y) in pts.items(): print(n, *im.getpixel((int(x * k), int(y * k))))
`]).toString();
    const pv = Object.fromEntries(pyOut.trim().split('\n').map((l) => { const [n, ...v] = l.split(' '); return [n, v.map(Number)]; }));
    check(white(pv.kitchen) && white(pv.bath) && white(pv.bedroom2), `PDF export: erased paint is gone (kitchen ${pv.kitchen}, bath ${pv.bath}, bedroom 2 ${pv.bedroom2})`, R);
    check(!white(pv.bedroom1), `PDF export: paint that was not erased is still there (bedroom 1 ${pv.bedroom1})`, R);
    // 8) project round trip keeps the erased colour erased
    const proj = OUT + '/t5.plantint';
    fs.rmSync(proj, { force: true });
    await stubSave(app, proj);
    await page.keyboard.press('Control+Shift+S');
    await page.click('.save-type[data-id="plantint"]');
    await page.click('.modal .btn.primary');
    for (let i = 0; i < 100 && !fs.existsSync(proj); i++) await page.waitForTimeout(100);
    check(fs.existsSync(proj), 'project saved', R);
  } catch (e) { check(false, 'zones: ' + e.stack, R); await shot(page, 't5_err'); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}
{
  const { app, page, errors } = await launch(OUT + '/t5.plantint');
  try {
    await waitDoc(page);
    await page.waitForTimeout(800);
    const k = await sample(page, P(2.2, 6.1)), c = await sample(page, P(7.9, 1.9)), b1 = await sample(page, P(3.0, 1.2));
    check(white(k) && white(c) && !white(b1), `reopened project: erased colour stays erased (${k} / ${c}), the rest is intact (${b1})`, R);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__plantint.S.rasterOps.length) >= 1, 'reopened project starts with a clean undo history', R);
  } catch (e) { check(false, 'reopen: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}
{
  // a JPEG scan and grey paint
  for (const [file, spot, label] of [['scan_plan.jpg', [10.4, 1.2], 'JPEG scan, blue bath'], ['plan_grey.pdf', [7.4, 1.6], 'grey zone']]) {
    const { app, page, errors } = await launch(DATA + '/' + file);
    try {
      await waitDoc(page);
      const dpi = await page.evaluate(() => window.__plantint.S.doc.dpi);
      const Q = (mx, my) => [((45 + 20 * mx) * dpi) / 25.4, ((297 - (70 + 20 * my)) * dpi) / 25.4];
      await page.keyboard.press('e');
      for (let i = 0; i < 3; i++) await page.keyboard.press(']');
      const s0 = await sample(page, Q(...spot));
      await stroke(page, [Q(spot[0] - 0.6, spot[1]), Q(spot[0] + 0.6, spot[1])]);
      const s1 = await sample(page, Q(...spot));
      const paperish = (c) => Math.min(...c) > 236;
      check(!paperish(s0) && paperish(s1), `${label}: brush lifts the colour (${s0} → ${s1})`, R);
    } catch (e) { check(false, label + ': ' + e.stack, R); }
    allErrors = allErrors.concat(errors);
    await quit(app);
  }
}
process.exit(summary(R, allErrors) ? 0 : 1);
