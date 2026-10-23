// Drawing: the sheet (tiles from the engine), highlights (always above the drawing,
// tinting it like a highlighter so line work stays readable), the legend, and the
// interaction layer (selection, guides, dimensions, previews, magnifier).

import { S, on, ptToPx } from './state.js';
import { V } from './view.js';
import { pathFromRings, ringsBBox, vertexCount } from './geom.js';
import { rgba, borderColorOf } from './colors.js';
import { drawLegend, legendRows, legendLayout } from './legend.js';
import { dashFor } from '../shared/linestyle.js';
import { lengthLabel } from './units.js';
import { drawAnnots, drawDim, dimLayout, tagLayout, tagsVisible } from './annot.js';
import { shown } from './progress.js';
import { drawPin, pinSize, PIN_MIN_CSS } from './pins.js';
import * as engine from './engine.js';

export const BOARD = '#5E6862';
const BLUE = '#2457C5';
const GAP = '#D6336C';
const SNAP = '#E8590C';
const UI_FONT = '"IBM Plex Sans", "Segoe UI", sans-serif';

// ------------------------------------------------------------------ tiles

const tiles = { gen: -1, levels: [], ready: false };

export function resetTiles(gen) {
  dropSharp();
  for (const L of tiles.levels) if (L) for (const t of L.map.values()) t.bitmap.close();
  tiles.gen = gen;
  tiles.levels = [];
  tiles.ready = false;
}

engine.onTiles((m) => {
  if (m.type === 'tiles-done') { if (m.gen === tiles.gen) tiles.ready = true; requestScene(); return; }
  if (m.gen !== tiles.gen) { for (const t of m.tiles) t.bitmap.close(); return; }
  if (sharp) { dropSharp(); scheduleSharp(); }
  let L = tiles.levels[m.level];
  if (!L) L = tiles.levels[m.level] = { w: m.levelW, h: m.levelH, map: new Map() };
  for (const t of m.tiles) {
    const key = t.tx + ',' + t.ty;
    const old = L.map.get(key);
    if (old && old.ver > t.ver) { t.bitmap.close(); continue; }
    if (old) old.bitmap.close();
    L.map.set(key, t);
  }
  requestScene();
});

export const tilesReady = () => tiles.ready;

// ------------------------------------------------------------------ sharp zoom for PDF drawings

let sharp = null;        // { bitmap, rect, k }
let sharpTimer = 0, sharpReq = 0;
export function dropSharp() { if (sharp) { sharp.bitmap.close(); sharp = null; } }
export function scheduleSharp() {
  clearTimeout(sharpTimer);
  if (!S.doc || S.doc.kind !== 'pdf' || V.scale <= 1.1) { if (sharp && V.scale <= 1.1) dropSharp(); return; }
  sharpTimer = setTimeout(async () => {
    const id = ++sharpReq;
    const k = V.scale;
    const x0 = Math.max(0, -V.tx / k), y0 = Math.max(0, -V.ty / k);
    const x1 = Math.min(S.doc.W, (V.cw - V.tx) / k), y1 = Math.min(S.doc.H, (V.ch - V.ty) / k);
    if (x1 <= x0 || y1 <= y0) return;
    try {
      const r = await engine.call('renderRegion', { x0, y0, x1, y1, k, gen: tiles.gen });
      if (!r) { if (id === sharpReq) dropSharp(); requestScene(); return; }
      if (id !== sharpReq) { r.bitmap.close(); return; }
      dropSharp();
      sharp = r;
      requestScene();
    } catch { /* keep tiles */ }
  }, 140);
}

// ------------------------------------------------------------------ geometry cache

const geoCache = new WeakMap();
export function geo(m) {
  let c = geoCache.get(m);
  if (!c) {
    c = { path: pathFromRings(m.rings), bbox: ringsBBox(m.rings), verts: vertexCount(m.rings) };
    geoCache.set(m, c);
  }
  return c;
}

export const dashMinPx = () => ptToPx(1.2);
export function borderDash(m, w) { return dashFor(m.borderStyle || 'solid', w, dashMinPx()); }

// ------------------------------------------------------------------ transient interaction state

export const T = {
  hoverId: null,
  moveIds: null, moveDx: 0, moveDy: 0,
  vertexEdit: null,      // { id, rings }
  hoverVertex: null,     // { ri, vi }
  poly: null,            // { pts, cursor, closeHint, guide, ref }
  rect: null,            // { x0, y0, x1, y1, waiting }
  gap: null,             // { pts, cursor }
  band: null,            // { x0, y0, x1, y1, crossing }
  brush: null,           // { x, y, r, stroke }
  guide: null,           // { x, y, sx, sy, cross } snapping guides / crosshair
  legendPreview: null,   // { x, y, titlePx, namePx }
  detectPreview: null,   // [{ rid, rings, on }]
  detectHover: null,     // rid
  flash: null,           // { ids, until }
  snap: null,            // { x, y, kind }
  busyAt: null,          // [devX, devY]
  cursor: null,          // [sheetX, sheetY]
  dim: null,             // dimension being drawn: { a, cur, b, off, phase: 'b' | 'off' }
  calibLine: null,       // calibration line being drawn: { a, cur, done }
  dimEdit: null,         // a dimension being edited (moved end or line): the edited copy
  tagEdit: null,         // an area tag being dragged: { id, at }
  hoverDimId: null,
  hoverTagId: null,
  hoverPinId: null,
  hoverDimHandle: null,  // 'a' | 'b' | 'off'
};

