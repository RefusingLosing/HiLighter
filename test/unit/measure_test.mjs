// Unit tests for measuring: units and scale (units.js), visible areas (measure.js) and the
// schedule files (schedule.js). Runs in Node: node test/unit/measure_test.mjs
import { S, MEAS_DEFAULT, makeMarkup } from '../../src/renderer/state.js';
import * as U from '../../src/renderer/units.js';
import * as M from '../../src/renderer/measure.js';
import { scheduleData, scheduleCsv, scheduleXlsx } from '../../src/renderer/schedule.js';
import { unzipSync, strFromU8 } from 'fflate';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const ok = typeof want === 'number' ? Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)) : got === want;
  if (ok) pass++; else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const near = (got, want, tol, msg) => { if (Math.abs(got - want) <= tol) pass++; else { fail++; console.log(`FAIL ${msg}: got ${got}, want ${want} ±${tol}`); } };

const sheet = (props = {}) => {
  S.doc = { dpi: 400, physical: true, scale: 50, W: 6615, H: 4678, text: [], name: 'test.pdf', pageCount: 1, pageIndex: 0, ...props };
  S.calib = null;
  S.meas = Object.freeze({ ...MEAS_DEFAULT });
  S.markups = []; S.dims = [];
};
const mm = (v) => (v * 400) / 25.4; // millimetres on paper -> sheet px
const setMeas = (p) => { S.meas = Object.freeze({ ...S.meas, ...p }); };

// ---- scale
sheet();
eq(U.scaleSource(), 'title', 'title block scale');
eq(U.fmtScale(), '1:50', 'title block scale text');
near(U.realPerPx(), (50 * 0.0254) / 400, 1e-12, 'metres per pixel at 1:50, 400 dpi');
eq(U.lengthLabel(mm(88)), '4.40 m', '88 mm on paper at 1:50');
S.calib = { kind: 'typed', mPerPx: U.mPerPxForRatio(100), ratio: 100 };
eq(U.fmtScale(), '1:100', 'typed scale');
eq(U.scaleSource(), 'typed', 'typed scale source');
S.calib = { kind: 'none', mPerPx: 0 };
eq(U.hasScale(), false, 'cleared scale: none');
eq(U.lengthLabel(mm(88)), '88.0 mm', 'no scale: millimetres on paper');
eq(U.areaLabel(1000), '', 'no scale: no area');
S.calib = { kind: 'calib', mPerPx: 12 / mm(240.3) };
eq(U.fmtScale(), '1:49.9', 'calibrated scale keeps one decimal');
sheet({ physical: false, scale: 0, dpi: 150 });
eq(U.lengthUnit(), 'px', 'picture without print size: pixels');
S.calib = { kind: 'calib', mPerPx: 0.00635 };
eq(U.fmtScale(), '1 px = 6.35 mm', 'calibrated picture');
eq(U.lengthLabel(1000), '6.35 m', 'calibrated picture lengths');

// ---- formatting in every unit
sheet();
const m4400 = mm(88); // 4.40 m
const cases = [['mm', '4,400 mm'], ['cm', '440.0 cm'], ['m', '4.40 m'], ['km', '0.004 km'], ['in', '173.2 in'], ['ft', '14.44 ft'], ['ftin', `14'-5"`], ['yd', '4.81 yd']];
for (const [u, want] of cases) { setMeas({ len: u }); eq(U.lengthLabel(m4400), want, `length in ${u}`); }
setMeas({ len: 'm' });
const a20 = mm(88) * mm(100); // 4.4 m × 5 m = 22 m²
const acases = [['mm2', '22,000,000 mm²'], ['cm2', '220,000 cm²'], ['m2', '22.00 m²'], ['ha', '0.0022 ha'], ['in2', '34,100 in²'], ['ft2', '236.8 ft²'], ['yd2', '26.31 yd²'], ['ac', '0.005 ac']];
for (const [u, want] of acases) { setMeas({ area: u }); eq(U.areaLabel(a20), want, `area in ${u}`); }
setMeas({ area: 'm2', dec: 3 });
eq(U.areaLabel(a20), '22.000 m²', 'three decimals');
setMeas({ dec: 0 });
eq(U.lengthLabel(m4400), '4 m', 'no decimals');
setMeas({ dec: 'auto', len: 'ftin' });
eq(U.fmtFtIn(14.4357), `14'-5"`, 'feet and inches, half inch');
eq(U.fmtFtIn(0.5), `0'-6"`, 'under a foot');
eq(U.fmtFtIn(1 + 1 / 96, 3), `1'-0 1/8"`, 'eighth of an inch');
eq(U.fmtFtIn(11.99999, 1), `12'-0"`, 'rounds up into the next foot');
setMeas({ dec: 3, area: 'ft2' });
eq(U.areaLabel(a20), '236.8 ft²', 'inch rounding leaves area decimals alone');

