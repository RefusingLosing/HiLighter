// Measuring: the drawing's scale and the units sizes are read in.
//
// The real-world scale comes from, in order: a calibration (two points and their known length)
// or a scale typed in the status bar (both kept in S.calib, so they undo and save), else the
// scale read from the title block (S.doc.scale). Without a scale, lengths are millimetres on
// paper (or pixels for pictures with no print size) and areas are not measured.

import { S } from './state.js';

export const LENGTH_UNITS = [
  { id: 'mm', label: 'mm', name: 'Millimetres', m: 0.001, dec: 0 },
  { id: 'cm', label: 'cm', name: 'Centimetres', m: 0.01, dec: 1 },
  { id: 'm', label: 'm', name: 'Metres', m: 1, dec: 2 },
  { id: 'km', label: 'km', name: 'Kilometres', m: 1000, dec: 3 },
  { id: 'in', label: 'in', name: 'Inches', m: 0.0254, dec: 1 },
  { id: 'ft', label: 'ft', name: 'Feet', m: 0.3048, dec: 2 },
  { id: 'ftin', label: 'ft-in', name: 'Feet and inches', m: 0.3048, dec: 1 },
  { id: 'yd', label: 'yd', name: 'Yards', m: 0.9144, dec: 2 },
];

export const AREA_UNITS = [
  { id: 'mm2', label: 'mm²', name: 'Square millimetres', m2: 1e-6, dec: 0 },
  { id: 'cm2', label: 'cm²', name: 'Square centimetres', m2: 1e-4, dec: 0 },
  { id: 'm2', label: 'm²', name: 'Square metres', m2: 1, dec: 2 },
  { id: 'ha', label: 'ha', name: 'Hectares', m2: 1e4, dec: 4 },
  { id: 'km2', label: 'km²', name: 'Square kilometres', m2: 1e6, dec: 4 },
  { id: 'in2', label: 'in²', name: 'Square inches', m2: 0.00064516, dec: 0 },
  { id: 'ft2', label: 'ft²', name: 'Square feet', m2: 0.09290304, dec: 1 },
  { id: 'yd2', label: 'yd²', name: 'Square yards', m2: 0.83612736, dec: 2 },
  { id: 'ac', label: 'ac', name: 'Acres', m2: 4046.8564224, dec: 3 },
];

const LEN = Object.fromEntries(LENGTH_UNITS.map((u) => [u.id, u]));
const AREA = Object.fromEntries(AREA_UNITS.map((u) => [u.id, u]));
export const isLengthUnit = (id) => !!LEN[id];
export const isAreaUnit = (id) => !!AREA[id];
export const lengthUnitInfo = (id) => LEN[id] || LEN.m;
export const areaUnitInfo = (id) => AREA[id] || AREA.m2;

/** Feet-and-inches precision, by the decimals setting: whole inches, 1/2, 1/4, 1/8, 1/16. */
const FRACTIONS = [1, 2, 4, 8, 16];

const COMMON_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 10000];

const meas = () => S.meas || { len: 'm', area: 'm2', dec: 'auto' };

// ------------------------------------------------------------------ scale

/** Real-world metres per sheet pixel, or 0 when the drawing's scale is not known. */
export function realPerPx() {
  const d = S.doc;
  if (!d) return 0;
  const c = S.calib;
  if (c) return c.mPerPx > 0 ? c.mPerPx : 0;
  if (d.physical && d.scale > 0) return (d.scale * 0.0254) / d.dpi;
  return 0;
}

export const hasScale = () => realPerPx() > 0;

/** n of a 1:n scale, for sheets with a print size; 0 otherwise. */
export function scaleRatio() {
  const d = S.doc;
  const r = realPerPx();
  return r > 0 && d && d.physical ? (r * d.dpi) / 0.0254 : 0;
}

/** Where the scale comes from: 'calib' | 'typed' | 'title' | 'none'. */
export function scaleSource() {
  const d = S.doc;
  if (!d) return 'none';
  const c = S.calib;
  if (c) return c.mPerPx > 0 ? (c.kind === 'typed' ? 'typed' : 'calib') : 'none';
  return d.physical && d.scale > 0 ? 'title' : 'none';
}

/** "1:50", "1:48.6", or for a picture without print size "1 px = 6.35 mm". */
export function fmtScale() {
  const n = scaleRatio();
  if (n > 0) {
    const r = Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n >= 100 ? n.toFixed(0) : n.toFixed(1);
    return '1:' + r;
  }
  const r = realPerPx();
  if (r > 0) return '1 px = ' + fmtLengthIn(r, 'mm', 2);
  return '';
}

/** Metres per pixel for a typed 1:n scale (sheets with a print size only). */
export function mPerPxForRatio(n) {
  const d = S.doc;
  return d && d.physical && n > 0 ? (n * 0.0254) / d.dpi : 0;
}

// ------------------------------------------------------------------ number formatting

function decFor(unit, kind) {
  const d = meas().dec;
  // with feet and inches the setting is how inches are rounded; areas keep their usual decimals
  const own = d === 'auto' || d === undefined || d === null || (kind === 'area' && meas().len === 'ftin');
  if (own) return (kind === 'area' ? areaUnitInfo(unit) : lengthUnitInfo(unit)).dec;
  return Math.max(0, Math.min(4, +d));
}

