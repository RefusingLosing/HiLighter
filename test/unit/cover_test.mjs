// Unit tests for 1.5.1: highlights that cover colour already painted on the drawing
// (coverPaints, paintModels, unpaintPixels in imgproc.js) and the markup's cover setting
// (covers.js, state.js). Runs in Node: node test/unit/cover_test.mjs
import * as IP from '../../src/engine/imgproc.js';
import { S, makeMarkup } from '../../src/renderer/state.js';
import { covers, covering } from '../../src/renderer/covers.js';
import { PROGRESS_DEFAULT } from '../../src/renderer/state.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL ' + msg); } };
const near = (got, want, tol, msg) => ok(Math.abs(got - want) <= tol, `${msg}: got ${got}, want ${want} ±${tol}`);

// a picture: W x H, white paper
const W = 400, H = 300;
const paper = [255, 255, 255];
function picture() { const p = new Uint8ClampedArray(W * H * 4); p.fill(255); return p; }
function rect(p, x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; }
}
function px(p, x, y) { const i = (y * W + x) * 4; return [p[i], p[i + 1], p[i + 2]]; }
const box = (x0, y0, x1, y1) => {
  const w = x1 - x0, h = y1 - y0, mask = new Uint8Array(w * h).fill(1);
  return { x0, y0, w, h, mask };
};
const paintsOf = (p, b, r = 3, minSolid = 40) => IP.coverPaints(p, W, H, b.x0, b.y0, b.w, b.h, b.mask, paper, r, minSolid);
const cover = (p, b, paints, tol = 24, loose = 0.22) => IP.unpaintPixels(p, W, b.x0, b.y0, b.w, b.h, b.mask, b.w, 0, 0, IP.paintModels(paints, paper), tol, loose);
const close = (a, b, d) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= d;

// ---- a building painted green with its number in black and a thin red mark across it
const GREEN = [88, 204, 12];
let p = picture();
rect(p, 50, 50, 250, 200, GREEN);
rect(p, 50, 50, 250, 52, [0, 0, 0]);          // outline (top)
rect(p, 120, 110, 180, 122, [10, 10, 10]);    // the number: a black bar of writing
rect(p, 60, 160, 240, 162, [220, 30, 30]);    // a thin red line (2 px)
let b = box(52, 53, 248, 198);
let paints = paintsOf(p, b);
ok(paints.length >= 1, 'green fill found as paint');
ok(paints.every((c) => close(c, GREEN, 30)), `only green counts as paint (${JSON.stringify(paints.map((c) => c.map(Math.round)))})`);
let changed = cover(p, b, paints);
ok(changed > 0, 'pixels changed');
ok(close(px(p, 70, 80), [255, 255, 255], 6), `green turns to paper (${px(p, 70, 80)})`);
ok(close(px(p, 150, 115), [10, 10, 10], 6), 'the number stays black');
ok(close(px(p, 150, 161), [220, 30, 30], 6), 'the thin red line stays');
ok(close(px(p, 150, 51), [0, 0, 0], 3), 'the outline outside the highlight is untouched');
ok(close(px(p, 30, 30), [255, 255, 255], 0), 'paper outside is untouched');

// ---- outside the mask nothing changes
p = picture();
rect(p, 50, 50, 250, 200, GREEN);
b = box(50, 50, 250, 200);
b.mask.fill(0);
for (let y = 0; y < 150; y++) for (let x = 0; x < 100; x++) b.mask[y * b.w + x] = 1; // left half only
paints = paintsOf(p, b);
cover(p, b, paints);
ok(close(px(p, 80, 100), [255, 255, 255], 6), 'covered half turns to paper');
ok(close(px(p, 200, 100), GREEN, 0), 'the other half keeps its paint');

// ---- several fills under one highlight, a light grey fill, but not dark grey walls
p = picture();
rect(p, 20, 20, 120, 120, [255, 192, 0]);     // orange
rect(p, 120, 20, 220, 120, [55, 165, 200]);   // water blue
rect(p, 220, 20, 320, 120, [217, 217, 217]);  // light grey zone
rect(p, 320, 20, 380, 120, [58, 58, 58]);     // dark grey wall (poché)
b = box(20, 20, 380, 120);
paints = paintsOf(p, b);
cover(p, b, paints);
ok(close(px(p, 70, 70), [255, 255, 255], 8), 'orange taken out');
ok(close(px(p, 170, 70), [255, 255, 255], 8), 'blue taken out');
ok(close(px(p, 270, 70), [255, 255, 255], 8), 'light grey taken out');
ok(close(px(p, 350, 70), [58, 58, 58], 3), 'dark grey wall stays');

// ---- coloured hatching (thin lines) is line work, not paint
p = picture();
for (let x = 40; x < 360; x += 12) rect(p, x, 40, x + 2, 260, [232, 89, 12]);
b = box(30, 30, 370, 270);
paints = paintsOf(p, b);
ok(paints.length === 0, `hatching is not paint (${paints.length})`);