// ---- typing lengths
sheet();
setMeas({ len: 'm' });
eq(U.parseLength('4.4'), 4.4, 'bare number in metres');
eq(U.parseLength('4,4'), 4.4, 'decimal comma');
eq(U.parseLength('1,250'), 1250, 'thousands separator');
eq(U.parseLength('4400mm'), 4.4, 'millimetres typed while in metres');
eq(U.parseLength('440 cm'), 4.4, 'centimetres');
near(U.parseLength('14 ft'), 4.2672, 1e-9, 'feet typed while in metres');
near(U.parseLength(`14'6"`), 4.4196, 1e-9, 'feet and inches typed while in metres');
eq(Number.isNaN(U.parseLength('abc')), true, 'nonsense is NaN');
eq(Number.isNaN(U.parseLength('12 px')), true, 'pixels are not a real length');
setMeas({ len: 'ftin' });
near(U.parseLength(`10'6"`), 10.5, 1e-9, '10\'6" in decimal feet');
near(U.parseLength(`10' 6 1/2"`), 10 + 6.5 / 12, 1e-9, 'with a fraction');
near(U.parseLength(`10'-6"`), 10.5, 1e-9, 'with a dash');
near(U.parseLength('10-6'), 10.5, 1e-9, 'dash form in the ft-in unit');
near(U.parseLength('8'), 8, 1e-9, 'bare number is feet');
near(U.parseLength('6"'), 0.5, 1e-9, 'inches only');
near(U.parseLength('1/2"'), 1 / 24, 1e-9, 'a fraction of an inch');
near(U.parseRealLength('12', 'm'), 12, 1e-12, 'real length, bare');
near(U.parseRealLength('12600 mm', 'm'), 12.6, 1e-12, 'real length with a unit');
near(U.parseRealLength(`39'4 1/2"`, 'm'), 39.375 * 0.3048, 1e-12, 'real length in feet and inches');
sheet({ scale: 0 });
eq(U.parseLength('25'), 25, 'no scale: millimetres on paper');
eq(U.parseLength('2.5 cm'), 25, 'no scale: a unit is read on paper');

// ---- visible areas and perimeters
sheet();
const rect = (x, y, w, h) => [[x, y, x + w, y, x + w, y + h, x, y + h]];
const A = makeMarkup({ kind: 'polygon', rings: rect(0, 0, 1000, 600), style: { color: '#FFD60A', opacity: 0.45 } });
const B = makeMarkup({ kind: 'polygon', rings: rect(200, 100, 300, 200), style: { color: '#3FA7E0', opacity: 0.45 } });
S.markups = [A, B];
near(M.measureAt(0).area, 600000 - 60000, 0.01, 'a markup on top is left out of the one below');
near(M.measureAt(0).perim, 3200 + 1000, 0.01, 'perimeter counts the outline of the hole too');
near(M.measureAt(1).area, 60000, 0.01, 'the one on top keeps its full area');
S.markups = [B, A];
near(M.measureAt(0).area, 0, 0.01, 'fully covered: nothing visible');
near(M.totals().area, 600000, 0.01, 'total is what is coloured');
S.markups = [A];
const hole = makeMarkup({ kind: 'fill', rings: [...rect(0, 0, 100, 100), ...rect(25, 25, 50, 50)], style: { color: '#FFD60A', opacity: 0.45 } });
S.markups = [hole];
near(M.measureAt(0).area, 10000 - 2500, 0.01, 'a hole inside a markup is not counted');
const p = M.polylabel(rect(0, 0, 1000, 200));
near(p[1], 100, 2, 'label point sits in the middle of a long strip');
const L = M.polylabel([[0, 0, 600, 0, 600, 100, 100, 100, 100, 600, 0, 600]]);
const inside = (x, y) => x >= 0 && y >= 0 && (x <= 100 || y <= 100) && x <= 600 && y <= 600;
eq(inside(L[0], L[1]), true, 'label point of an L shape is inside it');

// ---- schedules
sheet();
S.markups = [
  Object.freeze({ ...makeMarkup({ kind: 'polygon', rings: rect(0, 0, mm(100), mm(60)), style: { color: '#FFD60A', opacity: 0.45 } }), name: 'Kitchen' }),
  Object.freeze({ ...makeMarkup({ kind: 'polygon', rings: rect(mm(120), 0, mm(40), mm(40)), style: { color: '#3FA7E0', opacity: 0.45 } }), name: 'Bath, "main"' }),
  Object.freeze({ ...makeMarkup({ kind: 'polygon', rings: rect(mm(200), 0, mm(20), mm(20)), style: { color: '#FFD60A', opacity: 0.45 } }), name: 'غرفة' }),
];
const D = scheduleData();
near(D.rows[0].area, 15, 1e-3, 'schedule: area in m² (100 × 60 mm at 1:50)');
near(D.rows[0].perim, 16, 1e-3, 'schedule: perimeter in m');
eq(D.groups.length, 2, 'schedule: totals by colour');
near(D.groups[0].area, 16, 1e-3, 'schedule: two yellows add up');
const csvBytes = scheduleCsv(D);
eq([...csvBytes.slice(0, 3)].join(), '239,187,191', 'CSV starts with a UTF-8 byte order mark (Excel then reads Arabic and ² correctly)');
const csv = strFromU8(csvBytes).replace(/^﻿/, '');
eq(csv.split('\r\n')[2], `"Bath, ""main""",${D.rows[1].colour},#3FA7E0,4.00,8.00`, 'CSV quotes names with commas and quotes');
eq(csv.split('\r\n')[3].startsWith('غرفة,'), true, 'CSV keeps Arabic names');
const files = unzipSync(scheduleXlsx(D));
for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) eq(!!files[f], true, 'xlsx part ' + f);
const sh = strFromU8(files['xl/worksheets/sheet1.xml']);
eq(sh.includes('<f>SUM(D2:D4)</f>'), true, 'xlsx total formula');
eq(sh.includes('Bath, &quot;main&quot;'), true, 'xlsx escapes text');
eq(sh.includes('غرفة'), true, 'xlsx keeps Arabic text');
const v2 = /<c r="D2" s="2"><v>([\d.]+)<\/v><\/c>/.exec(sh);
near(v2 ? +v2[1] : NaN, 15, 1e-3, 'xlsx stores areas as numbers');
eq(strFromU8(files['xl/styles.xml']).includes('formatCode="#,##0.00"'), true, 'xlsx number format follows the decimals');

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
