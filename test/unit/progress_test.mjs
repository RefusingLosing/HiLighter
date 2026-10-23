// Unit tests for 1.5: the progress map (progress.js), snag pins (pins.js), the Excel writer (xlsx.js)
// and the two reports (reports.js). Runs in Node: node test/unit/progress_test.mjs
import { S, MEAS_DEFAULT, PROGRESS_DEFAULT, makeMarkup } from '../../src/renderer/state.js';
import * as PR from '../../src/renderer/progress.js';
import * as PI from '../../src/renderer/pins.js';
import { buildXlsx, styleBook, colName, excelDate, sheetRef, esc } from '../../src/renderer/xlsx.js';
import { progressData, progressXlsx, snagXlsx } from '../../src/renderer/reports.js';
import { unzipSync, strFromU8 } from 'fflate';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const ok = typeof want === 'number' ? Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)) : got === want;
  if (ok) pass++; else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const near = (got, want, tol, msg) => { if (Math.abs(got - want) <= tol) pass++; else { fail++; console.log(`FAIL ${msg}: got ${got}, want ${want} ±${tol}`); } };
const has = (s, part, msg) => eq(s.includes(part), true, msg);

const sheet = () => {
  S.doc = { dpi: 400, physical: true, scale: 50, W: 6615, H: 4678, text: [], name: 'site.pdf', pageCount: 1, pageIndex: 0 };
  S.calib = null;
  S.meas = Object.freeze({ ...MEAS_DEFAULT });
  S.markups = []; S.dims = []; S.pins = []; S.pinNext = 1; S.photos = new Map();
  S.progress = PROGRESS_DEFAULT;
};
const mm = (v) => (v * 400) / 25.4; // millimetres on paper -> sheet px (1 m at 1:50 is 20 mm)
const rect = (x, y, w, h) => [[x, y, x + w, y, x + w, y + h, x, y + h]];
const zone = (name, x, y, w, h, prog) => Object.freeze({
  ...makeMarkup({ kind: 'polygon', rings: rect(x, y, w, h), style: { color: '#FFD60A', opacity: 0.45 } }), name, ...(prog ? { prog: Object.freeze(prog) } : {}),
});

// ---- percentages for people
eq(PR.fmtPct(0), '0%', 'nothing done');
eq(PR.fmtPct(0.4), '1%', 'a little done is never 0%');
eq(PR.fmtPct(46.67), '47%', 'rounded');
eq(PR.fmtPct(99.6), '99%', 'never 100% before everything is done');
eq(PR.fmtPct(100), '100%', 'all done');
eq(PR.fmtPct(NaN), '0%', 'no number');

// ---- a zone's status
sheet();
let m = zone('A', 0, 0, 100, 100);
let p = PR.progOf(m);
eq(`${p.st} ${p.pct} ${p.units} ${p.setPct}`, 'todo 0 1 50', 'a zone without a status is not started, one unit, 50% kept for In progress');
m = PR.withProg(m, { st: 'doing' });
eq(PR.progOf(m).pct, 50, 'In progress starts at 50%');
m = PR.withProg(m, { pct: 130 });
eq(PR.progOf(m).pct, 100, 'the % is kept between 0 and 100');
m = PR.withProg(m, { pct: 62.4 });
eq(PR.progOf(m).pct, 62, 'whole percentages');
m = PR.withProg(m, { st: 'done' });
eq(PR.progOf(m).pct, 100, 'Done counts 100%');
eq(PR.progOf(m).setPct, 62, 'and keeps the % for when it goes back to In progress');
m = PR.withProg(m, { units: -3 });
eq(PR.progOf(m).units, 1, 'units must be more than nothing');
m = PR.withProg(m, { units: 2.345 });
eq(PR.progOf(m).units, 2.35, 'units keep two decimals');
eq(PR.withProg(m, { st: 'nonsense' }).prog.st, 'done', 'an unknown status is ignored');
eq(PR.progLabel(zone('B', 0, 0, 1, 1, { st: 'skip' })), '', 'no label for a zone not counted');
eq(PR.readProg({ st: 'doing', pct: '70', units: 3 }).pct, 70, 'a status read from a project file');
eq(PR.readProg({ st: 'later' }), undefined, 'an unknown status in a file is dropped');
eq(PR.readProg(null), undefined, 'no status in a file');
eq(PR.commonStatus([zone('a', 0, 0, 1, 1, { st: 'done' }), zone('b', 0, 0, 1, 1, { st: 'done' })]), 'done', 'common status');
eq(PR.commonStatus([zone('a', 0, 0, 1, 1, { st: 'done' }), zone('b', 0, 0, 1, 1)]), null, 'mixed statuses');

