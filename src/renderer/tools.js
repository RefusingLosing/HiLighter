// Pointer and keyboard interaction: tools, selection, editing, navigation.

import { S, emit, on, makeMarkup, withProps, setSelection, selectedMarkups, ptToPx, uid, makeDim, isDimId } from './state.js';
import { V, toSheet, zoomAt, pan, fit, setZoomPercent } from './view.js';
import { T, geo, requestUI, requestAll, setLoupeVisible, moveLoupe, editableRings, VERTEX_EDIT_LIMIT } from './render.js';
import * as G from './geom.js';
import * as engine from './engine.js';
import { change, snapshot, commit, runExclusive } from './history.js';
import { legendRect, legendLayout, clampLegendSizes } from './legend.js';
import { toast, showMenu, modal, h, modalOpen, closeMenu } from './ui.js';
import { rgbToHex } from './colors.js';
import { startRename, revealInList, zoomToIds, applyStyle } from './panel.js';
import { lengthUnit, lengthUnitLabel, pxToUnit, unitToPx, fmtUnitValue, parseLength, hasScale } from './units.js';
import { dimLayout, hitDim, hitTag, tagLayout, tagsVisible, movedDim, offsetFor } from './annot.js';
import { calibrateDialog } from './dialogs.js';
import { setCalibration } from './scale.js';
import { scaleRatio, fmtScale } from './units.js';
import { setMeas } from './state.js';

let cv = null;
let hooks = {};
const P = { down: false, button: 0, dev: [0, 0], startDev: [0, 0], start: [0, 0], moved: false, mode: null, data: null, id: -1 };
let spaceDown = false;
let ctrlDown = false;
let lastMoveEvent = null;

export const TOOL_INFO = {
  select: { label: 'Select and move', key: 'S', icon: 'mouse-pointer-2' },
  hand: { label: 'Pan the sheet', key: 'Space', icon: 'hand' },
  fill: { label: 'Fill an enclosed area', key: 'F', icon: 'paint-bucket' },
  polygon: { label: 'Draw a polygon', key: 'P', icon: 'pentagon' },
  rect: { label: 'Draw a rectangle', key: 'R', icon: 'square' },
  gap: { label: 'Close a gap for Fill', key: 'G', icon: 'fence' },
  dim: { label: 'Dimension: measure between two points', key: 'K', icon: 'ruler-dimension-line' },
  calib: { label: 'Calibrate the scale from a known length', key: 'C', icon: 'ruler' },
  pick: { label: 'Pick a colour from the sheet', key: 'I', icon: 'pipette' },
  erase: { label: 'Eraser: highlights and colour in the drawing', key: 'E', icon: 'eraser' },
};

const HINTS = {
  select: 'Click a markup to select it. Shift or Ctrl+click adds more. Drag across empty paper to select by area. Drag to move; drag a corner to reshape.',
  hand: 'Drag to move around the sheet. The wheel zooms at the pointer.',
  fill: 'Click inside a room or area to fill it. Click an existing fill to give it the current colour. Alt+click picks a colour.',
  polygon: 'Click to place corners. Click the first corner, double-click or press Enter to close. H horizontal, V vertical, A 90° to an edge, Shift ortho.',
  rect: 'Click or drag from corner to corner. Corners snap to walls and lines (hold Ctrl to place freely). After the first corner, type a size. Shift keeps it square.',
  gap: 'Draw a line across a door or opening so Fill stops there. Double-click or Enter to finish. Gap lines never print.',
  dim: 'Click two points to measure between them, then click where the dimension line goes. Shift: horizontal or vertical. Snaps to walls and lines (hold Ctrl to place freely).',
  calib: 'Click both ends of a length you know (a dimension, a door, a grid spacing), then type its real length.',
  pick: 'Click the sheet or a markup to take its colour. Selected markups take the colour too.',
  erase: 'Drag to erase colour: highlights and colour painted in the drawing. Lines and paper stay. Shift+click removes a whole markup or coloured area. [ and ] change the size.',
};

export function initTools(canvas, h_) {
  cv = canvas;
  hooks = h_;
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onCancel);
  cv.addEventListener('dblclick', onDbl);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('contextmenu', onContext);
  cv.addEventListener('pointerleave', () => {
    setLoupeVisible(false);
    if (T.brush) T.brush = null;
    T.snap = null;
    if (!T.rect) T.guide = null;
    if (T.poly) T.poly.cursor = null;
    if (T.detectHover !== null) { T.detectHover = null; requestAll(); }
    requestUI();
  });
  cv.addEventListener('pointerenter', () => setLoupeVisible(true));
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { spaceDown = false; ctrlDown = false; updateCursor(); });
  on('doc', () => { if (P.mode === null) updateHover(); });
  on('docLoaded', () => { LS.data = null; });
}

// ------------------------------------------------------------------ helpers

const devOf = (e) => [e.offsetX * V.dpr, e.offsetY * V.dpr];
const sheetOf = (e) => { const [dx, dy] = devOf(e); return toSheet(dx, dy); };
const tolSheet = (px = 8) => (px * V.dpr) / V.scale;
const detectMode = () => !!(hooks.detectActive && hooks.detectActive());

export function setTool(name) {
  if (!TOOL_INFO[name]) return;
  if (S.tool === name) return;
  cancelDrawing();
  S.tool = name;
  if (['fill', 'polygon', 'rect', 'gap', 'dim', 'calib'].includes(name) && (S.selection.size || S.legendSelected)) setSelection([]);
  T.brush = null;
  T.hoverVertex = null;
  T.hoverId = null;
  T.guide = null;
  emit('tool');
  updateCursor();
  requestAll();
}

export function hintFor(tool) { return HINTS[tool] || ''; }

/** Drops anything half-drawn (used when another drawing opens). */
export function resetInteraction() {
  cancelDrawing();
  T.brush = null; T.hoverId = null; T.hoverVertex = null; T.moveIds = null; T.vertexEdit = null; T.dimEdit = null; T.tagEdit = null; T.hoverDimId = null; T.hoverTagId = null;
  T.legendPreview = null; T.detectPreview = null; T.detectHover = null; T.flash = null; T.busyAt = null; T.guide = null;
  P.down = false; P.mode = null; P.data = null;
}

function cancelDrawing() {
  T.poly = null; T.rect = null; T.gap = null; T.band = null; T.snap = null; T.guide = null; T.dim = null; T.calibLine = null;
  closeDimInput();
  S.lock.once = null; S.lock.refIdx = -1; S.lock.extRef = null;
  emit('lock');
  emit('dimstep');
}

export function updateCursor() {
  if (!cv) return;
  let c = 'default';
  if (spaceDown || S.tool === 'hand') c = P.mode === 'pan' ? 'grabbing' : 'grab';
  else if (P.mode === 'pan') c = 'grabbing';
  else if (detectMode()) c = hooks.detectCursor ? hooks.detectCursor() : 'pointer';
  else if (S.tool === 'fill') c = 'crosshair';
  else if (S.tool === 'polygon' || S.tool === 'gap' || S.tool === 'dim' || S.tool === 'calib') c = 'crosshair';
  else if (S.tool === 'rect') c = 'none';
  else if (S.tool === 'pick') c = 'copy';
  else if (S.tool === 'erase') c = 'none';
  else if (S.tool === 'select') {
    if (T.hoverVertex || hoverDimHandle) c = 'move';
    else if (P.mode === 'move' || P.mode === 'legend-move' || P.mode === 'tag-move' || P.mode === 'dim-handle') c = 'move';
    else if (hoverLegendHandle) c = 'nwse-resize';
    else if (T.hoverTagId) c = 'move';
    else if (T.hoverId || T.hoverDimId || hoverLegend) c = 'pointer';
  }
  if (S.loupe.on && S.doc && c !== 'grab' && c !== 'grabbing') c = 'none';
  cv.style.cursor = c;
}

export function hitMarkup(x, y) {
  for (let i = S.markups.length - 1; i >= 0; i--) {
    const m = S.markups[i];
    const g = geo(m);
    const pad = m.borderPt > 0 ? ptToPx(m.borderPt) / 2 : 0;
    if (x < g.bbox[0] - pad || x > g.bbox[2] + pad || y < g.bbox[1] - pad || y > g.bbox[3] + pad) continue;
    if (G.pointInRings(m.rings, x, y)) return m;
  }
  return null;
}

function inLegend(x, y) {
  const r = legendRect();
  return r && x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
}

function onLegendHandle(dx, dy) {
  if (!S.legendSelected) return false;
  const r = legendRect();
  if (!r) return false;
  const hx = r[2] * V.scale + V.tx + 3 * V.dpr, hy = r[3] * V.scale + V.ty + 3 * V.dpr;
  return Math.abs(dx - hx) <= 9 * V.dpr && Math.abs(dy - hy) <= 9 * V.dpr;
}

function vertexAt(dx, dy) {
  if (S.selection.size !== 1) return null;
  const m = S.markups.find((q) => S.selection.has(q.id));
  if (!m) return null;
  const rings = editableRings(m);
  if (G.vertexCount(rings) > VERTEX_EDIT_LIMIT) return null;
  const [x, y] = toSheet(dx, dy);
  const v = G.nearestVertex(rings, x, y, tolSheet(7));
  return v ? { m, ...v } : null;
}

/** Handles of the one selected dimension: its two measured points and its line (offset). */
function dimHandleAt(dx, dy) {
  if (S.selection.size !== 1 || !S.meas.dims) return null;
  const id = [...S.selection][0];
  if (!isDimId(id)) return null;
  const d = S.dims.find((q) => q.id === id);
  if (!d) return null;
  const L = dimLayout(d);
  const [x, y] = toSheet(dx, dy);
  const tol = tolSheet(7);
  const mid = [(L.p[0] + L.q[0]) / 2, (L.p[1] + L.q[1]) / 2];
  for (const [which, pt] of [['a', d.a], ['b', d.b], ['off', mid]]) if (Math.hypot(pt[0] - x, pt[1] - y) <= tol) return { d, which };
  return null;
}

/** Ends of the dimensions on the sheet, as extra snap points. */
const dimPts = (skipId = null) => S.dims.filter((d) => d.id !== skipId).flatMap((d) => [d.a[0], d.a[1], d.b[0], d.b[1]]);

const noSnap = (e) => !!(e && (e.ctrlKey || ctrlDown));

