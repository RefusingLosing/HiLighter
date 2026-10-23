// Lengths as people read them on a drawing: real metres at the drawing scale, millimetres on
// paper when no scale is set, or pixels for pictures with no print size.

import { S } from './state.js';

const COMMON_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 10000];

/** 'm' (real size at the scale), 'mm' (on paper) or 'px'. */
export function lengthUnit() {
  const d = S.doc;
  if (!d || !d.physical) return 'px';
  return d.scale > 0 ? 'm' : 'mm';
}

/** Sheet pixels to a number in the current unit. */
export function pxToUnit(px) {
  const d = S.doc;
  const u = lengthUnit();
  if (u === 'px') return px;
  const mm = (px / d.dpi) * 25.4;
  return u === 'm' ? (mm * d.scale) / 1000 : mm;
}

/** A number in the current unit to sheet pixels. */
export function unitToPx(v) {
  const d = S.doc;
  const u = lengthUnit();
  if (u === 'px') return v;
  const mm = u === 'm' ? (v * 1000) / d.scale : v;
  return (mm / 25.4) * d.dpi;
}

export function fmtUnitValue(v) {
  const u = lengthUnit();
  if (u === 'px') return String(Math.round(v));
  if (u === 'm') return v >= 100 ? v.toFixed(1) : v.toFixed(2);
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function lengthLabel(px) {
  return fmtUnitValue(pxToUnit(Math.abs(px))) + ' ' + lengthUnit();
}

/** Accepts "4.4", "4,4", "4400mm", "4.4 m". Returns a value in the current unit or NaN. */
export function parseLength(text) {
  const t = String(text || '').trim().toLowerCase().replace(',', '.');
  const m = /^(-?\d*\.?\d+)\s*(mm|cm|m|px)?$/.exec(t);
  if (!m) return NaN;
  let v = parseFloat(m[1]);
  const given = m[2];
  const u = lengthUnit();
  if (given && given !== u) {
    if (u === 'px' || given === 'px') return NaN;
    const mmGiven = given === 'm' ? v * 1000 : given === 'cm' ? v * 10 : v;
    // the user typed real-world units: convert through the scale when there is one
    if (u === 'm') v = mmGiven / 1000;
    else v = S.doc.scale > 0 ? mmGiven / S.doc.scale : mmGiven;
  }
  return v;
}

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