// ---- the % complete, by visible area and by units
sheet();
S.markups = [
  zone('Under', 0, 0, 1000, 600, { st: 'done' }),            // 600 000 px², 60 000 of it under the next one
  zone('Over', 200, 100, 300, 200, { st: 'doing', pct: 50 }), // 60 000 px²
  zone('Cut', 2000, 0, 100, 100, { st: 'skip' }),
  zone('Later', 3000, 0, 200, 200),                           // 40 000 px², not started
];
let s = PR.progressSummary();
near(s.wAll, 540000 + 60000 + 40000, 0.01, 'counted area: visible parts, the zone not counted left out');
near(s.pct, ((540000 + 30000) / 640000) * 100, 1e-9, 'by area: done counts fully, in progress by its %');
eq(`${s.groups.done.n} ${s.groups.doing.n} ${s.groups.todo.n} ${s.groups.skip.n} ${s.counted}`, '1 1 1 1 3', 'zones by status');
S.progress = Object.freeze({ ...PROGRESS_DEFAULT, by: 'units' });
S.markups = S.markups.map((q, i) => (i === 3 ? PR.withProg(q, { units: 2 }) : q));
s = PR.progressSummary();
near(s.pct, ((1 + 0.5) / 4) * 100, 1e-9, 'by units: (1 + 0.5) / (1 + 1 + 2)');
S.markups = [zone('Cut', 0, 0, 10, 10, { st: 'skip' })];
eq(PR.progressSummary().pct, 0, 'nothing counted: 0%');

// ---- the sheet colours while the map is on
sheet();
const own = zone('Own', 0, 0, 10, 10, { st: 'doing' });
eq(PR.shown(own), own, 'map off: the zone as it is');
S.progress = Object.freeze({ ...PROGRESS_DEFAULT, on: true });
const sh1 = PR.shown(own);
eq(`${sh1.color} ${sh1.opacity} ${sh1.borderColor} ${sh1.name}`, `${PR.STATUS.doing.color} ${PR.PROGRESS_OPACITY} null Own`, 'map on: the status colour');
eq(PR.shown(own), sh1, 'the same object while nothing changes');

// ---- snag pins
sheet();
const day = PI.today();
eq(/^\d{4}-\d{2}-\d{2}$/.test(day), true, 'today as YYYY-MM-DD');
let pin = PI.makePin(500, 800);
eq(`${pin.n} ${pin.status} ${pin.raised === day} ${pin.closed} ${pin.photo} ${pin.id[0]}`, '1 open true null null p', 'a new pin: number 1, open, raised today');
pin = PI.withPin(pin, { status: 'closed' });
eq(pin.closed, day, 'closing a pin dates it');
eq(PI.withPin(pin, { note: 'x' }).closed, day, 'editing a closed pin keeps its date');
eq(PI.withPin(pin, { status: 'fixed' }).closed, null, 'opening it again clears the date');
eq(PI.withPin(pin, { status: 'gone' }).status, 'open', 'an unknown status becomes Open');
eq(PI.readPin({ x: 1, y: 2 }), null, 'a pin without a number is not read');
let rp = PI.readPin({ id: 'pabc', n: 7, x: 10, y: 20, note: 'Crack', trade: 'Civil', status: 'fixed', closed: '2026-01-02', raised: 'yesterday', photo: 3 }, 2, 0.5);
eq(`${rp.id} ${rp.n} ${rp.x} ${rp.y} ${rp.status} ${rp.closed} ${rp.raised} ${rp.photo}`, 'pabc 7 20 10 fixed null null null', 'a pin read from a file: scaled, dates and photo checked');
S.pins = [PI.makePin(1000, 1000)];
const z = PI.pinSize();
near(z.r, (8 / 72) * 400 * 1.05, 1e-9, 'pin head follows the 8 pt text size');
eq(PI.hitPin(1000, 1000), S.pins[0], 'the tip is on the pin');
eq(PI.hitPin(1000, 1000 - z.tail), S.pins[0], 'so is the head');
eq(PI.hitPin(1000 + z.r + z.lw + 5, 1000 - z.tail), null, 'beside the head is not');
eq(PI.hitPin(1000 + z.r + 5, 1000 - z.tail, z.r + 20), S.pins[0], 'a bigger pin on screen is easier to hit');
eq(PI.pinsIn([900, 900, 1100, 1100]).length, 1, 'pins inside a rectangle (by their tip)');
eq(PI.pinsIn([0, 0, 900, 900]).length, 0, 'and outside');
S.markups = [zone('Lobby', 800, 800, 400, 400)];
eq(PI.pinPlace(S.pins[0]), 'Lobby', 'a pin is in the zone under its tip');