/** Snaps to corners and edges of existing markups. */
function snapAt(x, y, e, extra) {
  if (noSnap(e)) return null;
  const tol = tolSheet(9);
  let best = null;
  const consider = (cx, cy, kind) => {
    const d = Math.hypot(cx - x, cy - y);
    if (d <= tol && (!best || d < best.d - (kind === 'vertex' ? tol * 0.3 : 0))) best = { x: cx, y: cy, kind, d };
  };
  if (extra) for (let i = 0; i < extra.length; i += 2) consider(extra[i], extra[i + 1], 'vertex');
  for (const m of S.markups) {
    const b = geo(m).bbox;
    if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
    const v = G.nearestVertex(m.rings, x, y, tol);
    if (v) consider(v.x, v.y, 'vertex');
  }
  if (best) return best;
  for (const m of S.markups) {
    const b = geo(m).bbox;
    if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
    const ed = G.nearestEdge(m.rings, x, y, tol * 0.8);
    if (ed && (!best || ed.d < best.d)) best = { x: ed.x, y: ed.y, kind: 'edge', d: ed.d };
  }
  return best;
}

// ------------------------------------------------------------------ snapping to the drawing's lines

// The engine finds wall faces and line edges near the pointer; the newest answer is kept and
// reused while the pointer stays inside the window it was computed for.
const LS = { data: null, inflight: false, pending: null };

function requestLineSnap(x, y) {
  if (!S.snapDrawing || !S.doc) return;
  const d = LS.data;
  if (d && Math.abs(x - d.cx) <= d.r * 0.5 && Math.abs(y - d.cy) <= d.r * 0.5 && d.scale === V.scale) return;
  LS.pending = [x, y];
  if (!LS.inflight) pumpLineSnap();
}

async function pumpLineSnap() {
  const q = LS.pending;
  if (!q) { LS.inflight = false; return; }
  LS.pending = null;
  LS.inflight = true;
  const r = Math.max(4, Math.ceil(tolSheet(14)));
  const scale = V.scale;
  try {
    const res = await engine.call('snapLines', { x: q[0], y: q[1], r });
    LS.data = { xs: res.xs, ys: res.ys, cx: q[0], cy: q[1], r, scale };
  } catch { LS.data = null; }
  LS.inflight = false;
  if (LS.pending) pumpLineSnap();
  else rehover();
}

function lineSnapAt(x, y) {
  const d = LS.data;
  if (!d || Math.abs(x - d.cx) > d.r || Math.abs(y - d.cy) > d.r) return { x: null, y: null };
  const tol = tolSheet(8);
  let bx = null, bd = tol;
  for (const e of d.xs) { const dd = Math.abs(e - x); if (dd <= bd) { bd = dd; bx = e; } }
  let by = null; bd = tol;
  for (const e of d.ys) { const dd = Math.abs(e - y); if (dd <= bd) { bd = dd; by = e; } }
  return { x: bx, y: by };
}

/** Snap for corners: markup corners/edges first, then the drawing's wall faces and lines. */
function snapPoint(x, y, e, extra, axes = 'xy') {
  const s = snapAt(x, y, e, extra);
  if (s) return { x: s.x, y: s.y, sx: false, sy: false, mark: s };
  if (noSnap(e) || !S.snapDrawing) return { x, y, sx: false, sy: false, mark: null };
  requestLineSnap(x, y);
  const ls = lineSnapAt(x, y);
  const sx = axes.includes('x') && ls.x !== null, sy = axes.includes('y') && ls.y !== null;
  return { x: sx ? ls.x : x, y: sy ? ls.y : y, sx, sy, mark: null };
}

/**
 * A point for the dimension and calibrate tools: snaps to markup corners and edges, dimension
 * ends and the drawing's lines; with Shift (and a start point) the line stays horizontal or
 * vertical while the free end still stops at a wall or line.
 */
function dimPoint(e, x, y, from = null, skipId = null) {
  const extra = dimPts(skipId);
  if (from && e && e.shiftKey) {
    const horiz = Math.abs(x - from[0]) >= Math.abs(y - from[1]);
    const p = horiz ? snapPoint(x, from[1], e, extra, 'x') : snapPoint(from[0], y, e, extra, 'y');
    const q = horiz ? [p.x, from[1]] : [from[0], p.y];
    T.snap = p.mark ? { ...p.mark, x: q[0], y: q[1] } : null;
    T.guide = { x: q[0], y: q[1], sx: horiz && p.sx, sy: !horiz && p.sy, cross: false };
    return q;
  }
  const p = snapPoint(x, y, e, extra);
  T.snap = p.mark;
  T.guide = { x: p.x, y: p.y, sx: p.sx, sy: p.sy, cross: false };
  return [p.x, p.y];
}

function rehover() {
  if (!lastMoveEvent || !T.cursor || P.down) return;
  const fn = HOVER[S.tool];
  if (fn) fn(lastMoveEvent, T.cursor[0], T.cursor[1]);
}

// ------------------------------------------------------------------ naming from the drawing's text

export function nameFromText(rings) {
  const text = S.doc && S.doc.text;
  if (!text || !text.length) return null;
  const bb = G.ringsBBox(rings);
  const unit = /^[\d\s.,:;+\-–—x×*/()%°'"#=]+(m²|m2|sq\.?\s?m|sqm|mm|cm|m|ft²|sf|sqft)?\.?$/i;
  const cands = text.filter((l) => {
    const cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2;
    if (cx < bb[0] || cx > bb[2] || cy < bb[1] || cy > bb[3]) return false;
    if (!G.pointInRings(rings, cx, cy)) return false;
    const letters = (l.t.match(/\p{L}/gu) || []).length;
    return letters >= 2 && !unit.test(l.t) && l.t.length <= 60;
  });
  if (!cands.length) return null;
  let best = cands[0];
  for (const c of cands) {
    if (c.size > best.size * 1.04 || (Math.abs(c.size - best.size) <= best.size * 0.04 && c.t.length > best.t.length)) best = c;
  }
  // names split over two or three lines of the same size, stacked
  const stack = cands
    .filter((c) => Math.abs(c.size - best.size) <= best.size * 0.08)
    .filter((c) => Math.min(c.x1, best.x1) - Math.max(c.x0, best.x0) > -best.size * 0.5)
    .filter((c) => Math.abs((c.y0 + c.y1) / 2 - (best.y0 + best.y1) / 2) <= best.size * 2.6)
    .sort((a, b) => a.y0 - b.y0);
  const name = (stack.length > 1 && stack.length <= 3 ? stack.map((c) => c.t).join(' ') : best.t).replace(/\s+/g, ' ').trim();
  return name.slice(0, 80) || null;
}

// ------------------------------------------------------------------ pointer events

function onDown(e) {
  closeMenu();
  if (!S.doc || modalOpen() || hooks.blocked()) return;
  cv.setPointerCapture(e.pointerId);
  const dev = devOf(e);
  const [x, y] = toSheet(dev[0], dev[1]);
  P.down = true; P.button = e.button; P.dev = dev; P.startDev = dev; P.start = [x, y]; P.moved = false; P.mode = null; P.data = null; P.id = e.pointerId;
  if (e.button === 1 || (e.button === 0 && (spaceDown || S.tool === 'hand'))) {
    P.mode = 'pan';
    updateCursor();
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  if (detectMode()) { P.mode = 'detect'; return; }
  const fn = DOWN[S.tool];
  if (fn) fn(e, x, y, dev);
}

function onMove(e) {
  lastMoveEvent = e;
  if (!S.doc) return;
  const dev = devOf(e);
  const [x, y] = toSheet(dev[0], dev[1]);
  T.cursor = [x, y];
  hooks.cursorMoved(x, y);
  if (S.loupe.on) { setLoupeVisible(true); moveLoupe(e.offsetX, e.offsetY); }
  if (P.down) {
    if (!P.moved && Math.hypot(dev[0] - P.startDev[0], dev[1] - P.startDev[1]) > 3 * V.dpr) P.moved = true;
    if (P.mode === 'pan') {
      pan(dev[0] - P.dev[0], dev[1] - P.dev[1]);
      P.dev = dev;
      requestAll();
      emit('view');
      return;
    }
    P.dev = dev;
    if (P.mode === 'detect') return;
    const fn = DRAG[S.tool];
    if (fn) fn(e, x, y, dev);
    return;
  }
  if (detectMode()) { hooks.detectHover(x, y); updateCursor(); return; }
  const fn = HOVER[S.tool];
  if (fn) fn(e, x, y, dev);
}

function onUp(e) {
  if (!P.down) return;
  try { cv.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  const dev = devOf(e);
  const [x, y] = toSheet(dev[0], dev[1]);
  const mode = P.mode;
  P.down = false;
  if (mode === 'pan') { P.mode = null; updateCursor(); return; }
  if (mode === 'detect') { P.mode = null; if (!P.moved && P.button === 0) hooks.detectClick(x, y, e); return; }
  const fn = UP[S.tool];
  if (fn && P.button === 0) fn(e, x, y, dev);
  P.mode = null; P.data = null;
  updateCursor();
}

function onCancel() {
  P.down = false; P.mode = null; P.data = null;
  T.moveIds = null; T.vertexEdit = null; T.band = null; T.legendPreview = null; T.dimEdit = null; T.tagEdit = null;
  requestAll();
}

function onDbl(e) {
  if (!S.doc || modalOpen() || detectMode()) return;
  const [x, y] = sheetOf(e);
  const fn = DBL[S.tool];
  if (fn) fn(e, x, y);
}

function onWheel(e) {
  e.preventDefault();
  if (!S.doc) return;
  const dev = devOf(e);
  if (e.altKey && S.loupe.on) {
    const steps = [2, 3, 4, 6, 8];
    const i = steps.indexOf(S.loupe.power);
    S.loupe.power = steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? 1 : i) + (e.deltaY < 0 ? 1 : -1)))];
    emit('loupe');
    requestUI();
    return;
  }
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 32;
  else if (e.deltaMode === 2) dy *= 400;
  const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022));
  zoomAt(dev[0], dev[1], factor);
  requestAll();
  emit('view');
  if (lastMoveEvent && !detectMode()) { const [x, y] = toSheet(dev[0], dev[1]); T.cursor = [x, y]; const fn = HOVER[S.tool]; if (fn) fn(e, x, y, dev); }
  repositionDimBox();
}

