// The legend: a two-column table (Name, Colour) placed on the sheet, one row per markup.
// Sizes are stored in sheet pixels so the table exports at exactly the size seen on screen.

import { S, ptToPx } from './state.js';
import { tintOnPaper, borderColorOf } from './colors.js';
import { dashFor } from '../shared/linestyle.js';
import { measureAt } from './measure.js';
import { hasScale, areaNumber, fmtNum, areaDecimals, areaUnitLabel, lengthUnit, lengthUnitLabel, realPerPx, lengthUnitInfo, fmtFtIn, lengthDecimals } from './units.js';

export const LEGEND_FONT = '"IBM Plex Sans", "IBM Plex Sans Arabic", "Segoe UI", Arial, sans-serif';

/** Readable minimums for the exported sheet, in sheet pixels. */
export function legendLimits() {
  const d = S.doc;
  if (!d) return { nameMin: 12, titleMin: 13, max: 400 };
  const short = Math.min(d.W, d.H);
  const nameMin = Math.ceil(Math.max(0.0055 * short, (6 * d.dpi) / 72, 12));
  const titleMin = Math.ceil(Math.max(0.006 * short, (7 * d.dpi) / 72, 13));
  const max = Math.max(titleMin * 4, Math.round(0.08 * short));
  return { nameMin, titleMin, max };
}

export function clampLegendSizes(L) {
  const { nameMin, titleMin, max } = legendLimits();
  return {
    ...L,
    namePx: Math.round(Math.min(max, Math.max(nameMin, L.namePx))),
    titlePx: Math.round(Math.min(max, Math.max(titleMin, L.titlePx))),
  };
}

export function defaultLegend() {
  const { nameMin, titleMin } = legendLimits();
  const namePx = Math.round(nameMin * 1.55);
  const titlePx = Math.round(Math.max(titleMin * 1.55, namePx * 1.18));
  const L = { visible: true, x: 0, y: 0, titlePx, namePx, merge: false };
  const [x, y] = bestLegendSpot(L);
  return Object.freeze({ ...L, x, y });
}

/**
 * Finds the emptiest place on the sheet for the legend: a window clear of line work and
 * markups, preferring the edges of the sheet.
 */
export function bestLegendSpot(L) {
  const d = S.doc;
  const lay = legendLayout(L, legendRows(L));
  // leave room for rows still to come
  const w = lay.w, h = lay.h + lay.rowH * Math.max(0, 6 - Math.max(1, legendRows(L).length));
  const margin = Math.round(Math.min(d.W, d.H) * 0.03);
  const fallback = [margin, margin];
  const g = d.ink;
  if (!g) return fallback;
  const { cols, rows, cell } = g;
  const occ = Float32Array.from(g.ink);
  for (const m of S.markups) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of m.rings) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    for (let cy = Math.max(0, (y0 / cell) | 0); cy <= Math.min(rows - 1, (y1 / cell) | 0); cy++)
      for (let cx = Math.max(0, (x0 / cell) | 0); cx <= Math.min(cols - 1, (x1 / cell) | 0); cx++) occ[cy * cols + cx] = 1;
  }
  const I = new Float64Array((cols + 1) * (rows + 1));
  for (let y = 0; y < rows; y++) {
    let run = 0;
    for (let x = 0; x < cols; x++) { run += occ[y * cols + x]; I[(y + 1) * (cols + 1) + x + 1] = I[y * (cols + 1) + x + 1] + run; }
  }
  const sum = (x0, y0, x1, y1) => I[y1 * (cols + 1) + x1] - I[y0 * (cols + 1) + x1] - I[y1 * (cols + 1) + x0] + I[y0 * (cols + 1) + x0];
  // cells that hold any line work at all (a frame line or a grid bubble counts)
  const hit = new Float64Array((cols + 1) * (rows + 1));
  for (let y = 0; y < rows; y++) {
    let run = 0;
    for (let x = 0; x < cols; x++) { run += occ[y * cols + x] > 0.003 ? 1 : 0; hit[(y + 1) * (cols + 1) + x + 1] = hit[y * (cols + 1) + x + 1] + run; }
  }
  const hits = (x0, y0, x1, y1) => hit[y1 * (cols + 1) + x1] - hit[y0 * (cols + 1) + x1] - hit[y1 * (cols + 1) + x0] + hit[y0 * (cols + 1) + x0];
  // the table plus one clear cell all round
  const cw = Math.ceil(w / cell) + 2, chh = Math.ceil(h / cell) + 2;
  const m0 = Math.ceil(margin / cell);
  let best = null;
  for (let cy = m0; cy + chh <= rows - m0; cy++) {
    for (let cx = m0; cx + cw <= cols - m0; cx++) {
      const n = hits(cx, cy, cx + cw, cy + chh);
      const ink = sum(cx, cy, cx + cw, cy + chh) / (cw * chh);
      const edge = Math.min(cx - m0, cols - m0 - (cx + cw), cy - m0, rows - m0 - (cy + chh)) / Math.max(cols, rows);
      const score = n * 10 + ink * 100 + edge * 4;
      if (!best || score < best.score) best = { score, cx, cy, n };
    }
  }
  if (!best || best.n > 2) return fallback;
  return [Math.round((best.cx + 1) * cell), Math.round((best.cy + 1) * cell)];
}