// ---- the Excel writer
eq(colName(0) + colName(25) + colName(26) + colName(701), 'AZAAZZ', 'column names');
eq(excelDate('1900-03-01'), 61, 'Excel day numbers');
eq(excelDate('2026-10-24'), 46319, 'Excel day numbers today');
eq(excelDate('soon'), null, 'not a date');
eq(sheetRef("Bob's list"), "'Bob''s list'", 'sheet names in formulas');
eq(esc('a<b & "c"\u0001'), 'a&lt;b &amp; &quot;c&quot;', 'XML text escaped, control characters dropped');
const st = styleBook();
const bold = st.xf({ bold: true }), bold2 = st.xf({ bold: true });
eq(bold, bold2, 'styles are shared');
const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
const book = unzipSync(buildXlsx({ styles: st, title: 'T', sheets: [
  { name: 'One', rows: [['a', { v: 2, s: bold }], [{ f: 'B1*2', v: 4 }]], filter: 'A1:B2', printTitles: [1, 1], freeze: 1, widths: [10, 20],
    images: [{ row: 1, col: 1, bytes: jpg, ext: 'jpeg', w: 100, h: 50 }] },
  { name: 'Two', rows: [['b']] },
] }));
for (const f of ['xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels', 'xl/worksheets/_rels/sheet1.xml.rels', 'xl/media/image1.jpeg', 'docProps/core.xml']) eq(!!book[f], true, 'xlsx part ' + f);
eq(!!book['xl/worksheets/_rels/sheet2.xml.rels'], false, 'a sheet without pictures has no drawing');
const ct = strFromU8(book['[Content_Types].xml']);
has(ct, '<Default Extension="jpeg" ContentType="image/jpeg"/>', 'content type for the pictures');
has(ct, '/xl/drawings/drawing1.xml', 'content type for the drawing');
const wbx = strFromU8(book['xl/workbook.xml']);
has(wbx, '<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'One\'!$A$1:$B$2</definedName>', 'the filter has its defined name');
has(wbx, '<definedName name="_xlnm.Print_Titles" localSheetId="0">\'One\'!$1:$1</definedName>', 'header rows print on every page');
const s1 = strFromU8(book['xl/worksheets/sheet1.xml']);
has(s1, '<c r="A2"><f>B1*2</f><v>4</v></c>', 'formulas keep their value');
has(s1, '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>', 'frozen header');
has(s1, '<drawing r:id="rId1"/>', 'the sheet points to its drawing');
const dr = strFromU8(book['xl/drawings/drawing1.xml']);
has(dr, '<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>1</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>1</xdr:row>', 'a picture anchored to its cell, moving and sizing with it');
has(dr, '<a:ext cx="952500" cy="476250"/>', 'picture size in EMU');

// ---- the progress report
sheet();
S.markups = [
  zone('Play area 1', 0, 0, mm(60), mm(40), { st: 'done' }),            // 3 × 2 m = 6 m²
  zone('Play area 2', mm(100), 0, mm(40), mm(40), { st: 'doing', pct: 60 }), // 4 m²
  zone('Kiosk', mm(200), 0, mm(40), mm(20), { st: 'skip' }),            // 2 m²
  zone('Lawn', mm(300), 0, mm(80), mm(40)),                             // 8 m²
];
const D = progressData();
eq(D.rows.map((r) => r.status).join(), 'Done,In progress,Not counted,Not started', 'report rows have the statuses');
near(D.pct, 8.4 / 18, 1e-4, 'report % complete');
eq(D.weightTitle, 'Area (m²)', 'report weight column');
let x = unzipSync(progressXlsx(D));
let sx = strFromU8(x['xl/worksheets/sheet1.xml']);
has(sx, '<f>IF(B8=&quot;Not counted&quot;,0,D8)</f><v>0</v>', 'a zone not counted counts 0');
has(sx, '<f>E7*C7</f><v>2.4', 'done = counted × % done');
has(sx, '<f>IF(SUM(E6:E9)=0,0,SUM(F6:F9)/SUM(E6:E9))</f><v>0.4666', 'total % complete');
has(sx, '<f>C10</f>', '“Complete” at the top points to the total');
has(sx, '<f>COUNTIF($B$6:$B$9,A13)</f><v>1</v>', 'zones by status');
has(sx, '<autoFilter ref="A5:F9"/>', 'filter over the zones');
S.calib = { kind: 'none', mPerPx: 0 };
eq(progressData().weightTitle, 'Area share', 'no scale: areas as shares of the total');
S.progress = Object.freeze({ ...PROGRESS_DEFAULT, by: 'units' });
eq(progressData().weightTitle, 'Units', 'by units');

// ---- the snag list (no photos here; Node has no picture decoder)
sheet();
S.markups = [zone('Lobby', 0, 0, 1000, 1000)];
S.pins = [
  PI.withPin(PI.makePin(500, 500), { n: 3, note: 'Tile <cracked>', trade: 'Civil', status: 'fixed' }),
  PI.withPin(PI.makePin(5000, 4000), { n: 1, note: 'Socket', trade: 'Electrical', status: 'closed' }),
];
x = unzipSync(await snagXlsx());
sx = strFromU8(x['xl/worksheets/sheet1.xml']);
eq(sx.indexOf('>Socket<') < sx.indexOf('Tile &lt;cracked&gt;'), true, 'snags are listed by number');
has(sx, '<c r="B5" s="', 'location column');
has(sx, '>Lobby<', 'a pin’s place is the zone it is in');
eq(!!x['xl/drawings/drawing1.xml'], false, 'no photos: no drawing');
const sum = strFromU8(x['xl/worksheets/sheet2.xml']);
has(sum, `<f>COUNTIFS('Snag list'!$C$4:$C$5,$A4,'Snag list'!$E$4:$E$5,&quot;Open&quot;)</f><v>0</v>`, 'summary counts by trade and status');
has(sum, '<f>SUM(B4:D4)</f><v>1</v>', 'summary row total');

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
