// 1.5.1: a highlight on a drawing that is already coloured shows its own colour. Under it the
// paint is taken out (lines, text and coloured line work stay), on screen, zoomed in, in PNG and in
// both kinds of PDF; moving, deleting or switching the setting off brings the paint back; the
// setting is saved with the project; plain paper looks as before; it works on a JPEG scan too.
// Shift+click with Fill joins a building split by its number into the highlight next to it.
import { launch, waitDoc, shot, check, summary, clickSheet, toClient, waitMarkups, saveVia, stubSave, quit, OUT, DATA } from './lib.mjs';
import fs from 'fs';
import { execFileSync } from 'child_process';

const R = [];
let allErrors = [];
const px = (mm, dpi = 400) => (mm * dpi) / 25.4;
const P = (mx, my, dpi = 400) => [px(45 + 20 * mx, dpi), px(297 - (70 + 20 * my), dpi)]; // plan metres -> sheet px
const RED = '#E03131', OP = 0.6;
// the highlight on paper, and the same highlight mixed with the kitchen's yellow (FFF0A8), as before 1.5.1
const onPaper = [224, 49, 49].map((c) => 255 * (1 - OP + (OP * c) / 255));
const onYellow = [255, 240, 168].map((v, i) => (v * onPaper[i]) / 255);
const fmt = (c) => '(' + c.map(Math.round).join(', ') + ')';
const near = (a, b, d) => Math.abs(a[0] - b[0]) <= d && Math.abs(a[1] - b[1]) <= d && Math.abs(a[2] - b[2]) <= d;

/** The colour on screen at a sheet point (mean of 5 x 5 device pixels). */
const screenPx = (page, [x, y]) => page.evaluate(([x, y]) => {
  const { V } = window.__plantint;
  const cv = document.getElementById('scene');
  const X = Math.round(x * V.scale + V.tx), Y = Math.round(y * V.scale + V.ty);
  const d = cv.getContext('2d').getImageData(X - 2, Y - 2, 5, 5).data;
  const s = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
  return s.map((v) => v / 25);
}, [x, y]);

/** Waits until the screen colour at pt is near want (the tiles come from the engine a moment later). */
async function screenNear(page, pt, want, tol, timeout = 10000) {
  const t0 = Date.now();
  let c;
  while (Date.now() - t0 < timeout) {
    await page.waitForFunction(() => window.__plantint.covers.coversIdle(), null, { timeout });
    c = await screenPx(page, pt);
    if (near(c, want, tol)) return c;
    await page.waitForTimeout(150);
  }
  return c;
}

/** Pixels of a PNG file: the mean colour at (x, y) (5 x 5), plus counts of red and dark pixels in boxes. */
function pngStats(file, x, y, boxes = []) {
  const out = execFileSync('python3', ['-c', `
import sys, json
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
im = Image.open(sys.argv[1]).convert('RGB')
x, y = int(float(sys.argv[2])), int(float(sys.argv[3]))
px = [im.getpixel((x + dx, y + dy)) for dx in range(-2, 3) for dy in range(-2, 3)]
mean = [sum(p[i] for p in px) / len(px) for i in range(3)]
counts = []
for b in json.loads(sys.argv[4]):
    red = dark = 0
    for yy in range(int(b[1]), int(b[3])):
        for xx in range(int(b[0]), int(b[2])):
            r, g, bl = im.getpixel((xx, yy))
            if r > 120 and g < 70 and bl < 90: red += 1
            if 0.3 * r + 0.59 * g + 0.11 * bl < 70: dark += 1
    counts.append([red, dark])
print(json.dumps({'mean': mean, 'counts': counts}))
`, file, String(x), String(y), JSON.stringify(boxes)]).toString();
  return JSON.parse(out);
}

async function setStyle(page, props) {
  await page.evaluate((p) => { const t = window.__plantint; t.S.style = { ...t.S.style, ...p }; t.emit('style'); }, props);
}

