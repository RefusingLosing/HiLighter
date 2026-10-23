// Dimension lines and area tags: laid out once in sheet pixels, then drawn on screen and written
// into pictures and PDFs from the same layout, so all three match.
//
// A dimension measures the straight distance between two points (a, b). Its line runs parallel
// to a–b, `off` sheet pixels to the side, with extension lines back to the points, 45° ticks at
// both ends and the length above the line, never upside down. A tag is a small label inside a
// markup with its area and/or perimeter; it sits at the most open spot, clear of the drawing's
// own text, unless it has been dragged somewhere (markup.tagAt).

import { S, ptToPx } from './state.js';
import { lengthLabel, areaLabel, hasScale, realPerPx } from './units.js';
import { measureAt, labelSpot } from './measure.js';
import { hexToRgb, borderColorOf } from './colors.js';
import * as G from './geom.js';

export const ANNOT_FONT = '"IBM Plex Sans", "IBM Plex Sans Arabic", "Segoe UI", Arial, sans-serif';
const TAG_INK = '#1C201E';

let mc = null;
const mctx = () => mc || (mc = new OffscreenCanvas(8, 8).getContext('2d'));

/** Sizes in sheet pixels, all from the text size (points on the printed sheet). */
export function annotSizes() {
  const fs = ptToPx(S.meas.textPt || 8);
  return {
    fs,
    lw: Math.max(ptToPx(0.45), fs * 0.06),
    tick: fs * 0.42,
    over: fs * 0.3,
    gap: fs * 0.3,
    ext: fs * 0.45,
    halo: fs * 0.2,
  };
}

const stamp = () => [S.meas.len, S.meas.dec, S.meas.textPt, realPerPx(), S.doc ? S.doc.dpi : 0, S.doc ? S.doc.physical : 0].join('|');

// ------------------------------------------------------------------ dimensions

const dimCache = new WeakMap();

/** Geometry of a dimension: segments (ext, line, ticks), the text box and a bounding box. */
export function dimLayout(d) {
  const st = stamp();
  const c = dimCache.get(d);
  if (c && c.stamp === st) return c;
  const z = annotSizes();
  const [ax, ay] = d.a, [bx, by] = d.b;
  const len = Math.hypot(bx - ax, by - ay);
  const ux = len > 1e-9 ? (bx - ax) / len : 1, uy = len > 1e-9 ? (by - ay) / len : 0;
  const nx = -uy, ny = ux;
  const off = d.off || 0;
  const p = [ax + nx * off, ay + ny * off], q = [bx + nx * off, by + ny * off];
  const segs = [];
  if (Math.abs(off) > z.gap * 1.5) {
    const s = Math.sign(off);
    for (const [x, y] of [[ax, ay], [bx, by]]) segs.push([x + nx * s * z.gap, y + ny * s * z.gap, x + nx * (off + s * z.ext), y + ny * (off + s * z.ext)]);
  }
  segs.push([p[0] - ux * z.over, p[1] - uy * z.over, q[0] + ux * z.over, q[1] + uy * z.over]);
  const tx = (ux - nx) * Math.SQRT1_2 * z.tick, ty = (uy - ny) * Math.SQRT1_2 * z.tick;
  segs.push([p[0] - tx, p[1] - ty, p[0] + tx, p[1] + ty], [q[0] - tx, q[1] - ty, q[0] + tx, q[1] + ty]);
  // readable from the bottom or the right of the sheet: vertical text runs bottom to top
  let ang = Math.atan2(uy, ux);
  if (ang > Math.PI / 2 - 1e-6) ang -= Math.PI;
  else if (ang < -Math.PI / 2 - 1e-6) ang += Math.PI;
  const s = lengthLabel(len);
  const ctx = mctx();
  ctx.font = `600 ${z.fs}px ${ANNOT_FONT}`;
  const w = ctx.measureText(s).width, h = z.fs * 1.2;
  const upx = Math.sin(ang), upy = -Math.cos(ang);
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const dist = z.lw / 2 + z.fs * 0.12 + h / 2;
  const text = { s, cx: mx + upx * dist, cy: my + upy * dist, ang, w, h, fs: z.fs };
  const corners = boxCorners(text, z.halo);
  let bb = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x, y) => { bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)]; };
  for (const sg of segs) { grow(sg[0], sg[1]); grow(sg[2], sg[3]); }
  for (const [x, y] of corners) grow(x, y);
  const out = { stamp: st, len, p, q, ux, uy, nx, ny, segs, text, corners, bbox: bb, lw: z.lw, halo: z.halo };
  dimCache.set(d, out);
  return out;
}