function onContext(e) {
  e.preventDefault();
  if (!S.doc || modalOpen() || detectMode()) return;
  const dev = devOf(e);
  const [x, y] = toSheet(dev[0], dev[1]);
  if (S.tool === 'polygon' && T.poly && T.poly.pts.length) {
    showMenu(e.clientX, e.clientY, [
      { label: 'Close polygon', key: 'Enter', icon: 'check', onClick: closePolygon, disabled: T.poly.pts.length < 6 },
      { label: 'Undo last corner', key: 'Backspace', icon: 'undo-2', onClick: () => { T.poly.pts.length -= 2; if (!T.poly.pts.length) T.poly = null; requestUI(); } },
      'sep',
      { label: 'Cancel polygon', key: 'Esc', icon: 'x', onClick: () => { cancelDrawing(); requestUI(); } },
    ]);
    return;
  }
  if (S.tool === 'gap') {
    const tol = tolSheet(8);
    const g = S.gaps.find((q) => G.distToPolyline(q.pts, x, y) <= tol);
    if (g) {
      showMenu(e.clientX, e.clientY, [{ label: 'Delete this gap line', icon: 'trash-2', danger: true, onClick: () => deleteGap(g.id) }]);
      return;
    }
  }
  const v = vertexAt(dev[0], dev[1]);
  if (S.tool === 'select' && v) {
    const ring = v.m.rings[v.ri];
    showMenu(e.clientX, e.clientY, [
      { label: 'Delete this corner', icon: 'trash-2', disabled: ring.length <= 6, onClick: () => deleteVertex(v.m.id, v.ri, v.vi) },
    ]);
    return;
  }
  const tg = hitTag(x, y);
  const dm = tg ? null : hitDim(x, y, tolSheet(6));
  if (dm) {
    if (!S.selection.has(dm.id)) setSelection([dm.id]);
    const n = S.selection.size;
    showMenu(e.clientX, e.clientY, [
      { label: 'Move the line to the other side', icon: 'arrow-down-to-line', disabled: n !== 1 || !dm.off, onClick: () => flipDim(dm.id) },
      'sep',
      { label: n > 1 ? `Delete ${n} items` : 'Delete dimension', key: 'Del', icon: 'trash-2', danger: true, onClick: deleteSelected },
    ]);
    return;
  }
  const m = tg || hitMarkup(x, y);
  if (m) {
    if (!S.selection.has(m.id)) setSelection([m.id]);
    markupMenu(e.clientX, e.clientY, m.id);
    return;
  }
  if (inLegend(x, y)) {
    setSelection([], true);
    showMenu(e.clientX, e.clientY, [
      { label: 'Hide legend', icon: 'eye-off', onClick: () => hooks.toggleLegend(false) },
    ]);
    return;
  }
  showMenu(e.clientX, e.clientY, [
    { label: 'Paste', key: 'Ctrl+V', icon: 'copy', disabled: !clipboard.length, onClick: paste },
    { label: 'Select all', key: 'Ctrl+A', icon: 'layers', disabled: !S.markups.length, onClick: () => setSelection(S.markups.map((q) => q.id)) },
    'sep',
    { label: 'Remove colour in this area of the drawing', icon: 'eraser', onClick: () => eraseColourAreaAt(x, y, dev) },
    'sep',
    { label: 'Fit sheet to window', key: 'Ctrl+0', icon: 'maximize', onClick: () => { fit(); requestAll(); emit('view'); } },
  ]);
}

export function markupMenu(cx, cy, id) {
  const n = S.selection.size;
  showMenu(cx, cy, [
    { label: 'Rename', key: 'F2', icon: 'pen-line', disabled: n !== 1, onClick: () => startRename(id) },
    { label: n > 1 ? 'Zoom to these' : 'Zoom to it', icon: 'locate', onClick: () => zoomToIds([...S.selection]) },
    { label: 'Duplicate', key: 'Ctrl+D', icon: 'copy', onClick: duplicate },
    ...(tagsVisible() && S.markups.some((m) => S.selection.has(m.id) && m.tagAt) ? [{ label: 'Put the area tag back in the middle', icon: 'tag', onClick: resetTags }] : []),
    'sep',
    { label: 'Bring to front', icon: 'arrow-up-to-line', onClick: () => reorder(true) },
    { label: 'Send to back', icon: 'arrow-down-to-line', onClick: () => reorder(false) },
    'sep',
    { label: n > 1 ? (S.dims.some((d) => S.selection.has(d.id)) ? `Delete ${n} items` : `Delete ${n} markups`) : 'Delete', key: 'Del', icon: 'trash-2', danger: true, onClick: deleteSelected },
  ]);
}

// ------------------------------------------------------------------ select tool

let hoverLegend = false;
let hoverLegendHandle = false;
let hoverDimHandle = false;
let lastHoverKey = '';

function updateHover() {
  if (S.tool !== 'select' || !T.cursor || !lastMoveEvent) return;
  const [x, y] = T.cursor;
  const dev = [x * V.scale + V.tx, y * V.scale + V.ty];
  HOVER.select(lastMoveEvent, x, y, dev);
}

const brushRadius = () => (S.eraser.size / 2) * V.dpr / V.scale;

/** Click selection: Ctrl toggles, Shift adds, a plain click selects only this (unless it is already selected). */
function selectHit(id, e) {
  if (e.ctrlKey) {
    const s = new Set(S.selection);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelection([...s], S.legendSelected);
  } else if (e.shiftKey) {
    setSelection([...new Set([...S.selection, id])], S.legendSelected);
  } else if (!S.selection.has(id)) {
    setSelection([id]);
  }
}

/** A markup moved by (dx, dy), with its tag. */
function movedMarkup(m, dx, dy) {
  return withProps(m, { rings: G.translateRings(m.rings, dx, dy), ...(m.tagAt ? { tagAt: [m.tagAt[0] + dx, m.tagAt[1] + dy] } : {}) });
}

/** After a markup's shape changed: a dragged tag that is no longer inside goes back to automatic. */
function keepTag(m) {
  if (!m.tagAt || G.pointInRings(m.rings, m.tagAt[0], m.tagAt[1])) return m;
  return withProps(m, { tagAt: null });
}

function moveLabel(ids) {
  const nm = S.markups.filter((m) => ids.has(m.id)).length, nd = S.dims.filter((d) => ids.has(d.id)).length;
  if (nd && !nm) return nd > 1 ? `Move ${nd} dimensions` : 'Move dimension';
  if (nm && !nd) return nm > 1 ? `Move ${nm} markups` : 'Move markup';
  return `Move ${nm + nd} items`;
}

const HOVER = {
  select(e, x, y, dev) {
    if (!dev) dev = [x * V.scale + V.tx, y * V.scale + V.ty];
    const v = vertexAt(dev[0], dev[1]);
    const hv = v ? { ri: v.ri, vi: v.vi } : null;
    const dh = v ? null : dimHandleAt(dev[0], dev[1]);
    hoverDimHandle = !!dh;
    hoverLegendHandle = !v && !dh && onLegendHandle(dev[0], dev[1]);
    hoverLegend = !hoverLegendHandle && !v && !dh && inLegend(x, y);
    const free = !v && !dh && !hoverLegend && !hoverLegendHandle;
    const tg = free ? hitTag(x, y) : null;
    const dm = free && !tg ? hitDim(x, y, tolSheet(6)) : null;
    const m = free && !tg && !dm ? hitMarkup(x, y) : null;
    const key = [m && m.id, tg && tg.id, dm && dm.id, hv ? hv.ri + ':' + hv.vi : '', dh ? dh.which : ''].join('|');
    T.hoverId = m ? m.id : tg ? tg.id : null;
    T.hoverTagId = tg ? tg.id : null;
    T.hoverDimId = dm ? dm.id : null;
    T.hoverVertex = hv;
    T.hoverDimHandle = dh ? dh.which : null;
    updateCursor();
    if (key !== lastHoverKey) { lastHoverKey = key; requestUI(); }
  },
  polygon(e, x, y) {
    if (!T.poly) {
      const p = snapPoint(x, y, e);
      T.snap = p.mark;
      T.guide = { x: p.x, y: p.y, sx: p.sx, sy: p.sy, cross: false };
      requestUI();
      return;
    }
    const q = constrainPoint(x, y, e);
    T.poly.cursor = q;
    const pts = T.poly.pts;
    T.poly.closeHint = pts.length >= 6 && Math.hypot((q[0] - pts[0]) * V.scale, (q[1] - pts[1]) * V.scale) <= 10 * V.dpr;
    requestUI();
  },
  rect(e, x, y) {
    if (dimBoxOpen()) return;
    const p = snapPoint(x, y, e);
    T.snap = p.mark;
    let q = [p.x, p.y];
    if (T.rect && T.rect.waiting) {
      q = squareIf(e, q);
      T.rect.x1 = q[0]; T.rect.y1 = q[1];
    }
    T.guide = { x: q[0], y: q[1], sx: p.sx, sy: p.sy, cross: true };
    requestUI();
  },
  gap(e, x, y) {
    if (!T.gap) {
      const p = snapPoint(x, y, e);
      T.snap = p.mark;
      T.guide = { x: p.x, y: p.y, sx: p.sx, sy: p.sy, cross: false };
      requestUI();
      return;
    }
    T.gap.cursor = constrainSimple(x, y, e, T.gap.pts);
    requestUI();
  },
  erase(e, x, y) {
    T.brush = { x, y, r: brushRadius(), stroke: null };
    requestUI();
  },
  fill() { if (S.loupe.on) requestUI(); },
  pick() { if (S.loupe.on) requestUI(); },
  dim(e, x, y) {
    if (!T.dim) { dimPoint(e, x, y); requestUI(); return; }
    if (T.dim.phase === 'b') { T.dim.cur = dimPoint(e, x, y, T.dim.a); requestUI(); return; }
    T.dim.off = offsetFor(T.dim, x, y);
    T.snap = null; T.guide = null;
    requestUI();
  },
  calib(e, x, y) {
    if (T.calibLine && T.calibLine.done) return;
    if (!T.calibLine) { dimPoint(e, x, y); requestUI(); return; }
    T.calibLine.cur = dimPoint(e, x, y, T.calibLine.a);
    requestUI();
  },
};

function squareIf(e, q) {
  if (!e || !e.shiftKey || !T.rect) return q;
  const dx = q[0] - T.rect.x0, dy = q[1] - T.rect.y0;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return [T.rect.x0 + Math.sign(dx || 1) * d, T.rect.y0 + Math.sign(dy || 1) * d];
}