export function fmtNum(v, dec, group = true) {
  if (!Number.isFinite(v)) return '—';
  const s = Math.abs(v) < 0.5 * 10 ** -dec ? 0 : v;
  return s.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: group });
}

/** Decimal feet as 12'-6 1/2". */
export function fmtFtIn(ft, precision = 1) {
  const den = FRACTIONS[Math.max(0, Math.min(4, precision))];
  let n = Math.round(Math.abs(ft) * 12 * den);
  const sign = ft < 0 ? '-' : '';
  const feet = Math.floor(n / (12 * den));
  n -= feet * 12 * den;
  const inch = Math.floor(n / den);
  let num = n - inch * den, d = den;
  while (num && num % 2 === 0 && d % 2 === 0) { num /= 2; d /= 2; }
  return `${sign}${feet}'-${inch}${num ? ` ${num}/${d}` : ''}"`;
}

/** A length in metres, written in a given unit with its symbol. */
export function fmtLengthIn(m, unit, dec = null, group = true) {
  const u = lengthUnitInfo(unit);
  const v = m / u.m;
  if (u.id === 'ftin') return fmtFtIn(v, dec === null ? decFor('ftin', 'len') : dec);
  return fmtNum(v, dec === null ? decFor(u.id, 'len') : dec, group) + ' ' + u.label;
}

// ------------------------------------------------------------------ lengths in the current unit

/** The unit lengths are shown and typed in: the chosen unit with a scale, else 'mm' on paper or 'px'. */
export function lengthUnit() {
  const d = S.doc;
  if (!d) return 'px';
  if (hasScale()) return lengthUnitInfo(meas().len).id;
  return d.physical ? 'mm' : 'px';
}

export const lengthUnitLabel = () => { const u = lengthUnit(); return u === 'px' ? 'px' : lengthUnitInfo(u).label; };

/** Sheet pixels to a number in the current unit (decimal feet for feet and inches). */
export function pxToUnit(px) {
  const d = S.doc;
  const u = lengthUnit();
  if (u === 'px') return px;
  const r = realPerPx();
  if (r > 0) return (px * r) / lengthUnitInfo(u).m;
  return (px / d.dpi) * 25.4; // millimetres on paper
}

/** A number in the current unit to sheet pixels. */
export function unitToPx(v) {
  const d = S.doc;
  const u = lengthUnit();
  if (u === 'px') return v;
  const r = realPerPx();
  if (r > 0) return (v * lengthUnitInfo(u).m) / r;
  return (v / 25.4) * d.dpi;
}

/** A number in the current unit, as typed into a size box (no thousands separators). */
export function fmtUnitValue(v) {
  const u = lengthUnit();
  if (u === 'px') return String(Math.round(v));
  if (!hasScale()) return v >= 100 ? v.toFixed(0) : v.toFixed(1);
  if (u === 'ftin') return fmtFtIn(v, decFor('ftin', 'len'));
  return fmtNum(v, decFor(u, 'len'), false);
}

/** A length in sheet pixels as people read it: "4.40 m", "4,400 mm", 14'-5", "1250 px". */
export function lengthLabel(px) {
  const u = lengthUnit();
  const a = Math.abs(px);
  if (u === 'px') return Math.round(a) + ' px';
  if (!hasScale()) { const v = pxToUnit(a); return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' mm'; }
  return fmtLengthIn(a * realPerPx(), u);
}

/** Length of sheet pixels in the chosen unit as a plain number (for schedules); NaN without a scale. */
export function lengthNumber(px) {
  const r = realPerPx();
  if (!(r > 0)) return NaN;
  return (px * r) / lengthUnitInfo(meas().len).m;
}

// ------------------------------------------------------------------ areas

export const areaUnit = () => areaUnitInfo(meas().area).id;
export const areaUnitLabel = () => areaUnitInfo(meas().area).label;

/** Area of square sheet pixels in the chosen unit, or NaN without a scale. */
export function areaNumber(px2) {
  const r = realPerPx();
  if (!(r > 0)) return NaN;
  return (px2 * r * r) / areaUnitInfo(meas().area).m2;
}

/** "17.63 m²", or '' when the drawing has no scale. */
export function areaLabel(px2) {
  const v = areaNumber(px2);
  if (!Number.isFinite(v)) return '';
  const u = areaUnitInfo(meas().area);
  return fmtNum(v, decFor(u.id, 'area')) + ' ' + u.label;
}

/** Decimals used for areas and for lengths in the chosen units (for schedules). */
export const areaDecimals = () => decFor(areaUnit(), 'area');
export const lengthDecimals = () => decFor(lengthUnitInfo(meas().len).id, 'len');

// ------------------------------------------------------------------ typing lengths

/** "1,250.5" -> 1250.5; "4,4" -> 4.4 (a decimal comma). */
function parseNumber(t) {
  let s = t.trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return parseFloat(s);
}