// ------------------------------------------------------------------ canvases + frame loop

let sceneCv, sceneCtx, uiCv, uiCtx, overlay, overlayCtx, loupeCv, loupeCtx, loupeOverlay, loupeOverlayCtx;
let needScene = false, needUI = false, raf = 0;
export const loupe = { visible: false, devX: 0, devY: 0, cssX: 0, cssY: 0, size: 240 };

export function initRender(scene, ui, loupeEl) {
  sceneCv = scene; uiCv = ui; loupeCv = loupeEl;
  sceneCtx = scene.getContext('2d', { alpha: false });
  uiCtx = ui.getContext('2d');
  overlay = new OffscreenCanvas(4, 4);
  overlayCtx = overlay.getContext('2d');
  loupeCtx = loupeEl.getContext('2d', { alpha: false });
  loupeOverlay = new OffscreenCanvas(4, 4);
  loupeOverlayCtx = loupeOverlay.getContext('2d');
  on('doc', requestAll);
  on('selection', requestAll);
}

export function resize() {
  const wrap = sceneCv.parentElement;
  const r = wrap.getBoundingClientRect();
  V.dpr = window.devicePixelRatio || 1;
  V.cssW = Math.max(1, Math.round(r.width));
  V.cssH = Math.max(1, Math.round(r.height));
  V.cw = Math.round(V.cssW * V.dpr);
  V.ch = Math.round(V.cssH * V.dpr);
  for (const c of [sceneCv, uiCv]) {
    c.width = V.cw; c.height = V.ch;
    c.style.width = V.cssW + 'px'; c.style.height = V.cssH + 'px';
  }
  overlay.width = V.cw; overlay.height = V.ch;
  const ls = Math.round(loupe.size * V.dpr);
  loupeCv.width = ls; loupeCv.height = ls;
  loupeCv.style.width = loupe.size + 'px'; loupeCv.style.height = loupe.size + 'px';
  loupeOverlay.width = ls; loupeOverlay.height = ls;
  requestAll();
}

function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
export function requestScene() { needScene = true; schedule(); }
export function requestUI() { needUI = true; schedule(); }
export function requestAll() { needScene = true; needUI = true; schedule(); }

function frame() {
  raf = 0;
  if (needScene) { needScene = false; drawScene(sceneCtx, V, overlayCtx, false); }
  if (needUI) { needUI = false; uiCtx.setTransform(1, 0, 0, 1, 0, 0); uiCtx.clearRect(0, 0, V.cw, V.ch); drawUI(uiCtx, V, false); }
  if (S.loupe.on && loupe.visible) drawLoupe();
  if (T.busyAt || (T.flash && T.flash.until > performance.now())) { needUI = true; schedule(); }
}

// ------------------------------------------------------------------ scene

function visRect(v) {
  return [(-v.tx) / v.scale, (-v.ty) / v.scale, (v.cw - v.tx) / v.scale, (v.ch - v.ty) / v.scale];
}

