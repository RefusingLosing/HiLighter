// 1.5: the progress map and snag pins.
// Progress map: the switch colours each zone by its status (red not started, amber in progress, green
// done, grey not counted); the status is set with the panel, the keys 1 2 3 0 and the right-click menu;
// the % complete is weighted by area or by units; each zone's % shows on the sheet; the legend becomes the
// progress table; everything undoes; the PNG export shows the status colours; the progress report is an
// Excel workbook with live formulas.
// Snag pins: X then a click drops a numbered pin and puts the keys in its note; trade, status (keys 1 2 3,
// the menu), dates; a photo from a file (turned upright), pasted with Ctrl+V and dropped on the card; pins
// move, select with Ctrl+A, delete (their numbers are never given again); they print in the PNG and both
// PDFs; the snag list is an Excel workbook with the photos inside; a project keeps all of it.
import { launch as launch0, waitDoc, shot, check, summary, clickSheet, toClient, waitMarkups, saveVia, stubSave, stubOpen, setRange, quit, OUT, DATA, RECOVERY_DIR } from './lib.mjs';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

// each run starts from the default settings (the trade of the last pin is remembered between sessions)
const launch = (file) => { fs.rmSync(path.join(RECOVERY_DIR, '..', 'Local Storage'), { recursive: true, force: true }); return launch0(file); };