const DOWN = {
  select(e, x, y, dev) {
    const v = vertexAt(dev[0], dev[1]);
    if (v && !e.shiftKey && !e.ctrlKey) {
      P.mode = 'vertex';
      P.data = { id: v.m.id, ri: v.ri, vi: v.vi, ox: v.x, oy: v.y };
      T.vertexEdit = { id: v.m.id, rings: v.m.rings.map((r) => r.slice()) };
      return;
    }
    const dh = dimHandleAt(dev[0], dev[1]);
    if (dh && !e.shiftKey && !e.ctrlKey) {
      P.mode = 'dim-handle';
      P.data = { id: dh.d.id, which: dh.which, d0: dh.d };
      T.dimEdit = { ...dh.d };
      return;
    }
    if (onLegendHandle(dev[0], dev[1])) {
      const L = S.legend;
      const lay = legendLayout(L);
      P.mode = 'legend-size';
      P.data = { L, w: lay.w, h: lay.h };
      return;
    }
    if (inLegend(x, y)) {
      setSelection(e.ctrlKey || e.shiftKey ? [...S.selection] : [], true);
      P.mode = 'legend-move';
      P.data = { L: S.legend };
      return;
    }
    const tg = hitTag(x, y);
    if (tg) {
      selectHit(tg.id, e);
      revealInList(tg.id);
      const t = tagLayout(S.markups.indexOf(tg));
      if (t) { P.mode = 'tag-pending'; P.data = { id: tg.id, at0: [t.cx, t.cy] }; }
      return;
    }
    const dm = hitDim(x, y, tolSheet(6));
    const m = dm ? null : hitMarkup(x, y);
    const hit = dm || m;
    if (hit) {
      selectHit(hit.id, e);
      if (m) revealInList(m.id);
      if (S.selection.has(hit.id)) { P.mode = 'move-pending'; P.data = { ids: new Set(S.selection) }; }
      return;
    }
    P.mode = 'band';
    P.data = { add: e.shiftKey || e.ctrlKey };
  },
  fill(e, x, y, dev) {
    if (e.altKey) { pickAt(x, y); return; }
    runFill(x, y, dev);
  },
  polygon(e, x, y) {
    if (e.altKey) {
      const ed = edgeAt(x, y);
      if (ed && (S.lock.mode === 'perp')) {
        S.lock.extRef = [ed.ax, ed.ay, ed.bx, ed.by];
        emit('lock');
        toast('90° lock now follows that edge.');
        HOVER.polygon(e, x, y);
        return;
      }
      pickAt(x, y);
      return;
    }
    if (!T.poly) {
      const p = snapPoint(x, y, e);
      T.poly = { pts: [p.x, p.y], cursor: null, closeHint: false, guide: null, ref: null };
      T.snap = null;
      emit('lock');
      requestUI();
      return;
    }
    const q = constrainPoint(x, y, e);
    const pts = T.poly.pts;
    if (pts.length >= 6 && Math.hypot((q[0] - pts[0]) * V.scale, (q[1] - pts[1]) * V.scale) <= 10 * V.dpr) { closePolygon(); return; }
    const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
    if (Math.hypot(q[0] - lx, q[1] - ly) < 0.5) return;
    pts.push(q[0], q[1]);
    if (S.lock.once) { S.lock.once = null; emit('lock'); }
    HOVER.polygon(e, x, y);
  },
  rect(e, x, y) {
    if (e.altKey) { pickAt(x, y); return; }
    if (dimBoxOpen()) { applyDims(); return; }
    const p = snapPoint(x, y, e);
    if (T.rect && T.rect.waiting) {
      const q = squareIf(e, [p.x, p.y]);
      T.rect.x1 = q[0]; T.rect.y1 = q[1];
      finishRect();
      return;
    }
    T.rect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, waiting: false };
    requestUI();
  },
  gap(e, x, y) {
    const q = T.gap ? constrainSimple(x, y, e, T.gap.pts) : (() => { const p = snapPoint(x, y, e); return [p.x, p.y]; })();
    if (!T.gap) T.gap = { pts: [q[0], q[1]], cursor: null };
    else {
      const pts = T.gap.pts;
      if (Math.hypot(q[0] - pts[pts.length - 2], q[1] - pts[pts.length - 1]) < 0.5) return;
      pts.push(q[0], q[1]);
    }
    T.guide = null;
    requestUI();
  },
  pick(e, x, y) { pickAt(x, y); },
  dim(e, x, y) {
    if (!T.dim) {
      const q = dimPoint(e, x, y);
      T.dim = { a: q, cur: q, b: null, off: 0, phase: 'b' };
      T.snap = null;
      emit('dimstep');
      requestUI();
      return;
    }
    if (T.dim.phase === 'b') {
      const q = dimPoint(e, x, y, T.dim.a);
      if (Math.hypot(q[0] - T.dim.a[0], q[1] - T.dim.a[1]) * V.scale < 3 * V.dpr) return;
      T.dim.b = q; T.dim.cur = q; T.dim.phase = 'off'; T.dim.off = 0;
      T.snap = null; T.guide = null;
      P.mode = 'none';
      emit('dimstep');
      requestUI();
      return;
    }
    P.mode = 'none';
    finishDim(offsetFor(T.dim, x, y));
  },
  calib(e, x, y) {
    if (T.calibLine && T.calibLine.done) return;
    if (!T.calibLine) {
      const q = dimPoint(e, x, y);
      T.calibLine = { a: q, cur: q, done: false };
      T.snap = null;
      emit('dimstep');
      requestUI();
      return;
    }
    const q = dimPoint(e, x, y, T.calibLine.a);
    if (Math.hypot(q[0] - T.calibLine.a[0], q[1] - T.calibLine.a[1]) * V.scale < 3 * V.dpr) return;
    P.mode = 'none';
    runCalibrate(T.calibLine.a, q);
  },
  erase(e, x, y, dev) {
    if (eraseBusy) return;
    if (e.shiftKey) {
      P.mode = 'none';
      shiftErase(x, y, dev);
      return;
    }
    P.mode = 'erase';
    T.brush = { x, y, r: brushRadius(), stroke: [x, y] };
    requestUI();
  },
};

const DRAG = {
  select(e, x, y) {
    const dx = x - P.start[0], dy = y - P.start[1];
    if (P.mode === 'dim-handle') {
      const d0 = P.data.d0;
      if (P.data.which === 'off') {
        T.dimEdit = { ...d0, off: offsetFor(d0, x, y) };
        T.snap = null; T.guide = null;
      } else {
        const other = P.data.which === 'a' ? d0.b : d0.a;
        T.dimEdit = { ...d0, [P.data.which]: dimPoint(e, x, y, other, P.data.id) };
      }
      requestAll();
      return;
    }
    if (P.mode === 'tag-pending' && P.moved) P.mode = 'tag-move';
    if (P.mode === 'tag-move') {
      T.tagEdit = { id: P.data.id, at: [P.data.at0[0] + dx, P.data.at0[1] + dy] };
      requestAll();
      updateCursor();
      return;
    }
    if (P.mode === 'vertex') {
      let nx = P.data.ox + dx, ny = P.data.oy + dy;
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) ny = P.data.oy; else nx = P.data.ox; }
      else {
        const m = S.markups.find((q) => q.id === P.data.id);
        const others = [];
        if (m) {
          // allow snapping to the markup's own other corners and to other markups
          const r = m.rings[P.data.ri];
          for (let i = 0; i < r.length; i += 2) if ((i >> 1) !== P.data.vi) others.push(r[i], r[i + 1]);
        }
        const p = snapPoint(nx, ny, e, others);
        T.snap = p.mark;
        T.guide = p.sx || p.sy ? { x: p.x, y: p.y, sx: p.sx, sy: p.sy, cross: false } : null;
        nx = p.x; ny = p.y;
      }
      const ring = T.vertexEdit.rings[P.data.ri];
      ring[P.data.vi * 2] = nx; ring[P.data.vi * 2 + 1] = ny;
      requestAll();
      return;
    }
    if (P.mode === 'legend-move') {
      if (!P.moved) return;
      const L = P.data.L;
      const lay = legendLayout(L);
      const nx = Math.max(0, Math.min(S.doc.W - lay.w, L.x + dx));
      const ny = Math.max(0, Math.min(S.doc.H - lay.h, L.y + dy));
      T.legendPreview = { x: nx, y: ny, titlePx: L.titlePx, namePx: L.namePx };
      requestAll();
      return;
    }
    if (P.mode === 'legend-size') {
      const { L, w, h: hh } = P.data;
      const k = Math.max((x - L.x) / w, (y - L.y) / hh);
      const c = clampLegendSizes({ ...L, titlePx: L.titlePx * k, namePx: L.namePx * k });
      T.legendPreview = { x: L.x, y: L.y, titlePx: c.titlePx, namePx: c.namePx };
      requestAll();
      return;
    }
    if (P.mode === 'move-pending' && P.moved) { P.mode = 'move'; T.moveIds = P.data.ids; }
    if (P.mode === 'move') {
      let mx = dx, my = dy;
      if (e.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) my = 0; else mx = 0; }
      T.moveDx = mx; T.moveDy = my;
      requestAll();
      updateCursor();
      return;
    }
    if (P.mode === 'band' && P.moved) {
      T.band = { x0: P.start[0], y0: P.start[1], x1: x, y1: y, crossing: x < P.start[0] };
      requestUI();
    }
  },
  rect(e, x, y) {
    if (!T.rect) return;
    const p = snapPoint(x, y, e);
    T.snap = p.mark;
    const q = squareIf(e, [p.x, p.y]);
    T.rect.x1 = q[0]; T.rect.y1 = q[1];
    T.guide = { x: q[0], y: q[1], sx: p.sx, sy: p.sy, cross: true };
    requestUI();
  },
  erase(e, x, y) {
    if (P.mode !== 'erase' || !T.brush) return;
    const st = T.brush.stroke;
    const lx = st[st.length - 2], ly = st[st.length - 1];
    if (Math.hypot(x - lx, y - ly) >= T.brush.r * 0.25) st.push(x, y);
    T.brush.x = x; T.brush.y = y;
    requestUI();
  },
  polygon(e, x, y) { HOVER.polygon(e, x, y); },
  gap(e, x, y) { HOVER.gap(e, x, y); },
  dim(e, x, y) { if (P.mode !== 'none') HOVER.dim(e, x, y); },
  calib(e, x, y) { if (P.mode !== 'none') HOVER.calib(e, x, y); },
};

