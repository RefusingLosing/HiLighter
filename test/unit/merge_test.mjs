// Unit tests for merging markups (merge.js): several areas become one markup, each keeping its own
// shape, nothing filled in between. Runs in Node: node test/unit/merge_test.mjs
import * as G from '../../src/renderer/geom.js';
import { S } from '../../src/renderer/state.js';
import { mergeMarkups, canMerge } from '../../src/renderer/merge.js';
import { undo } from '../../src/renderer/history.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL ' + msg); } };
const near = (got, want, tol, msg) => { if (Math.abs(got - want) <= tol) pass++; else { fail++; console.log(`FAIL ${msg}: got ${got}, want ${want} ±${tol}`); } };
const rect = (x0, y0, x1, y1) => [[x0, y0, x1, y0, x1, y1, x0, y1]];
const area = (rings) => G.ringsArea(rings);
const nPieces = (rings) => G.pieces(rings).length;
const mk = (id, name, color, rings, extra = {}) => Object.freeze({ id, name, kind: 'fill', rings, color, opacity: 0.45, borderPt: 1, borderColor: null, borderStyle: 'solid', ...extra });
const reset = (list) => { S.markups = list; S.selection = new Set(); };

S.doc = { dpi: 400, W: 6000, H: 4000, name: 'site.pdf', text: [] };
const P1 = mk('m1', 'Plot 1', '#F25F5C', rect(1000, 1000, 1600, 1400), { prog: Object.freeze({ st: 'done' }) });
const P2 = mk('m2', 'Plot 2', '#3FA7E0', rect(1608, 1000, 2200, 1400), { prog: Object.freeze({ st: 'doing', pct: 40 }), tagAt: [1900, 1200] });
const ROAD = mk('m3', 'Road', '#FFD60A', rect(0, 1500, 3000, 1700));
const KIOSK = mk('m4', 'Kiosk', '#57CC99', rect(1700, 1100, 1800, 1200));
const HALF = mk('m5', 'Plot 2 overlap', '#3FA7E0', rect(2100, 1000, 2400, 1400));
const COURT = mk('m6', 'Courtyard block', '#B07CE0', [[3000, 2000, 3400, 2000, 3400, 2400, 3000, 2400], [3150, 2150, 3150, 2250, 3250, 2250, 3250, 2150]]);

// ---- what can be merged
reset([P1, P2, ROAD, KIOSK]);
ok(!canMerge(['m1']) && canMerge(['m1', 'm3']) && !canMerge(['m1', 'gone']), 'two markups are needed to merge');
ok(mergeMarkups(['m1'], 'm1') === null && mergeMarkups(['m1', 'm2'], 'gone') === null, 'nothing to merge: nothing happens');

// ---- neighbours with a line between them: one markup, each keeping its shape, the line not filled
let res = mergeMarkups(['m1', 'm2'], 'm2');
let got = S.markups.find((q) => q.id === 'm2');
ok(res && res.n === 2 && S.markups.length === 3 && !S.markups.some((q) => q.id === 'm1'), 'Plot 1 goes into Plot 2: one markup');
ok(got.name === 'Plot 2' && got.color === '#3FA7E0' && got.prog.st === 'doing' && got.prog.pct === 40 && got.borderPt === 1 && got.kind === 'fill',
  'the one merged into keeps its name, colour, status, border and kind');
near(area(got.rings), 600 * 400 + 592 * 400, 1, 'its area is the two areas: the line between them is not filled');
ok(nPieces(got.rings) === 2, 'and it is in two parts, as they were');
ok(S.markups.map((q) => q.id).join() === 'm2,m3,m4', 'it keeps its place in the drawing order (the kiosk stays on top of it)');
ok(got.tagAt && got.tagAt[0] === 1900, 'a tag placed by hand stays where it was put');
ok([...S.selection].join() === 'm2', 'the merged markup is selected');
await undo();
ok(S.markups.length === 4 && S.markups[0] === P1 && S.markups[1] === P2, 'one undo brings both back, as they were');

// ---- far apart: parts of one markup
res = mergeMarkups(['m3', 'm1'], 'm1');
got = S.markups.find((q) => q.id === 'm1');
ok(res && nPieces(got.rings) === 2 && Math.abs(area(got.rings) - (600 * 400 + 3000 * 200)) < 1, 'areas apart: one markup in two parts, nothing added');

// ---- overlapping areas count once; touching ones become one part; holes stay
reset([P2, HALF]);
mergeMarkups(['m5'], 'm2');
got = S.markups[0];
near(area(got.rings), 592 * 400 + 300 * 400 - 100 * 400, 1, 'overlapping areas: the overlap counts once');
ok(nPieces(got.rings) === 1, 'and they are one part');
reset([mk('a', 'A', '#F25F5C', rect(0, 0, 100, 100)), mk('b', 'B', '#F25F5C', rect(100, 0, 200, 100))]);
mergeMarkups(['a', 'b'], 'a');
ok(nPieces(S.markups[0].rings) === 1 && Math.abs(area(S.markups[0].rings) - 20000) < 1, 'touching areas: one part');
reset([COURT, mk('c', 'C', '#B07CE0', rect(3500, 2000, 3600, 2400))]);
mergeMarkups(['c'], 'm6');
near(area(S.markups[0].rings), 400 * 400 - 100 * 100 + 100 * 400, 1, 'a hole stays a hole');

// ---- a whole block of plots at once stays as it was drawn
const block = [];
for (let i = 0; i < 40; i++) block.push(mk('b' + i, 'Plot ' + (i + 1), '#57CC99', rect((i % 8) * 305, Math.floor(i / 8) * 205, (i % 8) * 305 + 300, Math.floor(i / 8) * 205 + 200)));
reset(block);
const t0 = Date.now();
mergeMarkups(block.map((m) => m.id), 'b0');
ok(S.markups.length === 1 && nPieces(S.markups[0].rings) === 40 && Math.abs(area(S.markups[0].rings) - 40 * 300 * 200) < 1, `40 plots: one markup in 40 parts, nothing between them filled (${Date.now() - t0} ms)`);

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