function boxCorners(t, pad = 0) {
  const c = Math.cos(t.ang), s = Math.sin(t.ang);
  const hw = t.w / 2 + pad, hh = t.h / 2 + pad;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [t.cx + x * c - y * s, t.cy + x * s + y * c]);
}

function inBox(t, x, y, pad) {
  const c = Math.cos(t.ang), s = Math.sin(t.ang);
  const dx = x - t.cx, dy = y - t.cy;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= t.w / 2 + pad && Math.abs(ly) <= t.h / 2 + pad;
}

/** The dimension under a point (sheet px), topmost first. */
export function hitDim(x, y, tol, list = S.dims) {
  if (!S.meas.dims) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    const L = dimLayout(d);
    const b = L.bbox;
    if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
    if (inBox(L.text, x, y, tol * 0.5)) return d;
    for (const sg of L.segs) if (G.nearestPointOnSeg(x, y, sg[0], sg[1], sg[2], sg[3]).d <= tol) return d;
  }
  return null;
}

/** A dimension moved by (dx, dy). */
export function movedDim(d, dx, dy) {
  return { ...d, a: [d.a[0] + dx, d.a[1] + dy], b: [d.b[0] + dx, d.b[1] + dy] };
}

/** Signed offset of a point from the measured line a–b (positive to the dimension's normal side). */
export function offsetFor(d, x, y) {
  const [ax, ay] = d.a, [bx, by] = d.b;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / len, ny = (bx - ax) / len;
  return (x - ax) * nx + (y - ay) * ny;
}

// ------------------------------------------------------------------ tags

const tagCache = new WeakMap();

/** Text lines of a markup's tag (area, perimeter). */
export function tagLines(r) {
  const out = [];
  if (S.meas.showArea) out.push(areaLabel(r.area));
  if (S.meas.showPerim) out.push('P ' + lengthLabel(r.perim));
  return out.filter(Boolean);
}

export const tagsVisible = () => !!(S.meas.tags && hasScale() && (S.meas.showArea || S.meas.showPerim));

/** Tag of the markup at index i: { lines, cx, cy, w, h, fs, lineH, pad, color } or null. */
export function tagLayout(i) {
  const m = S.markups[i];
  const r = measureAt(i);
  if (!r.vis.length || r.area <= 0) return null;
  const key = stamp() + '|' + S.meas.showArea + S.meas.showPerim + '|' + S.meas.area + '|' + (m.tagAt ? m.tagAt.join(',') : '');
  const c = tagCache.get(m);
  if (c && c.r === r && c.key === key) return c.t;
  const lines = tagLines(r);
  if (!lines.length) return null;
  const z = annotSizes();
  const ctx = mctx();
  let w = 0;
  lines.forEach((s, k) => { ctx.font = `${k ? 500 : 600} ${z.fs * (k ? 0.88 : 1)}px ${ANNOT_FONT}`; w = Math.max(w, ctx.measureText(s).width); });
  const pad = z.fs * 0.32, lineH = z.fs * 1.22;
  const bw = w + pad * 2, bh = lineH * lines.length + pad * 1.2;
  const at = m.tagAt || labelSpot(r.vis, bw, bh);
  if (!at) return null;
  const t = { id: m.id, lines, cx: at[0], cy: at[1], w: bw, h: bh, fs: z.fs, lineH, pad, color: borderColorOf(m), lw: Math.max(ptToPx(0.4), z.fs * 0.05) };
  tagCache.set(m, { r, key, t });
  return t;
}

export function allTags() {
  if (!tagsVisible()) return [];
  const out = [];
  for (let i = 0; i < S.markups.length; i++) { const t = tagLayout(i); if (t) out.push(t); }
  return out;
}

/** The markup whose tag is under a point. */
export function hitTag(x, y) {
  if (!tagsVisible()) return null;
  for (let i = S.markups.length - 1; i >= 0; i--) {
    const t = tagLayout(i);
    if (t && Math.abs(x - t.cx) <= t.w / 2 && Math.abs(y - t.cy) <= t.h / 2) return S.markups[i];
  }
  return null;
}

// ------------------------------------------------------------------ drawing (sheet coordinates)

function strokeSegs(ctx, segs, lw, color) {
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (const s of segs) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
  ctx.stroke();
}