function drawTiles(ctx, v, isLoupe) {
  const levels = tiles.levels;
  if (!levels.length) return;
  const T_ = 1024;
  const [vx0, vy0, vx1, vy1] = visRect(v);
  const drawLevel = (l, onlyComplete) => {
    const L = levels[l];
    if (!L) return false;
    const f = 1 << l;
    const s = v.scale * f;
    const c0 = Math.max(0, Math.floor(vx0 / f / T_)), c1 = Math.min(Math.ceil(L.w / T_) - 1, Math.floor(vx1 / f / T_));
    const r0 = Math.max(0, Math.floor(vy0 / f / T_)), r1 = Math.min(Math.ceil(L.h / T_) - 1, Math.floor(vy1 / f / T_));
    if (onlyComplete) {
      for (let ty = r0; ty <= r1; ty++) for (let tx = c0; tx <= c1; tx++) if (!L.map.has(tx + ',' + ty)) return false;
    }
    if (s >= 1 && l === 0) ctx.imageSmoothingEnabled = false;
    else { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
    for (let ty = r0; ty <= r1; ty++) {
      for (let tx = c0; tx <= c1; tx++) {
        const t = L.map.get(tx + ',' + ty);
        if (!t) continue;
        const X0 = Math.round(v.tx + t.x * s), Y0 = Math.round(v.ty + t.y * s);
        const X1 = Math.round(v.tx + (t.x + t.w) * s), Y1 = Math.round(v.ty + (t.y + t.h) * s);
        ctx.drawImage(t.bitmap, X0, Y0, X1 - X0, Y1 - Y0);
      }
    }
    return true;
  };
  const want = v.scale >= 1 ? 0 : Math.min(levels.length - 1, Math.floor(Math.log2(1 / v.scale)));
  // underlay: the first coarser level that is complete for this view, so missing tiles never show holes
  for (let l = levels.length - 1; l > want; l--) { if (drawLevel(l, true)) break; }
  drawLevel(want, false);
  // zoomed in on a PDF: vectors re-rendered at screen resolution replace the enlarged pixels
  if (!isLoupe && sharp && Math.abs(sharp.k - v.scale) / v.scale < 0.001) {
    ctx.imageSmoothingEnabled = false;
    const r = sharp.rect;
    ctx.drawImage(sharp.bitmap, Math.round(v.tx + r[0] * v.scale), Math.round(v.ty + r[1] * v.scale), sharp.bitmap.width, sharp.bitmap.height);
  }
}

function drawMarkups(o, v) {
  const w = o.canvas.width, h = o.canvas.height;
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, w, h);
  const [vx0, vy0, vx1, vy1] = visRect(v);
  for (const m0 of S.markups) {
    const m = shown(m0); // its status colour on the progress map
    const g = geo(m0);
    let path = g.path, bb = g.bbox;
    if (T.vertexEdit && T.vertexEdit.id === m0.id) { path = pathFromRings(T.vertexEdit.rings); bb = ringsBBox(T.vertexEdit.rings); }
    let dx = 0, dy = 0;
    if (T.moveIds && T.moveIds.has(m.id)) { dx = T.moveDx; dy = T.moveDy; }
    const bw = m.borderPt > 0 ? ptToPx(m.borderPt) : 0;
    if (bb[2] + dx + bw < vx0 || bb[0] + dx - bw > vx1 || bb[3] + dy + bw < vy0 || bb[1] + dy - bw > vy1) continue;
    o.setTransform(v.scale, 0, 0, v.scale, v.tx + dx * v.scale, v.ty + dy * v.scale);
    o.globalCompositeOperation = 'destination-out';
    o.fillStyle = '#000';
    o.fill(path, 'evenodd');
    o.globalCompositeOperation = 'source-over';
    o.fillStyle = rgba(m.color, m.opacity);
    o.fill(path, 'evenodd');
    if (bw > 0) {
      const lw = Math.max(bw, 1 / v.scale);
      const ls = borderDash(m, lw);
      o.lineJoin = 'miter';
      o.miterLimit = 4;
      o.lineCap = ls.cap;
      o.setLineDash(ls.dash);
      o.lineWidth = lw;
      o.globalCompositeOperation = 'destination-out';
      o.strokeStyle = '#000';
      o.stroke(path);
      o.globalCompositeOperation = 'source-over';
      o.strokeStyle = borderColorOf(m);
      o.stroke(path);
      o.setLineDash([]);
    }
  }
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
}