// ------------------------------------------------------------------ a PDF with painted rooms
{
  const { app, page, errors } = await launch(DATA + '/plan_zones.pdf');
  try {
    await waitDoc(page);
    const K = P(1.0, 5.2);          // kitchen (painted yellow), away from its label and furniture
    const LIV = P(10.5, 7.6);       // living room (paper)
    const BED2 = P(8.7, 1.5);       // bedroom 2 (painted medium green)
    const paint = await screenPx(page, K);
    check(paint[2] < 200 && paint[0] > 235, `the kitchen is painted yellow on screen ${fmt(paint)}`, R);
    check(await page.evaluate(() => document.getElementById('cover-check').checked), 'new highlights cover colour on the drawing (setting on)', R);
    await setStyle(page, { color: RED, opacity: OP });
    await page.keyboard.press('f');
    await clickSheet(page, ...K);
    await waitMarkups(page, 1);
    await clickSheet(page, ...LIV);
    await waitMarkups(page, 2);
    let c = await screenNear(page, K, onPaper, 9);
    check(near(c, onPaper, 9), `on screen the highlight shows its own colour over the yellow ${fmt(c)}, want ${fmt(onPaper)} (mixed would be ${fmt(onYellow)})`, R);
    c = await screenNear(page, LIV, onPaper, 9);
    check(near(c, onPaper, 9), `on paper the highlight looks as before ${fmt(c)}`, R);
    await shot(page, 't10_cover_screen');

    // switching the setting off for this highlight: it tints the yellow again; undo covers again
    await page.keyboard.press('s');
    await clickSheet(page, ...K);
    await page.waitForFunction(() => window.__plantint.S.selection.size === 1);
    await page.click('#cover-check');
    c = await screenNear(page, K, onYellow, 10);
    check(near(c, onYellow, 10) && (await page.evaluate(() => window.__plantint.S.markups[0].cover === false)), `cover off: the highlight tints the paint ${fmt(c)}`, R);
    await page.keyboard.press('Control+z');
    c = await screenNear(page, K, onPaper, 9);
    check(near(c, onPaper, 9), `undo: covered again ${fmt(c)}`, R);

    // deleting the highlight brings the paint back; undo covers it again
    await page.keyboard.press('Delete');
    await waitMarkups(page, 1);
    c = await screenNear(page, K, paint, 6);
    check(near(c, paint, 6), `delete: the kitchen's own paint is back ${fmt(c)}`, R);
    await page.keyboard.press('Control+z');
    await waitMarkups(page, 2);
    c = await screenNear(page, K, onPaper, 9);
    check(near(c, onPaper, 9), `undo delete: covered again ${fmt(c)}`, R);

    // moving it: the paint comes back where it was, and is covered where it goes
    const kid = await page.evaluate(() => window.__plantint.S.markups[0].id);
    await page.evaluate((id) => window.__plantint.S.selection = new Set([id]), kid);
    const from = await toClient(page, ...K);
    const to = await toClient(page, K[0], K[1] + px(20 * 3.2)); // 3.2 m down: over bedroom 1 (pale blue)
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    c = await screenNear(page, K, paint, 6);
    check(near(c, paint, 6), `move: the old spot shows the kitchen paint again ${fmt(c)}`, R);
    const B1 = [K[0], K[1] + px(20 * 3.2)];
    c = await screenNear(page, B1, onPaper, 9);
    check(near(c, onPaper, 9), `move: the new spot (bedroom 1, painted pale blue) is covered ${fmt(c)}`, R);
    await page.keyboard.press('Control+z');
    c = await screenNear(page, K, onPaper, 9);
    check(near(c, onPaper, 9), `undo move ${fmt(c)}`, R);

    // a second highlight with the setting off, on the green bedroom 2
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const t = window.__plantint; t.S.selection = new Set(); t.emit('selection'); });
    await page.click('#cover-check');
    check(await page.evaluate(() => window.__plantint.S.style.cover === false), 'the setting for the next highlight can be switched off', R);
    await page.keyboard.press('f');
    await clickSheet(page, ...BED2);
    await waitMarkups(page, 3);
    const bedPaint = [169, 219, 156];
    const bedTint = bedPaint.map((v, i) => (v * onPaper[i]) / 255);
    c = await screenNear(page, BED2, bedTint, 12);
    check(near(c, bedTint, 12), `a highlight with the setting off tints the green ${fmt(c)}`, R);
    await page.click('#cover-check'); // back on for what follows (nothing selected: next markup)

    // zoomed in on a PDF: the sharp re-rendering is covered too
    await page.evaluate(([x, y]) => {
      const t = window.__plantint;
      const k = 2.5;
      t.V.scale = k; t.V.tx = t.V.cw / 2 - x * k; t.V.ty = t.V.ch / 2 - y * k;
      t.emit('view');
    }, K);
    await page.waitForTimeout(1500);
    c = await screenNear(page, K, onPaper, 9);
    check(near(c, onPaper, 9), `zoomed in (sharp vectors) the kitchen is still covered ${fmt(c)}`, R);
    await shot(page, 't10_cover_zoom');
    await page.evaluate(() => { window.__plantint.fit(); window.__plantint.emit('view'); });

    // ---- PNG
    const png = OUT + '/t10_cover.png';
    await saveVia(app, page, 'Save as PNG picture…', png);
    const cloud = [px(45 + 20 * 2.05), px(297 - (70 + 20 * 7.4)), px(45 + 20 * 2.35), px(297 - (70 + 20 * 7.0))]; // left end of the red revision cloud
    const label = [px(45 + 20 * 1.6), px(297 - (70 + 20 * 6.6)), px(45 + 20 * 2.8), px(297 - (70 + 20 * 6.2))]; // KITCHEN
    let st = pngStats(png, K[0], K[1], [cloud, label]);
    check(near(st.mean, onPaper, 6), `PNG: the kitchen highlight shows its own colour ${fmt(st.mean)}`, R);
    check(st.counts[0][0] >= 10, `PNG: the red revision cloud across the kitchen stays (${st.counts[0][0]} red pixels)`, R);
    check(st.counts[1][1] >= 200, `PNG: the KITCHEN label stays dark (${st.counts[1][1]} dark pixels)`, R);
    st = pngStats(png, BED2[0], BED2[1]);
    check(near(st.mean, bedTint, 10), `PNG: the highlight with the setting off still tints ${fmt(st.mean)}`, R);
    st = pngStats(png, LIV[0], LIV[1]);
    check(near(st.mean, onPaper, 6), `PNG: on paper as before ${fmt(st.mean)}`, R);

    // ---- vector PDF: the drawing stays vector, the painted pixels under highlights are replaced
    const pdf = OUT + '/t10_cover.pdf';
    await saveVia(app, page, 'Save as PDF…', pdf);
    execFileSync('pdftoppm', ['-r', '100', '-png', '-singlefile', pdf, OUT + '/t10_cover_pdf']);
    st = pngStats(OUT + '/t10_cover_pdf.png', K[0] / 4, K[1] / 4);
    check(near(st.mean, onPaper, 8), `PDF: the kitchen highlight shows its own colour ${fmt(st.mean)}`, R);
    st = pngStats(OUT + '/t10_cover_pdf.png', LIV[0] / 4, LIV[1] / 4);
    check(near(st.mean, onPaper, 8), `PDF: on paper as before ${fmt(st.mean)}`, R);
    const text = execFileSync('pdftotext', [pdf, '-']).toString();
    check(/KITCHEN/.test(text) && /LIVING ROOM/.test(text), 'PDF: the drawing’s text is still text', R);
    // ---- flattened PDF
    const flat = OUT + '/t10_cover_flat.pdf';
    await saveVia(app, page, 'Save as flattened PDF…', flat);
    execFileSync('pdftoppm', ['-r', '100', '-png', '-singlefile', flat, OUT + '/t10_cover_flat']);
    st = pngStats(OUT + '/t10_cover_flat.png', K[0] / 4, K[1] / 4);
    check(near(st.mean, onPaper, 8), `flattened PDF: the kitchen highlight shows its own colour ${fmt(st.mean)}`, R);

    // ---- progress map: status colours cover the paint too
    await page.evaluate(() => {
      const t = window.__plantint;
      t.S.markups = t.S.markups.map((m) => Object.freeze({ ...m, prog: Object.freeze({ st: 'todo' }) }));
      t.S.progress = Object.freeze({ ...t.S.progress, on: true });
      t.emit('doc');
    });
    const todo = [229, 72, 77].map((v) => 255 * (0.5 + (0.5 * v) / 255));
    c = await screenNear(page, K, todo, 10);
    check(near(c, todo, 10), `progress map: the Not started colour covers the yellow ${fmt(c)}`, R);
    await page.evaluate(() => { const t = window.__plantint; t.S.progress = Object.freeze({ ...t.S.progress, on: false }); t.emit('doc'); });

    // ---- the project keeps the setting; reopened, the paint is covered again
    const proj = OUT + '/t10_cover.plantint';
    fs.rmSync(proj, { force: true });
    await stubSave(app, proj);
    await page.keyboard.press('Control+Shift+s');
    await page.waitForSelector('.save-type');
    await page.click('.save-type[data-id="plantint"]');
    await page.click('.modal .btn.primary');
    const t0 = Date.now();
    while (!fs.existsSync(proj) && Date.now() - t0 < 30000) await page.waitForTimeout(150);
    await page.waitForTimeout(500);
    const meta = JSON.parse(execFileSync('python3', ['-c', 'import sys, zipfile; print(zipfile.ZipFile(sys.argv[1]).read("project.json").decode())', proj]).toString());
    const offs = meta.markups.filter((m) => m.cover === false).length;
    check(offs === 1 && meta.markups.length === 3, `the project stores the setting only where it is off (${offs} of ${meta.markups.length})`, R);
    allErrors = allErrors.concat(errors);
  } finally {
    await quit(app);
  }
}