/** Which measured columns the legend shows: { area, perim } (needs a scale). */
export function legendCols() {
  const on = !!(S.meas.legend && hasScale());
  return { area: on && S.meas.showArea, perim: on && S.meas.showPerim };
}

export function legendRows(L = S.legend) {
  const cols = legendCols();
  const want = cols.area || cols.perim;
  const rows = S.markups.map((m, i) => {
    const r = want ? measureAt(i) : null;
    return {
      name: (m.name || '').trim() || 'Untitled', color: m.color, opacity: m.opacity, borderPt: m.borderPt,
      borderColor: borderColorOf(m), borderStyle: m.borderStyle || 'solid',
      area: r ? r.area : 0, perim: r ? r.perim : 0,
    };
  });
  if (!L || !L.merge) return rows;
  const seen = new Map();
  const out = [];
  for (const r of rows) {
    const k = r.name.toLowerCase() + '|' + r.color + '|' + r.opacity + '|' + r.borderPt + '|' + r.borderStyle;
    const prev = seen.get(k);
    if (prev) { prev.area += r.area; prev.perim += r.perim; continue; }
    const c = { ...r };
    seen.set(k, c);
    out.push(c);
  }
  return out;
}

/** Text of the measured cells and their column titles. */
function areaCell(px2) { return fmtNum(areaNumber(px2), areaDecimals()); }
function perimCell(px) {
  const u = lengthUnit();
  const m = px * realPerPx();
  if (u === 'ftin') return fmtFtIn(m / 0.3048, lengthDecimals());
  return fmtNum(m / lengthUnitInfo(u).m, lengthDecimals());
}
const areaTitle = () => `Area (${areaUnitLabel()})`;
const perimTitle = () => (lengthUnit() === 'ftin' ? 'Perimeter' : `Perimeter (${lengthUnitLabel()})`);

let measure = null;
function mctx() {
  if (!measure) measure = new OffscreenCanvas(8, 8).getContext('2d');
  return measure;
}