export function drawScene(ctx, v, octx, isLoupe) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = BOARD;
  ctx.fillRect(0, 0, v.cw, v.ch);
  if (!S.doc) return;
  const sx = v.tx, sy = v.ty, sw = S.doc.W * v.scale, sh = S.doc.H * v.scale;
  if (!isLoupe) {
    ctx.save();
    ctx.shadowColor = 'rgba(16,24,20,0.38)';
    ctx.shadowBlur = 22 * v.dpr;
    ctx.shadowOffsetY = 4 * v.dpr;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(sx, sy, sw, sh);
  }
  drawTiles(ctx, v, isLoupe);
  if (S.markups.length) {
    drawMarkups(octx, v);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(octx.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  // dimensions and area tags: part of the sheet (they print)
  if ((S.dims.length && S.meas.dims) || tagsVisible()) {
    ctx.save();
    ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);
    drawAnnots(ctx, 1 / v.scale, { moveIds: T.moveIds, dx: T.moveDx, dy: T.moveDy, dimEdit: T.dimEdit, tagEdit: T.tagEdit });
    ctx.restore();
  }
  // gap lines (screen only, never exported)
  if (S.showGaps && (S.gaps.length || T.gap)) {
    ctx.save();
    ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);
    ctx.strokeStyle = GAP;
    ctx.lineWidth = 2 * v.dpr / v.scale;
    ctx.setLineDash([7 * v.dpr / v.scale, 4 * v.dpr / v.scale]);
    ctx.lineCap = 'round';
    for (const gl of S.gaps) {
      ctx.beginPath();
      ctx.moveTo(gl.pts[0], gl.pts[1]);
      for (let i = 2; i < gl.pts.length; i += 2) ctx.lineTo(gl.pts[i], gl.pts[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (T.detectPreview) {
    ctx.save();
    ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);
    for (const r of T.detectPreview) {
      const p = pathFromRings(r.rings);
      const hot = T.detectHover === r.rid;
      if (hot) { ctx.fillStyle = r.on ? 'rgba(36,87,197,0.16)' : 'rgba(43,48,45,0.12)'; ctx.fill(p, 'evenodd'); }
      ctx.lineWidth = (hot ? 4 : 2.5) * v.dpr / v.scale;
      ctx.setLineDash(r.on ? [] : [5 * v.dpr / v.scale, 4 * v.dpr / v.scale]);
      ctx.strokeStyle = r.on ? BLUE : 'rgba(43,48,45,0.6)';
      ctx.stroke(p);
    }
    ctx.restore();
  }
  // legend
  const L = S.legend;
  if (L && L.visible) {
    const rows = legendRows(L);
    let Lp = L;
    if (T.legendPreview) Lp = { ...L, x: T.legendPreview.x, y: T.legendPreview.y, titlePx: T.legendPreview.titlePx, namePx: T.legendPreview.namePx };
    const lay = legendLayout(Lp, rows);
    ctx.save();
    ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);
    drawLegend(ctx, Lp, rows, lay);
    ctx.restore();
  }
  // snag pins: on top of everything (they print)
  if (S.pins.length) {
    ctx.save();
    ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);
    const z = pinSize((PIN_MIN_CSS * v.dpr) / v.scale);
    for (const p of S.pins) {
      const mv = T.moveIds && T.moveIds.has(p.id);
      drawPin(ctx, p, z, mv ? T.moveDx : 0, mv ? T.moveDy : 0);
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------ interaction layer

function strokeOutline(ctx, v, path, dx = 0, dy = 0, color = BLUE, width = 1.5) {
  ctx.save();
  ctx.setTransform(v.scale, 0, 0, v.scale, v.tx + dx * v.scale, v.ty + dy * v.scale);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = (width + 2) * v.dpr / v.scale;
  ctx.stroke(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = width * v.dpr / v.scale;
  ctx.stroke(path);
  ctx.restore();
}

// Selected markups with a visible border: two thin lines hug the border on both sides, so the
// border's style and colour stay visible while it is selected (and while you change them).
const bracketLayers = new WeakMap(); // one per canvas (main view, magnifier)
function strokeBrackets(ctx, v, items) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  let layer = bracketLayers.get(ctx.canvas);
  if (!layer || layer.width !== W || layer.height !== H) { layer = new OffscreenCanvas(W, H); bracketLayers.set(ctx.canvas, layer); }
  const o = layer.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, W, H);
  o.lineJoin = 'miter';
  o.miterLimit = 4;
  const lw = 1.25 * v.dpr;
  for (const pass of [0, 1]) {
    o.globalCompositeOperation = pass ? 'destination-out' : 'source-over';
    o.strokeStyle = BLUE;
    for (const it of items) {
      o.setTransform(v.scale, 0, 0, v.scale, v.tx + it.dx * v.scale, v.ty + it.dy * v.scale);
      o.lineWidth = (2 * it.gap + (pass ? 0 : 2 * lw)) / v.scale;
      o.stroke(it.path);
    }
  }
  o.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function handle(ctx, x, y, d, fill = '#FFFFFF', stroke = BLUE, size = 7) {
  const s = size * d;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5 * d;
  ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), Math.round(s), Math.round(s));
  ctx.strokeRect(Math.round(x - s / 2) + 0.5, Math.round(y - s / 2) + 0.5, Math.round(s) - 1, Math.round(s) - 1);
}

/** A small rounded label (dimension values, lengths). */
function pill(ctx, text, cx, cy, d, color = BLUE) {
  ctx.save();
  ctx.font = `600 ${Math.round(11.5 * d)}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 12 * d, h = 19 * d;
  const x = cx - w / 2, y = cy - h / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * d;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4 * d);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy + 0.5 * d);
  ctx.restore();
}

/** Architectural dimension line between two screen points with 45° ticks and a value. */
function dimLine(ctx, ax, ay, bx, by, text, d) {
  ctx.save();
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1.25 * d;
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  const t = 5 * d;
  for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.moveTo(x - t, y + t); ctx.lineTo(x + t, y - t); }
  ctx.stroke();
  ctx.restore();
  pill(ctx, text, (ax + bx) / 2, (ay + by) / 2, d);
}

/** Blue outline along a dimension's lines (hover and selection). */
function outlineDim(ctx, v, d, color, width) {
  const L = dimLayout(d);
  const sp = (x, y) => [x * v.scale + v.tx, y * v.scale + v.ty];
  ctx.save();
  ctx.lineCap = 'round';
  for (const [w, c] of [[width + 2.5, 'rgba(255,255,255,0.9)'], [width, color]]) {
    ctx.lineWidth = w * v.dpr;
    ctx.strokeStyle = c;
    ctx.beginPath();
    for (const sg of L.segs) { const [ax, ay] = sp(sg[0], sg[1]); const [bx, by] = sp(sg[2], sg[3]); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
    ctx.stroke();
  }
  // the text box
  const t = L.text;
  ctx.translate(t.cx * v.scale + v.tx, t.cy * v.scale + v.ty);
  ctx.rotate(t.ang);
  ctx.setLineDash([3 * v.dpr, 2 * v.dpr]);
  ctx.lineWidth = 1 * v.dpr;
  ctx.strokeStyle = color;
  ctx.strokeRect((-t.w / 2) * v.scale - 2 * v.dpr, (-t.h / 2) * v.scale - 1 * v.dpr, t.w * v.scale + 4 * v.dpr, t.h * v.scale + 2 * v.dpr);
  ctx.restore();
}

function outlineTag(ctx, v, t, dx = 0, dy = 0, color = BLUE) {
  const x0 = (t.cx - t.w / 2 + dx) * v.scale + v.tx, y0 = (t.cy - t.h / 2 + dy) * v.scale + v.ty;
  ctx.save();
  ctx.setLineDash([4 * v.dpr, 3 * v.dpr]);
  ctx.lineWidth = 1.25 * v.dpr;
  ctx.strokeStyle = color;
  ctx.strokeRect(x0 - 3 * v.dpr, y0 - 3 * v.dpr, t.w * v.scale + 6 * v.dpr, t.h * v.scale + 6 * v.dpr);
  ctx.restore();
}

export function editableRings(m) {
  if (T.vertexEdit && T.vertexEdit.id === m.id) return T.vertexEdit.rings;
  return m.rings;
}

export const VERTEX_EDIT_LIMIT = 400;

function drawGuides(ctx, v, d) {
  const g = T.guide;
  if (!g) return;
  const X = g.x * v.scale + v.tx, Y = g.y * v.scale + v.ty;
  ctx.save();
  const line = (x0, y0, x1, y1, snapped) => {
    ctx.beginPath();
    if (snapped) { ctx.strokeStyle = SNAP; ctx.lineWidth = 1.25 * d; ctx.setLineDash([]); }
    else { ctx.strokeStyle = 'rgba(36,87,197,0.55)'; ctx.lineWidth = 1 * d; ctx.setLineDash([5 * d, 4 * d]); }
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  if (g.cross || g.sx) line(Math.round(X) + 0.5, 0, Math.round(X) + 0.5, v.ch, g.sx);
  if (g.cross || g.sy) line(0, Math.round(Y) + 0.5, v.cw, Math.round(Y) + 0.5, g.sy);
  ctx.restore();
}

function drawRectInProgress(ctx, v, d) {
  const r = T.rect;
  const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
  const sp = (x, y) => [x * v.scale + v.tx, y * v.scale + v.ty];
  const [X0, Y0] = sp(x0, y0), [X1, Y1] = sp(x1, y1);
  // extension lines: where each edge falls across the whole sheet
  ctx.save();
  ctx.strokeStyle = 'rgba(36,87,197,0.32)';
  ctx.lineWidth = 1 * d;
  ctx.setLineDash([4 * d, 4 * d]);
  ctx.beginPath();
  for (const X of [X0, X1]) { ctx.moveTo(Math.round(X) + 0.5, 0); ctx.lineTo(Math.round(X) + 0.5, v.ch); }
  for (const Y of [Y0, Y1]) { ctx.moveTo(0, Math.round(Y) + 0.5); ctx.lineTo(v.cw, Math.round(Y) + 0.5); }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = rgba(S.style.color, 0.28);
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 1.75 * d;
  ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
  if (X1 - X0 < 2 && Y1 - Y0 < 2) return;
  // dimensions
  const off = 24 * d;
  const wy = Y0 - off > 14 * d ? Y0 - off : Y1 + off;
  dimLine(ctx, X0, wy, X1, wy, lengthLabel(x1 - x0), d);
  const hx = X0 - off > 40 * d ? X0 - off : X1 + off;
  dimLine(ctx, hx, Y0, hx, Y1, lengthLabel(y1 - y0), d);
}

export function drawUI(ctx, v, isLoupe) {
  if (!S.doc) return;
  const d = v.dpr;
  const d_ = v.dpr;
  const sp = (x, y) => [x * v.scale + v.tx, y * v.scale + v.ty];

  if (T.hoverId && !S.selection.has(T.hoverId) && !T.moveIds) {
    const m = S.markups.find((q) => q.id === T.hoverId);
    if (m) strokeOutline(ctx, v, geo(m).path, 0, 0, 'rgba(36,87,197,0.75)', 1.25);
  }
  if (T.flash && T.flash.until > performance.now()) {
    const a = (T.flash.until - performance.now()) / 900;
    for (const id of T.flash.ids) {
      const m = S.markups.find((q) => q.id === id);
      if (m) strokeOutline(ctx, v, geo(m).path, 0, 0, `rgba(36,87,197,${Math.max(0, Math.min(1, a))})`, 3);
    }
  }
  const sel = S.markups.filter((m) => S.selection.has(m.id));
  const brackets = [];
  for (const m of sel) {
    const moving = T.moveIds && T.moveIds.has(m.id);
    const rings = editableRings(m);
    const path = rings === m.rings ? geo(m).path : pathFromRings(rings);
    const dx = moving ? T.moveDx : 0, dy = moving ? T.moveDy : 0;
    const bw = m.borderPt > 0 ? ptToPx(m.borderPt) * v.scale : 0;
    if (bw >= 1.5 * d) brackets.push({ path, dx, dy, gap: bw / 2 + 1.5 * d });
    else strokeOutline(ctx, v, path, dx, dy);
  }
  if (brackets.length) strokeBrackets(ctx, v, brackets);
  // area tags of selected (or hovered) markups: dashed box, so it is clear they can be dragged
  if (tagsVisible()) {
    S.markups.forEach((m, i) => {
      const sel_ = S.selection.has(m.id), hov = T.hoverTagId === m.id;
      if (!sel_ && !hov) return;
      const t = tagLayout(i);
      if (!t) return;
      let dx = 0, dy = 0;
      if (T.moveIds && T.moveIds.has(m.id)) { dx = T.moveDx; dy = T.moveDy; }
      if (T.tagEdit && T.tagEdit.id === m.id) { dx = T.tagEdit.at[0] - t.cx; dy = T.tagEdit.at[1] - t.cy; }
      outlineTag(ctx, v, t, dx, dy, sel_ ? BLUE : 'rgba(36,87,197,0.6)');
    });
  }
  // dimensions: hover and selection
  if (S.meas.dims && S.dims.length) {
    const selD = S.dims.filter((d) => S.selection.has(d.id));
    if (T.hoverDimId && !S.selection.has(T.hoverDimId) && !T.moveIds) {
      const d = S.dims.find((q) => q.id === T.hoverDimId);
      if (d) outlineDim(ctx, v, d, 'rgba(36,87,197,0.55)', 1.25);
    }
    for (const d0 of selD) {
      let d = d0;
      if (T.dimEdit && T.dimEdit.id === d.id) d = T.dimEdit;
      else if (T.moveIds && T.moveIds.has(d.id)) d = { ...d, a: [d.a[0] + T.moveDx, d.a[1] + T.moveDy], b: [d.b[0] + T.moveDx, d.b[1] + T.moveDy] };
      outlineDim(ctx, v, d, BLUE, 1.5);
      if (selD.length === 1 && !T.moveIds) {
        const L = dimLayout(d);
        const mid = [(L.p[0] + L.q[0]) / 2, (L.p[1] + L.q[1]) / 2];
        for (const [which, pt] of [['a', d.a], ['b', d.b]]) {
          const [x, y] = sp(pt[0], pt[1]);
          const hot = T.hoverDimHandle === which;
          handle(ctx, x, y, d_, hot ? BLUE : '#FFFFFF', BLUE, hot ? 9 : 7);
        }
        const [mx, my] = sp(mid[0], mid[1]);
        ctx.save();
        ctx.fillStyle = T.hoverDimHandle === 'off' ? BLUE : '#FFFFFF';
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 1.5 * d_;
        ctx.beginPath(); ctx.arc(mx, my, (T.hoverDimHandle === 'off' ? 6 : 5) * d_, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
  }
  if (sel.length === 1 && !T.moveIds) {
    const m = sel[0];
    const rings = editableRings(m);
    if (vertexCount(rings) <= VERTEX_EDIT_LIMIT) {
      rings.forEach((r, ri) => {
        for (let i = 0; i < r.length; i += 2) {
          const [x, y] = sp(r[i], r[i + 1]);
          const hot = T.hoverVertex && T.hoverVertex.ri === ri && T.hoverVertex.vi === i >> 1;
          handle(ctx, x, y, d, hot ? BLUE : '#FFFFFF', BLUE, hot ? 9 : 7);
        }
      });
    }
  }
  // snag pins: a ring round the head of selected and hovered pins
  if (S.pins.length) {
    const z = pinSize((PIN_MIN_CSS * v.dpr) / v.scale);
    for (const p of S.pins) {
      const sel_ = S.selection.has(p.id), hov = T.hoverPinId === p.id && !T.moveIds;
      if (!sel_ && !hov) continue;
      const mv = T.moveIds && T.moveIds.has(p.id);
      const [X, Y] = sp(p.x + (mv ? T.moveDx : 0), p.y - z.tail + (mv ? T.moveDy : 0));
      const R = (z.r + z.lw) * v.scale + 3 * d;
      ctx.save();
      ctx.lineWidth = 4 * d;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = (sel_ ? 2 : 1.5) * d;
      ctx.strokeStyle = sel_ ? BLUE : 'rgba(36,87,197,0.6)';
      ctx.stroke();
      ctx.restore();
    }
  }
  if (S.legendSelected && S.legend && S.legend.visible) {
    const Lp = T.legendPreview ? { ...S.legend, ...T.legendPreview } : S.legend;
    const lay = legendLayout(Lp);
    const [x0, y0] = sp(Lp.x, Lp.y);
    const [x1, y1] = sp(Lp.x + lay.w, Lp.y + lay.h);
    ctx.save();
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 1.5 * d;
    ctx.setLineDash([5 * d, 3 * d]);
    ctx.strokeRect(x0 - 3 * d, y0 - 3 * d, x1 - x0 + 6 * d, y1 - y0 + 6 * d);
    ctx.restore();
    handle(ctx, x1 + 3 * d, y1 + 3 * d, d, BLUE, '#FFFFFF', 11);
  }
  if (T.band) {
    const [x0, y0] = sp(Math.min(T.band.x0, T.band.x1), Math.min(T.band.y0, T.band.y1));
    const [x1, y1] = sp(Math.max(T.band.x0, T.band.x1), Math.max(T.band.y0, T.band.y1));
    ctx.save();
    if (T.band.crossing) {
      ctx.fillStyle = 'rgba(46,140,80,0.10)';
      ctx.strokeStyle = '#2E8C50';
      ctx.setLineDash([6 * d, 4 * d]);
    } else {
      ctx.fillStyle = 'rgba(36,87,197,0.10)';
      ctx.strokeStyle = BLUE;
    }
    ctx.lineWidth = 1.25 * d;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    ctx.restore();
  }
  // guides first, so shapes in progress draw over them
  drawGuides(ctx, v, d);
  if (T.poly && T.poly.pts.length) {
    const pts = T.poly.pts;
    const cur = T.poly.cursor;
    ctx.save();
    if (T.poly.guide) {
      const g = T.poly.guide;
      const [ax, ay] = sp(g.x - g.dx * 1e5, g.y - g.dy * 1e5);
      const [bx, by] = sp(g.x + g.dx * 1e5, g.y + g.dy * 1e5);
      ctx.strokeStyle = 'rgba(36,87,197,0.45)';
      ctx.lineWidth = 1 * d;
      ctx.setLineDash([2 * d, 4 * d]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (T.poly.ref) {
      const r = T.poly.ref;
      const [ax, ay] = sp(r[0], r[1]);
      const [bx, by] = sp(r[2], r[3]);
      ctx.strokeStyle = SNAP;
      ctx.lineWidth = 4 * d;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    const all = cur ? [...pts, cur[0], cur[1]] : pts;
    if (all.length >= 6) {
      ctx.beginPath();
      const [x0, y0] = sp(all[0], all[1]);
      ctx.moveTo(x0, y0);
      for (let i = 2; i < all.length; i += 2) { const [x, y] = sp(all[i], all[i + 1]); ctx.lineTo(x, y); }
      ctx.closePath();
      ctx.fillStyle = rgba(S.style.color, 0.28);
      ctx.fill();
    }
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 1.75 * d;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) { const [x, y] = sp(pts[i], pts[i + 1]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    if (cur) {
      const [lx, ly] = sp(pts[pts.length - 2], pts[pts.length - 1]);
      const [cx, cy] = sp(cur[0], cur[1]);
      ctx.setLineDash([6 * d, 4 * d]);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(cx, cy); ctx.stroke();
      if (pts.length >= 4) {
        const [fx, fy] = sp(pts[0], pts[1]);
        ctx.strokeStyle = 'rgba(36,87,197,0.4)';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(fx, fy); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = sp(pts[i], pts[i + 1]);
      const first = i === 0;
      handle(ctx, x, y, d, first && T.poly.closeHint ? BLUE : '#FFFFFF', BLUE, first ? (T.poly.closeHint ? 12 : 9) : 7);
    }
    // length of the edge being drawn
    if (cur && !isLoupe) {
      const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
      const len = Math.hypot(cur[0] - lx, cur[1] - ly);
      if (len * v.scale > 30 * d) {
        const [ax, ay] = sp(lx, ly), [bx, by] = sp(cur[0], cur[1]);
        const L = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / L, ny = (bx - ax) / L;
        pill(ctx, lengthLabel(len), (ax + bx) / 2 + nx * 16 * d, (ay + by) / 2 + ny * 16 * d, d);
      }
    }
    ctx.restore();
  }
  if (T.rect) drawRectInProgress(ctx, v, d);
  if (T.dim) {
    const t = T.dim;
    const end = t.phase === 'b' ? t.cur : t.b;
    if (end && Math.hypot(end[0] - t.a[0], end[1] - t.a[1]) > 0.5) {
      ctx.save();
      ctx.setTransform(v.scale, 0, 0, v.scale, v.tx, v.ty);
      drawDim(ctx, { id: '_', a: t.a, b: end, off: t.phase === 'off' ? t.off : 0 }, 1 / v.scale);
      ctx.restore();
    }
    for (const pt of [t.a, t.b].filter(Boolean)) { const [x, y] = sp(pt[0], pt[1]); handle(ctx, x, y, d, '#FFFFFF', BLUE, 7); }
  }
  if (T.calibLine) {
    const t = T.calibLine;
    const [ax, ay] = sp(t.a[0], t.a[1]), [bx, by] = sp(t.cur[0], t.cur[1]);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 4.5 * d;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = SNAP;
    ctx.lineWidth = 2 * d;
    ctx.stroke();
    ctx.restore();
    handle(ctx, ax, ay, d, '#FFFFFF', SNAP, 8);
    handle(ctx, bx, by, d, '#FFFFFF', SNAP, 8);
    const len = Math.hypot(t.cur[0] - t.a[0], t.cur[1] - t.a[1]);
    const L = Math.hypot(bx - ax, by - ay);
    if (L > 30 * d && !isLoupe) {
      const nx = -(by - ay) / L, ny = (bx - ax) / L;
      pill(ctx, lengthLabel(len), (ax + bx) / 2 + nx * 18 * d, (ay + by) / 2 + ny * 18 * d, d, SNAP);
    }
  }
  if (T.gap && T.gap.pts.length) {
    const pts = T.gap.cursor ? [...T.gap.pts, ...T.gap.cursor] : T.gap.pts;
    ctx.save();
    ctx.strokeStyle = GAP;
    ctx.lineWidth = 2 * d;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) { const [x, y] = sp(pts[i], pts[i + 1]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    for (let i = 0; i < T.gap.pts.length; i += 2) { const [x, y] = sp(T.gap.pts[i], T.gap.pts[i + 1]); handle(ctx, x, y, d, '#FFFFFF', GAP, 6); }
    ctx.restore();
  }
  if (T.snap) {
    const [x, y] = sp(T.snap.x, T.snap.y);
    ctx.save();
    ctx.strokeStyle = SNAP;
    ctx.lineWidth = 2 * d;
    const s = 6 * d;
    if (T.snap.kind === 'vertex') ctx.strokeRect(x - s, y - s, 2 * s, 2 * s);
    else { ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke(); }
    ctx.restore();
  }
  if (T.brush) {
    ctx.save();
    if (T.brush.stroke && T.brush.stroke.length >= 2) {
      ctx.strokeStyle = 'rgba(214,51,108,0.35)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = T.brush.r * 2 * v.scale;
      ctx.beginPath();
      const st = T.brush.stroke;
      for (let i = 0; i < st.length; i += 2) { const [x, y] = sp(st[i], st[i + 1]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      if (st.length === 2) { const [x, y] = sp(st[0], st[1]); ctx.lineTo(x + 0.01, y); }
      ctx.stroke();
    }
    const [x, y] = sp(T.brush.x, T.brush.y);
    const r = T.brush.r * v.scale;
    ctx.lineWidth = 3 * d; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.25 * d; ctx.strokeStyle = '#2B302D';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  if (T.busyAt && !isLoupe) {
    const [x, y] = T.busyAt;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.lineWidth = 3 * d;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(x, y, 11 * d, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = BLUE;
    ctx.beginPath(); ctx.arc(x, y, 11 * d, t * 6, t * 6 + Math.PI * 1.2); ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ magnifier

export function drawLoupe() {
  if (!S.doc) return;
  const size = loupeCv.width;
  const lv = { scale: V.scale * S.loupe.power, tx: 0, ty: 0, dpr: V.dpr, cw: size, ch: size };
  const sx = (loupe.devX - V.tx) / V.scale, sy = (loupe.devY - V.ty) / V.scale;
  lv.tx = size / 2 - sx * lv.scale;
  lv.ty = size / 2 - sy * lv.scale;
  drawScene(loupeCtx, lv, loupeOverlayCtx, true);
  loupeCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawUI(loupeCtx, lv, true);
  const c = size / 2, d = V.dpr;
  loupeCtx.setTransform(1, 0, 0, 1, 0, 0);
  loupeCtx.strokeStyle = 'rgba(255,255,255,0.9)';
  loupeCtx.lineWidth = 3 * d;
  loupeCtx.beginPath();
  loupeCtx.moveTo(c - 14 * d, c); loupeCtx.lineTo(c - 4 * d, c); loupeCtx.moveTo(c + 4 * d, c); loupeCtx.lineTo(c + 14 * d, c);
  loupeCtx.moveTo(c, c - 14 * d); loupeCtx.lineTo(c, c - 4 * d); loupeCtx.moveTo(c, c + 4 * d); loupeCtx.lineTo(c, c + 14 * d);
  loupeCtx.stroke();
  loupeCtx.strokeStyle = '#D6336C';
  loupeCtx.lineWidth = 1.25 * d;
  loupeCtx.stroke();
}

export function setLoupeVisible(vis) {
  loupe.visible = vis && S.loupe.on && !!S.doc;
  loupeCv.style.display = loupe.visible ? 'block' : 'none';
}

export function moveLoupe(cssX, cssY) {
  loupe.cssX = cssX; loupe.cssY = cssY;
  loupe.devX = cssX * V.dpr; loupe.devY = cssY * V.dpr;
  loupeCv.style.transform = `translate(${Math.round(cssX - loupe.size / 2)}px, ${Math.round(cssY - loupe.size / 2)}px)`;
  if (loupe.visible) schedule();
}
