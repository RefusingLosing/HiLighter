// Excel reports.
// Progress report: every zone with its status, % done and weight (area or units), the % complete and
// the totals by status. The totals are formulas, so changing a status or a % in Excel updates them.
// Snag list: every pin with its number, place (the zone it is in), trade, note, status, dates and
// photo, then a summary by trade and status.

import { S } from './state.js';
import { measureAt } from './measure.js';
import { STATUSES, STATUS, progOf, progressSummary, progressBy } from './progress.js';
import { PIN_STATUSES, PIN_STATUS, pinsByNumber, pinPlace, pinCounts, photoThumb, today } from './pins.js';
import { areaNumber, areaUnitLabel, areaDecimals, hasScale } from './units.js';
import { buildXlsx, styleBook, sheetRef, excelDate, colPx } from './xlsx.js';

const LIGHT = { todo: '#F9D9DA', doing: '#FDEBCB', done: '#D4EEDD', skip: '#E8EAE5', open: '#FADAD7', fixed: '#FCE6C8', closed: '#D3EFDC' };
const HEAD = '#EDEFEB', TOTAL = '#F4F5F2', MUTED = '#6B716D';
const DATE_FMT = 'dd/mm/yyyy';
const numFmt = (dec) => (dec > 0 ? '#,##0.' + '0'.repeat(dec) : '#,##0');

export function drawingTitle() {
  const d = S.doc;
  return (d.projectName || d.name || 'Drawing').replace(/\.[^.]+$/, '') + (d.pageCount > 1 ? ` (page ${d.pageIndex + 1})` : '');
}

// ------------------------------------------------------------------ progress

/** The numbers behind the progress report; weight is units, area in the chosen unit, or a share of the area. */
export function progressData() {
  const by = progressBy();
  const scaled = hasScale();
  const areaAll = S.markups.reduce((s, m, i) => s + measureAt(i).area, 0);
  const rows = S.markups.map((m, i) => {
    const p = progOf(m);
    const area = measureAt(i).area;
    const weight = by === 'units' ? p.units : scaled ? areaNumber(area) : areaAll > 0 ? area / areaAll : 0;
    return { name: (m.name || '').trim() || 'Untitled', st: p.st, status: STATUS[p.st].label, pct: p.pct / 100, weight };
  });
  const s = progressSummary();
  return { by, scaled, rows, pct: s.pct / 100, groups: s.groups, drawing: drawingTitle(), weightTitle: by === 'units' ? 'Units' : scaled ? `Area (${areaUnitLabel()})` : 'Area share' };
}