export function legendLayout(L = S.legend, rows = legendRows(L)) {
  const n = L.namePx, t = L.titlePx;
  const pad = Math.round(n * 0.62);
  const line = Math.max(1, n / 15);
  const cols = legendCols();
  const total = (cols.area || cols.perim) && rows.length > 1;
  const c = mctx();
  c.font = `600 ${t}px ${LEGEND_FONT}`;
  const hName = c.measureText('Name').width;
  const hColour = c.measureText('Colour').width;
  const hArea = cols.area ? c.measureText(areaTitle()).width : 0;
  const hPerim = cols.perim ? c.measureText(perimTitle()).width : 0;
  c.font = `500 ${n}px ${LEGEND_FONT}`;
  let maxName = rows.length ? 0 : c.measureText('No markups yet').width;
  for (const r of rows) maxName = Math.max(maxName, c.measureText(r.name).width);
  let maxA = 0, maxP = 0;
  if (cols.area || cols.perim) {
    c.font = `600 ${n}px ${LEGEND_FONT}`;
    const sum = rows.reduce((s_, r) => ({ a: s_.a + r.area, p: s_.p + r.perim }), { a: 0, p: 0 });
    for (const r of [...rows, { area: sum.a, perim: sum.p }]) {
      if (cols.area) maxA = Math.max(maxA, c.measureText(areaCell(r.area)).width);
      if (cols.perim) maxP = Math.max(maxP, c.measureText(perimCell(r.perim)).width);
    }
  }
  const swW = Math.round(n * 2.7), swH = Math.round(n * 1.05);
  const col1 = Math.ceil(Math.max(hName, maxName, n * 5) + pad * 2);
  const colA = cols.area ? Math.ceil(Math.max(hArea, maxA) + pad * 2) : 0;
  const colP = cols.perim ? Math.ceil(Math.max(hPerim, maxP) + pad * 2) : 0;
  const col2 = Math.ceil(Math.max(hColour, swW) + pad * 2);
  const headH = Math.round(t * 1.8);
  const rowH = Math.round(n * 1.65);
  const w = col1 + colA + colP + col2;
  const h = headH + rowH * (Math.max(1, rows.length) + (total ? 1 : 0));
  return { w, h, pad, line, col1, colA, colP, col2, headH, rowH, swW, swH, cols, total };
}

export function legendRect(L = S.legend) {
  if (!L || !L.visible || !S.doc) return null;
  const lay = legendLayout(L);
  return [L.x, L.y, L.x + lay.w, L.y + lay.h];
}

