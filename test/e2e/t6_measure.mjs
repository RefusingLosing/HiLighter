// 1.2: measuring. The scale from the title block, a typed scale and a calibration from a known
// length (undoable); units (metric, imperial, feet and inches) and decimals; areas and
// perimeters of what is visible (overlaps and erasing); dimensions (snap, Shift, drag, edit,
// delete, erase, undo); area tags (placed clear of text, draggable, move with the markup);
// legend columns with a total; Excel and CSV schedules; dimensions and tags in PNG and PDF (four
// PDF engines); the project file (and 1.1 projects); a picture without a print size.
import { launch as launch0, waitDoc, shot, check, summary, clickSheet, moveSheet, toClient, waitMarkups, saveVia, stubSave, quit, OUT, DATA, ROOT, RECOVERY_DIR } from './lib.mjs';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

// each run starts from the default measuring settings (they are remembered between sessions)
const launch = (file) => { fs.rmSync(path.join(RECOVERY_DIR, '..', 'Local Storage'), { recursive: true, force: true }); return launch0(file); };

const R = [];
let allErrors = [];
const px = (mm) => (mm * 400) / 25.4;
const P = (mx, my) => [px(45 + 20 * mx), px(297 - (70 + 20 * my))]; // plan metres -> sheet px (plan_zones.pdf, 1:50, 400 dpi)
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rowText = (page, i) => page.evaluate((i) => {
  const r = document.querySelectorAll('#mk-list .mk-row')[i];
  return r ? [...r.querySelectorAll('.mk-meas span')].map((s) => s.textContent).join(' | ') : null;
}, i);
const S_ = (page, fn) => page.evaluate(fn);
const dims = (page) => page.evaluate(() => window.__plantint.S.dims.map((d) => ({ ...d, len: window.__plantint.annot.dimLayout(d).len, text: window.__plantint.annot.dimLayout(d).text.s })));
const pyRun = (args) => { try { return { ok: true, out: execFileSync('python3', args, { encoding: 'utf8', maxBuffer: 1 << 26 }) }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } };

async function hoverClick(page, pt, opts) {
  await moveSheet(page, pt[0] + 6, pt[1] + 6, 3);
  await page.waitForTimeout(200);
  await moveSheet(page, ...pt);
  await page.waitForTimeout(250);
  await clickSheet(page, ...pt, opts);
  await page.waitForTimeout(80);
}

async function typedRect(page, at, w, h) {
  await page.keyboard.press('r');
  await clickSheet(page, ...at, { modifiers: ['Control'] });
  await page.keyboard.type(w);
  await page.keyboard.press('Tab');
  await page.keyboard.type(h);
  await page.keyboard.press('Enter');
}