const R = [];
let allErrors = [];
const px = (mm) => (mm * 400) / 25.4;
const P = (mx, my) => [px(45 + 20 * mx), px(297 - (70 + 20 * my))]; // plan metres -> sheet px (plan_zones.pdf, 1:50, 400 dpi)
const M = px(20); // one metre on the sheet
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const S_ = (page, fn, arg) => page.evaluate(fn, arg);
const pyRun = (args) => { try { return { ok: true, out: execFileSync('python3', args, { encoding: 'utf8', maxBuffer: 1 << 26 }) }; } catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') }; } };
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

// four zones in the empty paper right of the plan (plan metres): 6, 4, 2 and 8 m²
const ZONES = [[[13.0, 7.5], [16.0, 5.5]], [[13.0, 5.0], [15.0, 3.0]], [[15.5, 5.0], [17.5, 4.0]], [[13.0, 2.5], [17.0, 0.5]]];
// a point inside a zone near its top-left corner (the middle holds the zone's % label)
const inZone = (z) => P(z[0][0] + 0.25, z[0][1] - 0.25);

// test pictures
const IMG = path.join(OUT, 't9_img');
fs.mkdirSync(IMG, { recursive: true });
execFileSync('python3', ['-c', `
from PIL import Image
im = Image.new('RGB', (2400, 1600), (40, 60, 220))
im.paste((220, 40, 40), (0, 0, 1200, 1600))
ex = Image.Exif(); ex[0x0112] = 6            # stored on its side: shown turned 90° clockwise
im.save('${IMG}/side.jpg', quality=90, exif=ex)
Image.new('RGB', (300, 200), (40, 170, 90)).save('${IMG}/paste.png')
Image.new('RGB', (640, 480), (230, 200, 40)).save('${IMG}/drop.jpg', quality=90)
`]);

async function rectZone(page, a, b) {
  await page.keyboard.press('r');
  const A = await toClient(page, ...a), B = await toClient(page, ...b);
  await page.keyboard.down('Control'); // corners exactly where pressed (no snapping)
  await page.mouse.move(A.x, A.y);
  await page.mouse.down();
  await page.mouse.move(B.x, B.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Control');
}
const undo = (page) => page.keyboard.press('Control+z').then(() => page.waitForTimeout(250));
const undoTip = (page) => page.getAttribute('#btn-undo', 'data-tip');
const text = (page, sel) => page.textContent(sel).then((t) => (t || '').trim());
const visible = (page, sel) => page.isVisible(sel);
const prog = (page, i) => S_(page, (i) => { const p = window.__plantint; return p.progress.progOf(p.S.markups[i]); }, i);
const pins = (page) => S_(page, () => window.__plantint.S.pins.map((p) => ({ ...p })));
const clickRow = (page, i, opts) => page.click(`#mk-list .mk-row:nth-child(${i + 1}) .mk-name`, opts);
const waitNote = (page) => page.waitForFunction(() => document.activeElement && document.activeElement.id === 'pc-note', null, { timeout: 5000 });

/** Mean colour of 3 × 3 screen pixels at a sheet point (the scene canvas: drawing, markups, legend, pins). */
const scenePx = (page, x, y) => page.evaluate(([x, y]) => {
  const { V } = window.__plantint;
  const ctx = document.getElementById('scene').getContext('2d', { alpha: false });
  const d = ctx.getImageData(Math.round(x * V.scale + V.tx) - 1, Math.round(y * V.scale + V.ty) - 1, 3, 3).data;
  const s = [0, 0, 0];
  for (let i = 0; i < 9; i++) for (let k = 0; k < 3; k++) s[k] += d[i * 4 + k];
  return s.map((v) => Math.round(v / 9));
}, [x, y]);
const isRed = ([r, g, b]) => r - g > 50 && r - b > 50 && g < 200;
const isAmber = ([r, g, b]) => r > 200 && g > 150 && r - b > 60 && g - b > 30;
const isGreen = ([r, g, b]) => g - r > 30 && g >= b;
const isGrey = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 16 && r < 235;
const isYellow = ([r, g, b]) => r > 200 && g > 180 && b < 160;

/** Where a pin shows its colour (inside the head, below the number), in sheet px; exported pins have no screen minimum. */
const pinSpots = (page, onScreen) => S_(page, (onScreen) => {
  const p = window.__plantint;
  const z = onScreen ? p.pins.pinSize((p.pins.PIN_MIN_CSS * p.V.dpr) / p.V.scale) : p.pins.pinSize(0);
  return p.S.pins.map((q) => ({ n: q.n, status: q.status, x: q.x, y: q.y - z.tail * 0.55, head: [q.x, q.y - z.tail] }));
}, onScreen);
const PIN_RGB = { open: [0xD9, 0x2D, 0x20], fixed: [0xE0, 0x7C, 0x00], closed: [0x16, 0xA3, 0x4A] };
const rgbNear = (a, b, tol = 40) => a && a.every((v, i) => Math.abs(v - b[i]) <= tol);

async function waitFile(page, file, timeout = 60000) {
  const t0 = Date.now();
  while (!fs.existsSync(file)) {
    if (Date.now() - t0 > timeout) throw new Error('save timed out: ' + file);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => !document.querySelector('.busy:not([hidden])'), null, { timeout });
  await page.waitForTimeout(200);
}
/** Clicks a report button in the panel and waits for the workbook. */
async function report(app, page, button, file) {
  fs.rmSync(file, { force: true });
  await stubSave(app, file);
  await page.click(button);
  await waitFile(page, file);
}
/** Mean colours of a picture (PNG, or a PDF page rendered by Poppler) at sheet points. */
function pictureColours(file, pts, kind = 'png') {
  let pic = file, k = 1;
  if (kind === 'pdf') {
    const base = file.replace(/\.pdf$/, '_r100');
    execFileSync('pdftoppm', ['-r', '100', '-png', '-singlefile', file, base]);
    pic = base + '.png';
    k = 100 / 400;
  }
  const r = pyRun(['-c', `
import json, sys
from PIL import Image
im = Image.open('${pic}').convert('RGB')
pts = json.loads(sys.argv[1])
out = []
for x, y in pts:
    s = [0, 0, 0]
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            p = im.getpixel((int(round(x)) + dx, int(round(y)) + dy))
            for i in range(3): s[i] += p[i]
    out.append([round(v / 9) for v in s])
print(json.dumps(out))
`, JSON.stringify(pts.map(([x, y]) => [x * k, y * k]))]);
  return r.ok ? JSON.parse(r.out) : null;
}

// ======================================================================== the progress map and snag pins
const proj = OUT + '/t9.plantint';
{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    for (const [a, b] of ZONES) await rectZone(page, P(...a), P(...b));
    await waitMarkups(page, 4);
    await page.keyboard.press('s');
    await page.keyboard.press('Escape');
    const names = await S_(page, () => window.__plantint.S.markups.map((m) => m.name));
    const areas = await S_(page, () => window.__plantint.S.markups.map((m, i) => window.__plantint.units.areaNumber(window.__plantint.measure.measureAt(i).area)));
    check(areas.every((a, i) => near(a, [6, 4, 2, 8][i], 0.01)), `four zones of 6, 4, 2 and 8 m² (${areas.map((a) => a.toFixed(2)).join(', ')}; ${names.join(', ')})`, R);
    const yellow = await scenePx(page, ...inZone(ZONES[0]));

    // ---- the switch
    check(!(await S_(page, () => window.__plantint.S.progress.on)) && !(await page.$('#pg-sec.open')), 'the progress map starts off', R);
    await page.click('#pg-switch');
    await page.waitForTimeout(250);
    check(await S_(page, () => window.__plantint.S.progress.on) && !!(await page.$('#pg-sec.open')), 'the switch turns it on and opens the section', R);
    check(await text(page, '#pg-sum') === '0%' && await text(page, '#pg-big') === '0% complete' && (await text(page, '#pg-counts')).includes('4 not started'),
      `every zone starts as Not started: ${await text(page, '#pg-big')}, ${await text(page, '#pg-counts')}`, R);
    let c = await scenePx(page, ...inZone(ZONES[0]));
    check(isYellow(yellow) && isRed(c), `the sheet shows the zones in the Not started colour (${yellow} -> ${c})`, R);
    check(await undoTip(page) === 'Undo progress map on', `switching is one undo step (${await undoTip(page)})`, R);
    check(await visible(page, '#pg-note') && /Keys: 1 not started/.test(await text(page, '#pg-note')) && !(await visible(page, '#pg-sel')), 'with nothing selected the section says how to set a status', R);

    // ---- statuses: keys, buttons, % slider
    const tip0 = await undoTip(page);
    await page.keyboard.press('3');
    check(await undoTip(page) === tip0, 'a status key with nothing selected does nothing', R);
    await clickRow(page, 0);
    await page.keyboard.press('3');
    check((await prog(page, 0)).st === 'done' && await undoTip(page) === 'Undo set zone to done', `3 sets the selected zone to Done (${await undoTip(page)})`, R);
    await page.waitForTimeout(150);
    c = await scenePx(page, ...inZone(ZONES[0]));
    check(isGreen(c), `a done zone is green on the sheet (${c})`, R);
    await clickRow(page, 1);
    check(await visible(page, '#pg-sel') && await text(page, '#pg-sel-title') === names[1], 'selecting a zone shows its status box', R);
    await page.click('#pg-st .pg-st-btn[data-st="doing"]');
    let p1 = await prog(page, 1);
    check(p1.st === 'doing' && p1.pct === 50 && await visible(page, '#pg-pct-row') && await text(page, '#pg-pct-val') === '50%', `In progress starts at 50% and shows the % slider (${JSON.stringify(p1)})`, R);
    check(await page.getAttribute('#pg-st .pg-st-btn[data-st="doing"]', 'aria-checked') === 'true', 'the zone’s status button is on', R);
    await setRange(page, '#pg-pct', 60);
    await page.waitForTimeout(100);
    p1 = await prog(page, 1);
    check(p1.pct === 60 && await undoTip(page) === 'Undo change % done', `the slider sets 60% as one undo step (${await undoTip(page)})`, R);
    c = await scenePx(page, ...inZone(ZONES[1]));
    check(isAmber(c), `an in-progress zone is amber (${c})`, R);
    await clickRow(page, 2);
    await page.keyboard.press('0');
    check((await prog(page, 2)).st === 'skip', '0 sets Not counted', R);
    await page.waitForTimeout(150);
    c = await scenePx(page, ...inZone(ZONES[2]));
    check(isGrey(c), `a zone not counted is grey (${c})`, R);
    check(await text(page, '#pg-sum') === '47%' && await text(page, '#pg-big') === '47% complete', `by area: (6 + 60% of 4) / 18 m² = 47% (${await text(page, '#pg-big')})`, R);
    check(await text(page, '#pg-counts') === '1 done · 1 in progress · 1 not started · 1 not counted', `counts by status (${await text(page, '#pg-counts')})`, R);
    const rowMeas = await S_(page, () => [...document.querySelectorAll('#mk-list .mk-row')].map((r) => [...r.querySelectorAll('.mk-meas span')].map((s) => s.textContent).join(' | ')));
    check(rowMeas.join(' / ') === '100% | 6.00 m² / 60% | 4.00 m² / Not counted | 2.00 m² / 0% | 8.00 m²', `the list shows each zone’s % (${rowMeas.join(' / ')})`, R);

    // several zones: no common status, then one key for both; undo
    await clickRow(page, 0);
    await clickRow(page, 3, { modifiers: ['Control'] });
    const onBtns = await page.$$eval('#pg-st .pg-st-btn.on', (b) => b.length);
    check(onBtns === 0 && await text(page, '#pg-sel-title') === '2 zones selected', 'two zones with different statuses: no button is on', R);
    await page.keyboard.press('2');
    check((await prog(page, 0)).st === 'doing' && (await prog(page, 3)).st === 'doing' && await undoTip(page) === 'Undo set 2 zones to in progress', `one key sets both (${await undoTip(page)})`, R);
    await undo(page);
    check((await prog(page, 0)).st === 'done' && (await prog(page, 3)).st === 'todo', 'undo puts both back', R);

    // the right-click menu
    await page.keyboard.press('Escape');
    const z4 = await toClient(page, ...P(16.5, 1.0));
    await page.mouse.click(z4.x, z4.y, { button: 'right' });
    await page.waitForSelector('.menu');
    const menu = await page.$$eval('.menu .menu-item', (b) => b.map((x) => x.querySelector('.menu-label').textContent + (x.querySelector('.ico') ? '*' : '')));
    check(['Not started', 'In progress', 'Done', 'Not counted'].every((l) => menu.some((m) => m.startsWith(l))), `the zone menu has the statuses (${menu.join(', ')})`, R);
    await page.click('.menu .menu-item:has(.menu-label:text-is("In progress"))');
    check((await prog(page, 3)).st === 'doing', 'and sets one', R);
    await undo(page);
    check((await prog(page, 3)).st === 'todo', 'which undoes', R);

    // ---- by units
    await page.click('#pg-by .seg[data-v="units"]');
    await page.waitForTimeout(100);
    check(await text(page, '#pg-sum') === '53%', `by units, one each: (1 + 0.6) / 3 = 53% (${await text(page, '#pg-sum')})`, R);
    await clickRow(page, 3);
    check(await visible(page, '#pg-units-row'), 'counting by units shows the units of the selected zone', R);
    await page.fill('#pg-units', '2');
    await page.press('#pg-units', 'Enter');
    await page.waitForTimeout(150);
    check((await prog(page, 3)).units === 2 && await text(page, '#pg-sum') === '40%', `2 units for the last zone: 1.6 / 4 = 40% (${await text(page, '#pg-sum')})`, R);
    await page.click('#pg-by .seg[data-v="area"]');
    await page.waitForTimeout(100);
    check(await text(page, '#pg-sum') === '47%', 'back to area: 47%', R);

    // ---- % on the sheet
    let tags = await S_(page, () => [0, 1, 2, 3].map((i) => { const t = window.__plantint.annot.tagLayout(i); return t ? t.lines.join('/') : null; }));
    check(tags.join(',') === '100%,60%,,0%', `each zone’s % is written on the sheet, none on the zone not counted (${tags.join(', ')})`, R);
    await page.uncheck('#pg-labels');
    await page.waitForTimeout(100);
    check(!(await S_(page, () => window.__plantint.annot.tagsVisible())), 'the % labels can be hidden', R);
    await page.check('#pg-labels');
    await page.waitForTimeout(100);

    // ---- the legend becomes the progress table
    await page.keyboard.press('Escape');
    await page.keyboard.press('l');
    await page.waitForTimeout(300);
    const lay = await S_(page, () => { const p = window.__plantint; const l = p.legend.legendLayout(p.S.legend); return { progress: l.progress, titles: l.titles, cells: l.cells, total: l.total }; });
    check(lay.progress && lay.titles.join('|') === 'Progress|Zones|Area (m²)|Share' && lay.cells.map((r) => r[0]).join('|') === 'Not started|In progress|Done|Not counted',
      `the legend is the progress table (${lay.titles.join(' | ')}; ${lay.cells.map((r) => r.join(' ')).join('; ')})`, R);
    check(lay.total.join('|') === 'Complete|3|18.00|47%', `with the % complete (${lay.total.join(' | ')})`, R);
    await shot(page, 't9_progress_screen');

    // ---- PNG with the status colours, then the progress report
    await saveVia(app, page, 'Save as PNG picture…', OUT + '/t9_progress.png');
    let cols = pictureColours(OUT + '/t9_progress.png', ZONES.map(inZone));
    check(cols && isGreen(cols[0]) && isAmber(cols[1]) && isGrey(cols[2]) && isRed(cols[3]), `the PNG shows the status colours (${JSON.stringify(cols)})`, R);
    await report(app, page, '#pg-report', OUT + '/t9_progress.xlsx');
    let r = pyRun(['-c', `
import openpyxl, json
f = '${OUT}/t9_progress.xlsx'
ws = openpyxl.load_workbook(f)['Progress']
wv = openpyxl.load_workbook(f, data_only=True)['Progress']
rows = [[c.value for c in row] for row in ws.iter_rows(min_row=1, max_row=16)]
vals = [[c.value for c in row] for row in wv.iter_rows(min_row=1, max_row=16)]
print(json.dumps({'sheets': ws.parent.sheetnames, 'rows': rows, 'vals': vals, 'freeze': ws.freeze_panes, 'filter': ws.auto_filter.ref,
  'fmtC': ws['C7'].number_format, 'fill': ws['B6'].fill.fgColor.rgb}, default=str))
`]);
    let X = null;
    try { X = JSON.parse(r.out); } catch { check(false, 'progress workbook readable: ' + r.out, R); }
    if (X) {
      const head = X.rows[4], z = X.rows.slice(5, 9), tot = X.rows[9], vt = X.vals[9];
      check(X.sheets.join() === 'Progress' && /^Progress: plan_zones/.test(X.rows[0][0]), `progress workbook (${X.rows[0][0]})`, R);
      check(head.join('|') === 'Zone|Status|% done|Area (m²)|Counted|Done', `columns (${head.join(' | ')})`, R);
      check(z.map((q) => q[0]).join() === names.join() && z.map((q) => q[1]).join() === 'Done,In progress,Not counted,Not started', `zones with their status (${z.map((q) => q[0] + ': ' + q[1]).join(', ')})`, R);
      check(z[0][2] === 1 && near(z[1][2], 0.6, 1e-9) && z[2][2] === null && z[3][2] === 0 && X.fmtC === '0%', `% done as numbers (${z.map((q) => q[2]).join(', ')}, ${X.fmtC})`, R);
      check(z.every((q, i) => near(q[3], [6, 4, 2, 8][i], 0.01)), `areas (${z.map((q) => q[3]).join(', ')})`, R);
      check(z[2][4] === '=IF(B8="Not counted",0,D8)' && z[1][5] === '=E7*C7', `counted and done are formulas (${z[2][4]}, ${z[1][5]})`, R);
      check(tot[0] === 'Total' && tot[2] === '=IF(SUM(E6:E9)=0,0,SUM(F6:F9)/SUM(E6:E9))' && near(vt[2], 8.4 / 18, 1e-3) && near(vt[4], 18, 0.01), `the total % is a formula with its value (${tot[2]} = ${vt[2]})`, R);
      check(X.rows[2][0] === 'Complete' && X.rows[2][1] === '=C10' && near(X.vals[2][1], 8.4 / 18, 1e-3), `“Complete” at the top follows the total (${X.rows[2][1]})`, R);
      const bySt = X.rows.slice(12, 16);
      check(X.rows[11][0] === 'By status' && bySt.map((q) => q[0]).join() === 'Not started,In progress,Done,Not counted' && bySt[0][1] === '=COUNTIF($B$6:$B$9,A13)'
        && X.vals[12][1] === 1 && near(X.vals[12][3], 8 / 18, 1e-3) && near(X.vals[14][3], 6 / 18, 1e-3) && X.vals[15][3] === null,
        `totals by status (${X.vals.slice(12, 16).map((q) => q.join(' ')).join('; ')})`, R);
      check(X.freeze === 'A6' && X.filter === 'A5:F9' && X.fill === 'FFD4EEDD', `frozen header, filter and status colours (${X.freeze}, ${X.filter}, ${X.fill})`, R);
    }
    check((await text(page, '#doc-title')).includes('not saved') || (await page.textContent('#doc-title')).includes('saved as picture'), 'a report does not count as saving the work', R);

    // ---- off and on again
    await page.click('#pg-switch');
    await page.waitForTimeout(200);
    c = await scenePx(page, ...inZone(ZONES[0]));
    check(isYellow(c), `off: the zones show their own colours again (${c})`, R);
    await undo(page);
    check(await S_(page, () => window.__plantint.S.progress.on), 'undo turns it back on', R);
    await page.keyboard.press('l'); // the legend off, to keep the zones clear for the pins

    // ======================================================== snag pins
    await page.keyboard.press('x');
    check(await S_(page, () => window.__plantint.S.tool) === 'pin' && !!(await page.$('#sn-sec.open')) && !!(await page.$('.rail-btn.on[data-tool="pin"]')), 'X picks the snag pin tool and opens the Snags section', R);
    const at1 = P(13.6, 7.0), at2 = P(13.6, 3.6), at3 = P(13.6, 1.0), at4 = P(16.4, 1.0);
    await clickSheet(page, ...at1);
    await waitNote(page);
    let ps = await pins(page);
    check(ps.length === 1 && ps[0].n === 1 && near(ps[0].x, at1[0], 3) && near(ps[0].y, at1[1], 3) && ps[0].status === 'open' && ps[0].trade === 'Civil' && ps[0].raised === today,
      `a click drops pin 1 where clicked, open, raised today (${JSON.stringify(ps[0])})`, R);
    check(await visible(page, '#pin-card') && !(await visible(page, '.style-card')) && await text(page, '#pc-title') === 'Snag 1' && await text(page, '#pc-place') === names[0],
      `the pin card replaces the style card and names the zone it is in (${await text(page, '#pc-place')})`, R);
    await page.keyboard.type('Cracked tile at the door');
    await page.keyboard.press('Enter');
    ps = await pins(page);
    check(ps[0].note === 'Cracked tile at the door' && await undoTip(page) === 'Undo edit snag note', 'type the note, Enter keeps it', R);
    await clickSheet(page, ...at2);
    await waitNote(page);
    await page.keyboard.type('Loose socket');
    await clickSheet(page, ...at3); // the next click keeps the note typed so far
    await waitNote(page);
    await page.keyboard.type('Paint');
    await page.keyboard.press('Escape');
    ps = await pins(page);
    check(ps.map((p) => p.n).join() === '1,2,3' && ps[1].note === 'Loose socket' && ps[2].note === '', `pins 2 and 3: the next click kept pin 2’s note, Esc dropped pin 3’s (${ps.map((p) => p.note).join(' / ')})`, R);
    const board = await toClient(page, -60, 900);
    await page.mouse.click(board.x, board.y);
    await page.waitForTimeout(150);
    check((await pins(page)).length === 3 && /Drop snag pins on the sheet/.test(await text(page, '.toasts')), 'a click beside the sheet drops no pin', R);
    await page.waitForTimeout(150);
    let spots = await pinSpots(page, true);
    c = await scenePx(page, spots[0].x, spots[0].y);
    check(rgbNear(c, PIN_RGB.open), `pins show on the sheet in their status colour (${c})`, R);

    // trade and status of pin 1
    const h1 = await toClient(page, ...spots[0].head);
    await page.mouse.click(h1.x, h1.y);
    await page.waitForTimeout(150);
    check(await S_(page, () => [...window.__plantint.S.selection].join()) === ps[0].id && (await pins(page)).length === 3, 'clicking a pin with the pin tool selects it', R);
    await page.fill('#pc-trade', 'Electrical');
    await page.press('#pc-trade', 'Enter');
    check((await pins(page))[0].trade === 'Electrical' && await undoTip(page) === 'Undo change trade', 'the trade can be typed', R);
    await page.keyboard.press('2');
    check((await pins(page))[0].status === 'fixed', '2: Fixed', R);
    await page.keyboard.press('3');
    ps = await pins(page);
    check(ps[0].status === 'closed' && ps[0].closed === today && (await text(page, '#pc-dates')).includes('closed'), `3: Closed, dated today (${ps[0].closed})`, R);
    await page.keyboard.press('1');
    ps = await pins(page);
    check(ps[0].status === 'open' && ps[0].closed === null, '1: Open again, the closing date goes', R);
    await undo(page);
    ps = await pins(page);
    check(ps[0].status === 'closed' && ps[0].closed === today, 'undo: closed again with its date', R);

    // a photo from a file, stored upright and at most 1600 px
    await stubOpen(app, IMG + '/side.jpg');
    await page.click('#pc-add');
    await page.waitForFunction(() => !!window.__plantint.S.pins[0].photo, null, { timeout: 15000 });
    const ph = await S_(page, async () => {
      const p = window.__plantint;
      const q = p.S.photos.get(p.S.pins[0].photo);
      const bmp = await createImageBitmap(new Blob([q.bytes], { type: 'image/jpeg' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const top = [...ctx.getImageData(bmp.width >> 1, 20, 1, 1).data].slice(0, 3), bottom = [...ctx.getImageData(bmp.width >> 1, bmp.height - 20, 1, 1).data].slice(0, 3);
      return { w: q.w, h: q.h, bw: bmp.width, bh: bmp.height, top, bottom };
    });
    check(ph.w === 1067 && ph.h === 1600 && ph.bw === 1067 && ph.bh === 1600, `a 2400 × 1600 photo taken on its side is stored upright at 1067 × 1600 (${ph.w} × ${ph.h})`, R);
    check(isRed(ph.top) && ph.bottom[2] > 150 && ph.bottom[0] < 120, `turned the right way (top ${ph.top}, bottom ${ph.bottom})`, R);
    check(await visible(page, '#pc-thumb img') && !(await visible(page, '#pc-drop')) && (await text(page, '#pc-add')).includes('Replace'), 'the card shows the photo', R);

    // pasted with Ctrl+V (a picture on the clipboard)
    const h2 = await toClient(page, ...spots[1].head);
    await page.mouse.click(h2.x, h2.y);
    await page.waitForTimeout(150);
    await app.evaluate(({ clipboard }) => clipboard.writeText('just text'));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(300);
    check(/Copy a photo or a screenshot first/.test(await text(page, '.toasts')) && !(await pins(page))[1].photo, 'Ctrl+V with no picture copied says so', R);
    const b64 = fs.readFileSync(IMG + '/paste.png').toString('base64');
    await app.evaluate(({ clipboard, ClipboardItem }, b) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b, 'base64')], { type: 'image/png' }) })]), b64);
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => !!window.__plantint.S.pins[1].photo, null, { timeout: 15000 });
    let q2 = await S_(page, () => { const p = window.__plantint; const q = p.S.photos.get(p.S.pins[1].photo); return [q.w, q.h]; });
    check(q2.join('×') === '300×200' && /Photo added to snag 2/.test(await text(page, '.toasts')), `Ctrl+V pastes a copied picture into the pin (${q2.join(' × ')})`, R);

    // in a text box a pasted picture stays out, except in the pin's own note, where it is the photo
    const h3 = await toClient(page, ...spots[2].head);
    await page.mouse.click(h3.x, h3.y);
    await page.waitForTimeout(150);
    await page.click('#pc-trade');
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(500);
    const kept = !(await pins(page))[2].photo;
    await page.keyboard.press('Escape');
    await page.click('#pc-note');
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => !!window.__plantint.S.pins[2].photo, null, { timeout: 15000 });
    await page.keyboard.press('Escape');
    check(kept && (await pins(page))[2].trade === 'Civil', 'a picture pasted in the trade box is not taken as the photo', R);
    check(await S_(page, () => { const p = window.__plantint; const q = p.S.photos.get(p.S.pins[2].photo); return q.w + '×' + q.h; }) === '300×200', 'pasted in the pin’s note, it is the photo', R);

    // dropped on the card (it replaces the photo)
    const veil = await S_(page, async (b) => {
      const bytes = Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'drop.jpg', { type: 'image/jpeg' }));
      const t = document.getElementById('pc-thumb');
      const rr = t.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rr.left + 5, clientY: rr.top + 5 };
      t.dispatchEvent(new DragEvent('dragenter', o));
      t.dispatchEvent(new DragEvent('dragover', o));
      const v = document.querySelector('.drop-veil').textContent;
      t.dispatchEvent(new DragEvent('drop', o));
      return v;
    }, fs.readFileSync(IMG + '/drop.jpg').toString('base64'));
    await page.waitForFunction(() => { const p = window.__plantint; const q = p.S.photos.get(p.S.pins[2].photo); return q && q.w === 640; }, null, { timeout: 15000 });
    q2 = await S_(page, () => { const p = window.__plantint; const q = p.S.photos.get(p.S.pins[2].photo); return [q.w, q.h]; });
    check(veil === 'Drop to add the photo to snag 3' && q2.join('×') === '640×480', `a picture dropped on the card is the pin’s photo (“${veil}”, ${q2.join(' × ')})`, R);
    check(await S_(page, () => window.__plantint.S.doc.name) === 'plan_zones.pdf', 'and is not opened as a drawing', R);

    // the Snags list
    let rows = await page.$$eval('#sn-list .sn-row', (b) => b.map((x) => x.querySelector('.sn-num').textContent + ':' + x.querySelector('.sn-note').textContent + ':' + !!x.querySelector('.sn-cam')));
    check(rows.join(' / ') === '1:Cracked tile at the door:true / 2:Loose socket:true / 3:No note yet:true', `the Snags section lists the pins (${rows.join(' / ')})`, R);
    check(await text(page, '#sn-sum') === '2 open · 1 closed', `with a count by status (${await text(page, '#sn-sum')})`, R);
    await page.click('#sn-filter .seg[data-v="closed"]');
    rows = await page.$$eval('#sn-list .sn-row', (b) => b.map((x) => x.querySelector('.sn-num').textContent));
    check(rows.join() === '1', `filter by status (${rows.join()})`, R);
    await page.click('#sn-filter .seg[data-v="all"]');

    // move with the select tool, undo
    await page.keyboard.press('s');
    await page.keyboard.press('Escape');
    spots = await pinSpots(page, true);
    const from = await toClient(page, ...spots[2].head), to = await toClient(page, spots[2].head[0] + M / 2, spots[2].head[1]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    ps = await pins(page);
    check(near(ps[2].x - at3[0], M / 2, 3) && await undoTip(page) === 'Undo move pin', `a pin drags to a new place (${((ps[2].x - at3[0]) / M).toFixed(2)} m, ${await undoTip(page)})`, R);
    await undo(page);
    check(near((await pins(page))[2].x, at3[0], 3), 'undo puts it back', R);

    // Ctrl+A takes pins too
    await page.keyboard.press('Control+a');
    const sel = await S_(page, () => [...window.__plantint.S.selection].length);
    check(sel === 7 && !(await visible(page, '#pin-card')) && await visible(page, '.style-card'), `Ctrl+A selects the zones and the pins (${sel}); the style card shows for a mixed selection`, R);
    await page.keyboard.press('Escape');

    // a box dragged from empty paper takes the pins whose tips are inside it (zones only when wholly inside)
    const b0 = await toClient(page, ...P(12.4, 7.9)), b1 = await toClient(page, ...P(13.9, 6.6));
    await page.mouse.move(b0.x, b0.y);
    await page.mouse.down();
    await page.mouse.move(b1.x, b1.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    check(await S_(page, () => [...window.__plantint.S.selection].join()) === ps[0].id, 'a box dragged around a pin selects it', R);
    // the arrow keys nudge it
    const nx = await S_(page, () => window.__plantint.S.pins[0].x);
    await page.keyboard.press('ArrowRight');
    const step = await S_(page, () => window.__plantint.V.dpr / window.__plantint.V.scale);
    check(near((await pins(page))[0].x - nx, step, 1e-6) && await undoTip(page) === 'Undo nudge', 'the arrow keys nudge pins', R);
    await undo(page);
    await page.keyboard.press('Escape');

    // delete: numbers are never given again
    await page.click('#sn-list .sn-row[data-id="' + ps[1].id + '"]');
    await page.keyboard.press('Delete');
    ps = await pins(page);
    check(ps.map((p) => p.n).join() === '1,3' && /Deleted snag pin 2/.test(await text(page, '.toasts')), `Delete removes pin 2 (${ps.map((p) => p.n).join()})`, R);
    await page.keyboard.press('x');
    await clickSheet(page, ...at4);
    await waitNote(page);
    await page.keyboard.type('Check the drain');
    await page.keyboard.press('Enter');
    ps = await pins(page);
    check(ps.map((p) => p.n).join() === '1,3,4' && ps[2].trade === 'Electrical' && await S_(page, () => window.__plantint.S.pinNext) === 5,
      `the next pin is number 4, not 2, and takes the last trade used (${ps.map((p) => p.n).join()}, ${ps[2].trade})`, R);

    // the pin menu; double-click edits the note
    await page.keyboard.press('s');
    spots = await pinSpots(page, true);
    const h3b = await toClient(page, ...spots[1].head);
    await page.mouse.click(h3b.x, h3b.y, { button: 'right' });
    await page.waitForSelector('.menu');
    const pm = await page.$$eval('.menu .menu-item', (b) => b.map((x) => x.querySelector('.menu-label').textContent));
    check(pm.join('|') === 'Open|Fixed|Closed|Replace photo…|Edit note|Zoom to it|Delete pin', `pin menu (${pm.join(', ')})`, R);
    await page.click('.menu .menu-item:has(.menu-label:text-is("Fixed"))');
    check((await pins(page))[1].status === 'fixed', 'the menu sets the status', R);
    const h4 = await toClient(page, ...spots[2].head);
    await page.mouse.dblclick(h4.x, h4.y);
    await page.waitForTimeout(150);
    check(await S_(page, () => document.activeElement && document.activeElement.id) === 'pc-note' && await S_(page, () => [...window.__plantint.S.selection].join()) === ps[2].id, 'double-clicking a pin puts the keys in its note', R);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await shot(page, 't9_pins_screen');

    // ---- pins print: PNG and both PDFs
    await saveVia(app, page, 'Save as PNG picture…', OUT + '/t9_pins.png');
    await saveVia(app, page, 'Save as PDF…', OUT + '/t9_pins.pdf');
    await saveVia(app, page, 'Save as flattened PDF…', OUT + '/t9_pins_flat.pdf');
    const ex = await pinSpots(page, false);
    const want = ex.map((s) => PIN_RGB[s.status]);
    for (const [file, kind] of [['/t9_pins.png', 'png'], ['/t9_pins.pdf', 'pdf'], ['/t9_pins_flat.pdf', 'pdf']]) {
      cols = pictureColours(OUT + file, ex.map((s) => [s.x, s.y]), kind);
      check(cols && cols.every((q, i) => rgbNear(q, want[i], 45)), `pins in ${file.slice(1)} in their status colours (${JSON.stringify(cols)})`, R);
    }
    r = pyRun(['-c', `
import pikepdf
pdf = pikepdf.open('${OUT}/t9_pins.pdf')
print(pdf.docinfo.get('/Creator'))
`]);
    check(r.ok && /^PlanTint 1\.[5-9]$/.test(r.out.trim()), `the PDF says PlanTint made it (${r.out.trim()})`, R);

    // ---- the snag list
    await report(app, page, '#sn-report', OUT + '/t9_snags.xlsx');
    r = pyRun(['-c', `
import openpyxl, json
f = '${OUT}/t9_snags.xlsx'
wb = openpyxl.load_workbook(f)
ws = wb['Snag list']
wv = openpyxl.load_workbook(f, data_only=True)
rows = [[c.value for c in row] for row in ws.iter_rows(min_row=1, max_row=6)]
imgs = [(im.anchor._from.col, im.anchor._from.row, im.anchor.to.col, im.anchor.to.row, im.width, im.height) for im in ws._images]
sm = wb['Summary']
srows = [[c.value for c in row] for row in sm.iter_rows(min_row=1, max_row=6)]
svals = [[c.value for c in row] for row in wv['Summary'].iter_rows(min_row=1, max_row=6)]
print(json.dumps({'sheets': wb.sheetnames, 'rows': rows, 'imgs': imgs, 'h4': ws.row_dimensions[4].height, 'h6': ws.row_dimensions[6].height,
  'srows': srows, 'svals': svals, 'filter': ws.auto_filter.ref, 'land': ws.page_setup.orientation}, default=str))
`]);
    X = null;
    try { X = JSON.parse(r.out); } catch { check(false, 'snag workbook readable: ' + r.out, R); }
    if (X) {
      const day = `${today} 00:00:00`;
      check(X.sheets.join() === 'Snag list,Summary' && /^Snag list: plan_zones/.test(X.rows[0][0]) && X.rows[1][3] === '3 snags: 1 open, 1 fixed, 1 closed', `snag workbook (${X.rows[0][0]}; ${X.rows[1][3]})`, R);
      check(X.rows[2].join('|') === 'No.|Location|Trade|Description|Status|Raised|Closed|Photo', `columns (${X.rows[2].join(' | ')})`, R);
      const [a, b, d] = X.rows.slice(3, 6);
      check(a[0] === 1 && a[1] === names[0] && a[2] === 'Electrical' && a[3] === 'Cracked tile at the door' && a[4] === 'Closed' && a[5] === day && a[6] === day, `pin 1 (${a.join(' | ')})`, R);
      check(b[0] === 3 && b[1] === names[3] && b[2] === 'Civil' && b[4] === 'Fixed' && b[6] === null, `pin 3 (${b.join(' | ')})`, R);
      check(d[0] === 4 && d[2] === 'Electrical' && d[3] === 'Check the drain' && d[4] === 'Open', `pin 4 (${d.join(' | ')})`, R);
      check(X.imgs.length === 2 && X.imgs[0][0] === 7 && X.imgs[0][1] === 3 && X.imgs[0][2] === 7 && X.imgs[0][3] === 3 && X.imgs[1][1] === 4,
        `the two photos sit in the Photo column on their pins’ rows (${JSON.stringify(X.imgs)})`, R);
      check(X.h4 > 100 && X.h6 === null, `rows with a photo are tall enough for it (${X.h4} pt)`, R);
      check(X.filter === 'A3:H6' && X.land === 'landscape', `filter and landscape print (${X.filter}, ${X.land})`, R);
      const tr = X.srows.slice(3, 6), tv = X.svals.slice(3, 6);
      check(tr[0][0] === 'Electrical' && tr[1][0] === 'Civil' && /^=COUNTIFS\('Snag list'!\$C\$4:\$C\$6,\$A4,'Snag list'!\$E\$4:\$E\$6,"Open"\)$/.test(tr[0][1]),
        `summary by trade counts with formulas (${tr[0][1]})`, R);
      check(tv[0].slice(1).join() === '1,0,1,2' && tv[1].slice(1).join() === '0,1,0,1' && tv[2].slice(1).join() === '1,1,1,3', `and their values (${tv.map((q) => q.join(' ')).join('; ')})`, R);
    }

    // ---- the project keeps the statuses, the pins and their photos
    fs.rmSync(proj, { force: true });
    await stubSave(app, proj);
    await page.keyboard.press('Control+Shift+s');
    await page.waitForSelector('.save-type');
    const types = await page.$$eval('.save-type', (b) => b.map((x) => x.getAttribute('data-id')));
    check(types.join(',') === 'plantint,pdf,pdfflat,png,jpg,xlsx,csv,progress,snags', `Save as offers the progress report and the snag list once they have content (${types.join(', ')})`, R);
    await page.click('.save-type[data-id="plantint"]');
    await page.click('.modal .btn.primary');
    await waitFile(page, proj);
    const zf = unzipSync(new Uint8Array(fs.readFileSync(proj)));
    const meta = JSON.parse(strFromU8(zf['project.json']));
    const photoFiles = Object.keys(zf).filter((k) => k.startsWith('photos/'));
    check(meta.version === 4 && /^PlanTint 1\.[5-9]$/.test(meta.app) && meta.pins.length === 3 && meta.pinNext === 5 && meta.photos.length === 2 && photoFiles.length === 2,
      `project v${meta.version}: ${meta.pins.length} pins, next number ${meta.pinNext}, ${photoFiles.length} photos (the deleted pin’s photo is left out)`, R);
    check(meta.progress.on === true && meta.progress.by === 'area' && meta.markups.map((m) => m.prog && m.prog.st).join() === 'done,doing,skip,todo' && meta.markups[3].prog.units === 2,
      `and the progress map (${JSON.stringify(meta.progress)}, ${meta.markups.map((m) => JSON.stringify(m.prog)).join(' ')})`, R);
    // a 1.4 project (no pins, no statuses) still opens: written from this one
    const old = { ...meta, version: 3, app: 'PlanTint 1.4' };
    delete old.pins; delete old.pinNext; delete old.photos; delete old.progress;
    old.markups = old.markups.map((m) => { const q = { ...m }; delete q.prog; return q; });
    const of = { ...zf, 'project.json': strToU8(JSON.stringify(old)) };
    for (const k of photoFiles) delete of[k];
    fs.writeFileSync(OUT + '/t9_v3.plantint', zipSync(of));
  } catch (e) { check(false, 'progress and pins: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}

// ======================================================================== the project reopened
{
  const { app, page, errors } = await launch(proj);
  try {
    await waitDoc(page);
    const ps = await pins(page);
    const ph = await S_(page, () => window.__plantint.S.pins.map((p) => { const q = p.photo && window.__plantint.S.photos.get(p.photo); return q ? `${q.w}×${q.h}` : '-'; }));
    check(ps.map((p) => `${p.n}:${p.status}:${p.trade}:${p.note}`).join(' / ') === '1:closed:Electrical:Cracked tile at the door / 3:fixed:Civil: / 4:open:Electrical:Check the drain',
      `reopened: the pins with their numbers, statuses, trades and notes (${ps.map((p) => `${p.n} ${p.status} ${p.trade} ${p.note}`).join(' / ')})`, R);
    check(ph.join() === '1067×1600,640×480,-' && ps[0].closed === today, `their photos and dates (${ph.join(', ')})`, R);
    check(await S_(page, () => window.__plantint.S.progress.on) && await text(page, '#pg-sum') === '47%', `the progress map is on with the same % (${await text(page, '#pg-sum')})`, R);
    await page.keyboard.press('x');
    await clickSheet(page, ...P(16.4, 6.0));
    await waitNote(page);
    await page.keyboard.press('Escape');
    check((await pins(page)).map((p) => p.n).join() === '1,3,4,5', 'a new pin goes on from the saved numbering (5)', R);
    await shot(page, 't9_reopened');
  } catch (e) { check(false, 'reopen: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}
{
  const { app, page, errors } = await launch(OUT + '/t9_v3.plantint');
  try {
    await waitDoc(page);
    const st = await S_(page, () => { const p = window.__plantint; return { pins: p.S.pins.length, next: p.S.pinNext, on: p.S.progress.on, n: p.S.markups.length, st: p.S.markups.map((m) => p.progress.progOf(m).st).join() }; });
    check(st.pins === 0 && st.next === 1 && !st.on && st.n === 4 && st.st === 'todo,todo,todo,todo', `a 1.4 project opens without pins, its zones not started (${JSON.stringify(st)})`, R);
  } catch (e) { check(false, 'v3: ' + e.stack, R); }
  allErrors = allErrors.concat(errors);
  await quit(app);
}
process.exit(summary(R, allErrors) ? 0 : 1);