const UP = {
  select(e, x, y) {
    if (P.mode === 'dim-handle') {
      const de = T.dimEdit;
      T.dimEdit = null; T.snap = null; T.guide = null;
      if (P.moved && de) {
        if (Math.hypot(de.b[0] - de.a[0], de.b[1] - de.a[1]) < 0.5) toast('A dimension needs two different points.');
        else change(P.data.which === 'off' ? 'Move dimension line' : 'Edit dimension', () => { S.dims = S.dims.map((d) => (d.id === de.id ? Object.freeze({ ...de }) : d)); });
      }
      requestAll();
      return;
    }
    if (P.mode === 'tag-move') {
      const te = T.tagEdit;
      T.tagEdit = null;
      if (te) change('Move area tag', () => { S.markups = S.markups.map((m) => (m.id === te.id ? withProps(m, { tagAt: te.at }) : m)); });
      requestAll();
      return;
    }
    if (P.mode === 'tag-pending') return;
    if (P.mode === 'vertex') {
      const ve = T.vertexEdit;
      T.vertexEdit = null; T.snap = null; T.guide = null;
      if (P.moved && ve) {
        change('Move corner', () => { S.markups = S.markups.map((m) => (m.id === ve.id ? keepTag(withProps(m, { rings: ve.rings })) : m)); });
      }
      requestAll();
      return;
    }
    if (P.mode === 'legend-move' || P.mode === 'legend-size') {
      const pv = T.legendPreview;
      T.legendPreview = null;
      if (pv && P.moved) change(P.mode === 'legend-move' ? 'Move legend' : 'Resize legend', () => { S.legend = Object.freeze({ ...S.legend, ...pv }); });
      requestAll();
      return;
    }
    if (P.mode === 'move') {
      const ids = T.moveIds, dx = T.moveDx, dy = T.moveDy;
      T.moveIds = null; T.moveDx = 0; T.moveDy = 0;
      if (dx || dy) change(moveLabel(ids), () => {
        S.markups = S.markups.map((m) => (ids.has(m.id) ? movedMarkup(m, dx, dy) : m));
        S.dims = S.dims.map((d) => (ids.has(d.id) ? Object.freeze(movedDim(d, dx, dy)) : d));
      });
      requestAll();
      return;
    }
    if (P.mode === 'move-pending') {
      if (!e.shiftKey && !e.ctrlKey && S.selection.size > 1) {
        const m = hitDim(x, y, tolSheet(6)) || hitMarkup(x, y);
        if (m) setSelection([m.id]);
      }
      return;
    }
    if (P.mode === 'band') {
      const b = T.band;
      T.band = null;
      if (!b) { if (!P.data.add) setSelection([]); requestUI(); return; }
      const r = [Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.max(b.x0, b.x1), Math.max(b.y0, b.y1)];
      const hits = S.markups.filter((m) => {
        const g = geo(m).bbox;
        if (b.crossing) return G.ringsTouchRect(m.rings, r);
        return g[0] >= r[0] && g[1] >= r[1] && g[2] <= r[2] && g[3] <= r[3];
      }).map((m) => m.id);
      if (S.meas.dims) {
        for (const d of S.dims) {
          const g = dimLayout(d).bbox;
          const inside = g[0] >= r[0] && g[1] >= r[1] && g[2] <= r[2] && g[3] <= r[3];
          const touch = !(g[2] < r[0] || g[0] > r[2] || g[3] < r[1] || g[1] > r[3]);
          if (b.crossing ? touch : inside) hits.push(d.id);
        }
      }
      const lr = legendRect();
      const legHit = !!lr && (b.crossing ? !(lr[2] < r[0] || lr[0] > r[2] || lr[3] < r[1] || lr[1] > r[3]) : lr[0] >= r[0] && lr[1] >= r[1] && lr[2] <= r[2] && lr[3] <= r[3]);
      setSelection(P.data.add ? [...new Set([...S.selection, ...hits])] : hits, legHit || (P.data.add && S.legendSelected));
      requestUI();
    }
  },
  rect() {
    if (!T.rect) return;
    if (!P.moved && !T.rect.waiting) { T.rect.waiting = true; emit('rect'); return; }
    if (!T.rect.waiting) finishRect();
  },
  dim(e, x, y) {
    // pressed on the first point and dragged to the second
    if (P.mode === 'none' || !P.moved || !T.dim || T.dim.phase !== 'b') return;
    const q = dimPoint(e, x, y, T.dim.a);
    if (Math.hypot(q[0] - T.dim.a[0], q[1] - T.dim.a[1]) * V.scale < 3 * V.dpr) return;
    T.dim.b = q; T.dim.cur = q; T.dim.phase = 'off'; T.dim.off = 0;
    T.snap = null; T.guide = null;
    emit('dimstep');
    requestUI();
  },
  calib(e, x, y) {
    if (P.mode === 'none' || !P.moved || !T.calibLine || T.calibLine.done) return;
    const q = dimPoint(e, x, y, T.calibLine.a);
    if (Math.hypot(q[0] - T.calibLine.a[0], q[1] - T.calibLine.a[1]) * V.scale < 3 * V.dpr) return;
    runCalibrate(T.calibLine.a, q);
  },
  erase(e) {
    if (P.mode !== 'erase' || !T.brush || !T.brush.stroke) return;
    const st = T.brush.stroke;
    const r = T.brush.r;
    T.brush.stroke = null;
    eraseStroke(st, r, devOf(e));
  },
};

const DBL = {
  select(e, x, y) {
    const tg = hitTag(x, y);
    if (tg) { setSelection([tg.id]); startRename(tg.id); return; } // a tag: rename its markup
    if (hitDim(x, y, tolSheet(6))) return; // a dimension lies over the markup here
    if (S.selection.size === 1) {
      const m = S.markups.find((q) => S.selection.has(q.id));
      if (m && G.vertexCount(m.rings) <= VERTEX_EDIT_LIMIT) {
        const ed = G.nearestEdge(m.rings, x, y, tolSheet(6));
        if (ed && !G.nearestVertex(m.rings, x, y, tolSheet(7))) {
          change('Add corner', () => {
            S.markups = S.markups.map((q) => {
              if (q.id !== m.id) return q;
              const rings = q.rings.map((r, ri) => (ri === ed.ri ? [...r.slice(0, (ed.si + 1) * 2), ed.x, ed.y, ...r.slice((ed.si + 1) * 2)] : r));
              return withProps(q, { rings });
            });
          });
          return;
        }
      }
    }
    const m = hitMarkup(x, y);
    if (m) { setSelection([m.id]); startRename(m.id); }
  },
  polygon() {
    if (!T.poly) return;
    // the two clicks of a double-click each added a corner; drop the duplicate
    const p = T.poly.pts;
    while (p.length >= 4 && Math.hypot(p[p.length - 2] - p[p.length - 4], p[p.length - 1] - p[p.length - 3]) < 2 / V.scale) p.length -= 2;
    closePolygon();
  },
  gap() {
    if (!T.gap) return;
    const p = T.gap.pts;
    while (p.length >= 4 && Math.hypot(p[p.length - 2] - p[p.length - 4], p[p.length - 1] - p[p.length - 3]) < 2 / V.scale) p.length -= 2;
    finishGap();
  },
};

// ------------------------------------------------------------------ fill

let fillBusy = false;
const GAP_MM = [0, 0.3, 0.7, 1.4];
const wallKeys = new WeakMap();
let wallSeq = 0;
const wallKey = (m) => { let k = wallKeys.get(m); if (!k) { k = m.id + ':' + (++wallSeq); wallKeys.set(m, k); } return k; };

async function runFill(x, y, dev) {
  if (fillBusy) return;
  if (x < 0 || y < 0 || x >= S.doc.W || y >= S.doc.H) return;
  if (inLegend(x, y)) { toast('That is the legend. Move it aside with the Select tool to fill what is under it.'); return; }
  const hit = hitMarkup(x, y);
  if (hit) {
    // never stack a second fill on top of a fill: give it the current colour instead.
    // Only the colour changes, so clicking or double-clicking a fill never alters its opacity.
    if (hit.color !== S.style.color) {
      change('Recolour', () => { S.markups = S.markups.map((m) => (m.id === hit.id ? withProps(m, { color: S.style.color }) : m)); });
    }
    T.flash = { ids: [hit.id], until: performance.now() + 700 };
    revealInList(hit.id);
    requestAll();
    return;
  }
  fillBusy = true;
  T.busyAt = dev;
  requestUI();
  try {
    const dpi = S.doc.dpi;
    const args = {
      x, y,
      tol: Math.round(S.fill.tol * 2.55),
      gapPx: Math.round((GAP_MM[S.fill.gaps] / 25.4) * dpi),
      cover: S.fill.cover,
      holeRatio: 0.35,
      tuck: Math.max(1, Math.round(dpi / 250)),
      walls: S.markups.map((m) => ({ id: m.id, key: wallKey(m), rings: m.rings })),
      force: false,
    };
    let res = await engine.call('flood', args);
    if (res.leak) {
      T.busyAt = null;
      requestUI();
      const go = await modal({
        title: `This fill would cover ${Math.round(res.share * 100)}% of the sheet`,
        body: h('div', null,
          h('p', { class: 'modal-text' }, 'The area is probably not closed, so the colour escaped through an opening such as a doorway.'),
          h('p', { class: 'modal-text' }, 'Draw a gap line across the opening (G), or choose a larger Close gaps setting, then fill again.')),
        buttons: [{ label: 'Fill anyway', value: true }, { label: 'Don’t fill', value: false, primary: true }],
        cancelValue: false,
      });
      if (!go) return;
      T.busyAt = dev;
      requestUI();
      res = await engine.call('flood', { ...args, force: true });
    }
    if (res.error === 'line') { toast('That spot is on a line. Click inside the area instead.'); return; }
    if (res.error === 'covered') { toast('This area is already highlighted.'); return; }
    if (res.error) return;
    let rings = res.rings;
    const near = S.markups.filter((m) => {
      const b = geo(m).bbox;
      return !(b[2] < res.bbox[0] || b[0] > res.bbox[2] || b[3] < res.bbox[1] || b[1] > res.bbox[3]);
    });
    if (near.length) rings = G.difference(rings, near.map((m) => m.rings));
    const piece = G.pieceAt(rings, x, y) || G.pieceAt(rings, Math.floor(x) + 0.5, Math.floor(y) + 0.5);
    if (!piece) { toast('This area is already highlighted.'); return; }
    const name = S.fill.autoName ? nameFromText(piece) : null;
    const m = makeMarkup({ kind: 'fill', rings: piece, name });
    change('Fill', () => { S.markups = [...S.markups, m]; });
    T.flash = { ids: [m.id], until: performance.now() + 600 };
    revealInList(m.id);
  } catch (err) {
    toast('Fill failed: ' + err.message, { kind: 'error' });
  } finally {
    fillBusy = false;
    T.busyAt = null;
    requestAll();
  }
}