async function drag(page, from, to, { ctrlAfterDown = false, steps = 8 } = {}) {
  const a = await toClient(page, ...from), b = await toClient(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(120);
  await page.mouse.down();
  if (ctrlAfterDown) await page.keyboard.down('Control');
  await page.mouse.move(b.x, b.y, { steps });
  await page.waitForTimeout(120);
  await page.mouse.up();
  if (ctrlAfterDown) await page.keyboard.up('Control');
  await page.waitForTimeout(150);
}

async function calibrate(page, a, b, text) {
  await page.keyboard.press('c');
  await clickSheet(page, ...a, { modifiers: ['Control'] });
  await clickSheet(page, ...b, { modifiers: ['Control'] });
  await page.waitForSelector('#cal-len', { timeout: 5000 });
  await page.fill('#cal-len', text);
  await page.waitForTimeout(80);
  const res = await page.textContent('#cal-result');
  const intro = await page.textContent('.modal .modal-text');
  await page.press('#cal-len', 'Enter');
  await page.waitForSelector('#cal-len', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(150);
  return { res, intro };
}

async function schedule(app, page, label, file) {
  fs.rmSync(file, { force: true });
  await stubSave(app, file);
  await page.click('#ms-export');
  await page.getByText(label, { exact: true }).click();
  const t0 = Date.now();
  while (!fs.existsSync(file) && Date.now() - t0 < 30000) await page.waitForTimeout(150);
  await page.waitForFunction(() => !document.querySelector('.busy:not([hidden])'));
}

const undo = (page) => page.keyboard.press('Control+z').then(() => page.waitForTimeout(250));
const redo = (page) => page.keyboard.press('Control+y').then(() => page.waitForTimeout(250));
const scaleInfo = (page) => page.evaluate(() => { const u = window.__plantint.units; return { src: u.scaleSource(), scale: u.fmtScale(), unit: u.lengthUnit(), mpp: u.realPerPx() }; });

// ======================================================================== a PDF at 1:50
{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    let s = await scaleInfo(page);
    check(s.src === 'title' && s.scale === '1:50', `scale read from the title block (${s.scale}, ${s.src})`, R);
    check((await page.textContent('#ms-scale')).includes('1:50'), 'Measurements panel shows the scale', R);

    // ---- areas and perimeters
    await typedRect(page, P(0.6, 0.6), '5', '3');
    await waitMarkups(page, 1);
    let t = await rowText(page, 0);
    check(t === '15.00 m²', `area of a 5 × 3 m rectangle (${t})`, R);
    await page.check('#ms-show-perim');
    await page.waitForTimeout(150);
    t = await rowText(page, 0);
    check(t === '15.00 m² | P 16.00 m', `perimeter shows when ticked (${t})`, R);
    check((await page.textContent('#list-total')).trim() === '15.00 m²', 'total of all markups in the list header', R);
    await undo(page);
    check(await rowText(page, 0) === '15.00 m²', 'unticking happens on undo (settings are undoable)', R);
    await redo(page);
    check(await rowText(page, 0) === '15.00 m² | P 16.00 m', 'and come back on redo', R);
    await page.keyboard.press('s'); // keys work after ticking a checkbox
    check(await S_(page, () => window.__plantint.S.tool) === 'select', 'shortcut keys still work after ticking a checkbox', R);

    // ---- calibration on the drawing's 12000 overall dimension
    let c = await calibrate(page, P(0, -1.6), P(12, -1.6), '12');
    check(/240\.0 mm/.test(c.intro), `calibrate dialog gives the line's length on the sheet (${c.intro.trim()})`, R);
    check(/1:50\.0/.test(c.res), `and shows the resulting scale while typing (${c.res})`, R);
    const cal = await S_(page, () => window.__plantint.S.calib);
    check(cal && cal.kind === 'calib' && near(cal.mPerPx, 12 / px(240), 12 / px(240) * 1e-4), `calibrated metres per pixel (${cal && cal.mPerPx.toPrecision(6)})`, R);
    s = await scaleInfo(page);
    check(s.src === 'calib' && s.scale === '1:50', `scale now from the calibration (${s.scale})`, R);
    check(await S_(page, () => window.__plantint.S.tool) === 'select', 'back to Select after calibrating', R);
    check(await rowText(page, 0) === '15.00 m² | P 16.00 m', 'same area when the calibration matches the title block', R);

    // a print not at its stated scale: 12.6 m on the same line
    c = await calibrate(page, P(0, -1.6), P(12, -1.6), '12600 mm');
    check(/1:52\.5/.test(c.res) && /title block says 1:50/.test(c.res), `dialog warns that the title block disagrees (${c.res})`, R);
    const toasts = await page.textContent('.toasts');
    check(/title block says 1:50/.test(toasts), 'and so does the message after setting it', R);
    t = await rowText(page, 0);
    check(t === '16.54 m² | P 16.80 m', `sizes follow the new scale (${t})`, R);
    await undo(page);
    check(await rowText(page, 0) === '15.00 m² | P 16.00 m', 'undo restores the previous calibration', R);
    await page.click('#ms-reset');
    await page.waitForTimeout(150);
    s = await scaleInfo(page);
    check(s.src === 'title', `Reset goes back to the title block (${s.src})`, R);
    await undo(page);
    check((await scaleInfo(page)).src === 'calib', 'and Reset undoes too', R);

    // typed scale in the status bar
    await page.keyboard.press('k');
    await page.fill('#tool-options .scale-in', '100');
    await page.press('#tool-options .scale-in', 'Enter');
    await page.waitForTimeout(200);
    s = await scaleInfo(page);
    t = await rowText(page, 0);
    check(s.src === 'typed' && s.scale === '1:100' && t === '60.00 m² | P 32.00 m', `typed scale 1:100 (${s.scale}; ${t})`, R);
    await undo(page);
    check((await scaleInfo(page)).src === 'calib', 'typed scale undoes', R);

    // ---- units
    await page.selectOption('#ms-len', 'ft');
    await page.selectOption('#ms-area', 'ft2');
    await page.waitForTimeout(150);
    t = await rowText(page, 0);
    check(t === '161.5 ft² | P 52.49 ft', `feet and square feet (${t})`, R);
    await page.selectOption('#ms-len', 'ftin');
    await page.waitForTimeout(150);
    t = await rowText(page, 0);
    check(t === `161.5 ft² | P 52'-6"`, `feet and inches (${t})`, R);
    await typedRect(page, P(6.8, 0.6), `10'6"`, `8'`);
    await waitMarkups(page, 2);
    t = await rowText(page, 1);
    check(t === `84.0 ft² | P 37'-0"`, `a rectangle typed in feet and inches, 10'6" × 8' (${t})`, R);
    await page.selectOption('#ms-dec', '3');
    await page.waitForTimeout(100);
    t = await rowText(page, 0);
    check(t === `161.5 ft² | P 52'-5 7/8"`, `inches rounded to 1/8" (${t})`, R);
    await page.selectOption('#ms-len', 'cm');
    await page.selectOption('#ms-area', 'm2');
    await page.selectOption('#ms-dec', 'auto');
    await page.waitForTimeout(100);
    t = await rowText(page, 0);
    check(t === '15.00 m² | P 1,600.0 cm', `centimetres (${t})`, R);
    await page.selectOption('#ms-len', 'm');
    await page.waitForTimeout(100);
    t = await rowText(page, 1);
    check(t === '7.80 m² | P 11.28 m', `back to metres (${t})`, R);

    // ---- what is visible: a markup on top, and erasing
    await typedRect(page, P(1.6, 0.0), '2', '1');
    await waitMarkups(page, 3);
    t = await rowText(page, 0);
    check(t === '13.00 m² | P 22.00 m', `a markup on top is left out of the one below (${t})`, R);
    check(await rowText(page, 2) === '2.00 m² | P 6.00 m', 'the one on top keeps its full area', R);
    check((await page.textContent('#list-total')).trim() === '22.80 m²', `total is what is coloured on the sheet (${(await page.textContent('#list-total')).trim()})`, R);
    await page.keyboard.press('e');
    await page.click('#tool-options .seg:text-is("Highlights")');
    const before = await S_(page, () => window.__plantint.measure.measureAt(0).area);
    const ringsBefore = await S_(page, () => window.__plantint.S.markups[0].rings);
    await drag(page, P(4.3, -0.5), P(5.2, -0.5));
    await page.waitForFunction(() => !window.__plantint.T.busyAt);
    const after = await S_(page, () => { const p = window.__plantint; return { area: p.measure.measureAt(0).area, label: p.units.areaLabel(p.measure.measureAt(0).area) }; });
    check(after.area < before - 100, `erasing part of a markup reduces its area (${after.label})`, R);
    const removed = await S_(page, () => window.__plantint.S.markups[0].rings !== null);
    check(removed, 'eraser changed the markup', R);
    await undo(page);
    check(near(await S_(page, () => window.__plantint.measure.measureAt(0).area), before, 0.01), 'undo restores the area', R);
    void ringsBefore;

    // ---- dimensions
    await page.keyboard.press('k');
    await hoverClick(page, P(0.32, 3.0));
    await hoverClick(page, P(4.38, 3.0));
    await moveSheet(page, ...P(2.0, 3.6), 4);
    await page.waitForTimeout(120);
    await shot(page, 't6_dim_placing');
    await clickSheet(page, ...P(2.0, 3.6));
    await page.waitForTimeout(200);
    let D = await dims(page);
    check(D.length === 1 && D[0].text === '4.10 m', `dimension between the wall faces snaps: ${D[0] && D[0].text}`, R);
    check(D.length === 1 && near(D[0].off, -px(12), 4), `third click places the line 0.6 m above (${D[0] && (D[0].off / px(20)).toFixed(2)} m)`, R);
    // Shift: horizontal; Enter: on the points
    await hoverClick(page, P(0.32, 2.0));
    await page.keyboard.down('Shift');
    await moveSheet(page, ...P(4.38, 2.3), 4);
    await page.waitForTimeout(250);
    await clickSheet(page, ...P(4.38, 2.3));
    await page.keyboard.up('Shift');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    D = await dims(page);
    check(D.length === 2 && D[1].a[1] === D[1].b[1] && D[1].off === 0 && D[1].text === '4.10 m', `Shift keeps it horizontal and Enter puts the line on the points (${D[1] && D[1].text})`, R);
    // press, drag, release, then click
    await drag(page, P(9.4, 4.0), P(9.4, 4.6));
    await clickSheet(page, ...P(9.8, 4.3));
    await page.waitForTimeout(150);
    D = await dims(page);
    check(D.length === 3 && D[2].len > 0, `dragging from point to point works too (${D[2] && D[2].text})`, R);
    check(await page.textContent('#ms-diminfo') === '3 dimensions', 'Measurements panel counts the dimensions', R);
    // no scale -> paper mm (tested on the picture below); escape cancels
    await hoverClick(page, P(6, 7));
    await page.keyboard.press('Escape');
    check(await S_(page, () => window.__plantint.T.dim) === null && (await dims(page)).length === 3, 'Esc cancels a dimension in progress', R);

    // select, move the line, move an end, delete, undo
    await page.keyboard.press('s');
    const tx = await S_(page, () => { const L = window.__plantint.annot.dimLayout(window.__plantint.S.dims[0]); return [L.text.cx, L.text.cy, (L.p[0] + L.q[0]) / 2, (L.p[1] + L.q[1]) / 2]; });
    await clickSheet(page, tx[0], tx[1]);
    await page.waitForTimeout(150);
    check(await S_(page, () => [...window.__plantint.S.selection].join()) === D[0].id, 'clicking a dimension selects it', R);
    await shot(page, 't6_dim_selected');
    await drag(page, [tx[2], tx[3]], [tx[2], tx[3] - px(8)]);
    D = await dims(page);
    check(near(D[0].off, -px(20), 4) && D[0].text === '4.10 m', `dragging the dot moves the line (${(D[0].off / px(20)).toFixed(2)} m), the length stays`, R);
    await drag(page, D[0].b, P(3.0, 3.0), { ctrlAfterDown: true });
    D = await dims(page);
    check(D[0].text === '2.70 m', `dragging an end re-measures (${D[0].text})`, R);
    await undo(page);
    check((await dims(page))[0].text === '4.10 m', 'undo puts the end back', R);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    check((await dims(page)).length === 2, 'Delete removes the selected dimension', R);
    await undo(page);
    check((await dims(page)).length === 3, 'and undo brings it back', R);
    // moving the whole dimension
    D = await dims(page);
    const tl = await S_(page, () => { const L = window.__plantint.annot.dimLayout(window.__plantint.S.dims[2]); return [L.text.cx, L.text.cy]; });
    await drag(page, tl, [tl[0] + px(10), tl[1]]);
    const D2 = await dims(page);
    check(near(D2[2].a[0] - D[2].a[0], px(10), 2) && near(D2[2].b[0] - D[2].b[0], px(10), 2) && D2[2].text === D[2].text, 'dragging a dimension moves it whole', R);
    // right-click menu
    const dc = await toClient(page, tl[0] + px(10), tl[1]);
    await page.mouse.click(dc.x, dc.y, { button: 'right' });
    await page.waitForSelector('.menu');
    check(await page.isVisible('.menu-item:has-text("Delete dimension")'), 'right-click offers Delete dimension', R);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    // the eraser takes a dimension it passes over
    await page.keyboard.press('e');
    await drag(page, P(9.5, 4.3), P(10.3, 4.3));
    await page.waitForFunction(() => !window.__plantint.T.busyAt);
    check((await dims(page)).length === 2, 'the eraser removes a dimension it passes over', R);
    await undo(page);
    check((await dims(page)).length === 3, 'undo brings it back', R);

    // ---- area tags
    await page.keyboard.press('s');
    await page.check('#ms-tags');
    await page.waitForTimeout(250);
    const tag = await S_(page, () => window.__plantint.annot.tagLayout(0));
    check(tag && tag.lines.join(' | ') === '13.00 m² | P 22.00 m', `tag shows the area and perimeter (${tag && tag.lines.join(' | ')})`, R);
    const inside = await S_(page, () => { const p = window.__plantint; const t = p.annot.tagLayout(0); const vis = p.measure.measureAt(0).vis; const pts = [[t.cx - t.w / 2, t.cy - t.h / 2], [t.cx + t.w / 2, t.cy + t.h / 2], [t.cx, t.cy]]; return pts.every(([x, y]) => { let ins = false; for (const r of vis) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) ins = !ins; } return ins; }); });
    check(inside, 'the tag sits inside the visible part of its markup', R);
    const textHit = await S_(page, () => { const p = window.__plantint; const t = p.annot.tagLayout(1); return (p.S.doc.text || []).filter((l) => !(l.x1 < t.cx - t.w / 2 || l.x0 > t.cx + t.w / 2 || l.y1 < t.cy - t.h / 2 || l.y0 > t.cy + t.h / 2)).map((l) => l.t); });
    check(textHit.length === 0, `tags keep clear of the drawing's text (${textHit.join(', ') || 'none under the tag'})`, R);
    await shot(page, 't6_tags');
    await drag(page, [tag.cx, tag.cy], [tag.cx + px(8), tag.cy + px(4)]);
    let tagAt = await S_(page, () => window.__plantint.S.markups[0].tagAt);
    check(tagAt && near(tagAt[0], tag.cx + px(8), 2) && near(tagAt[1], tag.cy + px(4), 2), 'dragging a tag moves it', R);
    await drag(page, P(1.0, -2.0), P(1.0, -2.3));
    const tagAt2 = await S_(page, () => window.__plantint.S.markups[0].tagAt);
    check(tagAt2 && near(tagAt2[1] - tagAt[1], px(6), 2), 'a moved markup takes its tag along', R);
    await undo(page); await undo(page);
    check(!(await S_(page, () => window.__plantint.S.markups[0].tagAt)), 'undo returns the tag to its automatic place', R);

    // ---- legend columns
    await page.keyboard.press('l');
    await page.check('#ms-legend');
    await page.waitForTimeout(200);
    const lay = await S_(page, () => { const p = window.__plantint; const l = p.legend.legendLayout(p.S.legend); return { area: l.cols.area, perim: l.cols.perim, total: l.total, rows: p.legend.legendRows(p.S.legend).length, w: l.w }; });
    check(lay.area && lay.perim && lay.total && lay.rows === 3, `legend gets Area and Perimeter columns and a total row (${JSON.stringify(lay)})`, R);
    await shot(page, 't6_legend');

    // ---- exports
    await saveVia(app, page, 'Save as PNG picture…', OUT + '/t6.png');
    await saveVia(app, page, 'Save as PDF…', OUT + '/t6_vector.pdf');
    await saveVia(app, page, 'Save as flattened PDF…', OUT + '/t6_flat.pdf');
    const spec = await S_(page, () => {
      const p = window.__plantint;
      const hex = p.S.meas.dimColor.replace('#', '');
      const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const lines = [], texts = [], boxes = [];
      for (const d of p.S.dims) {
        const L = p.annot.dimLayout(d);
        const m = L.segs[L.segs.length - 3];
        for (const f of [0.2, 0.8]) lines.push([m[0] + (m[2] - m[0]) * f, m[1] + (m[3] - m[1]) * f]);
        const xs = L.corners.map((c) => c[0]), ys = L.corners.map((c) => c[1]);
        texts.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
      for (const t of p.annot.allTags()) boxes.push([t.cx - t.w / 2, t.cy - t.h / 2, t.cx + t.w / 2, t.cy + t.h / 2]);
      return { sheetDpi: p.S.doc.dpi, lines, lineRgb: rgb, texts, textRgb: rgb, boxes };
    });
    fs.writeFileSync(OUT + '/t6_annots.json', JSON.stringify(spec));
    let r = pyRun([ROOT + '/test/pdfcheck/check_annots.py', OUT + '/t6_annots.json', OUT + '/t6.png', OUT + '/t6_vector.pdf', OUT + '/t6_flat.pdf']);
    check(r.ok, 'dimensions and tags are in the PNG and in both PDFs, in MuPDF, PDFium, Poppler and Ghostscript' + (r.ok ? '' : '\n' + r.out), R);
    r = pyRun([ROOT + '/test/pdfcheck/check_annots.py', OUT + '/t6_annots.json', DATA + '/plan_zones.pdf', '--expect-missing']);
    check(r.ok, 'control: the same check fails on the drawing without them' + (r.ok ? '' : '\n' + r.out), R);
    r = pyRun([ROOT + '/test/pdfcheck/check_app.py', OUT + '/t6.png', OUT + '/t6_vector.pdf', OUT + '/t6_flat.pdf']);
    check(r.ok, 'PDFs look like the PNG in four engines' + (r.ok ? '' : '\n' + r.out.split('\n').slice(-12).join('\n')), R);

    // ---- schedules
    await schedule(app, page, 'Excel workbook (.xlsx)…', OUT + '/t6.xlsx');
    await schedule(app, page, 'CSV file…', OUT + '/t6.csv');
    r = pyRun(['-c', `
import openpyxl, json
wb = openpyxl.load_workbook('${OUT}/t6.xlsx')
ws = wb['Areas']
rows = [[c.value for c in row] for row in ws.iter_rows(min_row=1, max_row=6)]
wv = openpyxl.load_workbook('${OUT}/t6.xlsx', data_only=True)['Areas']
total = [c.value for c in wv[5]]
d = wb['Dimensions']
print(json.dumps({'head': rows[0], 'r1': rows[1], 'total': total, 'totalf': rows[4][3], 'fill': ws['C2'].fill.fgColor.rgb, 'dims': [[c.value for c in row] for row in d.iter_rows(min_row=2)], 'sheets': wb.sheetnames}))
`]);
    let X = null;
    try { X = JSON.parse(r.out); } catch { /* reported below */ }
    check(X && X.head.join('|') === 'Name|Colour|Colour code|Area (m²)|Perimeter (m)', `Excel schedule header (${X && X.head.join(' | ')})`, R);
    check(X && near(X.r1[3], 13, 0.001) && near(X.r1[4], 22, 0.001), `Excel rows hold numbers (${X && X.r1.join(' | ')})`, R);
    check(X && X.total[0] === 'Total' && near(X.total[3], 13 + 7.80385 + 2, 0.001) && X.totalf === '=SUM(D2:D4)', `Excel total is a formula with its value (${X && X.totalf} = ${X && X.total[3]})`, R);
    check(X && X.fill === 'FFFFD60A', `Excel colour column is filled with the markup's colour (${X && X.fill})`, R);
    check(X && X.sheets.join() === 'Areas,Dimensions' && X.dims.length === 3 && near(X.dims[0][1], 4.10, 0.005), `Excel lists the dimensions (${X && JSON.stringify(X.dims)})`, R);
    const csv = fs.readFileSync(OUT + '/t6.csv', 'utf8');
    const lines = csv.replace(/^﻿/, '').split(/\r\n/);
    check(csv.charCodeAt(0) === 0xFEFF && lines[0] === 'Name,Colour,Colour code,Area (m²),Perimeter (m)' && /,13\.00,22\.00$/.test(lines[1]), `CSV schedule (${lines[1]})`, R);
    check((await page.textContent('#doc-title')).includes('not saved') || (await page.textContent('#doc-title')).includes('saved as picture'), 'saving a schedule does not count as saving the work', R);

    // ---- project file
    const proj = OUT + '/t6.plantint';
    fs.rmSync(proj, { force: true });
    await stubSave(app, proj);
    await page.keyboard.press('Control+Shift+s');
    await page.waitForSelector('.save-type');
    const types = await page.$$eval('.save-type', (b) => b.map((x) => x.getAttribute('data-id')));
    check(types.join(',') === 'plantint,pdf,pdfflat,png,jpg,xlsx,csv', `Save as offers the schedules too (${types.join(', ')})`, R);
    await page.click('.save-type[data-id="plantint"]');
    await page.click('.modal .btn.primary');
    const t0 = Date.now();
    while (!fs.existsSync(proj) && Date.now() - t0 < 30000) await page.waitForTimeout(150);
    await page.waitForTimeout(400);
    const meta = JSON.parse(strFromU8(unzipSync(new Uint8Array(fs.readFileSync(proj)))['project.json']));
    check(meta.version === 4 && meta.dims.length === 3 && meta.calib && meta.calib.kind === 'calib' && meta.meas.tags === true && meta.scale === 50, `project keeps dimensions, calibration and settings (v${meta.version}, scale ${meta.scale} for 1.1)`, R);
    // a 1.1 project with a typed scale opens as a typed scale
    const files = unzipSync(new Uint8Array(fs.readFileSync(proj)));
    const old = { ...meta, version: 2, app: 'PlanTint 1.1', scale: 100, scaleSource: 'user' };
    delete old.calib; delete old.meas; delete old.dims;
    for (const m of old.markups) delete m.tagAt;
    files['project.json'] = strToU8(JSON.stringify(old));
    fs.writeFileSync(OUT + '/t6_v2.plantint', zipSync(files));
  } catch (e) { check(false, 'pdf: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

// ======================================================================== the project reopened
{
  const { app, page, errors } = await launch(OUT + '/t6.plantint');
  try {
    await waitDoc(page);
    const st = await page.evaluate(() => { const p = window.__plantint; return { dims: p.S.dims.length, src: p.units.scaleSource(), tags: p.S.meas.tags, legend: p.S.meas.legend, perim: p.S.meas.showPerim }; });
    check(st.dims === 3 && st.src === 'calib' && st.tags && st.legend && st.perim, `reopened project has its dimensions, calibration and settings (${JSON.stringify(st)})`, R);
    check(await rowText(page, 0) === '13.00 m² | P 22.00 m', 'and the same areas', R);
    check((await dims(page))[0].text === '4.10 m', 'and the same dimensions', R);
    await shot(page, 't6_reopened');
  } catch (e) { check(false, 'reopen: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}
{
  const { app, page, errors } = await launch(OUT + '/t6_v2.plantint');
  try {
    await waitDoc(page);
    const s = await scaleInfo(page);
    check(s.src === 'typed' && s.scale === '1:100', `a 1.1 project with a typed scale opens with it (${s.scale}, ${s.src})`, R);
    check((await rowText(page, 0)).startsWith('52.00 m²'), `areas use it (${await rowText(page, 0)})`, R);
  } catch (e) { check(false, 'v2: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

// ======================================================================== a picture with no print size
{
  const png = OUT + '/t6_nodpi.png';
  execFileSync('python3', ['-c', `from PIL import Image; Image.open('${DATA}/scan_plan.jpg').convert('RGB').save('${png}')`]);
  const { app, page, errors } = await launch(png);
  try {
    await waitDoc(page);
    let s = await scaleInfo(page);
    check(s.src === 'none' && s.unit === 'px', `a picture without print size starts in pixels (${s.unit})`, R);
    await page.keyboard.press('r');
    check(await page.isVisible('#tool-options button:has-text("Calibrate")'), 'the status bar offers Calibrate', R);
    await page.keyboard.press('Escape');
    // the scan is the plan at 200 dpi turned 0.35° about its centre
    const { W, H } = await page.evaluate(() => ({ W: window.__plantint.S.doc.W, H: window.__plantint.S.doc.H }));
    const th = (0.35 * Math.PI) / 180;
    const Q = (mx, my) => {
      const x = ((45 + 20 * mx) * 200) / 25.4, y = ((297 - (70 + 20 * my)) * 200) / 25.4;
      const dx = x - W / 2, dy = y - H / 2;
      return [W / 2 + dx * Math.cos(th) + dy * Math.sin(th), H / 2 - dx * Math.sin(th) + dy * Math.cos(th)];
    };
    const c = await calibrate(page, Q(0, -1.6), Q(12, -1.6), '12 m');
    check(/1890 pixels/.test(c.intro), `dialog gives the length in pixels (${c.intro.trim()})`, R);
    s = await scaleInfo(page);
    check(s.src === 'calib' && /6\.35 mm/.test(s.scale) && s.unit === 'm', `calibrated picture: ${s.scale}`, R);
    await typedRect(page, Q(0.6, 0.6), '5', '3');
    await waitMarkups(page, 1);
    check(await rowText(page, 0) === '15.00 m²', `areas in square metres on a calibrated picture (${await rowText(page, 0)})`, R);
    await page.keyboard.press('k');
    await clickSheet(page, ...Q(0, -0.9), { modifiers: ['Control'] });
    await clickSheet(page, ...Q(4.4, -0.9), { modifiers: ['Control'] });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const D = await dims(page);
    check(D.length === 1 && D[0].text === '4.40 m', `dimension on the calibrated picture (${D[0] && D[0].text})`, R);
    await shot(page, 't6_picture');
  } catch (e) { check(false, 'picture: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

process.exit(summary(R, allErrors) ? 0 : 1);