export function progressXlsx(data = progressData()) {
  const st = styleBook();
  const title = st.xf({ bold: true, size: 14 });
  const muted = st.xf({ color: MUTED });
  const dateS = st.xf({ color: MUTED, fmt: DATE_FMT, h: 'left' });
  const big = st.xf({ bold: true, size: 13 });
  const bigPct = st.xf({ bold: true, size: 13, fmt: '0%', h: 'left' });
  const head = st.xf({ bold: true, fill: HEAD, border: true });
  const headR = st.xf({ bold: true, fill: HEAD, border: true, h: 'right' });
  const cell = st.xf({ border: true });
  const pctS = st.xf({ border: true, fmt: '0%' });
  const wFmt = data.by === 'units' ? 'General' : data.scaled ? numFmt(areaDecimals()) : '0.0%';
  const wS = st.xf({ border: true, fmt: wFmt });
  const totS = st.xf({ bold: true, border: true, fill: TOTAL });
  const totPct = st.xf({ bold: true, border: true, fill: TOTAL, fmt: '0%' });
  const totW = st.xf({ bold: true, border: true, fill: TOTAL, fmt: wFmt });
  const stS = Object.fromEntries(STATUSES.map((x) => [x.id, st.xf({ border: true, fill: LIGHT[x.id] })]));
  const n = data.rows.length;
  const HEADER = 4; // 0-based row of the column titles
  const R0 = HEADER + 2, R1 = HEADER + 1 + n; // Excel rows of the first and last zone
  const RT = R1 + 1; // Excel row of the totals
  const counted = (r) => (r.st === 'skip' ? 0 : r.weight);
  const sumD = data.rows.reduce((s, r) => s + r.weight, 0);
  const sumE = data.rows.reduce((s, r) => s + counted(r), 0);
  const sumF = data.rows.reduce((s, r) => s + counted(r) * r.pct, 0);
  const pct = sumE > 0 ? sumF / sumE : 0;
  const by = data.by === 'units' ? 'Units given to each zone' : data.scaled ? 'Visible area of each zone' : 'Visible area of each zone (no scale set: shares of the total)';

  const rows = [];
  rows.push([{ v: `Progress: ${data.drawing}`, s: title }]);
  rows.push([{ v: 'Counted by', s: muted }, { v: by, s: muted }, null, null, { v: 'Saved', s: muted }, { v: excelDate(today()), s: dateS }]);
  rows.push([{ v: 'Complete', s: big }, { f: `C${RT}`, v: pct, s: bigPct }]);
  rows.push([]);
  rows.push([{ v: 'Zone', s: head }, { v: 'Status', s: head }, { v: '% done', s: headR }, { v: data.weightTitle, s: headR }, { v: 'Counted', s: headR }, { v: 'Done', s: headR }]);
  for (const r of data.rows) {
    const R = rows.length + 1;
    rows.push([
      { v: r.name, s: cell },
      { v: r.status, s: stS[r.st] },
      r.st === 'skip' ? { v: '', s: cell } : { v: r.pct, s: pctS },
      { v: r.weight, s: wS },
      { f: `IF(B${R}="${STATUS.skip.label}",0,D${R})`, v: counted(r), s: wS },
      { f: `E${R}*C${R}`, v: counted(r) * (r.st === 'skip' ? 0 : r.pct), s: wS },
    ]);
  }
  const range = (c) => `${c}${R0}:${c}${R1}`;
  rows.push(n ? [
    { v: 'Total', s: totS }, { v: '', s: totS },
    { f: `IF(SUM(${range('E')})=0,0,SUM(${range('F')})/SUM(${range('E')}))`, v: pct, s: totPct },
    { f: `SUM(${range('D')})`, v: sumD, s: totW }, { f: `SUM(${range('E')})`, v: sumE, s: totW }, { f: `SUM(${range('F')})`, v: sumF, s: totW },
  ] : [{ v: 'Total', s: totS }, { v: '', s: totS }, { v: 0, s: totPct }, { v: 0, s: totW }, { v: 0, s: totW }, { v: 0, s: totW }]);
  rows.push([]);
  rows.push([{ v: 'By status', s: head }, { v: 'Zones', s: headR }, { v: data.weightTitle, s: headR }, { v: 'Share', s: headR }]);
  for (const x of STATUSES) {
    if (x.id === 'skip' && !data.groups.skip.n) continue;
    const R = rows.length + 1;
    const mine = data.rows.filter((r) => r.st === x.id);
    const w = mine.reduce((s, r) => s + r.weight, 0);
    rows.push([
      { v: x.label, s: stS[x.id] },
      n ? { f: `COUNTIF($B$${R0}:$B$${R1},A${R})`, v: mine.length, s: cell } : { v: 0, s: cell },
      n ? { f: `SUMIF($B$${R0}:$B$${R1},A${R},$D$${R0}:$D$${R1})`, v: w, s: wS } : { v: 0, s: wS },
      x.id === 'skip' ? { v: '', s: cell } : n ? { f: `IF($E$${RT}=0,0,C${R}/$E$${RT})`, v: sumE > 0 ? w / sumE : 0, s: pctS } : { v: 0, s: pctS },
    ]);
  }
  rows.push([]);
  rows.push([{ v: 'Done zones count 100%, zones not started 0%. Not counted zones are left out of every total.', s: muted }]);
  const sheet = {
    name: 'Progress', rows, widths: [34, 14, 10, 16, 14, 14], freeze: HEADER + 1,
    filter: n ? `A${HEADER + 1}:F${R1}` : null, printTitles: [HEADER + 1, HEADER + 1], fitWidth: true,
  };
  return buildXlsx({ sheets: [sheet], styles: st, title: `Progress: ${data.drawing}` });
}

// ------------------------------------------------------------------ snag list

const PHOTO_COL = 7;
const PHOTO_COL_W = 33; // characters
const PHOTO_W = colPx(PHOTO_COL_W) - 12, PHOTO_H = Math.round(PHOTO_W * 0.75);