/** Inches with an optional fraction: "6", "6.5", "6 1/2", "1/2". */
function parseInches(t) {
  const s = t.trim();
  if (!s) return 0;
  let m = /^(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return NaN;
  let v = m[1] ? parseFloat(m[1]) : 0;
  if (m[2]) { const den = +m[3]; if (!den) return NaN; v += +m[2] / den; }
  return v;
}

/** Feet and inches as typed: 12'6", 12' 6 1/2", 12'-6", 6", 12', 12-6 (in the ft-in unit). Metres or NaN. */
function parseFeetInches(t, dashForm) {
  const s = t.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*([\d\s./]*)\s*"?$/.exec(s);
  if (m) {
    const inch = parseInches(m[2] || '');
    if (Number.isNaN(inch)) return NaN;
    return parseFloat(m[1]) * 0.3048 + inch * 0.0254;
  }
  m = /^([\d\s./]+)\s*"$/.exec(s);
  if (m) { const inch = parseInches(m[1]); return Number.isNaN(inch) ? NaN : inch * 0.0254; }
  if (dashForm) {
    m = /^(\d+)\s*-\s*([\d\s./]+)$/.exec(s);
    if (m) { const inch = parseInches(m[2]); return Number.isNaN(inch) ? NaN : +m[1] * 0.3048 + inch * 0.0254; }
  }
  return NaN;
}

const SUFFIX = { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, inch: 0.0254, inches: 0.0254, ft: 0.3048, feet: 0.3048, foot: 0.3048, yd: 0.9144, yds: 0.9144 };

/** A typed length in metres when it carries a unit (or is in feet and inches); null for a bare number. NaN if unreadable. */
function parseRealMetres(text, unit) {
  const t = String(text || '').trim().toLowerCase();
  if (/['"′″’”]/.test(t)) return parseFeetInches(t, false);
  if (unit === 'ftin' && /^\d+\s*-\s*[\d\s./]+$/.test(t)) return parseFeetInches(t, true);
  const m = /^(.*?)\s*([a-z]+)$/.exec(t);
  if (m && SUFFIX[m[2]] !== undefined) {
    const v = parseNumber(m[1]);
    return Number.isNaN(v) ? NaN : v * SUFFIX[m[2]];
  }
  if (m && m[2] === 'px') return NaN;
  return null;
}

/**
 * Reads a typed length. Accepts "4.4", "4,4", "4400mm", "4.4 m", "14 ft", 12'6", 6 1/2".
 * Returns a value in the current unit (decimal feet for feet and inches) or NaN.
 */
export function parseLength(text) {
  const t = String(text || '').trim();
  if (!t) return NaN;
  const u = lengthUnit();
  if (u === 'px') {
    const m = /^(.*?)\s*px$/i.exec(t);
    return parseNumber(m ? m[1] : t);
  }
  if (!hasScale()) {
    // millimetres on paper; a typed unit is read as that length on paper
    const real = parseRealMetres(t, 'mm');
    if (real === null) return parseNumber(t);
    return Number.isNaN(real) ? NaN : real * 1000;
  }
  const real = parseRealMetres(t, u);
  if (real === null) {
    const v = parseNumber(t);
    return v;
  }
  return Number.isNaN(real) ? NaN : real / lengthUnitInfo(u).m;
}

/** A typed real length in metres, in any unit; a bare number is in `unit`. NaN when unreadable. */
export function parseRealLength(text, unit) {
  const t = String(text || '').trim();
  if (!t) return NaN;
  const real = parseRealMetres(t, unit);
  if (real === null) {
    const v = parseNumber(t);
    return Number.isNaN(v) ? NaN : v * lengthUnitInfo(unit).m;
  }
  return real;
}

// ------------------------------------------------------------------ title block

/**
 * Reads the drawing scale from the title block text ("SCALE 1:50", "1/100 @ A1").
 * When the scale is stated for another paper size, it is adjusted to this sheet.
 */
export function detectScale(text, pageSizePt) {
  if (!text || !text.length) return 0;
  const found = new Map();
  const PAPER = { A0: 1189, A1: 841, A2: 594, A3: 420, A4: 297 };
  const longMm = pageSizePt ? (Math.max(pageSizePt[0], pageSizePt[1]) / 72) * 25.4 : 0;
  for (const line of text) {
    const t = line.t;
    const re = /(?:^|[^\d.\/])1\s*[:\/]\s*(\d{1,5})(?![\d.\/])(?:\s*@\s*(A[0-4]))?/gi;
    let m;
    while ((m = re.exec(t))) {
      let n = parseInt(m[1], 10);
      if (!COMMON_SCALES.includes(n) || n === 1) continue;
      if (m[2] && longMm) {
        const at = PAPER[m[2].toUpperCase()];
        if (at && Math.abs(at - longMm) > 8) n = Math.round((n * at) / longMm);
      }
      const weight = /scale|مقياس|échelle|maßstab/i.test(t) ? 3 : 1;
      found.set(n, (found.get(n) || 0) + weight);
    }
  }
  let best = 0, bw = 0;
  for (const [n, w] of found) if (w > bw) { bw = w; best = n; }
  return best;
}
