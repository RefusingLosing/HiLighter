// Unit tests for merging markups: the shape (geom.js mergeRings) and the markups (merge.js).
// Runs in Node: node test/unit/merge_test.mjs
import * as G from '../../src/renderer/geom.js';
import { S } from '../../src/renderer/state.js';
import { mergeMarkups, mergeReach, canMerge } from '../../src/renderer/merge.js';
import { undo } from '../../src/renderer/history.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL ' + msg); } };
const near = (got, want, tol, msg) => { if (Math.abs(got - want) <= tol) pass++; else { fail++; console.log(`FAIL ${msg}: got ${got}, want ${want} ±${tol}`); } };
const rect = (x0, y0, x1, y1) => [[x0, y0, x1, y0, x1, y1, x0, y1]];
const area = (rings) => G.ringsArea(rings);
const nPieces = (rings) => G.pieces(rings).length;
const bbox = (rings) => G.ringsBBox(rings).map((v) => Math.round(v * 100) / 100).join(',');
const R = 10; // reach: gaps up to 20 px are filled

// ---- neighbours with a line between them become one shape, the line included
let m = G.mergeRings([rect(0, 0, 100, 100), rect(108, 0, 208, 100)], R);
ok(nPieces(m) === 1, 'two neighbours 8 px apart: one piece');
near(area(m), 208 * 100, 1, 'the line between them is filled in, nothing more');
ok(bbox(m) === '0,0,208,100', `the outline stays straight across the line (${bbox(m)})`);

// ---- shapes further apart stay apart, as parts of one shape
m = G.mergeRings([rect(0, 0, 100, 100), rect(130, 0, 230, 100)], R);
ok(nPieces(m) === 2, 'two shapes 30 px apart: two parts');
near(area(m), 20000, 1, 'and nothing between them is added');

// ---- neighbours side by side, one lower: only the part of the line they share is filled
m = G.mergeRings([rect(0, 0, 100, 100), rect(108, 40, 208, 140)], R);
ok(nPieces(m) === 1, 'neighbours out of line: one piece');
near(area(m), 20000 + 8 * 60, 2, 'only the line along their shared side is filled');

// ---- a narrow notch in one shape stays: it is not between two shapes
const notched = [[0, 0, 45, 0, 45, 60, 55, 60, 55, 0, 100, 0, 100, 100, 0, 100]];
m = G.mergeRings([notched, rect(150, 0, 250, 100)], R);
near(area(m), 9400 + 10000, 1, 'a notch in one of the shapes is kept');
m = G.mergeRings([notched, rect(108, 0, 208, 100)], R);
near(area(m), 9400 + 10000 + 800, 2, 'also next to a neighbour: only the line between them is filled');

// ---- a hole stays a hole
const courtyard = [[0, 0, 100, 0, 100, 100, 0, 100], [40, 40, 40, 52, 52, 52, 52, 40]];
m = G.mergeRings([courtyard, rect(108, 0, 208, 100)], R);
near(area(m), 10000 - 144 + 10000 + 800, 2, 'a small hole inside one shape is kept');

// ---- three around a corner: the lines between all of them are filled, one shape
m = G.mergeRings([rect(0, 0, 100, 100), rect(108, 0, 208, 100), rect(0, 108, 208, 208)], R);
ok(nPieces(m) === 1, 'three neighbours: one piece');
near(area(m), 208 * 208, 2, 'with the lines and their crossing filled');

// ---- overlapping and touching shapes
m = G.mergeRings([rect(0, 0, 100, 100), rect(50, 50, 150, 150)], R);
near(area(m), 20000 - 2500, 1, 'overlapping shapes: their union');
m = G.mergeRings([rect(0, 0, 100, 100), rect(100, 0, 200, 100)], R);
ok(nPieces(m) === 1 && Math.abs(area(m) - 20000) < 1, 'touching shapes: one piece');

// ---- one shape, or no reach: just the union
m = G.mergeRings([rect(0, 0, 100, 100)], R);
near(area(m), 10000, 0.01, 'a single shape is itself');
m = G.mergeRings([rect(0, 0, 100, 100), rect(108, 0, 208, 100)], 0);
ok(nPieces(m) === 2, 'with no reach nothing is filled');