function drawDimText(ctx, t, color, halo) {
  ctx.save();
  ctx.translate(t.cx, t.cy);
  ctx.rotate(t.ang);
  ctx.font = `600 ${t.fs}px ${ANNOT_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr';
  ctx.lineJoin = 'round';
  ctx.lineWidth = halo * 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeText(t.s, 0, t.fs * 0.04);
  ctx.fillStyle = color;
  ctx.fillText(t.s, 0, t.fs * 0.04);
  ctx.restore();
}

/** Draws one dimension; minLw keeps lines visible on screen when zoomed out. */
export function drawDim(ctx, d, minLw = 0, color = S.meas.dimColor) {
  const L = dimLayout(d);
  ctx.save();
  strokeSegs(ctx, L.segs, Math.max(L.lw, minLw), color);
  drawDimText(ctx, L.text, color, L.halo);
  ctx.restore();
}

function drawTagBox(ctx, t, x0, y0) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeStyle = t.color;
  ctx.lineWidth = t.lw;
  ctx.beginPath();
  ctx.roundRect(x0 + t.lw / 2, y0 + t.lw / 2, t.w - t.lw, t.h - t.lw, t.fs * 0.22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = TAG_INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr';
  t.lines.forEach((s, k) => {
    ctx.font = `${k ? 500 : 600} ${t.fs * (k ? 0.88 : 1)}px ${ANNOT_FONT}`;
    ctx.fillText(s, x0 + t.w / 2, y0 + t.pad * 0.6 + t.lineH * (k + 0.5) + t.fs * 0.04);
  });
  ctx.restore();
}

export function drawTag(ctx, t, dx = 0, dy = 0) {
  drawTagBox(ctx, t, t.cx - t.w / 2 + dx, t.cy - t.h / 2 + dy);
}

/**
 * Dimensions and tags on the sheet. The caller sets the sheet-to-canvas transform; preview
 * moves and edits in progress come from `live` ({ moveIds, dx, dy, dimEdit, tagEdit }).
 */
export function drawAnnots(ctx, minLw = 0, live = null) {
  if (!S.doc) return;
  if (tagsVisible()) {
    for (let i = 0; i < S.markups.length; i++) {
      const t = tagLayout(i);
      if (!t) continue;
      const m = S.markups[i];
      let dx = 0, dy = 0;
      if (live && live.moveIds && live.moveIds.has(m.id)) { dx = live.dx; dy = live.dy; }
      if (live && live.tagEdit && live.tagEdit.id === m.id) { dx = live.tagEdit.at[0] - t.cx; dy = live.tagEdit.at[1] - t.cy; }
      drawTag(ctx, t, dx, dy);
    }
  }
  if (S.meas.dims) {
    for (const d0 of S.dims) {
      let d = d0;
      if (live && live.dimEdit && live.dimEdit.id === d.id) d = live.dimEdit;
      else if (live && live.moveIds && live.moveIds.has(d.id)) d = movedDim(d, live.dx, live.dy);
      drawDim(ctx, d, minLw);
    }
  }
}

// ------------------------------------------------------------------ export

async function pngOf(c) {
  const blob = await c.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Dimensions and tags for export: lines as vectors (sheet px) and text as small pictures with
 * transparency, placed by their centre and angle. k renders the pictures k times finer than
 * the sheet (PDFs), so text stays crisp when zoomed.
 */
export async function annotExport(k = 1) {
  const lines = [];
  const images = [];
  if (!S.doc) return { lines, images };
  const color = hexToRgb(S.meas.dimColor);
  if (S.meas.dims) {
    for (const d of S.dims) {
      const L = dimLayout(d);
      for (const s of L.segs) lines.push({ pts: s, w: L.lw, color });
      const t = L.text;
      const W = t.w + L.halo * 2, H = t.h + L.halo * 2;
      const kk = Math.max(1, Math.min(k, 4000 / Math.max(W, H)));
      const c = new OffscreenCanvas(Math.max(1, Math.ceil(W * kk)), Math.max(1, Math.ceil(H * kk)));
      const x = c.getContext('2d');
      x.scale(c.width / W, c.height / H);
      drawDimText(x, { ...t, cx: W / 2, cy: H / 2, ang: 0 }, S.meas.dimColor, L.halo);
      images.push({ png: await pngOf(c), cx: t.cx, cy: t.cy, w: W, h: H, ang: t.ang });
    }
  }
  for (const t of allTags()) {
    const kk = Math.max(1, Math.min(k, 4000 / Math.max(t.w, t.h)));
    const c = new OffscreenCanvas(Math.max(1, Math.ceil(t.w * kk)), Math.max(1, Math.ceil(t.h * kk)));
    const x = c.getContext('2d');
    x.scale(c.width / t.w, c.height / t.h);
    drawTagBox(x, t, 0, 0);
    images.push({ png: await pngOf(c), cx: t.cx, cy: t.cy, w: t.w, h: t.h, ang: 0 });
  }
  return { lines, images };
}