/** Draws the legend in sheet coordinates (the caller sets the transform). */
export function drawLegend(ctx, L, rows = legendRows(L), lay = legendLayout(L, rows), at = [L.x, L.y]) {
  ctx.save();
  ctx.translate(at[0], at[1]);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, lay.w, lay.h);
  ctx.fillStyle = '#EDEFEB';
  ctx.fillRect(0, 0, lay.w, lay.headH);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.fillStyle = '#1C201E';
  ctx.font = `600 ${L.titlePx}px ${LEGEND_FONT}`;
  const xA = lay.col1, xP = lay.col1 + lay.colA, xC = lay.col1 + lay.colA + lay.colP;
  const ty = lay.headH / 2 + L.titlePx * 0.04;
  ctx.fillText('Name', lay.pad, ty);
  if (lay.cols.area) { ctx.textAlign = 'right'; ctx.fillText(areaTitle(), xA + lay.colA - lay.pad, ty); ctx.textAlign = 'left'; }
  if (lay.cols.perim) { ctx.textAlign = 'right'; ctx.fillText(perimTitle(), xP + lay.colP - lay.pad, ty); ctx.textAlign = 'left'; }
  ctx.fillText('Colour', xC + lay.pad, ty);
  ctx.font = `500 ${L.namePx}px ${LEGEND_FONT}`;
  if (!rows.length) {
    ctx.fillStyle = '#7A817C';
    ctx.fillText('No markups yet', lay.pad, lay.headH + lay.rowH / 2);
  }
  const numbers = (r, y, bold) => {
    ctx.save();
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1C201E';
    ctx.font = `${bold ? 600 : 500} ${L.namePx}px ${LEGEND_FONT}`;
    const yy = y + lay.rowH / 2 + L.namePx * 0.04;
    if (lay.cols.area) ctx.fillText(areaCell(r.area), xA + lay.colA - lay.pad, yy);
    if (lay.cols.perim) ctx.fillText(perimCell(r.perim), xP + lay.colP - lay.pad, yy);
    ctx.restore();
  };
  rows.forEach((r, i) => {
    const y = lay.headH + i * lay.rowH;
    ctx.fillStyle = '#1C201E';
    ctx.fillText(r.name, lay.pad, y + lay.rowH / 2 + L.namePx * 0.04);
    numbers(r, y, false);
    const sx = xC + lay.pad, sy = y + (lay.rowH - lay.swH) / 2;
    ctx.fillStyle = tintOnPaper(r.color, r.opacity);
    ctx.fillRect(sx, sy, lay.swW, lay.swH);
    if (r.borderPt > 0) {
      const bw = Math.max(lay.line, Math.min(lay.swH / 3.5, ptToPx(r.borderPt)));
      const ls = dashFor(r.borderStyle, bw, bw * 0.8);
      ctx.save();
      ctx.strokeStyle = r.borderColor;
      ctx.lineWidth = bw;
      ctx.lineJoin = 'miter';
      ctx.lineCap = ls.cap;
      ctx.setLineDash(ls.dash);
      ctx.strokeRect(sx + bw / 2, sy + bw / 2, lay.swW - bw, lay.swH - bw);
      ctx.restore();
    } else {
      const bw = lay.line * 0.8;
      ctx.strokeStyle = 'rgba(0,0,0,0.38)';
      ctx.lineWidth = bw;
      ctx.strokeRect(sx + bw / 2, sy + bw / 2, lay.swW - bw, lay.swH - bw);
    }
  });
  if (lay.total) {
    const y = lay.headH + rows.length * lay.rowH;
    ctx.fillStyle = '#F4F5F2';
    ctx.fillRect(0, y, lay.w, lay.rowH);
    ctx.fillStyle = '#1C201E';
    ctx.font = `600 ${L.namePx}px ${LEGEND_FONT}`;
    ctx.fillText('Total', lay.pad, y + lay.rowH / 2 + L.namePx * 0.04);
    numbers(rows.reduce((s_, r) => ({ area: s_.area + r.area, perim: s_.perim + r.perim }), { area: 0, perim: 0 }), y, true);
  }
  ctx.strokeStyle = '#B4BAB5';
  ctx.lineWidth = lay.line * 0.8;
  ctx.beginPath();
  const nRows = Math.max(1, rows.length);
  for (let i = 1; i < nRows; i++) {
    const y = lay.headH + i * lay.rowH;
    ctx.moveTo(0, y); ctx.lineTo(lay.w, y);
  }
  for (const x of new Set([lay.col1, lay.col1 + lay.colA, lay.col1 + lay.colA + lay.colP])) { ctx.moveTo(x, 0); ctx.lineTo(x, lay.h); }
  ctx.stroke();
  if (lay.total) {
    ctx.strokeStyle = '#2B302D';
    ctx.lineWidth = lay.line * 1.1;
    ctx.beginPath();
    const y = lay.headH + rows.length * lay.rowH;
    ctx.moveTo(0, y); ctx.lineTo(lay.w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#2B302D';
  ctx.lineWidth = lay.line * 1.1;
  ctx.beginPath();
  ctx.moveTo(0, lay.headH); ctx.lineTo(lay.w, lay.headH);
  ctx.stroke();
  ctx.lineWidth = lay.line * 1.6;
  ctx.strokeRect(lay.line * 0.8, lay.line * 0.8, lay.w - lay.line * 1.6, lay.h - lay.line * 1.6);
  ctx.restore();
}

/**
 * The legend as a PNG for export. scale > 1 renders extra detail (used for PDFs, where the
 * picture is placed at the table's size on the sheet).
 */
export async function legendPng(scale = 1) {
  const L = S.legend;
  if (!L || !L.visible) return null;
  const rows = legendRows(L);
  const lay = legendLayout(L, rows);
  const k = Math.max(1, Math.min(scale, 6000 / Math.max(lay.w, lay.h)));
  const c = new OffscreenCanvas(Math.ceil(lay.w * k), Math.ceil(lay.h * k));
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  drawLegend(ctx, L, rows, lay, [0, 0]);
  const blob = await c.convertToBlob({ type: 'image/png' });
  return { png: new Uint8Array(await blob.arrayBuffer()), x: L.x, y: L.y, w: Math.ceil(lay.w), h: Math.ceil(lay.h) };
}