// ------------------------------------------------------------------ reopening the project
{
  const { app, page, errors } = await launch(OUT + '/t10_cover.plantint');
  try {
    await waitDoc(page);
    await page.waitForFunction(() => window.__plantint.S.markups.length === 3, null, { timeout: 30000 });
    const K = P(1.0, 5.2), BED2 = P(8.7, 1.5);
    let c = await screenNear(page, K, onPaper, 9);
    check(near(c, onPaper, 9), `reopened: the kitchen highlight covers the yellow ${fmt(c)}`, R);
    const bedTint = [169, 219, 156].map((v, i) => (v * onPaper[i]) / 255);
    c = await screenNear(page, BED2, bedTint, 12);
    check(near(c, bedTint, 12), `reopened: the highlight with the setting off still tints ${fmt(c)}`, R);
    check(await page.evaluate(() => window.__plantint.S.markups.filter((m) => m.cover === false).length === 1), 'reopened: the setting is kept', R);
    allErrors = allErrors.concat(errors);
  } finally {
    await quit(app);
  }
}

// ------------------------------------------------------------------ a JPEG scan of a painted plan
{
  const { app, page, errors } = await launch(DATA + '/scan_plan.jpg');
  try {
    await waitDoc(page);
    const dpi = await page.evaluate(() => window.__plantint.S.doc.dpi);
    const K = P(1.0, 5.2, dpi);
    await setStyle(page, { color: RED, opacity: OP, cover: true });
    await page.keyboard.press('f');
    await clickSheet(page, ...K);
    await waitMarkups(page, 1);
    const c = await screenNear(page, K, onPaper, 14);
    check(near(c, onPaper, 14), `JPEG scan: the highlight covers the yellow on screen ${fmt(c)}`, R);
    const png = OUT + '/t10_scan.png';
    await saveVia(app, page, 'Save as PNG picture…', png);
    // share of the kitchen highlight still tinted by the yellow (specks of the old paint)
    const rings = await page.evaluate(() => window.__plantint.S.markups[0].rings);
    const out = execFileSync('python3', ['-c', `
import sys, json
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert('RGB')
rings = json.loads(sys.argv[2])
m = Image.new('L', im.size, 0)
d = ImageDraw.Draw(m)
for r in rings: d.polygon([(r[i], r[i + 1]) for i in range(0, len(r), 2)], fill=255)
# shrink a little: the edge of the highlight meets the wall
from PIL import ImageFilter
m = m.filter(ImageFilter.MinFilter(9))
inside = yellow = 0
pm = m.load(); pi = im.load()
for y in range(im.size[1]):
    for x in range(im.size[0]):
        if not pm[x, y]: continue
        r, g, b = pi[x, y]
        if r < 150: continue
        inside += 1
        if g - b > 35: yellow += 1
print(json.dumps([inside, yellow]))
`, png, JSON.stringify(rings)]).toString();
    const [inside, yellow] = JSON.parse(out);
    check(inside > 20000 && yellow / inside < 0.03, `JPEG scan: under 3% of the highlight keeps a yellow tint (${yellow} of ${inside})`, R);
    allErrors = allErrors.concat(errors);
  } finally {
    await quit(app);
  }
}