export async function snagXlsx() {
  const st = styleBook();
  const title = st.xf({ bold: true, size: 14 });
  const muted = st.xf({ color: MUTED });
  const dateM = st.xf({ color: MUTED, fmt: DATE_FMT, h: 'left' });
  const head = st.xf({ bold: true, fill: HEAD, border: true, v: 'center' });
  const top = st.xf({ border: true, v: 'top' });
  const no = st.xf({ border: true, v: 'top', h: 'center', bold: true });
  const wrap = st.xf({ border: true, v: 'top', wrap: true });
  const date = st.xf({ border: true, v: 'top', fmt: DATE_FMT, h: 'left' });
  const stS = Object.fromEntries(PIN_STATUSES.map((x) => [x.id, st.xf({ border: true, v: 'top', fill: LIGHT[x.id] })]));
  const pins = pinsByNumber();
  const c = pinCounts(pins);
  const drawing = drawingTitle();
  const HEADER = 2;
  const rows = [], heights = {}, images = [];
  rows.push([{ v: `Snag list: ${drawing}`, s: title }]);
  rows.push([{ v: 'Saved', s: muted }, { v: excelDate(today()), s: dateM }, null, { v: `${pins.length} ${pins.length === 1 ? 'snag' : 'snags'}: ${c.open} open, ${c.fixed} fixed, ${c.closed} closed`, s: muted }]);
  rows.push(['No.', 'Location', 'Trade', 'Description', 'Status', 'Raised', 'Closed', 'Photo'].map((v) => ({ v, s: head })));
  for (const p of pins) {
    const ri = rows.length;
    rows.push([
      { v: p.n, s: no },
      { v: pinPlace(p), s: top },
      { v: p.trade || 'No trade', s: top },
      { v: p.note, s: wrap },
      { v: (PIN_STATUS[p.status] || PIN_STATUS.open).label, s: stS[p.status] || stS.open },
      { v: excelDate(p.raised), s: date },
      { v: excelDate(p.closed), s: date },
      { v: '', s: top },
    ]);
    const ph = p.photo && S.photos.get(p.photo);
    if (ph) {
      const t = await photoThumb(ph, 640);
      const k = Math.min(PHOTO_W / t.w, PHOTO_H / t.h);
      const w = Math.max(1, Math.round(t.w * k)), h = Math.max(1, Math.round(t.h * k));
      images.push({ row: ri, col: PHOTO_COL, bytes: t.bytes, ext: 'jpeg', w, h, dx: 6, dy: 6, name: `Snag ${p.n}` });
      heights[ri] = ((h + 12) * 3) / 4;
    }
  }
  const last = rows.length; // Excel row of the last pin
  const list = {
    name: 'Snag list', rows, heights, images, widths: [6, 22, 14, 46, 10, 12, 12, PHOTO_COL_W],
    freeze: HEADER + 1, filter: pins.length ? `A${HEADER + 1}:H${last}` : null, printTitles: [HEADER + 1, HEADER + 1], landscape: true,
  };

  // summary: snags by trade and status
  const sh = sheetRef(list.name);
  const r0 = HEADER + 2;
  const trades = [];
  for (const p of pins) { const t = p.trade || 'No trade'; if (!trades.includes(t)) trades.push(t); }
  const sum = [];
  sum.push([{ v: `Snags by trade: ${drawing}`, s: title }]);
  sum.push([]);
  sum.push([{ v: 'Trade', s: head }, ...PIN_STATUSES.map((x) => ({ v: x.label, s: head })), { v: 'Total', s: head }]);
  const cellN = st.xf({ border: true });
  const tot = st.xf({ bold: true, border: true, fill: TOTAL });
  const first = sum.length + 1;
  for (const t of trades) {
    const R = sum.length + 1;
    const mine = pins.filter((p) => (p.trade || 'No trade') === t);
    sum.push([
      { v: t, s: cellN },
      ...PIN_STATUSES.map((x) => (pins.length
        ? { f: `COUNTIFS(${sh}!$C$${r0}:$C$${last},$A${R},${sh}!$E$${r0}:$E$${last},"${x.label}")`, v: mine.filter((p) => p.status === x.id).length, s: cellN }
        : { v: 0, s: cellN })),
      { f: `SUM(B${R}:D${R})`, v: mine.length, s: cellN },
    ]);
  }
  const lastT = sum.length;
  const colSum = (col) => (trades.length ? { f: `SUM(${col}${first}:${col}${lastT})` } : { v: 0 });
  sum.push([{ v: 'Total', s: tot },
    { ...colSum('B'), v: c.open, s: tot }, { ...colSum('C'), v: c.fixed, s: tot }, { ...colSum('D'), v: c.closed, s: tot }, { ...colSum('E'), v: pins.length, s: tot }]);
  const summary = { name: 'Summary', rows: sum, widths: [22, 10, 10, 10, 10], fitWidth: true };
  return buildXlsx({ sheets: [list, summary], styles: st, title: `Snag list: ${drawing}` });
}