// ------------------------------------------------------------------ polygon

function edgeAt(x, y) {
  const tol = tolSheet(8);
  let best = null;
  for (const m of S.markups) {
    const b = geo(m).bbox;
    if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
    const ed = G.nearestEdge(m.rings, x, y, tol);
    if (ed && (!best || ed.d < best.d)) best = ed;
  }
  return best;
}

function refEdge(pts) {
  if (S.lock.extRef) return S.lock.extRef;
  const n = pts.length >> 1;
  if (n < 2) return null;
  const last = n - 2;
  const k = S.lock.refIdx >= 0 && S.lock.refIdx <= last ? S.lock.refIdx : last;
  return [pts[k * 2], pts[k * 2 + 1], pts[k * 2 + 2], pts[k * 2 + 3]];
}

function constrainPoint(x, y, e) {
  const pts = T.poly.pts;
  const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
  let dir = null;
  T.poly.ref = null;
  if (S.lock.once === 'h') dir = [1, 0];
  else if (S.lock.once === 'v') dir = [0, 1];
  else if (e.shiftKey || S.lock.mode === 'ortho') dir = Math.abs(x - lx) >= Math.abs(y - ly) ? [1, 0] : [0, 1];
  else if (S.lock.mode === 'perp') {
    const r = refEdge(pts);
    if (r) {
      const ex = r[2] - r[0], ey = r[3] - r[1];
      const L = Math.hypot(ex, ey) || 1;
      dir = [-ey / L, ex / L];
      T.poly.ref = r;
    }
  }
  const s = snapAt(x, y, e, pts.length >= 6 ? [pts[0], pts[1]] : null);
  if (!dir) {
    T.poly.guide = null;
    T.snap = s;
    if (s) { T.guide = null; return [s.x, s.y]; }
    const p = snapPoint(x, y, e);
    T.guide = { x: p.x, y: p.y, sx: p.sx, sy: p.sy, cross: false };
    return [p.x, p.y];
  }
  T.poly.guide = { x: lx, y: ly, dx: dir[0], dy: dir[1] };
  let px = s ? s.x : x, py = s ? s.y : y;
  T.guide = null;
  if (!s) {
    // along a horizontal or vertical lock, stop at the face of a wall or line
    const axis = Math.abs(dir[1]) < 1e-9 ? 'x' : Math.abs(dir[0]) < 1e-9 ? 'y' : '';
    if (axis) {
      const p = snapPoint(x, y, e, null, axis);
      px = p.x; py = p.y;
      if (p.sx || p.sy) T.guide = { x: p.x, y: p.y, sx: p.sx, sy: p.sy, cross: false };
    }
  }
  const t = (px - lx) * dir[0] + (py - ly) * dir[1];
  T.snap = s ? { ...s, x: lx + dir[0] * t, y: ly + dir[1] * t } : null;
  return [lx + dir[0] * t, ly + dir[1] * t];
}

function constrainSimple(x, y, e, pts) {
  const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
  const p = snapPoint(x, y, e);
  T.snap = p.mark;
  T.guide = p.sx || p.sy ? { x: p.x, y: p.y, sx: p.sx, sy: p.sy, cross: false } : null;
  let q = [p.x, p.y];
  if (e.shiftKey) q = Math.abs(q[0] - lx) >= Math.abs(q[1] - ly) ? [q[0], ly] : [lx, q[1]];
  return q;
}

export function closePolygon() {
  if (!T.poly) return;
  const pts = T.poly.pts.slice();
  const clean = [];
  for (let i = 0; i < pts.length; i += 2) {
    const n = clean.length;
    if (n && Math.hypot(pts[i] - clean[n - 2], pts[i + 1] - clean[n - 1]) < 0.01) continue;
    clean.push(pts[i], pts[i + 1]);
  }
  if (clean.length >= 8 && Math.hypot(clean[0] - clean[clean.length - 2], clean[1] - clean[clean.length - 1]) < 0.01) clean.length -= 2;
  if (clean.length < 6) { toast('A polygon needs at least three corners.'); return; }
  if (Math.abs(G.signedArea(clean)) < 1) { toast('That polygon has no area.'); return; }
  const name = S.fill.autoName ? nameFromText([clean]) : null;
  const m = makeMarkup({ kind: 'polygon', rings: [clean], name });
  T.poly = null; T.snap = null; T.guide = null;
  S.lock.once = null; S.lock.refIdx = -1; S.lock.extRef = null;
  emit('lock');
  change('Polygon', () => { S.markups = [...S.markups, m]; });
  T.flash = { ids: [m.id], until: performance.now() + 600 };
  revealInList(m.id);
  requestAll();
}

// ------------------------------------------------------------------ rectangle

function finishRect() {
  const r = T.rect;
  T.rect = null; T.snap = null;
  closeDimInput();
  emit('rect');
  if (!r) return;
  const x0 = Math.min(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), x1 = Math.max(r.x0, r.x1), y1 = Math.max(r.y0, r.y1);
  if ((x1 - x0) * V.scale < 4 * V.dpr || (y1 - y0) * V.scale < 4 * V.dpr) { requestUI(); return; }
  const ring = [x0, y0, x1, y0, x1, y1, x0, y1];
  const name = S.fill.autoName ? nameFromText([ring]) : null;
  const m = makeMarkup({ kind: 'polygon', rings: [ring], name });
  change('Rectangle', () => { S.markups = [...S.markups, m]; });
  T.flash = { ids: [m.id], until: performance.now() + 600 };
  revealInList(m.id);
  requestAll();
}

// typed size: after the first corner, digits open a small W × H box next to the rectangle
let dimBox = null, wIn = null, hIn = null, unitEl = null;
const dimBoxOpen = () => !!(dimBox && !dimBox.hidden);

export function rectWaiting() { return !!(T.rect && T.rect.waiting); }

export function openDimInput(firstKey = '') {
  if (!T.rect || !T.rect.waiting) return false;
  if (!dimBox) {
    const mk = (id, label) => {
      const input = h('input', { class: 'dim-in', id, inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': label });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); applyDims(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeDimInput(); requestUI(); }
        else if (e.key === 'Tab') { e.preventDefault(); (e.target === wIn ? hIn : wIn).select(); }
      });
      input.addEventListener('input', previewDims);
      return input;
    };
    wIn = mk('dim-w', 'Width');
    hIn = mk('dim-h', 'Height');
    unitEl = h('span', { class: 'dim-unit' });
    dimBox = h('div', { class: 'dim-box' },
      h('span', { class: 'dim-l' }, 'W'), wIn, h('span', { class: 'dim-x' }, '×'), h('span', { class: 'dim-l' }, 'H'), hIn, unitEl,
      h('span', { class: 'dim-hint' }, 'Enter'));
    document.getElementById('canvas-wrap').append(dimBox);
  }
  const r = T.rect;
  const wv = pxToUnit(Math.abs(r.x1 - r.x0)), hv = pxToUnit(Math.abs(r.y1 - r.y0));
  wIn.value = firstKey !== '' ? firstKey : fmtUnitValue(wv);
  hIn.value = fmtUnitValue(hv);
  unitEl.textContent = lengthUnitLabel();
  dimBox.hidden = false;
  repositionDimBox();
  wIn.focus();
  if (firstKey === '') wIn.select();
  else wIn.setSelectionRange(wIn.value.length, wIn.value.length);
  previewDims();
  return true;
}