// ---- noise (a scan or a JPEG): the loose reading leaves no specks of the old colour
p = picture();
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let y = 50; y < 250; y++) for (let x = 50; x < 350; x++) {
  const n = () => Math.round((rnd() - 0.5) * 32);
  const i = (y * W + x) * 4; p[i] = 90 + n(); p[i + 1] = 205 + n(); p[i + 2] = 20 + n();
}
b = box(50, 50, 350, 250);
paints = paintsOf(p, b);
const before = new Uint8ClampedArray(p);
cover(p, b, paints, 24, 0);
let left = 0;
for (let y = 50; y < 250; y++) for (let x = 50; x < 350; x++) { const c = px(p, x, y); if (c[1] - c[0] > 40) left++; }
const strict = left;
p = before;
cover(p, b, paints);
left = 0;
for (let y = 50; y < 250; y++) for (let x = 50; x < 350; x++) { const c = px(p, x, y); if (c[1] - c[0] > 40) left++; }
ok(left < 60000 * 0.01, `noisy paint: under 1% specks left with the loose reading (${left} of 60000; strict fit left ${strict})`);
ok(left <= strict, 'the loose reading leaves no more specks than the strict fit');

// ---- dark text anti-aliased into the paint keeps its softness (darkness), loses the colour
p = picture();
rect(p, 0, 0, 200, 100, [255, 240, 168]);    // pale yellow room
const k = 0.5;                                   // half-covered by black ink
rect(p, 100, 50, 101, 51, [255 * k, 240 * k, 168 * k]);
b = box(0, 0, 200, 100);
paints = paintsOf(p, b);
cover(p, b, paints);
near(px(p, 100, 50)[0], 128, 4, 'an anti-aliased ink pixel keeps its darkness');
near(px(p, 100, 50)[2], 128, 6, 'and loses the yellow (grey, not dark yellow)');

// ---- unpaint (the eraser) still works the same through paintModels/unpaintPixels
p = picture();
rect(p, 10, 10, 60, 60, [191, 227, 245]);
const part = { x0: 0, y0: 0, w: 80, h: 80, mask: new Uint8Array(6400).fill(1), colors: [[191, 227, 245]] };
const r = IP.unpaint(p, W, part, paper);
ok(r.changed === 2500 && r.patch.length === 6400, `eraser: ${r.changed} pixels changed, patch kept`);
IP.restorePatch(p, W, part, r.patch);
ok(close(px(p, 30, 30), [191, 227, 245], 0), 'eraser undo restores the paint');

// ---- small or empty input
p = picture();
b = box(10, 10, 12, 12);
ok(paintsOf(p, b).length === 0, 'paper only: no paint');
ok(IP.unpaintPixels(p, W, 0, 0, 5, 5, new Uint8Array(25).fill(1), 5, 0, 0, IP.paintModels([], paper)) === 0, 'no paint colours: nothing changes');

// ---- reduce2xFrom matches reduce2x over the same source
{
  const sw = 37, sh = 23, src = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < src.length; i++) src[i] = (i * 37) % 251;
  const dw = Math.ceil(sw / 2), dh = Math.ceil(sh / 2);
  const a = new Uint8ClampedArray(dw * dh * 4), c = new Uint8ClampedArray(dw * dh * 4);
  IP.reduce2x(src, sw, sh, a, dw, 3, 2, dw, dh);
  const part2 = IP.copyRect(src, sw, 6, 4, sw - 6, sh - 4);
  IP.reduce2xFrom(part2, sw - 6, 6, 4, sw, sh, c, dw, 3, 2, dw, dh);
  let same = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) { same = false; break; }
  ok(same, 'reduce2xFrom gives the same pixels as reduce2x');
}

// ---- the markup setting
S.doc = { dpi: 300 };
S.style = { ...S.style, cover: true };
let m = makeMarkup({ kind: 'fill', rings: [[0, 0, 10, 0, 10, 10]] });
ok(covers(m) && !('cover' in m), 'a new markup covers paint (and stores nothing extra)');
S.style = { ...S.style, cover: false };
m = makeMarkup({ kind: 'fill', rings: [[0, 0, 10, 0, 10, 10]] });
ok(!covers(m) && m.cover === false, 'with cover off, a new markup tints');
ok(covers({ id: 'm1' }), 'markups from older projects cover paint');
S.markups = []; S.progress = PROGRESS_DEFAULT;
S.style = { ...S.style, cover: true, opacity: 0 };
m = makeMarkup({ kind: 'polygon', rings: [[0, 0, 10, 0, 10, 10]] });
ok(covers(m) && !covering(m), 'an outline with no fill (0% opacity) takes no paint out');
S.progress = Object.freeze({ ...PROGRESS_DEFAULT, on: true });
ok(covering(m), 'on the progress map it shows a status colour, so it covers the paint');
S.progress = PROGRESS_DEFAULT;
S.style = { ...S.style, opacity: 0.45 };
ok(covering(makeMarkup({ kind: 'polygon', rings: [[0, 0, 10, 0, 10, 10]] })), 'a normal highlight covers the paint');

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