// ------------------------------------------------------------------ a coloured layout picture: Shift+click joins a split building
{
  const { app, page, errors } = await launch(DATA + '/layout_coloured.png');
  try {
    await waitDoc(page);
    await setStyle(page, { color: RED, opacity: OP, cover: true });
    await page.keyboard.press('f');
    // building 2 (green, x 230..379, y 150..259), its number a thick stroke from (275, 156) to (335, 253)
    const left = [245, 240], right = [365, 165], stroke = [305, 205];
    const green = [88, 204, 12];
    await clickSheet(page, ...left);
    await waitMarkups(page, 1);
    let c = await screenNear(page, left, onPaper, 9);
    check(near(c, onPaper, 9), `layout picture: one click covers one side of the building ${fmt(c)}`, R);
    c = await screenPx(page, right);
    check(near(c, green, 8), `the number written across it stops the fill: the other side keeps its green ${fmt(c)}`, R);
    // Shift+click the other side: the same highlight grows over it and over the number
    await page.evaluate(() => { window.__t10Rings = window.__plantint.S.markups[0].rings; });
    await page.keyboard.down('Shift');
    await clickSheet(page, ...right);
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => window.__plantint.S.markups.length > 1 || window.__plantint.S.markups[0].rings !== window.__t10Rings, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const n = await page.evaluate(() => window.__plantint.S.markups.length);
    c = await screenNear(page, right, onPaper, 9);
    check(n === 1 && near(c, onPaper, 9), `Shift+click: one highlight covers both sides (${n} markup) ${fmt(c)}`, R);
    const bb = await page.evaluate(() => {
      const b = [1e9, 1e9, -1e9, -1e9];
      for (const r of window.__plantint.S.markups[0].rings) for (let i = 0; i < r.length; i += 2) { b[0] = Math.min(b[0], r[i]); b[2] = Math.max(b[2], r[i]); b[1] = Math.min(b[1], r[i + 1]); b[3] = Math.max(b[3], r[i + 1]); }
      return b;
    });
    check(bb[0] >= 226 && bb[2] <= 384 && bb[1] >= 146 && bb[3] <= 264, `the joined highlight stays inside the building (${bb.map(Math.round).join(', ')})`, R);
    const inStroke = await page.evaluate(([x, y]) => {
      // point in rings, even-odd
      let inside = false;
      for (const r of window.__plantint.S.markups[0].rings) {
        for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
          const yi = r[i + 1], yj = r[j + 1];
          if ((yi > y) !== (yj > y) && x < r[i] + ((y - yi) * (r[j] - r[i])) / (yj - yi)) inside = !inside;
        }
      }
      return inside;
    }, stroke);
    check(inStroke, 'the number between the two sides is inside the highlight', R);
    const nb1 = await screenPx(page, [95, 240]), nb3 = await screenPx(page, [395, 240]);
    check(near(nb1, green, 8) && near(nb3, [255, 192, 0], 8), `the buildings either side keep their own colour ${fmt(nb1)} ${fmt(nb3)}`, R);
    // undo: back to one side
    await page.keyboard.press('Control+z');
    c = await screenNear(page, right, green, 8);
    check(near(c, green, 8), `undo: the other side is green again ${fmt(c)}`, R);
    // Shift+click with no highlight next to it: a new highlight
    await page.keyboard.down('Shift');
    await clickSheet(page, 700, 240); // building 5 (cyan), left side
    await page.keyboard.up('Shift');
    await waitMarkups(page, 2);
    check(true, 'Shift+click with no highlight next to it makes a new one', R);
    allErrors = allErrors.concat(errors);
  } finally {
    await quit(app);
  }
}

process.exit(summary(R, allErrors) ? 0 : 1);