function repositionDimBox() {
  if (!dimBoxOpen() || !T.rect) return;
  const r = T.rect;
  const X = (Math.max(r.x0, r.x1) * V.scale + V.tx) / V.dpr, Y = (Math.max(r.y0, r.y1) * V.scale + V.ty) / V.dpr;
  const wrap = dimBox.parentElement.getBoundingClientRect();
  const bw = dimBox.offsetWidth || 260, bh = dimBox.offsetHeight || 36;
  const x = Math.max(8, Math.min(wrap.width - bw - 8, X + 14)), y = Math.max(8, Math.min(wrap.height - bh - 8, Y + 14));
  dimBox.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function dimValues() {
  return [parseLength(wIn.value), parseLength(hIn.value)];
}

function previewDims() {
  if (!T.rect) return;
  const [wv, hv] = dimValues();
  const r = T.rect;
  const sx = Math.sign(r.x1 - r.x0) || 1, sy = Math.sign(r.y1 - r.y0) || 1;
  if (wv > 0) r.x1 = r.x0 + sx * unitToPx(wv);
  if (hv > 0) r.y1 = r.y0 + sy * unitToPx(hv);
  T.guide = { x: r.x1, y: r.y1, sx: false, sy: false, cross: true }; // guides follow the typed corner
  T.snap = null;
  requestUI();
}

function applyDims() {
  const [wv, hv] = dimValues();
  if (!(wv > 0) || !(hv > 0)) { toast(lengthUnit() === 'ftin' ? 'Type a width and a height, for example 14\'6" and 10\'.' : `Type a width and a height in ${lengthUnitLabel()}, for example 4.40 and 3.20.`); return; }
  previewDims();
  finishRect();
}

function closeDimInput() {
  if (!dimBox) return;
  dimBox.hidden = true;
  if (document.activeElement === wIn || document.activeElement === hIn) cv && cv.focus && document.activeElement.blur();
}

// ------------------------------------------------------------------ dimensions

let warnedNoScale = false;

function finishDim(off) {
  const t = T.dim;
  T.dim = null; T.snap = null; T.guide = null;
  emit('dimstep');
  if (!t || !t.b) { requestUI(); return; }
  const d = makeDim(t.a, t.b, off);
  change('Dimension', () => {
    S.dims = [...S.dims, d];
    if (!S.meas.dims) setMeas({ dims: true });
  });
  if (!hasScale() && !warnedNoScale) {
    warnedNoScale = true;
    toast('This drawing has no scale yet, so dimensions show millimetres on the sheet. Calibrate (C) or type the scale to measure real sizes.', { timeout: 8000 });
  }
  requestAll();
}

// ------------------------------------------------------------------ calibrate

async function runCalibrate(a, b) {
  T.calibLine = { a, cur: b, done: true };
  T.snap = null; T.guide = null;
  requestUI();
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let r = null;
  try { r = await calibrateDialog({ px }); } finally { T.calibLine = null; emit('dimstep'); requestUI(); }
  if (!r) return;
  setCalibration({ a, b, px, lengthM: r.lengthM, unit: r.unit });
  const n = scaleRatio();
  const title = S.doc.scale;
  let msg = `Scale set${n || hasScale() ? ' to ' + fmtScale() : ''}. Check it by dimensioning another length you know (K).`;
  if (title && n && Math.abs(n - title) / title > 0.02) msg = `Scale set to ${fmtScale()}. The title block says 1:${title}, so this print is probably not at its stated scale.`;
  toast(msg, { timeout: 8000 });
  setTool('select');
  requestAll();
}

// ------------------------------------------------------------------ gap lines

function finishGap() {
  const g = T.gap;
  T.gap = null; T.snap = null; T.guide = null;
  if (!g || g.pts.length < 4) { requestAll(); return; }
  const gl = Object.freeze({ id: uid('g'), pts: g.pts.slice() });
  change('Gap line', () => { S.gaps = [...S.gaps, gl]; });
  engine.call('setGaps', { lines: S.gaps.map((q) => q.pts) });
  requestAll();
}

export function deleteGap(id) {
  change('Delete gap line', () => { S.gaps = S.gaps.filter((g) => g.id !== id); });
  engine.call('setGaps', { lines: S.gaps.map((q) => q.pts) });
  requestAll();
}

export function clearGaps() {
  if (!S.gaps.length) return;
  change('Clear gap lines', () => { S.gaps = []; });
  engine.call('setGaps', { lines: [] });
  requestAll();
}

// ------------------------------------------------------------------ pick

async function pickAt(x, y) {
  const m = hitMarkup(x, y);
  let hex;
  if (m) hex = m.color;
  else {
    const rgb = await engine.call('sample', { x, y });
    if (!rgb) return;
    hex = rgbToHex(rgb);
  }
  applyStyle('Pick colour', { color: hex });
  toast(S.selection.size ? `Selected markups now use ${hex}.` : `Next markup will use ${hex}.`);
}

// ------------------------------------------------------------------ eraser

let eraseBusy = false;

/** Erases highlights (vector) and/or colour painted in the drawing under a brush stroke. */
async function eraseStroke(stroke, r, dev) {
  const mode = S.eraser.mode;
  const targets = S.selection.size ? new Set(S.selection) : null;
  eraseBusy = true;
  try {
    await runExclusive(async () => {
      const before = snapshot();
      let markupsChanged = false, colourChanged = false, dimsChanged = false;
      if (mode !== 'drawing' || targets) {
        const area = G.strokeArea(stroke, r);
        if (area.length) {
          const ab = G.ringsBBox(area);
          const next = S.markups.flatMap((m) => {
            if (targets && !targets.has(m.id)) return [m];
            const b = geo(m).bbox;
            if (b[2] < ab[0] || b[0] > ab[2] || b[3] < ab[1] || b[1] > ab[3]) return [m];
            const nr = G.difference(m.rings, [area]);
            if (!nr.length) { markupsChanged = true; return []; }
            if (Math.abs(G.ringsArea(m.rings) - G.ringsArea(nr)) < 0.5) return [m];
            markupsChanged = true;
            const pcs = G.pieces(nr).filter((p) => p.area >= 4);
            if (!pcs.length) return [];
            return [keepTag(withProps(m, { rings: pcs.flatMap((p) => p.rings) }))];
          });
          if (markupsChanged) S.markups = next;
          if (S.meas.dims && S.dims.length) {
            // a dimension the brush passes over is erased whole
            const keepD = S.dims.filter((d) => {
              if (targets && !targets.has(d.id)) return true;
              const L = dimLayout(d);
              const b = L.bbox;
              if (b[2] < ab[0] || b[0] > ab[2] || b[3] < ab[1] || b[1] > ab[3]) return true;
              for (let i = 0; i < stroke.length; i += 2) {
                for (const sg of L.segs) if (G.nearestPointOnSeg(stroke[i], stroke[i + 1], sg[0], sg[1], sg[2], sg[3]).d <= r) return false;
              }
              return true;
            });
            if (keepD.length !== S.dims.length) { S.dims = keepD; dimsChanged = true; }
          }
          if (!targets) {
            const keep = S.gaps.filter((g) => {
              for (let i = 0; i < stroke.length; i += 2) if (G.distToPolyline(g.pts, stroke[i], stroke[i + 1]) <= r) return false;
              return true;
            });
            if (keep.length !== S.gaps.length) { S.gaps = keep; await engine.call('setGaps', { lines: S.gaps.map((q) => q.pts) }); }
          }
        }
      }
      if (mode !== 'highlights' && !targets) {
        T.busyAt = dev; requestUI();
        const opId = uid('op');
        const res = await engine.call('eraseColour', { opId, pts: stroke, radius: r });
        if (res && res.changed > 0) {
          S.rasterOps = [...S.rasterOps, Object.freeze({ id: opId, label: 'Erase colour' })];
          colourChanged = true;
        }
      }
      const parts = [markupsChanged, dimsChanged, colourChanged].filter(Boolean).length;
      const label = parts > 1 ? 'Erase' : colourChanged ? 'Erase drawing colour' : dimsChanged ? 'Erase dimension' : 'Erase highlight';
      if (commit(label, before)) {
        const ids = new Set([...S.markups.map((m) => m.id), ...S.dims.map((d) => d.id)]);
        S.selection = new Set([...S.selection].filter((id) => ids.has(id)));
        emit('selection');
      } else if (mode === 'drawing') {
        toast('No colour under the eraser. Lines and paper are never erased.');
      }
    });
  } catch (err) {
    toast('Could not erase: ' + err.message, { kind: 'error' });
  } finally {
    eraseBusy = false;
    T.busyAt = null;
    requestAll();
  }
}

/** Shift+click with the eraser: a whole markup, or the whole coloured area of the drawing. */
async function shiftErase(x, y, dev) {
  const mode = S.eraser.mode;
  const targets = S.selection.size ? new Set(S.selection) : null;
  const dm = mode !== 'drawing' ? hitDim(x, y, tolSheet(6)) : null;
  if (dm && (!targets || targets.has(dm.id))) {
    change('Delete dimension', () => { S.dims = S.dims.filter((q) => q.id !== dm.id); });
    S.selection.delete(dm.id);
    emit('selection');
    toast('Removed the dimension.', { action: 'Undo', onAction: hooks.undo });
    return;
  }
  const m = hitMarkup(x, y);
  if (m && mode !== 'drawing' && (!targets || targets.has(m.id))) {
    change('Delete markup', () => { S.markups = S.markups.filter((q) => q.id !== m.id); });
    S.selection.delete(m.id);
    emit('selection');
    toast(`Removed “${m.name}”.`, { action: 'Undo', onAction: hooks.undo });
    return;
  }
  if (mode === 'highlights' || targets) return;
  eraseColourAreaAt(x, y, dev);
}

export async function eraseColourAreaAt(x, y, dev) {
  if (eraseBusy || !S.doc) return;
  eraseBusy = true;
  T.busyAt = dev;
  requestUI();
  try {
    await runExclusive(async () => {
      const before = snapshot();
      const opId = uid('op');
      const res = await engine.call('eraseColourAt', { opId, x, y });
      if (!res || !res.changed) {
        toast(res && res.reason === 'no-area' ? 'No coloured area here. Drag the eraser over thin coloured lines to remove them.' : 'No painted colour here to remove.');
        return;
      }
      S.rasterOps = [...S.rasterOps, Object.freeze({ id: opId, label: 'Remove coloured area' })];
      commit('Remove coloured area', before);
      toast('Removed the colour of this area.', { action: 'Undo', onAction: hooks.undo });
    });
  } catch (err) {
    toast('Could not remove the colour: ' + err.message, { kind: 'error' });
  } finally {
    eraseBusy = false;
    T.busyAt = null;
    requestAll();
  }
}

// ------------------------------------------------------------------ edit commands

let clipboard = [];

export function deleteSelected() {
  const ids = new Set(S.selection);
  if (S.legendSelected && !ids.size) { hooks.toggleLegend(false); return; }
  if (!ids.size) return;
  const nm = S.markups.filter((m) => ids.has(m.id)).length, nd = S.dims.filter((d) => ids.has(d.id)).length;
  if (!nm && !nd) return;
  const what = nd && !nm ? (nd > 1 ? `${nd} dimensions` : '1 dimension') : nm && !nd ? (nm > 1 ? `${nm} markups` : '1 markup') : `${nm + nd} items`;
  const label = nd && !nm ? (nd > 1 ? `Delete ${nd} dimensions` : 'Delete dimension') : nm && !nd ? (nm > 1 ? `Delete ${nm} markups` : 'Delete markup') : `Delete ${nm + nd} items`;
  change(label, () => {
    S.markups = S.markups.filter((m) => !ids.has(m.id));
    S.dims = S.dims.filter((d) => !ids.has(d.id));
  });
  setSelection([]);
  toast(`Deleted ${what}.`, { action: 'Undo', onAction: hooks.undo });
}

export function copySelected() {
  clipboard = selectedMarkups().map((m) => ({ ...m }));
  if (clipboard.length) toast(clipboard.length > 1 ? `Copied ${clipboard.length} markups.` : 'Copied 1 markup.');
}

export function paste() {
  if (!clipboard.length || !S.doc) return;
  const off = (24 * V.dpr) / V.scale;
  const shift = (m) => ({ ...m, rings: G.translateRings(m.rings, off, off), ...(m.tagAt ? { tagAt: [m.tagAt[0] + off, m.tagAt[1] + off] } : {}) });
  const fresh = clipboard.map((m) => Object.freeze({ ...shift(m), id: uid('m') }));
  clipboard = clipboard.map(shift);
  change(fresh.length > 1 ? `Paste ${fresh.length} markups` : 'Paste markup', () => { S.markups = [...S.markups, ...fresh]; });
  setSelection(fresh.map((m) => m.id));
}

export function duplicate() {
  const sel = selectedMarkups();
  if (!sel.length) return;
  clipboard = sel.map((m) => ({ ...m }));
  paste();
}

function resetTags() {
  const ids = S.selection;
  change('Reset area tag', () => { S.markups = S.markups.map((m) => (ids.has(m.id) && m.tagAt ? withProps(m, { tagAt: null }) : m)); });
}

/** Mirrors the dimension line to the other side of the measured points. */
function flipDim(id) {
  change('Flip dimension', () => { S.dims = S.dims.map((d) => (d.id === id ? Object.freeze({ ...d, off: -(d.off || 0) }) : d)); });
}

function reorder(front) {
  const ids = S.selection;
  change(front ? 'Bring to front' : 'Send to back', () => {
    const a = S.markups.filter((m) => ids.has(m.id));
    const b = S.markups.filter((m) => !ids.has(m.id));
    S.markups = front ? [...b, ...a] : [...a, ...b];
  });
}

function deleteVertex(id, ri, vi) {
  change('Delete corner', () => {
    S.markups = S.markups.map((m) => {
      if (m.id !== id) return m;
      const rings = m.rings.map((r, i) => (i === ri && r.length > 6 ? [...r.slice(0, vi * 2), ...r.slice(vi * 2 + 2)] : r));
      return keepTag(withProps(m, { rings }));
    });
  });
}

function nudge(dx, dy) {
  const ids = S.selection;
  if (!ids.size) {
    if (S.legendSelected && S.legend) change('Move legend', () => { S.legend = Object.freeze({ ...S.legend, x: S.legend.x + dx, y: S.legend.y + dy }); });
    return;
  }
  change('Nudge', () => {
    S.markups = S.markups.map((m) => (ids.has(m.id) ? movedMarkup(m, dx, dy) : m));
    S.dims = S.dims.map((d) => (ids.has(d.id) ? Object.freeze(movedDim(d, dx, dy)) : d));
  });
}

// ------------------------------------------------------------------ keyboard

const NOT_TEXT = ['checkbox', 'radio', 'range', 'color', 'button', 'submit'];
/** True while a text field has the keys (a ticked checkbox or a slider must not swallow shortcuts). */
function typing(e) {
  const t = e.target;
  if (!t) return false;
  if (t.tagName === 'INPUT') {
    if (t.type === 'range') return /^(Arrow|Home|End|Page)/.test(e.key);
    if (NOT_TEXT.includes(t.type)) return e.key === ' ' || e.key === 'Enter';
    return true;
  }
  return t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function onKeyDown(e) {
  if (e.key === 'Control') { ctrlDown = true; rehover(); }
  if (modalOpen() || typing(e)) return;
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (k === 'o' || k === 'O')) { e.preventDefault(); hooks.open(); return; }
  if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); hooks.save(e.shiftKey); return; }
  if (ctrl && !e.shiftKey && (k === 'z' || k === 'Z')) { e.preventDefault(); if (T.poly && T.poly.pts.length) { T.poly.pts.length -= 2; if (!T.poly.pts.length) T.poly = null; requestUI(); } else hooks.undo(); return; }
  if (ctrl && (k === 'y' || k === 'Y' || ((k === 'z' || k === 'Z') && e.shiftKey))) { e.preventDefault(); hooks.redo(); return; }
  if (!S.doc) return;
  if (detectMode()) { if (k === 'Escape') { e.preventDefault(); hooks.detectEscape(); } return; }
  // typing a size for the rectangle being drawn
  if (S.tool === 'rect' && T.rect && T.rect.waiting && !ctrl && !e.altKey && /^[0-9.,]$/.test(k)) {
    e.preventDefault();
    openDimInput(k === ',' ? '.' : k);
    return;
  }
  if (S.tool === 'rect' && T.rect && T.rect.waiting && k === 'Tab') { e.preventDefault(); openDimInput(''); return; }
  if (S.tool === 'polygon' && T.poly && T.poly.pts.length) {
    if (k === 'Enter') { e.preventDefault(); closePolygon(); return; }
    if (k === 'Escape') { e.preventDefault(); cancelDrawing(); requestUI(); return; }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); T.poly.pts.length -= 2; if (!T.poly.pts.length) T.poly = null; requestUI(); return; }
  }
  if (S.tool === 'polygon' && !ctrl && !e.altKey) {
    const lk = k.toLowerCase();
    if (lk === 'h' || lk === 'v') { e.preventDefault(); S.lock.once = S.lock.once === lk ? null : lk; emit('lock'); refreshPolyCursor(); return; }
    if (lk === 'a') { e.preventDefault(); cyclePerp(); return; }
    if (lk === 'n') { e.preventDefault(); S.lock.mode = 'free'; S.lock.once = null; S.lock.extRef = null; emit('lock'); refreshPolyCursor(); return; }
    if (k === 'F8') { e.preventDefault(); S.lock.mode = S.lock.mode === 'ortho' ? 'free' : 'ortho'; emit('lock'); refreshPolyCursor(); return; }
  }
  if (S.tool === 'dim' && T.dim) {
    if (k === 'Enter' && T.dim.phase === 'off') { e.preventDefault(); finishDim(T.dim.off); return; }
    if (k === 'Escape') { e.preventDefault(); cancelDrawing(); requestUI(); return; }
    if (k === 'Backspace') { e.preventDefault(); if (T.dim.phase === 'off') { T.dim.phase = 'b'; T.dim.b = null; T.dim.off = 0; } else T.dim = null; emit('dimstep'); refreshDimCursor(); return; }
  }
  if (S.tool === 'calib' && T.calibLine && !T.calibLine.done && (k === 'Escape' || k === 'Backspace')) { e.preventDefault(); cancelDrawing(); requestUI(); return; }
  if (S.tool === 'gap' && T.gap) {
    if (k === 'Enter') { e.preventDefault(); finishGap(); return; }
    if (k === 'Escape') { e.preventDefault(); T.gap = null; requestUI(); return; }
    if (k === 'Backspace') { e.preventDefault(); T.gap.pts.length -= 2; if (!T.gap.pts.length) T.gap = null; requestUI(); return; }
  }
  if (S.tool === 'rect' && T.rect && k === 'Escape') { T.rect = null; closeDimInput(); emit('rect'); requestUI(); return; }
  if (k === ' ') {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; updateCursor(); }
    return;
  }
  if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); setSelection([...S.markups.map((m) => m.id), ...(S.meas.dims ? S.dims.map((d) => d.id) : [])]); return; }
  if (ctrl && (k === 'c' || k === 'C')) { e.preventDefault(); copySelected(); return; }
  if (ctrl && (k === 'v' || k === 'V')) { e.preventDefault(); paste(); return; }
  if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); duplicate(); return; }
  if (ctrl && (k === '0')) { e.preventDefault(); fit(); requestAll(); emit('view'); return; }
  if (ctrl && (k === '1')) { e.preventDefault(); setZoomPercent(100); requestAll(); emit('view'); return; }
  if (k === 'Delete' || (k === 'Backspace' && S.tool === 'select')) { e.preventDefault(); deleteSelected(); return; }
  if (k === 'Escape') {
    if (T.rect || T.gap || T.poly || T.dim || T.calibLine) { cancelDrawing(); requestUI(); return; }
    if (S.selection.size || S.legendSelected) setSelection([]);
    return;
  }
  if (k === 'F2') { e.preventDefault(); const s = selectedMarkups(); if (s.length === 1) startRename(s[0].id); return; }
  if (k === 'F1' || k === '?') { e.preventDefault(); hooks.help(); return; }
  if (k === '+' || k === '=') { e.preventDefault(); zoomAt(V.cw / 2, V.ch / 2, 1.25); requestAll(); emit('view'); return; }
  if (k === '-' || k === '_') { e.preventDefault(); zoomAt(V.cw / 2, V.ch / 2, 0.8); requestAll(); emit('view'); return; }
  if (k.startsWith('Arrow') && (S.selection.size || S.legendSelected)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const d = (step * V.dpr) / V.scale;
    nudge(k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0, k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0);
    return;
  }
  if (k === '[' || k === ']') {
    if (S.tool === 'erase') {
      S.eraser.size = Math.max(6, Math.min(240, Math.round(S.eraser.size * (k === ']' ? 1.25 : 0.8))));
      emit('eraser');
      if (T.brush) { T.brush.r = brushRadius(); requestUI(); }
    } else if (S.loupe.on) {
      const steps = [2, 3, 4, 6, 8];
      const i = steps.indexOf(S.loupe.power);
      S.loupe.power = steps[Math.max(0, Math.min(steps.length - 1, i + (k === ']' ? 1 : -1)))];
      emit('loupe');
    }
    return;
  }
  if (ctrl || e.altKey) return;
  const map = { s: 'select', f: 'fill', p: 'polygon', r: 'rect', g: 'gap', i: 'pick', e: 'erase', k: 'dim', c: 'calib' };
  const lk = k.toLowerCase();
  if (map[lk]) { e.preventDefault(); setTool(map[lk]); return; }
  if (lk === 'm') { e.preventDefault(); hooks.toggleLoupe(); return; }
  if (lk === 'l') { e.preventDefault(); hooks.toggleLegend(); return; }
  if (lk === 'd') { e.preventDefault(); hooks.detect(); return; }
}