// ---- traced fills: ragged outlines (many small steps), as Fill makes them
const ragged = (x0, y0, w, h, seed) => {
  const r = [];
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s % 1000) / 1000; };
  for (let x = x0; x < x0 + w; x += 3) r.push(x, y0 + rnd() * 2);
  for (let y = y0; y < y0 + h; y += 3) r.push(x0 + w - rnd() * 2, y);
  for (let x = x0 + w; x > x0; x -= 3) r.push(x, y0 + h - rnd() * 2);
  for (let y = y0 + h; y > y0; y -= 3) r.push(x0 + rnd() * 2, y);
  return [r];
};
const a = ragged(0, 0, 900, 600, 7), b = ragged(906, 0, 900, 600, 11);
const t0 = Date.now();
m = G.mergeRings([a, b], R);
const ms = Date.now() - t0;
ok(nPieces(m) === 1, 'two ragged fills 6 px apart: one piece');
const gapArea = area(m) - area(a) - area(b);
ok(gapArea > 6 * 600 * 0.9 && gapArea < 6 * 600 * 1.6, `the gap between them is filled (${Math.round(gapArea)} px² added for a 6 × 600 px gap)`);
ok(ms < 1500, `quick enough on ragged outlines (${ms} ms)`);
// a block of plots (8 × 5), each a ragged fill, 5 px apart: one shape, no specks left along the outline
const block = [];
for (let i = 0; i < 40; i++) block.push(ragged((i % 8) * 305, Math.floor(i / 8) * 205, 300, 200, i + 3));
const t1 = Date.now();
m = G.mergeRings(block, R);
const ms1 = Date.now() - t1;
ok(nPieces(m) === 1, `a block of 40 plots: one piece (${nPieces(m)})`);
ok(ms1 < 4000, `merging 40 ragged plots takes ${ms1} ms`);
const far = ragged(1000, 0, 900, 600, 13);
const sumFar = area(a) + area(far);
m = G.mergeRings([a, far], R);
near(area(m), sumFar, sumFar * 1e-4, 'ragged outlines apart: their own steps are not filled');

// ---- merging markups: what the merged markup keeps
const mk = (id, name, color, rings, extra = {}) => Object.freeze({ id, name, kind: 'fill', rings, color, opacity: 0.45, borderPt: 1, borderColor: null, borderStyle: 'solid', ...extra });
S.doc = { dpi: 400, W: 6000, H: 4000, name: 'site.pdf', text: [] };
const P1 = mk('m1', 'Plot 1', '#F25F5C', rect(1000, 1000, 1600, 1400), { prog: Object.freeze({ st: 'done' }) });
const P2 = mk('m2', 'Plot 2', '#3FA7E0', rect(1608, 1000, 2200, 1400), { prog: Object.freeze({ st: 'doing', pct: 40 }), tagAt: [1900, 1200] });
const ROAD = mk('m3', 'Road', '#FFD60A', rect(0, 1500, 3000, 1700));
const TOP = mk('m4', 'Kiosk', '#57CC99', rect(1700, 1100, 1800, 1200));
S.markups = [P1, P2, ROAD, TOP];
S.selection = new Set();
near(mergeReach(), (0.6 / 25.4) * 400, 1e-9, 'merging fills gaps up to 1.2 mm on the sheet (half of it either side)');
ok(!canMerge(['m1']) && canMerge(['m1', 'm3']) && !canMerge(['m1', 'gone']), 'two markups are needed to merge');
ok(mergeMarkups(['m1'], 'm1') === null && mergeMarkups(['m1', 'm2'], 'gone') === null, 'nothing to merge: nothing happens');
let res = mergeMarkups(['m1', 'm2'], 'm2');
const got = S.markups.find((q) => q.id === 'm2');
ok(res && res.n === 2 && S.markups.length === 3 && !S.markups.some((q) => q.id === 'm1'), 'Plot 1 goes into Plot 2');
ok(got.name === 'Plot 2' && got.color === '#3FA7E0' && got.prog.st === 'doing' && got.prog.pct === 40 && got.borderPt === 1 && got.kind === 'fill',
  'the one merged into keeps its name, colour, status, border and kind');
near(area(got.rings), 600 * 400 + 592 * 400 + 8 * 400, 2, 'with the line between the plots filled in');
ok(S.markups.map((q) => q.id).join() === 'm2,m3,m4', 'and keeps its place in the drawing order (the kiosk stays on top of it)');
ok(got.tagAt && got.tagAt[0] === 1900, 'a tag placed by hand stays where it was put');
ok([...S.selection].join() === 'm2', 'the merged markup is selected');
await undo();
ok(S.markups.length === 4 && S.markups[0] === P1 && S.markups[1] === P2, 'one undo brings both back, as they were');
res = mergeMarkups(['m3', 'm1'], 'm1');
const far1 = S.markups.find((q) => q.id === 'm1');
ok(res && G.pieces(far1.rings).length === 2 && Math.abs(area(far1.rings) - (600 * 400 + 3000 * 200)) < 2, 'areas apart: one markup in two parts, nothing added');

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