function onKeyUp(e) {
  if (e.key === 'Control') { ctrlDown = false; rehover(); }
  if (e.key === ' ') { spaceDown = false; updateCursor(); }
}

function refreshDimCursor() {
  if (T.cursor && lastMoveEvent) HOVER.dim(lastMoveEvent, T.cursor[0], T.cursor[1]);
  requestUI();
}

function refreshPolyCursor() {
  if (T.poly && T.cursor && lastMoveEvent) HOVER.polygon(lastMoveEvent, T.cursor[0], T.cursor[1]);
  requestUI();
}

export function setLock(mode) {
  if (mode === 'h' || mode === 'v') S.lock.once = S.lock.once === mode ? null : mode;
  else { S.lock.mode = mode; S.lock.once = null; if (mode !== 'perp') S.lock.extRef = null; }
  emit('lock');
  refreshPolyCursor();
}

function cyclePerp() {
  if (S.lock.mode !== 'perp') { S.lock.mode = 'perp'; S.lock.refIdx = -1; S.lock.once = null; }
  else if (T.poly) {
    const n = T.poly.pts.length >> 1;
    const last = n - 2;
    if (last >= 1) {
      const cur = S.lock.refIdx >= 0 ? S.lock.refIdx : last;
      S.lock.refIdx = cur - 1 < 0 ? last : cur - 1;
      S.lock.extRef = null;
    }
  }
  emit('lock');
  refreshPolyCursor();
}

export function polyState() { return T.poly; }
