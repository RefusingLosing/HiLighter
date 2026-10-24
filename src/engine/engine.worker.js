// PlanTint engine worker: owns the drawing's pixels. Renders PDFs (MuPDF), decodes images,
// builds the display tile pyramid, and runs fill / colour detection / colour removal / export.

import UTIF from 'utif';
import { zlibSync } from 'fflate';
import * as IP from './imgproc.js';
import { detectPaint, colourAt } from './detect.js';
import { dashFor } from '../shared/linestyle.js';

let mupdfPromise = null;
const MU = () => (mupdfPromise ||= import('./vendor/mupdf/mupdf.js'));

const E = {
  gen: 0,
  raster: null, W: 0, H: 0, dpi: 150,
  levels: [],
  TILE: 1024,
  pdf: null,
  pdfProbe: null,
  pageIndex: 0,
  dl: null, ib: null, pageScale: 1,
  tiff: null,
  img: null,
  srcExt: '',
  dt: null, dtKey: '',
  gapMask: null, gapVer: 0,
  rasterVer: 0,
  scratch: null,
  ops: new Map(),
  found: new Map(),
  walls: new Map(), wallMask: null, wallKey: '',
  covers: new Map(),  // highlights that cover the paint under them, by markup id (see setCovers)
  viewVer: 0,         // version of what the tiles show (the drawing, or the covers on it)
  paper: [255, 255, 255],
  ink: null,
  vec: null,          // the PDF page's line geometry in sheet pixels, for exact snapping (built on first use)
};

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

function progressFor(id) {
  let last = 0;
  return (f, msg) => {
    const now = performance.now();
    if (now - last > 80 || f >= 1) { last = now; post({ id, progress: f, msg }); }
  };
}

// ------------------------------------------------------------------ raster + tiles

function freeRaster() {
  if (E.dl) { try { E.dl.destroy(); } catch { /* ignore */ } E.dl = null; }
  E.raster = null; E.levels = []; E.dt = null; E.dtKey = ''; E.scratch = null; E.gapMask = null;
  E.ops.clear(); E.found.clear();
  E.walls.clear(); E.wallMask = null; E.wallKey = '';
  E.covers.clear();
  E.ink = null;
  E.vec = null;
}

// ------------------------------------------------------------------ vector geometry (PDF drawings)

/**
 * Collects every straight piece of the page's line work, in sheet pixels, into a grid. Snapping
 * then lands on the drawing's own coordinates: the line itself for thin lines (a wall outline is
 * the wall face), and both faces of thick stroked lines. Pictures have no geometry: they use
 * the edges of the ink instead.
 */
async function vectors() {
  if (E.vec !== null) return E.vec;
  if (!E.dl || E.srcExt !== 'pdf') { E.vec = false; return false; }
  const mupdf = await MU();
  const ib = E.ib, s = E.pageScale;
  const MAX = 1.5e6;
  let buf = new Float32Array(1 << 16), n = 0;
  const push = (ax, ay, bx, by) => {
    if (n >= MAX) return;
    if ((n + 1) * 4 > buf.length) { const nb = new Float32Array(buf.length * 2); nb.set(buf); buf = nb; }
    const o = n * 4;
    buf[o] = ax; buf[o + 1] = ay; buf[o + 2] = bx; buf[o + 3] = by;
    n++;
  };
  const walk = (path, ctm, half) => {
    const [a, b, c, d, e, f] = ctm;
    const tx = (x, y) => a * x + c * y + e - ib[0], ty = (x, y) => b * x + d * y + f - ib[1];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const seg = (ax, ay, bx, by, faces) => {
      push(ax, ay, bx, by);
      if (faces && half > 0) {
        const L = Math.hypot(bx - ax, by - ay);
        if (!L) return;
        const nx = (-(by - ay) / L) * half, ny = ((bx - ax) / L) * half;
        push(ax + nx, ay + ny, bx + nx, by + ny);
        push(ax - nx, ay - ny, bx - nx, by - ny);
      }
    };
    path.walk({
      moveTo(x, y) { cx = tx(x, y); cy = ty(x, y); sx = cx; sy = cy; },
      lineTo(x, y) { const nx = tx(x, y), ny = ty(x, y); seg(cx, cy, nx, ny, true); cx = nx; cy = ny; },
      curveTo(x1, y1, x2, y2, x3, y3) {
        const p1x = tx(x1, y1), p1y = ty(x1, y1), p2x = tx(x2, y2), p2y = ty(x2, y2), p3x = tx(x3, y3), p3y = ty(x3, y3);
        let px = cx, py = cy;
        for (let i = 1; i <= 8; i++) {
          const t = i / 8, u = 1 - t;
          const qx = u * u * u * cx + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x;
          const qy = u * u * u * cy + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * p3y;
          seg(px, py, qx, qy, false);
          px = qx; py = qy;
        }
        cx = p3x; cy = p3y;
      },
      closePath() { if (cx !== sx || cy !== sy) seg(cx, cy, sx, sy, true); cx = sx; cy = sy; },
    });
  };
  // paint in paper white (openings cut out of walls, masks) is not line work
  const invisible = (color, alpha) => {
    if (!(alpha > 0.05)) return true;
    if (!color || !color.length) return false;
    if (color.length === 4) return Math.max(...color) < 0.03;
    return Math.min(...color) > 0.97;
  };
  const dev = new mupdf.Device({
    fillPath(path, evenOdd, ctm, cs, color, alpha) { if (!invisible(color, alpha)) walk(path, ctm, 0); },
    strokePath(path, stroke, ctm, cs, color, alpha) {
      if (invisible(color, alpha)) return;
      let half = 0;
      try {
        const w = stroke.getLineWidth() * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
        if (w > Math.max(4, E.dpi / 75)) half = w / 2;
      } catch { /* no width */ }
      walk(path, ctm, half);
    },
  });
  try {
    E.dl.run(dev, mupdf.Matrix.scale(s, s));
    dev.close();
  } finally { dev.destroy(); }
  // a grid of cells, each listing the pieces that cross it (compressed rows)
  const cell = 128, cols = Math.max(1, Math.ceil(E.W / cell)), rows = Math.max(1, Math.ceil(E.H / cell));
  const cellsOf = (i, fn) => {
    const o = i * 4;
    const c0 = Math.max(0, Math.floor(Math.min(buf[o], buf[o + 2]) / cell)), c1 = Math.min(cols - 1, Math.floor(Math.max(buf[o], buf[o + 2]) / cell));
    const r0 = Math.max(0, Math.floor(Math.min(buf[o + 1], buf[o + 3]) / cell)), r1 = Math.min(rows - 1, Math.floor(Math.max(buf[o + 1], buf[o + 3]) / cell));
    if (c1 < c0 || r1 < r0) return;
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > 4096) return; // a huge diagonal: not useful for snapping
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * cols + c);
  };
  const start = new Int32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) cellsOf(i, (k) => { start[k + 1]++; });
  for (let k = 0; k < cols * rows; k++) start[k + 1] += start[k];
  const fill = start.slice(0, cols * rows);
  const idx = new Int32Array(start[cols * rows]);
  for (let i = 0; i < n; i++) cellsOf(i, (k) => { idx[fill[k]++] = i; });
  E.vec = { segs: buf.subarray(0, n * 4), n, cell, cols, rows, start, idx };
  return E.vec;
}

/** Faces near (x, y): x of upright pieces within r across, y of level pieces within r up or down, passing the pointer. */
function vectorSnap(v, x, y, r) {
  const L = 1.5 * r;
  const xs = [], ys = [];
  const c0 = Math.max(0, Math.floor((x - L) / v.cell)), c1 = Math.min(v.cols - 1, Math.floor((x + L) / v.cell));
  const r0 = Math.max(0, Math.floor((y - L) / v.cell)), r1 = Math.min(v.rows - 1, Math.floor((y + L) / v.cell));
  const seen = new Set();
  const S_ = v.segs;
  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      const k = rr * v.cols + cc;
      for (let q = v.start[k]; q < v.start[k + 1]; q++) {
        const i = v.idx[q];
        if (seen.has(i)) continue;
        seen.add(i);
        const o = i * 4;
        const ax = S_[o], ay = S_[o + 1], bx = S_[o + 2], by = S_[o + 3];
        const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
        if (dy > 0.5 && dx <= Math.max(0.15, dy * 0.002)) {
          // upright
          const sx = (ax + bx) / 2;
          if (Math.abs(sx - x) <= r && Math.max(ay, by) >= y - L && Math.min(ay, by) <= y + L) xs.push(sx);
        } else if (dx > 0.5 && dy <= Math.max(0.15, dx * 0.002)) {
          const sy = (ay + by) / 2;
          if (Math.abs(sy - y) <= r && Math.max(ax, bx) >= x - L && Math.min(ax, bx) <= x + L) ys.push(sy);
        }
      }
    }
  }
  return { xs, ys };
}

/** Existing markups act as walls for Fill: keeps a pixel mask of them, rebuilt only when they change. */
function updateWalls(list) {
  const { W, H } = E;
  const keys = list.map((w) => w.key).join('|');
  if (keys === E.wallKey && (E.wallMask || !list.length)) return;
  const seen = new Set();
  for (const w of list) {
    seen.add(w.id);
    const c = E.walls.get(w.id);
    if (c && c.key === w.key) continue;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const r of w.rings) for (let i = 0; i < r.length; i += 2) {
      if (r[i] < bx0) bx0 = r[i]; if (r[i] > bx1) bx1 = r[i];
      if (r[i + 1] < by0) by0 = r[i + 1]; if (r[i + 1] > by1) by1 = r[i + 1];
    }
    const x0 = Math.max(0, Math.floor(bx0)), y0 = Math.max(0, Math.floor(by0));
    const x1 = Math.min(W, Math.ceil(bx1)), y1 = Math.min(H, Math.ceil(by1));
    if (x1 <= x0 || y1 <= y0) { E.walls.set(w.id, { key: w.key, x0: 0, y0: 0, w: 0, h: 0, mask: null }); continue; }
    const mask = new Uint8Array((x1 - x0) * (y1 - y0));
    IP.rasterizeRings(w.rings, x0, y0, x1 - x0, y1 - y0, mask);
    E.walls.set(w.id, { key: w.key, x0, y0, w: x1 - x0, h: y1 - y0, mask });
  }
  for (const id of [...E.walls.keys()]) if (!seen.has(id)) E.walls.delete(id);
  if (!list.length) E.wallMask = null;
  else {
    const M = E.wallMask && E.wallMask.length === W * H ? E.wallMask.fill(0) : new Uint8Array(W * H);
    for (const c of E.walls.values()) {
      if (!c.mask) continue;
      for (let y = 0; y < c.h; y++) {
        const o = (c.y0 + y) * W + c.x0, mo = y * c.w;
        for (let x = 0; x < c.w; x++) if (c.mask[mo + x]) M[o + x] = 1;
      }
    }
    E.wallMask = M;
  }
  E.wallKey = keys;
}

function buildLevels() {
  E.levels = [{ w: E.W, h: E.H, data: E.raster }];
  let prev = E.levels[0];
  while (Math.max(prev.w, prev.h) > 640) {
    const w = Math.ceil(prev.w / 2), h = Math.ceil(prev.h / 2);
    const data = new Uint8ClampedArray(w * h * 4);
    IP.reduce2x(prev.data, prev.w, prev.h, data, w, 0, 0, w, h);
    const L = { w, h, data };
    E.levels.push(L);
    prev = L;
  }
}

function updateLevels(x0, y0, x1, y1) {
  let rx0 = x0, ry0 = y0, rx1 = x1, ry1 = y1;
  for (let l = 1; l < E.levels.length; l++) {
    const src = E.levels[l - 1], dst = E.levels[l];
    rx0 = Math.floor(rx0 / 2); ry0 = Math.floor(ry0 / 2);
    rx1 = Math.min(dst.w, Math.ceil(rx1 / 2)); ry1 = Math.min(dst.h, Math.ceil(ry1 / 2));
    if (l === 1) reduceLevel1(rx0, ry0, rx1, ry1);
    else IP.reduce2x(src.data, src.w, src.h, dst.data, dst.w, rx0, ry0, rx1, ry1);
  }
}

/** Level 1 from the drawing as it shows (paint taken out under covering highlights), in bands. */
function reduceLevel1(rx0, ry0, rx1, ry1) {
  const L0 = E.levels[0], L1 = E.levels[1];
  if (rx1 <= rx0 || ry1 <= ry0) return;
  const band = Math.max(8, Math.floor(2e6 / ((rx1 - rx0) * 4)));
  for (let y = ry0; y < ry1; y += band) {
    const yb = Math.min(ry1, y + band);
    const sx0 = 2 * rx0, sy0 = 2 * y, sx1 = Math.min(L0.w, 2 * rx1), sy1 = Math.min(L0.h, 2 * yb);
    const list = coversIn(sx0, sy0, sx1, sy1);
    if (!list.length) { IP.reduce2x(L0.data, L0.w, L0.h, L1.data, L1.w, rx0, y, rx1, yb); continue; }
    const w = sx1 - sx0, h = sy1 - sy0;
    const buf = IP.copyRect(E.raster, E.W, sx0, sy0, w, h);
    applyCovers(buf, sx0, sy0, w, h, list);
    IP.reduce2xFrom(buf, w, sx0, sy0, L0.w, L0.h, L1.data, L1.w, rx0, y, rx1, yb);
  }
}

async function tileBitmap(L, tx, ty) {
  const T = E.TILE;
  const ver = E.viewVer;
  const x0 = tx * T, y0 = ty * T;
  const w = Math.min(T, L.w - x0), h = Math.min(T, L.h - y0);
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * L.w + x0) * 4;
    buf.set(L.data.subarray(s, s + w * 4), y * w * 4);
  }
  if (L === E.levels[0]) applyCovers(buf, x0, y0, w, h);
  const bmp = await createImageBitmap(new ImageData(buf, w, h));
  return { tx, ty, x: x0, y: y0, w, h, ver, bitmap: bmp };
}

/** Sends the tiles of every level that intersect any of rects (level-0 pixels); rects null = everything. */
async function sendTiles(gen, rects) {
  const T = E.TILE;
  for (let l = E.levels.length - 1; l >= 0; l--) {
    const L = E.levels[l];
    const f = 1 << l;
    const cols = Math.ceil(L.w / T), rows = Math.ceil(L.h / T);
    const keys = new Set();
    for (const rect of rects || [[0, 0, L.w * f, L.h * f]]) {
      const c0 = Math.max(0, Math.floor(rect[0] / f / T)), c1 = Math.min(cols - 1, Math.floor((rect[2] - 1) / f / T));
      const r0 = Math.max(0, Math.floor(rect[1] / f / T)), r1 = Math.min(rows - 1, Math.floor((rect[3] - 1) / f / T));
      for (let ty = r0; ty <= r1; ty++) for (let tx = c0; tx <= c1; tx++) keys.add(ty * cols + tx);
    }
    let batch = [];
    for (const k of [...keys].sort((a, b) => a - b)) {
      if (gen !== E.gen) return;
      batch.push(await tileBitmap(L, k % cols, Math.floor(k / cols)));
      if (batch.length >= 6) {
        post({ type: 'tiles', gen, level: l, levelW: L.w, levelH: L.h, tiles: batch }, batch.map((t) => t.bitmap));
        batch = [];
      }
    }
    if (batch.length) post({ type: 'tiles', gen, level: l, levelW: L.w, levelH: L.h, tiles: batch }, batch.map((t) => t.bitmap));
  }
  post({ type: 'tiles-done', gen });
}

// ------------------------------------------------------------------ highlights that cover paint

// A highlight shows its own colour, not a mix with colour already painted on the drawing (a layout
// whose buildings are filled green, a plan with coloured rooms): under each highlight the paint is
// taken out wherever the drawing is shown or exported, while line work and text stay. The drawing's
// own pixels never change, so moving, recolouring or deleting a highlight brings the paint back.
const COVER_TOL = 24, COVER_LOOSE = 0.22;
const coverReach = () => Math.max(2, Math.round((E.dpi * 0.3) / 25.4));
const coverMinSolid = () => Math.round(((E.dpi * 1.5) / 25.4) ** 2);

function buildCover(id, key, rings) {
  const { W, H } = E;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    if (r[i] < bx0) bx0 = r[i]; if (r[i] > bx1) bx1 = r[i];
    if (r[i + 1] < by0) by0 = r[i + 1]; if (r[i + 1] > by1) by1 = r[i + 1];
  }
  const x0 = Math.max(0, Math.floor(bx0)), y0 = Math.max(0, Math.floor(by0));
  const x1 = Math.min(W, Math.ceil(bx1)), y1 = Math.min(H, Math.ceil(by1));
  const c = { id, key, rings, x0, y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), mask: null, paints: [], models: null };
  if (!c.w || !c.h) return c;
  const mask = new Uint8Array(c.w * c.h);
  IP.rasterizeRings(rings, x0, y0, c.w, c.h, mask);
  const paints = IP.coverPaints(E.raster, W, H, x0, y0, c.w, c.h, mask, E.paper, coverReach(), coverMinSolid());
  if (paints.length) { c.mask = mask; c.paints = paints; c.models = IP.paintModels(paints, E.paper); }
  return c;
}

const coverBox = (c) => [c.x0, c.y0, c.x0 + c.w, c.y0 + c.h];

/** Covers with paint to take out that reach into [x0, x1) x [y0, y1). */
function coversIn(x0, y0, x1, y1) {
  const out = [];
  for (const c of E.covers.values()) if (c.models && c.x0 < x1 && c.x0 + c.w > x0 && c.y0 < y1 && c.y0 + c.h > y0) out.push(c);
  return out;
}

/** Takes the paint out under covering highlights in buf, which holds columns [bx0, bx0 + bw) and rows [by0, by0 + bh) of the drawing. */
function applyCovers(buf, bx0, by0, bw, bh, list = coversIn(bx0, by0, bx0 + bw, by0 + bh)) {
  for (const c of list) {
    const ix0 = Math.max(bx0, c.x0), iy0 = Math.max(by0, c.y0);
    const ix1 = Math.min(bx0 + bw, c.x0 + c.w), iy1 = Math.min(by0 + bh, c.y0 + c.h);
    if (ix1 <= ix0 || iy1 <= iy0) continue;
    IP.unpaintPixels(buf, bw, ix0 - bx0, iy0 - by0, ix1 - ix0, iy1 - iy0, c.mask, c.w, ix0 - c.x0, iy0 - c.y0, c.models, COVER_TOL, COVER_LOOSE);
  }
}

/** Shows the drawing again where it changed (rects in level-0 pixels): the levels, then the tiles. */
function refreshView(rects) {
  const rs = [];
  for (const b of rects) {
    const x0 = Math.max(0, Math.floor(b[0])), y0 = Math.max(0, Math.floor(b[1]));
    const x1 = Math.min(E.W, Math.ceil(b[2])), y1 = Math.min(E.H, Math.ceil(b[3]));
    if (x1 > x0 && y1 > y0) rs.push([x0, y0, x1, y1]);
  }
  if (!rs.length) return;
  E.viewVer++;
  for (const r of rs) updateLevels(r[0], r[1], r[2], r[3]);
  sendTiles(E.gen, rs);
}

/**
 * The highlights that cover paint: [{ id, key, rings }], all of them. key changes whenever the
 * shape does; rings may be left out for a key sent before. Returns { need: ids } for the ones whose
 * shape is needed (not seen before, or the drawing was opened again).
 */
function setCovers({ list }) {
  if (!E.raster) return { need: [] };
  const seen = new Set(), dirty = [], need = [];
  for (const it of list) {
    seen.add(it.id);
    const old = E.covers.get(it.id);
    if (old && old.key === it.key) continue;
    if (!it.rings) { need.push(it.id); continue; }
    const c = buildCover(it.id, it.key, it.rings);
    if (old && old.models) dirty.push(coverBox(old));
    if (c.models) dirty.push(coverBox(c));
    E.covers.set(it.id, c);
  }
  for (const [id, c] of E.covers) {
    if (seen.has(id)) continue;
    if (c.models) dirty.push(coverBox(c));
    E.covers.delete(id);
  }
  refreshView(dirty);
  return { need, covers: [...E.covers.values()].filter((c) => c.models).length };
}

/** Coarse map of how much line work each part of the sheet has (for placing the legend). */
function inkGrid() {
  const { W, H, raster } = E;
  const cols = 96, cell = Math.max(1, Math.ceil(W / cols)), rows = Math.ceil(H / cell);
  const ink = new Float32Array(cols * rows);
  const cnt = new Uint32Array(cols * rows);
  const pr = E.paper[0], pg = E.paper[1], pb = E.paper[2];
  for (let y = 0; y < H; y += 2) {
    const cy = (y / cell) | 0;
    for (let x = 0; x < W; x += 2) {
      const p = (y * W + x) * 4;
      const i = cy * cols + ((x / cell) | 0);
      cnt[i]++;
      if (Math.abs(raster[p] - pr) + Math.abs(raster[p + 1] - pg) + Math.abs(raster[p + 2] - pb) > 60) ink[i]++;
    }
  }
  for (let i = 0; i < ink.length; i++) ink[i] = cnt[i] ? ink[i] / cnt[i] : 1;
  return { cols, rows, cell, ink };
}

function finishRaster(gen) {
  E.paper = IP.estimatePaper(E.raster, E.W, E.H);
  E.ink = inkGrid();
  buildLevels();
  E.rasterVer++;
  E.viewVer++;
  E.dt = null; E.dtKey = '';
  E.ops.clear(); E.found.clear();
  E.gapMask = null;
  sendTiles(gen, null);
}

function afterRasterChange(b) {
  E.rasterVer++;
  E.dtKey = '';
  // the paint under covering highlights there may have changed (colour taken out, or put back by undo)
  const rects = [b];
  for (const c of [...E.covers.values()]) {
    if (!(c.x0 < b[2] && c.x0 + c.w > b[0] && c.y0 < b[3] && c.y0 + c.h > b[1])) continue;
    const n = buildCover(c.id, c.key, c.rings);
    E.covers.set(c.id, n);
    if (c.models || n.models) rects.push(coverBox(c));
  }
  refreshView(rects);
}

function rgbToRgba(px, stride, n, w, h, dst, dstOffsetRow, dstW) {
  for (let y = 0; y < h; y++) {
    let s = y * stride;
    let d = ((dstOffsetRow + y) * dstW) * 4;
    if (n === 3) {
      for (let x = 0; x < w; x++, s += 3, d += 4) { dst[d] = px[s]; dst[d + 1] = px[s + 1]; dst[d + 2] = px[s + 2]; dst[d + 3] = 255; }
    } else if (n === 1) {
      for (let x = 0; x < w; x++, s += 1, d += 4) { const v = px[s]; dst[d] = v; dst[d + 1] = v; dst[d + 2] = v; dst[d + 3] = 255; }
    } else {
      for (let x = 0; x < w; x++, s += n, d += 4) { dst[d] = px[s]; dst[d + 1] = px[s + 1]; dst[d + 2] = px[s + 2]; dst[d + 3] = 255; }
    }
  }
}

// ------------------------------------------------------------------ PDF

async function pixmapToBitmap(pix) {
  const w = pix.getWidth(), h = pix.getHeight();
  const buf = new Uint8ClampedArray(w * h * 4);
  rgbToRgba(pix.getPixels(), pix.getStride(), pix.getNumberOfComponents(), w, h, buf, 0, w);
  return createImageBitmap(new ImageData(buf, w, h));
}

const H_ = {};

H_.setCovers = setCovers;

H_.openPdf = async ({ bytes }) => {
  const mupdf = await MU();
  if (E.pdfProbe && E.pdfProbe !== E.pdf) { try { E.pdfProbe.destroy(); } catch { /* ignore */ } }
  E.pdfProbe = null;
  let doc;
  try { doc = mupdf.Document.openDocument(bytes, 'application/pdf'); } catch {
    throw new Error('This file could not be read as a PDF. It may be damaged.');
  }
  if (doc.needsPassword()) throw new Error('This PDF is password-protected. Remove the password, then open it again.');
  const n = doc.countPages();
  if (!n) throw new Error('This PDF has no pages.');
  const pages = [];
  for (let i = 0; i < n; i++) {
    const p = doc.loadPage(i);
    const b = p.getBounds();
    let label = '';
    try { label = p.getLabel() || ''; } catch { /* ignore */ }
    pages.push({ w: b[2] - b[0], h: b[3] - b[1], label });
    p.destroy();
  }
  E.pdfProbe = doc;
  return { pageCount: n, pages };
};

H_.pdfThumb = async ({ index, max }) => {
  const mupdf = await MU();
  const page = (E.pdfProbe || E.pdf).loadPage(index);
  const b = page.getBounds();
  const s = max / Math.max(b[2] - b[0], b[3] - b[1]);
  const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
  const bmp = await pixmapToBitmap(pix);
  pix.destroy(); page.destroy();
  return { result: bmp, transfer: [bmp] };
};

H_.loadPdfPage = async ({ index, dpi, gen }, id) => {
  const mupdf = await MU();
  const prog = progressFor(id);
  E.gen = gen;
  freeRaster();
  if (E.pdfProbe) {
    if (E.pdf && E.pdf !== E.pdfProbe) { try { E.pdf.destroy(); } catch { /* ignore */ } }
    E.pdf = E.pdfProbe;
    E.pdfProbe = null;
  }
  E.pageIndex = index;
  E.srcExt = 'pdf';
  const page = E.pdf.loadPage(index);
  const b = page.getBounds();
  const s = dpi / 72;
  const M = mupdf.Matrix.scale(s, s);
  const ib = [Math.floor(b[0] * s + 1e-3), Math.floor(b[1] * s + 1e-3), Math.ceil(b[2] * s - 1e-3), Math.ceil(b[3] * s - 1e-3)];
  const W = ib[2] - ib[0], H = ib[3] - ib[1];
  E.W = W; E.H = H; E.dpi = dpi;
  E.raster = new Uint8ClampedArray(W * H * 4);
  prog(0.02, 'Reading the page');
  const dl = page.toDisplayList(true);
  const BAND = Math.max(32, Math.floor(12e6 / W));
  for (let y = 0; y < H; y += BAND) {
    const bh = Math.min(BAND, H - y);
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [ib[0], ib[1] + y, ib[2], ib[1] + y + bh], false);
    pix.clear(255);
    const dev = new mupdf.DrawDevice(M, pix);
    dl.run(dev, mupdf.Matrix.identity);
    dev.close(); dev.destroy();
    rgbToRgba(pix.getPixels(), pix.getStride(), pix.getNumberOfComponents(), W, bh, E.raster, y, W);
    pix.destroy();
    prog(0.05 + 0.85 * ((y + bh) / H), 'Rendering at ' + dpi + ' dpi');
  }
  E.dl = dl; E.ib = ib; E.pageScale = s; // kept for sharp re-rendering when zoomed in
  const text = [];
  try {
    const st = page.toStructuredText('preserve-whitespace');
    const j = JSON.parse(st.asJSON());
    st.destroy();
    for (const block of j.blocks || []) {
      if (block.type !== 'text') continue;
      for (const line of block.lines || []) {
        const t = (line.text || '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        const bb = line.bbox;
        text.push({ t, x0: bb.x * s - ib[0], y0: bb.y * s - ib[1], x1: (bb.x + bb.w) * s - ib[0], y1: (bb.y + bb.h) * s - ib[1], size: ((line.font && line.font.size) || 0) * s });
      }
    }
  } catch { /* no text layer */ }
  page.destroy();
  prog(0.95, 'Preparing the view');
  finishRaster(gen);
  return { W, H, dpi, pageSizePt: [b[2] - b[0], b[3] - b[1]], text, paper: E.paper, levels: E.levels.map((l) => [l.w, l.h]) };
};

// ------------------------------------------------------------------ sharp zoom (PDF vectors re-rendered at screen resolution)

H_.renderRegion = async ({ x0, y0, x1, y1, k, gen }) => {
  if (!E.dl || !E.ib || gen !== E.gen) return null;
  // colour taken out of the drawing exists only in the pixels: keep showing those there
  for (const op of E.ops.values()) {
    if (!op.applied) continue;
    for (const p of op.parts) if (!(p.x0 + p.w < x0 || p.x0 > x1 || p.y0 + p.h < y0 || p.y0 > y1)) return null;
  }
  const mupdf = await MU();
  const bx0 = Math.floor((x0 + E.ib[0]) * k), by0 = Math.floor((y0 + E.ib[1]) * k);
  const bx1 = Math.ceil((x1 + E.ib[0]) * k), by1 = Math.ceil((y1 + E.ib[1]) * k);
  const w = bx1 - bx0, h = by1 - by0;
  if (w <= 0 || h <= 0 || w * h > 40e6) return null;
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [bx0, by0, bx1, by1], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(E.pageScale * k, E.pageScale * k), pix);
  E.dl.run(dev, mupdf.Matrix.identity);
  dev.close(); dev.destroy();
  const buf = new Uint8ClampedArray(w * h * 4);
  rgbToRgba(pix.getPixels(), pix.getStride(), pix.getNumberOfComponents(), w, h, buf, 0, w);
  pix.destroy();
  // highlights that cover paint: take it out here too, at this resolution
  for (const c of coversIn(x0, y0, x1, y1)) {
    const sx = (v) => (v + E.ib[0]) * k - bx0, sy = (v) => (v + E.ib[1]) * k - by0;
    const cx0 = Math.max(0, Math.floor(sx(c.x0))), cy0 = Math.max(0, Math.floor(sy(c.y0)));
    const cx1 = Math.min(w, Math.ceil(sx(c.x0 + c.w))), cy1 = Math.min(h, Math.ceil(sy(c.y0 + c.h)));
    if (cx1 <= cx0 || cy1 <= cy0) continue;
    const mw = cx1 - cx0, mh = cy1 - cy0;
    const m = new Uint8Array(mw * mh);
    IP.rasterizeRings(c.rings.map((r) => r.map((v, i) => (i & 1 ? sy(v) : sx(v)))), cx0, cy0, mw, mh, m);
    IP.unpaintPixels(buf, w, cx0, cy0, mw, mh, m, mw, 0, 0, c.models, COVER_TOL, COVER_LOOSE);
  }
  const bmp = await createImageBitmap(new ImageData(buf, w, h));
  if (gen !== E.gen) { bmp.close(); return null; }
  return { result: { bitmap: bmp, rect: [bx0 / k - E.ib[0], by0 / k - E.ib[1], bx1 / k - E.ib[0], by1 / k - E.ib[1]], k, ver: E.rasterVer }, transfer: [bmp] };
};

// ------------------------------------------------------------------ images

function readU16(b, o, le) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
function readU32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }

function imageDpi(bytes, ext) {
  try {
    if (ext === 'png') {
      let o = 8;
      while (o + 8 < bytes.length) {
        const len = readU32(bytes, o);
        const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
        if (type === 'pHYs') {
          const ppu = readU32(bytes, o + 8);
          if (bytes[o + 16] === 1 && ppu > 0) return Math.round(ppu * 0.0254);
          return 0;
        }
        if (type === 'IDAT') return 0;
        o += 12 + len;
      }
    } else if (ext === 'jpg' || ext === 'jpeg') {
      if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46) {
        const units = bytes[13];
        const xd = readU16(bytes, 14, false);
        if (units === 1 && xd > 1) return xd;
        if (units === 2 && xd > 1) return Math.round(xd * 2.54);
      }
    }
  } catch { /* ignore */ }
  return 0;
}

function tiffDpi(ifd) {
  const xr = ifd.t282, unit = ifd.t296 ? ifd.t296[0] : 2;
  if (!xr) return 0;
  let v = Array.isArray(xr) ? xr[0] : xr;
  if (Array.isArray(v)) v = v[0] / (v[1] || 1);
  if (!(v > 1)) return 0;
  return Math.round(unit === 3 ? v * 2.54 : v);
}

/** Converts a decoded TIFF page to RGBA, box-downscaled by an integer factor k. */
function tiffToRgba(ifd, k) {
  const w = ifd.width, h = ifd.height;
  const W = Math.ceil(w / k), H = Math.ceil(h / k);
  const out = new Uint8ClampedArray(W * H * 4);
  const bps = ifd.t258 ? ifd.t258[0] : 1;
  const spp = ifd.t277 ? ifd.t277[0] : 1;
  const photo = ifd.t262 ? ifd.t262[0] : 1;
  const planar = ifd.t284 ? ifd.t284[0] : 1;
  const data = ifd.data;
  const simple = planar === 1 && ((bps === 1 && spp === 1 && (photo === 0 || photo === 1)) || (bps === 8 && (spp === 1 || spp === 3 || spp === 4) && (photo === 0 || photo === 1 || photo === 2)));
  if (!simple) {
    const rgba = UTIF.toRGBA8(ifd);
    const acc = new Float64Array(W * H * 3), cnt = new Uint32Array(W * H);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, a = rgba[s + 3] / 255, d = ((y / k | 0) * W + (x / k | 0));
      acc[d * 3] += rgba[s] * a + 255 * (1 - a); acc[d * 3 + 1] += rgba[s + 1] * a + 255 * (1 - a); acc[d * 3 + 2] += rgba[s + 2] * a + 255 * (1 - a); cnt[d]++;
    }
    for (let i = 0; i < W * H; i++) { const c = cnt[i] || 1; out[i * 4] = acc[i * 3] / c; out[i * 4 + 1] = acc[i * 3 + 1] / c; out[i * 4 + 2] = acc[i * 3 + 2] / c; out[i * 4 + 3] = 255; }
    return { rgba: out, W, H };
  }
  const acc = new Uint32Array(W * H * 3), cnt = new Uint16Array(W * H);
  if (bps === 1) {
    const rowBytes = Math.ceil(w / 8);
    const white = photo === 0 ? 0 : 1; // photometric 0: a 0 bit is white
    for (let y = 0; y < h; y++) {
      const ro = y * rowBytes, dy = (y / k | 0) * W;
      for (let x = 0; x < w; x++) {
        const bit = (data[ro + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit === white ? 255 : 0;
        const d = dy + (x / k | 0);
        acc[d * 3] += v; acc[d * 3 + 1] += v; acc[d * 3 + 2] += v; cnt[d]++;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      const dy = (y / k | 0) * W;
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * spp, d = dy + (x / k | 0);
        let r, g, b;
        if (spp === 1) { r = g = b = photo === 0 ? 255 - data[s] : data[s]; }
        else { r = data[s]; g = data[s + 1]; b = data[s + 2]; if (spp === 4) { const a = data[s + 3] / 255; r = r * a + 255 * (1 - a); g = g * a + 255 * (1 - a); b = b * a + 255 * (1 - a); } }
        acc[d * 3] += r; acc[d * 3 + 1] += g; acc[d * 3 + 2] += b; cnt[d]++;
      }
    }
  }
  for (let i = 0; i < W * H; i++) { const c = cnt[i] || 1; out[i * 4] = acc[i * 3] / c; out[i * 4 + 1] = acc[i * 3 + 1] / c; out[i * 4 + 2] = acc[i * 3 + 2] / c; out[i * 4 + 3] = 255; }
  return { rgba: out, W, H };
}

H_.probeImage = async ({ bytes, ext }) => {
  E.tiff = null;
  if (E.img) { try { E.img.close(); } catch { /* ignore */ } E.img = null; }
  if (ext === 'tif' || ext === 'tiff') {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    let ifds;
    try { ifds = UTIF.decode(buf); } catch { throw new Error('This TIFF file could not be read. It may be damaged.'); }
    const pages = ifds.filter((f) => f.t256 && f.t257);
    if (!pages.length) throw new Error('This TIFF file has no readable pages.');
    E.tiff = { buf, pages };
    return { pageCount: pages.length, pages: pages.map((f) => ({ w: f.t256[0], h: f.t257[0] })), dpi: tiffDpi(pages[0]) };
  }
  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'from-image' });
  } catch {
    throw new Error('This picture could not be read. Use PNG, JPEG, TIFF, BMP, GIF or WebP.');
  }
  E.img = bmp;
  return { pageCount: 1, pages: [{ w: bmp.width, h: bmp.height }], dpi: imageDpi(bytes, ext) };
};

function decodeTiffPage(index) {
  const ifd = E.tiff.pages[index];
  if (!ifd.data) UTIF.decodeImage(E.tiff.buf, ifd, E.tiff.pages);
  ifd.width = ifd.width || ifd.t256[0];
  ifd.height = ifd.height || ifd.t257[0];
  return ifd;
}

H_.imageThumb = async ({ index, max }) => {
  let src;
  if (E.tiff) {
    const ifd = decodeTiffPage(index);
    const k = Math.max(1, Math.floor(Math.max(ifd.width, ifd.height) / (max * 2)));
    const r = tiffToRgba(ifd, k);
    src = await createImageBitmap(new ImageData(r.rgba, r.W, r.H));
  } else src = E.img;
  const s = max / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const bmp = c.transferToImageBitmap();
  return { result: bmp, transfer: [bmp] };
};

H_.loadImagePage = async ({ index, gen, maxPixels, ext }, id) => {
  const prog = progressFor(id);
  E.gen = gen;
  freeRaster();
  if (E.pdf) { try { E.pdf.destroy(); } catch { /* ignore */ } E.pdf = null; }
  E.srcExt = ext || '';
  prog(0.05, 'Decoding the picture');
  let downscaled = false;
  if (E.tiff) {
    const ifd = decodeTiffPage(index);
    const px = ifd.width * ifd.height;
    const k = px > maxPixels ? Math.ceil(Math.sqrt(px / maxPixels)) : 1;
    downscaled = k > 1;
    const r = tiffToRgba(ifd, k);
    ifd.data = null; // free decoded page
    E.raster = r.rgba; E.W = r.W; E.H = r.H;
  } else {
    const bmp = E.img;
    let W = bmp.width, H = bmp.height;
    if (W * H > maxPixels) { const s = Math.sqrt(maxPixels / (W * H)); W = Math.floor(W * s); H = Math.floor(H * s); downscaled = true; }
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = downscaled;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, W, H);
    E.raster = ctx.getImageData(0, 0, W, H).data;
    E.W = W; E.H = H;
  }
  prog(0.9, 'Preparing the view');
  finishRaster(gen);
  return { W: E.W, H: E.H, paper: E.paper, downscaled, levels: E.levels.map((l) => [l.w, l.h]) };
};

H_.setDpi = ({ dpi }) => { if (dpi > 0) E.dpi = dpi; return true; };

// ------------------------------------------------------------------ queries

H_.sample = ({ x, y }) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const px = ix + dx, py = iy + dy;
    if (px < 0 || py < 0 || px >= E.W || py >= E.H) continue;
    const p = (py * E.W + px) * 4;
    r += E.raster[p]; g += E.raster[p + 1]; b += E.raster[p + 2]; n++;
  }
  if (!n) return null;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
};

H_.colourAt = ({ x, y }) => (E.raster ? colourAt(E.raster, E.W, E.H, x, y, E.paper) : null);

H_.snapLines = async ({ x, y, r }) => {
  if (!E.raster) return { xs: [], ys: [] };
  const rr = Math.max(3, Math.round(r));
  let v = null;
  try { v = await vectors(); } catch { E.vec = false; }
  // a PDF's own geometry where it has lines here; the edges of the ink elsewhere (pictures, scans, text)
  const vs = v ? vectorSnap(v, x, y, rr) : { xs: [], ys: [] };
  if (vs.xs.length && vs.ys.length) return { ...vs, vector: true };
  const rs = IP.snapEdges(E.raster, E.W, E.H, x, y, rr, E.paper);
  return { xs: vs.xs.length ? vs.xs : rs.xs, ys: vs.ys.length ? vs.ys : rs.ys, vector: !!(vs.xs.length || vs.ys.length) };
};

H_.setGaps = ({ lines }) => {
  if (!E.raster) return true;
  if (!lines.length) E.gapMask = null;
  else {
    const m = E.gapMask && E.gapMask.length === E.W * E.H ? E.gapMask.fill(0) : new Uint8Array(E.W * E.H);
    const rad = Math.max(1.25, E.dpi / 220);
    for (const pts of lines) {
      for (let i = 0; i + 3 < pts.length; i += 2) IP.drawThickLine(m, E.W, E.H, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], rad);
    }
    E.gapMask = m;
  }
  E.gapVer++;
  return true;
};

/**
 * Joins a new fill (mask m, window x0, y0, w, h) to the highlight next to it: the one with the most
 * pixels within reach (about 1.2 mm, the thickness of writing). The gap between them, the writing
 * that split the area, is taken in: dark ink and free space within reach of both. Returns the whole
 * joined shape as a mask in its own window, or null when no highlight is near.
 */
function joinNearest(m, x0, y0, w, h, dt) {
  const { W, H } = E;
  const d = Math.max(2, Math.round((1.2 / 25.4) * E.dpi));
  const ex0 = Math.max(0, x0 - d), ey0 = Math.max(0, y0 - d), ex1 = Math.min(W, x0 + w + d), ey1 = Math.min(H, y0 + h + d);
  const ew = ex1 - ex0, eh = ey1 - ey0;
  const mE = new Uint8Array(ew * eh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) mE[(y + y0 - ey0) * ew + x + x0 - ex0] = 1;
  const reach = IP.dilate(mE, ew, eh, d);
  let best = null, bestN = 0;
  for (const [id, c] of E.walls) {
    if (!c.mask) continue;
    const ix0 = Math.max(ex0, c.x0), iy0 = Math.max(ey0, c.y0), ix1 = Math.min(ex1, c.x0 + c.w), iy1 = Math.min(ey1, c.y0 + c.h);
    let n = 0;
    for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) if (c.mask[(y - c.y0) * c.w + x - c.x0] && reach[(y - ey0) * ew + x - ex0]) n++;
    if (n > bestN) { bestN = n; best = id; }
  }
  if (!best) return null;
  const c = E.walls.get(best);
  const ux0 = Math.max(0, Math.min(ex0, c.x0 - d)), uy0 = Math.max(0, Math.min(ey0, c.y0 - d));
  const ux1 = Math.min(W, Math.max(ex1, c.x0 + c.w + d)), uy1 = Math.min(H, Math.max(ey1, c.y0 + c.h + d));
  const uw = ux1 - ux0, uh = uy1 - uy0;
  if (uw * uh > 30e6) return null;
  const a = new Uint8Array(uw * uh), b = new Uint8Array(uw * uh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) a[(y + y0 - uy0) * uw + x + x0 - ux0] = 1;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (c.mask[y * c.w + x]) b[(y + c.y0 - uy0) * uw + x + c.x0 - ux0] = 1;
  const ra = IP.dilate(a, uw, uh, d), rb = IP.dilate(b, uw, uh, d);
  const pl = 0.3 * E.paper[0] + 0.59 * E.paper[1] + 0.11 * E.paper[2];
  const out = new Uint8Array(uw * uh);
  for (let y = 0; y < uh; y++) {
    for (let x = 0; x < uw; x++) {
      const i = y * uw + x;
      if (a[i] || b[i]) { out[i] = 1; continue; }
      if (!ra[i] || !rb[i]) continue;
      const j = (uy0 + y) * W + ux0 + x, p = j << 2;
      const ink = 0.3 * E.raster[p] + 0.59 * E.raster[p + 1] + 0.11 * E.raster[p + 2] < pl * 0.5;
      if (ink || dt[j] >= 1) out[i] = 1;
    }
  }
  const area = IP.countMask(out);
  IP.fillHoles(out, uw, uh, (n) => n <= area * 0.35);
  return { id: best, mask: out, x0: ux0, y0: uy0, w: uw, h: uh };
}

H_.flood = ({ x, y, tol, gapPx, cover, holeRatio, tuck, walls, force, join = false, leakShare = 0.4 }) => {
  const { W, H } = E;
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= W || iy >= H) return { error: 'outside' };
  const p = (iy * W + ix) * 4;
  const r = E.raster[p], g = E.raster[p + 1], b = E.raster[p + 2];
  if (0.3 * r + 0.59 * g + 0.11 * b < 70) return { error: 'line' };
  const q = (v) => Math.min(255, (v & ~7) + 4);
  const sr = q(r), sg = q(g), sb = q(b);
  const key = `${sr},${sg},${sb},${tol},${E.gapVer},${E.rasterVer}`;
  if (E.dtKey !== key) {
    E.dt = IP.barrierDistance(E.raster, W, H, sr, sg, sb, tol, E.gapMask, E.dt);
    E.dtKey = key;
  }
  const dt = E.dt;
  const si = iy * W + ix;
  if (dt[si] === 0) return { error: 'line' };
  updateWalls(walls || []);
  const wall = E.wallMask;
  if (wall && wall[si]) return { error: 'covered' };
  let thr = Math.min(gapPx | 0, 250);
  while (thr > 0 && dt[si] <= thr) thr--;
  if (!E.scratch || E.scratch.length !== W * H) E.scratch = new Uint8Array(W * H);
  const R = E.scratch;
  const st = IP.floodFill(dt, W, H, ix, iy, thr, R, wall);
  if (!force && st.area > leakShare * W * H) {
    IP.clearRect(R, W, st.x0, st.y0, st.x1 - st.x0 + 1, st.y1 - st.y0 + 1);
    return { leak: true, share: st.area / (W * H) };
  }
  const pad = thr + tuck + 3;
  let wx0 = Math.max(0, st.x0 - pad), wy0 = Math.max(0, st.y0 - pad);
  let wx1 = Math.min(W - 1, st.x1 + pad), wy1 = Math.min(H - 1, st.y1 + pad);
  let w = wx1 - wx0 + 1, h = wy1 - wy0 + 1;
  let m = IP.cropMask(R, W, wx0, wy0, w, h);
  IP.clearRect(R, W, st.x0, st.y0, st.x1 - st.x0 + 1, st.y1 - st.y0 + 1);
  if (thr > 0) {
    m = IP.dilate(m, w, h, thr);
    for (let yy = 0; yy < h; yy++) {
      const ro = (wy0 + yy) * W + wx0;
      for (let xx = 0; xx < w; xx++) if (m[yy * w + xx] && (dt[ro + xx] === 0 || (wall && wall[ro + xx]))) m[yy * w + xx] = 0;
    }
  }
  const baseArea = IP.countMask(m);
  if (cover && w * h < 30e6) {
    // furniture against a wall (counters, wardrobes, beds) leaves pockets that touch the wall,
    // so they are not holes. Take in any small pocket that is cut off from the room only by
    // thin lines, not by walls.
    const d = Math.max(2, Math.round((0.2 / 25.4) * E.dpi));
    const added = IP.absorbPockets(m, w, h, (i) => {
      const yy = (i / w) | 0, xx = i - yy * w;
      const j = (wy0 + yy) * W + wx0 + xx;
      return dt[j] >= 1 && !(wall && wall[j]);
    }, d, baseArea * holeRatio);
    if (added) m = IP.erode(IP.dilate(m, w, h, d), w, h, d).map((v, i) => v | m[i]);
  }
  const maxHole = cover ? baseArea * holeRatio : Math.max(6, (2 * tuck + 2) ** 2);
  IP.fillHoles(m, w, h, (area) => area <= maxHole);
  if (tuck > 0) m = IP.dilate(m, w, h, tuck);
  // Shift+click: one highlight with the one next to it (a building split by the number written across it)
  let joinId = null;
  if (join) {
    const jn = joinNearest(m, wx0, wy0, w, h, dt);
    if (jn) { joinId = jn.id; m = jn.mask; wx0 = jn.x0; wy0 = jn.y0; w = jn.w; h = jn.h; wx1 = wx0 + w - 1; wy1 = wy0 + h - 1; }
  }
  const rings = IP.maskToRings(m, w, h, wx0, wy0, 0.9, 4);
  return { rings, area: IP.countMask(m), bbox: [wx0, wy0, wx1 + 1, wy1 + 1], gapUsed: thr, seed: [r, g, b], sheetArea: W * H, joinId };
};

// ------------------------------------------------------------------ painted colour

const norm = (c) => c.map((v, i) => Math.min(255, (v * 255) / Math.max(E.paper[i], 1)));
const MATCH_DIST = [18, 30, 46];
const TARGET_TOL = [16, 26, 40];

H_.detect = ({ minAreaPx, match = 1, hatch = false, targets = [] }, id) => {
  const prog = progressFor(id);
  const cell = Math.max(2, Math.round(E.dpi / 110));
  const mergeDist = MATCH_DIST[match] || 30;
  const hatchPx = Math.round((2.5 / 25.4) * E.dpi);
  const base = { paper: E.paper, minAreaPx, cell, mergeDist, hatch, hatchPx };
  const nT = targets.length;
  const res = detectPaint(E.raster, E.W, E.H, { ...base, progress: (f) => prog(f * (nT ? 0.6 : 1), 'Looking for painted colour') });
  const groups = res.groups;
  targets.forEach((t, ti) => {
    const tn = norm(t);
    const hit = groups.find((g) => { const gn = norm(g.color); return Math.hypot(gn[0] - tn[0], gn[1] - tn[1], gn[2] - tn[2]) <= mergeDist; });
    if (hit) { hit.picked = true; return; }
    const tr = detectPaint(E.raster, E.W, E.H, { ...base, target: t, targetTol: TARGET_TOL[match] || 26, progress: (f) => prog(0.6 + (0.4 * (ti + f)) / nT, 'Looking for the colour you picked') });
    for (const g of tr.groups) { g.picked = true; groups.push(g); }
  });
  E.found.clear();
  let rid = 0;
  return {
    groups: groups.map((g, gi) => ({
      key: gi + 1, color: g.color, liftColor: g.liftColor, area: g.area, picked: !!g.picked,
      regions: g.regions.map((r) => { const k = ++rid; E.found.set(k, r.part); return { rid: k, rings: r.rings, area: r.area, bbox: r.bbox, hatch: !!r.hatch }; }),
    })),
  };
};

// ------------------------------------------------------------------ colour removal ops

function opBBox(parts) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of parts) { b[0] = Math.min(b[0], p.x0); b[1] = Math.min(b[1], p.y0); b[2] = Math.max(b[2], p.x0 + p.w); b[3] = Math.max(b[3], p.y0 + p.h); }
  return b;
}

function partFromData(p) {
  return { x0: p.x0, y0: p.y0, w: p.w, h: p.h, colors: p.colors || [p.color], mask: IP.rleDecode(p.rle, p.w * p.h) };
}

H_.applyOp = ({ opId, rids, parts }) => {
  let ps;
  if (rids) ps = rids.map((k) => E.found.get(k)).filter(Boolean);
  else ps = parts.map(partFromData);
  if (!ps.length) throw new Error('Nothing to remove.');
  const patches = ps.map((part) => IP.unpaint(E.raster, E.W, part, E.paper).patch);
  E.ops.set(opId, { parts: ps, patches, applied: true });
  const b = opBBox(ps);
  afterRasterChange(b);
  return { bbox: b };
};

H_.revertOp = ({ opId }) => {
  const op = E.ops.get(opId);
  if (!op || !op.applied || !op.patches) return false;
  for (let k = op.parts.length - 1; k >= 0; k--) IP.restorePatch(E.raster, E.W, op.parts[k], op.patches[k]);
  op.applied = false;
  afterRasterChange(opBBox(op.parts));
  return true;
};

H_.reapplyOp = ({ opId }) => {
  const op = E.ops.get(opId);
  if (!op || op.applied) return false;
  op.patches = op.parts.map((part) => IP.unpaint(E.raster, E.W, part, E.paper).patch);
  op.applied = true;
  afterRasterChange(opBBox(op.parts));
  return true;
};

H_.forgetPatches = ({ ids }) => { for (const k of ids) { const op = E.ops.get(k); if (op && op.applied) op.patches = null; } return true; };
H_.disposeOps = ({ ids }) => { for (const k of ids) E.ops.delete(k); return true; };

H_.opData = ({ ids }) => {
  const out = {};
  const transfer = [];
  for (const k of ids) {
    const op = E.ops.get(k);
    if (!op) continue;
    out[k] = op.parts.map((p) => { const rle = IP.rleEncode(p.mask); transfer.push(rle.buffer); return { x0: p.x0, y0: p.y0, w: p.w, h: p.h, colors: p.colors, rle }; });
  }
  return { result: out, transfer };
};

/** Eraser on the drawing: removes painted colour under a brush stroke. */
H_.eraseColour = ({ opId, pts, radius }) => {
  if (!E.raster) return { changed: 0 };
  const sm = IP.strokeMask(pts, radius, E.W, E.H);
  if (!sm) return { changed: 0 };
  const colors = IP.estimatePaints(E.raster, E.W, sm.x0, sm.y0, sm.w, sm.h, sm.mask, E.paper);
  if (!colors.length) return { changed: 0, reason: 'no-colour' };
  const part = { x0: sm.x0, y0: sm.y0, w: sm.w, h: sm.h, mask: sm.mask, colors };
  const { patch, changed } = IP.unpaint(E.raster, E.W, part, E.paper);
  if (!changed) return { changed: 0, reason: 'no-colour' };
  E.ops.set(opId, { parts: [part], patches: [patch], applied: true });
  const b = opBBox([part]);
  afterRasterChange(b);
  return { changed, bbox: b, colors };
};

/** Eraser Shift+click on the drawing: removes the whole painted area under the click. */
H_.eraseColourAt = ({ opId, x, y }, id) => {
  if (!E.raster) return { changed: 0 };
  const c = colourAt(E.raster, E.W, E.H, x, y, E.paper);
  if (!c) return { changed: 0, reason: 'no-colour' };
  const prog = progressFor(id);
  const cell = Math.max(2, Math.round(E.dpi / 110));
  const res = detectPaint(E.raster, E.W, E.H, {
    paper: E.paper, target: c, targetTol: 26, cell,
    minAreaPx: Math.max(150, Math.round(((3 / 25.4) * E.dpi) ** 2)),
    progress: (f) => prog(f, 'Finding the coloured area'),
  });
  let best = null, bd = Infinity;
  const ix = Math.floor(x), iy = Math.floor(y);
  for (const g of res.groups) for (const r of g.regions) {
    const p = r.part;
    const lx = ix - p.x0, ly = iy - p.y0;
    if (lx >= 0 && ly >= 0 && lx < p.w && ly < p.h && p.mask[ly * p.w + lx]) { best = r; bd = 0; break; }
    const dx = Math.max(p.x0 - x, 0, x - (p.x0 + p.w)), dy = Math.max(p.y0 - y, 0, y - (p.y0 + p.h));
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = r; }
  }
  if (!best || bd > Math.max(8, E.dpi / 25.4)) return { changed: 0, reason: 'no-area' };
  const part = best.part;
  const { patch, changed } = IP.unpaint(E.raster, E.W, part, E.paper);
  if (!changed) return { changed: 0, reason: 'no-area' };
  E.ops.set(opId, { parts: [part], patches: [patch], applied: true });
  const b = opBBox([part]);
  afterRasterChange(b);
  return { changed, bbox: b, color: c };
};

// ------------------------------------------------------------------ export: shared drawing

function ringsPath(rings) {
  const p = new Path2D();
  for (const r of rings) {
    p.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
    p.closePath();
  }
  return p;
}
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const dashMin = () => (1.2 * E.dpi) / 72;

function drawMarkupReplace(o, m) {
  const p = ringsPath(m.rings);
  o.globalCompositeOperation = 'destination-out';
  o.fillStyle = '#000';
  o.fill(p, 'evenodd');
  o.globalCompositeOperation = 'source-over';
  o.fillStyle = css(m.color, m.opacity);
  o.fill(p, 'evenodd');
  if (m.borderPx > 0) {
    const ls = dashFor(m.borderStyle, m.borderPx, dashMin());
    o.lineJoin = 'miter'; o.miterLimit = 4; o.lineCap = ls.cap; o.setLineDash(ls.dash); o.lineWidth = m.borderPx;
    o.globalCompositeOperation = 'destination-out'; o.strokeStyle = '#000'; o.stroke(p);
    o.globalCompositeOperation = 'source-over'; o.strokeStyle = css(m.borderColor, 1); o.stroke(p);
    o.setLineDash([]);
  }
}

/** Decodes the dimension and tag pictures once per export. */
async function annotBitmaps(annots) {
  if (!annots) return null;
  const bitmaps = async (list) => {
    const out = [];
    for (const im of list || []) out.push({ ...im, bitmap: await createImageBitmap(new Blob([im.png], { type: 'image/png' })) });
    return out;
  };
  // over: pictures drawn after the legend (snag pins), so nothing covers them
  return { lines: annots.lines || [], images: await bitmaps(annots.images), over: await bitmaps(annots.over) };
}
function closeAnnots(a) { if (a) for (const im of [...a.images, ...a.over]) im.bitmap.close(); }

/** Dimension lines (vectors) and their text and area tags (pictures) for rows y0..y0+bh. */
function drawAnnotsBand(ctx, y0, bh, an) {
  if (!an || (!an.lines.length && !an.images.length)) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, -y0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'butt';
  for (const l of an.lines) {
    const p = l.pts;
    if (Math.max(p[1], p[3]) + l.w < y0 || Math.min(p[1], p[3]) - l.w > y0 + bh) continue;
    ctx.strokeStyle = css(l.color, 1);
    ctx.lineWidth = l.w;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.stroke();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const im of an.images) {
    const r = Math.hypot(im.w, im.h) / 2;
    if (im.cy + r < y0 || im.cy - r > y0 + bh) continue;
    ctx.save();
    ctx.translate(im.cx, im.cy);
    if (im.ang) ctx.rotate(im.ang);
    ctx.drawImage(im.bitmap, -im.w / 2, -im.h / 2, im.w, im.h);
    ctx.restore();
  }
  ctx.restore();
}

/** Draws rows y0..y0+bh of the finished sheet (drawing, highlights, dimensions and tags, legend) into ctx at (0,0). */
function composeBand(ctx, y0, bh, markups, legend, overlay, annots = null) {
  const { W } = E;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const base = E.raster.slice(y0 * W * 4, (y0 + bh) * W * 4);
  applyCovers(base, 0, y0, W, bh);
  ctx.putImageData(new ImageData(base, W, bh), 0, 0);
  if (markups.length) {
    const o = overlay.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, overlay.width, overlay.height);
    o.setTransform(1, 0, 0, 1, 0, -y0);
    let any = false;
    for (const m of markups) {
      const pad = m.borderPx + 2;
      if (m.bbox[3] + pad < y0 || m.bbox[1] - pad > y0 + bh) continue;
      drawMarkupReplace(o, m);
      any = true;
    }
    if (any) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(overlay, 0, 0, W, bh, 0, 0, W, bh);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  drawAnnotsBand(ctx, y0, bh, annots);
  if (legend && legend.bitmap && legend.y < y0 + bh && legend.y + legend.h > y0) {
    ctx.drawImage(legend.bitmap, legend.x, legend.y - y0, legend.w, legend.h);
  }
  if (annots && annots.over.length) drawAnnotsBand(ctx, y0, bh, { lines: [], images: annots.over });
}

async function legendBitmapOf(legend) {
  if (!legend || !legend.png) return null;
  const bitmap = await createImageBitmap(new Blob([legend.png], { type: 'image/png' }));
  return { ...legend, bitmap };
}

let crcTable = null;
function crc32(bytes, start, end) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adds print resolution so the picture prints at the drawing's real size. */
function withDpi(bytes, type, dpi) {
  if (!dpi) return bytes;
  if (type === 'png' && bytes[12] === 0x49 && bytes[13] === 0x48) {
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4);
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, crc32(chunk, 4, 17));
    const out = new Uint8Array(bytes.length + 21);
    out.set(bytes.subarray(0, 33), 0); out.set(chunk, 33); out.set(bytes.subarray(33), 54);
    return out;
  }
  if (type === 'jpg' && bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a) {
    bytes[13] = 1; bytes[14] = (dpi >> 8) & 0xff; bytes[15] = dpi & 0xff; bytes[16] = (dpi >> 8) & 0xff; bytes[17] = dpi & 0xff;
  }
  return bytes;
}

H_.exportImage = async ({ type, quality, markups, legend, annots }, id) => {
  const prog = progressFor(id);
  const { W, H } = E;
  prog(0.05, 'Composing the sheet');
  const lg = await legendBitmapOf(legend);
  const an = await annotBitmaps(annots);
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d');
  const BH = Math.min(H, 2048);
  const overlay = new OffscreenCanvas(W, BH);
  const band = new OffscreenCanvas(W, BH);
  const bctx = band.getContext('2d');
  for (let y0 = 0; y0 < H; y0 += BH) {
    const bh = Math.min(BH, H - y0);
    composeBand(bctx, y0, bh, markups, lg, overlay, an);
    ctx.drawImage(band, 0, 0, W, bh, 0, y0, W, bh);
    prog(0.05 + 0.5 * ((y0 + bh) / H), 'Composing the sheet');
  }
  if (lg) lg.bitmap.close();
  closeAnnots(an);
  prog(0.6, type === 'png' ? 'Compressing the PNG' : 'Compressing the JPEG');
  const blob = await cv.convertToBlob(type === 'jpg' ? { type: 'image/jpeg', quality: quality || 0.92 } : { type: 'image/png' });
  const bytes = withDpi(new Uint8Array(await blob.arrayBuffer()), type, E.dpi);
  prog(1, 'Done');
  return { result: bytes, transfer: [bytes.buffer] };
};

// ------------------------------------------------------------------ export: PDF

const pn = (v) => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 100) / 100;
  return r === 0 ? '0' : String(r);
};
const pm = (m) => m.map((v) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1e6) / 1e6))).join(' ');

function pathOps(rings, out) {
  for (const r of rings) {
    out.push(pn(r[0]) + ' ' + pn(r[1]) + ' m');
    for (let i = 2; i < r.length; i += 2) out.push(pn(r[i]) + ' ' + pn(r[i + 1]) + ' l');
    out.push('h');
  }
}

/** Net number of unclosed q operators in content streams (so our content starts clean). */
function unbalancedSaves(chunks) {
  let depth = 0;
  const isWS = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
  for (const bytes of chunks) {
    const n = bytes.length;
    let i = 0;
    while (i < n) {
      const c = bytes[i];
      if (isWS(c)) { i++; continue; }
      if (c === 37) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; continue; }
      if (c === 40) {
        let d = 1; i++;
        while (i < n && d > 0) { const b = bytes[i]; if (b === 92) { i += 2; continue; } if (b === 40) d++; else if (b === 41) d--; i++; }
        continue;
      }
      if (c === 60) { if (bytes[i + 1] === 60) { i += 2; continue; } while (i < n && bytes[i] !== 62) i++; i++; continue; }
      if (c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 41) { i++; continue; }
      if (c === 47) { i++; while (i < n && !isWS(bytes[i]) && !isDelim(bytes[i])) i++; continue; }
      const s = i;
      while (i < n && !isWS(bytes[i]) && !isDelim(bytes[i])) i++;
      const len = i - s;
      if (len === 1) { if (bytes[s] === 113) depth++; else if (bytes[s] === 81 && depth > 0) depth--; }
      else if (len === 2 && bytes[s] === 73 && bytes[s + 1] === 68) {
        // inline image data: skip to EI
        i++;
        while (i < n - 1) {
          if (bytes[i] === 69 && bytes[i + 1] === 73 && isWS(bytes[i - 1]) && (i + 2 >= n || isWS(bytes[i + 2]))) { i += 2; break; }
          i++;
        }
      }
    }
  }
  return depth;
}

/** RGB bytes of a rectangle of an RGBA buffer. */
function rgbBytes(rgba, W, x0, y0, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    let s = ((y0 + y) * W + x0) * 4, d = y * w * 3;
    for (let x = 0; x < w; x++, s += 4, d += 3) { out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; }
  }
  return out;
}

/**
 * Writes an image XObject in the plainest form every reader accepts: 8-bit DeviceRGB, Flate,
 * and (optionally) an 8-bit DeviceGray soft mask. (A soft mask in any other colour space is
 * invalid and some readers, Poppler for one, then drop the picture.)
 */
function addPlainImage(out, rgb, w, h, alpha) {
  const dict = { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' };
  if (alpha) {
    dict.SMask = out.addRawStream(zlibSync(alpha, { level: 6 }), { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' });
  }
  return out.addRawStream(zlibSync(rgb, { level: 6 }), dict);
}

/** A PNG with transparency as RGB bytes plus an 8-bit alpha channel. */
async function rgbaOfPng(png) {
  const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const w = bmp.width, h = bmp.height;
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0);
  bmp.close();
  const d = x.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
  for (let i = 0, j = 0, k = 0; i < d.length; i += 4, j += 3, k++) { rgb[j] = d[i]; rgb[j + 1] = d[i + 1]; rgb[j + 2] = d[i + 2]; alpha[k] = d[i + 3]; }
  return { rgb, alpha, w, h };
}

/** The legend picture flattened onto white (it is an opaque table) as RGB bytes. */
async function legendRgb(lg) {
  const bmp = await createImageBitmap(new Blob([lg.png], { type: 'image/png' }));
  const w = bmp.width, h = bmp.height;
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#FFFFFF';
  x.fillRect(0, 0, w, h);
  x.drawImage(bmp, 0, 0);
  bmp.close();
  return { rgb: rgbBytes(x.getImageData(0, 0, w, h).data, w, 0, 0, w, h), w, h };
}

/**
 * PDF export. Highlights are written as plain filled paths in the page's own content, with an
 * ExtGState (Multiply blend + opacity) in the page's own resources: the simplest form, which
 * every PDF reader and printer shows. For a PDF drawing the original page is kept as it is
 * (vector, text, layers); colour taken out of the drawing is covered with picture patches.
 * mode 'flat' writes one picture of the finished sheet instead (same look in every program).
 */
H_.exportPdf = async ({ mode, markups, legend, annots, title }, id) => {
  const mupdf = await MU();
  const prog = progressFor(id);
  const { W, H } = E;
  const k = 72 / E.dpi;
  const pw = W * k, ph = H * k;
  const out = new mupdf.PDFDocument();
  const lg = legend && legend.png ? legend : null;
  prog(0.03, 'Writing the PDF');

  // ---- base page and the matrix from sheet pixels to PDF user space
  let page, M;
  const src = mode !== 'flat' && E.pdf ? E.pdf.asPDF && E.pdf.asPDF() : null;
  const res = out.newDictionary();
  const xobj = out.newDictionary();
  const gstates = out.newDictionary();
  let nX = 0; // entries in xobj (PDFObject.length only counts arrays)
  let baseContent = '';
  const applied = [...E.ops.values()].filter((op) => op.applied);
  if (src) {
    // one graft map, so the page's layers and the document's layer settings stay linked
    const map = out.newGraftMap();
    map.graftPage(-1, src, E.pageIndex);
    try {
      // keep layers (and which ones are switched off) exactly as in the original drawing
      const ocp = src.getTrailer().get('Root').get('OCProperties');
      if (ocp && !ocp.isNull()) out.getTrailer().get('Root').put('OCProperties', map.graftObject(ocp));
    } catch { /* no layers */ }
    page = out.findPage(0);
    const pg = out.loadPage(0);
    const ctm = pg.getTransform();
    pg.destroy();
    const s = E.pageScale;
    M = mupdf.Matrix.concat([1 / s, 0, 0, 1 / s, E.ib[0] / s, E.ib[1] / s], mupdf.Matrix.invert(ctm));
  } else {
    M = [k, 0, 0, -k, 0, ph];
    prog(0.1, 'Writing the PDF');
    let rgb;
    if (mode === 'flat') {
      // the finished sheet as one picture
      const lgb = await legendBitmapOf(lg);
      const anb = await annotBitmaps(annots);
      rgb = new Uint8Array(W * H * 3);
      const BH = Math.min(H, 1024);
      const band = new OffscreenCanvas(W, BH);
      const bctx = band.getContext('2d', { willReadFrequently: true });
      const overlay = new OffscreenCanvas(W, BH);
      for (let y0 = 0; y0 < H; y0 += BH) {
        const bh = Math.min(BH, H - y0);
        composeBand(bctx, y0, bh, markups, lgb, overlay, anb);
        const data = bctx.getImageData(0, 0, W, bh).data;
        rgb.set(rgbBytes(data, W, 0, 0, W, bh), y0 * W * 3);
        prog(0.1 + 0.5 * ((y0 + bh) / H), 'Writing the PDF');
      }
      if (lgb) lgb.bitmap.close();
      closeAnnots(anb);
    } else {
      // the picture, with the paint taken out under covering highlights
      rgb = new Uint8Array(W * H * 3);
      const BH = Math.max(16, Math.floor(8e6 / W));
      for (let y0 = 0; y0 < H; y0 += BH) {
        const bh = Math.min(BH, H - y0);
        const band = E.raster.slice(y0 * W * 4, (y0 + bh) * W * 4);
        applyCovers(band, 0, y0, W, bh);
        rgb.set(rgbBytes(band, W, 0, 0, W, bh), y0 * W * 3);
      }
    }
    prog(0.62, 'Compressing the picture');
    if (E.srcExt === 'jpg' || E.srcExt === 'jpeg') {
      // a photo or scan stays a JPEG
      const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, W, H], false);
      const px = pix.getPixels();
      const stride = pix.getStride();
      for (let y = 0; y < H; y++) px.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * stride);
      const img = new mupdf.Image(pix.asJPEG(92));
      xobj.put('PlanTintBase', out.addImage(img)); nX++;
      img.destroy(); pix.destroy();
    } else {
      xobj.put('PlanTintBase', addPlainImage(out, rgb, W, H, null)); nX++;
    }
    rgb = null;
    baseContent = `q ${pn(pw)} 0 0 ${pn(ph)} 0 0 cm /PlanTintBase Do Q\n`;
  }
  prog(0.72, 'Adding highlights');

  // ---- overlay content, in sheet pixels
  const ops = [];
  ops.push('q', pm(M) + ' cm');
  // patches: colour taken out of a vector drawing, as pictures of the cleaned sheet
  let n = 0;
  if (src && applied.length) {
    for (const op of applied) {
      for (const part of op.parts) {
        const alpha = new Uint8Array(part.w * part.h);
        for (let i = 0; i < alpha.length; i++) alpha[i] = part.mask[i] ? 255 : 0;
        const name = 'PlanTintP' + n++;
        xobj.put(name, addPlainImage(out, rgbBytes(E.raster, W, part.x0, part.y0, part.w, part.h), part.w, part.h, alpha)); nX++;
        ops.push(`q ${pn(part.w)} 0 0 ${pn(-part.h)} ${pn(part.x0)} ${pn(part.y0 + part.h)} cm /${name} Do Q`);
      }
    }
  }
  // paint taken out under covering highlights: pictures of only the pixels that change, so the
  // drawing's own lines and text stay vector
  if (src && mode !== 'flat') {
    for (const c of E.covers.values()) {
      if (!c.models) continue;
      const buf = IP.copyRect(E.raster, W, c.x0, c.y0, c.w, c.h);
      if (!IP.unpaintPixels(buf, c.w, 0, 0, c.w, c.h, c.mask, c.w, 0, 0, c.models, COVER_TOL, COVER_LOOSE)) continue;
      const alpha = new Uint8Array(c.w * c.h);
      for (let y = 0; y < c.h; y++) {
        let p = ((c.y0 + y) * W + c.x0) * 4, q = y * c.w * 4;
        for (let x = 0; x < c.w; x++, p += 4, q += 4) {
          if (E.raster[p] !== buf[q] || E.raster[p + 1] !== buf[q + 1] || E.raster[p + 2] !== buf[q + 2]) alpha[y * c.w + x] = 255;
        }
      }
      const name = 'PlanTintP' + n++;
      xobj.put(name, addPlainImage(out, rgbBytes(buf, c.w, 0, 0, c.w, c.h), c.w, c.h, alpha)); nX++;
      ops.push(`q ${pn(c.w)} 0 0 ${pn(-c.h)} ${pn(c.x0)} ${pn(c.y0 + c.h)} cm /${name} Do Q`);
    }
  }
  // highlights, bottom to top
  const gsNames = new Map();
  const gsFor = (opacity) => {
    const key = Math.round(opacity * 1000) / 1000;
    if (gsNames.has(key)) return gsNames.get(key);
    const name = 'PlanTintM' + gsNames.size;
    const d = out.newDictionary();
    d.put('Type', out.newName('ExtGState'));
    d.put('BM', out.newName('Multiply'));
    d.put('ca', key);
    d.put('CA', 1);
    gstates.put(name, out.addObject(d));
    gsNames.set(key, name);
    return name;
  };
  const rgbOp = (c) => c.map((v) => pn(Math.max(0, Math.min(255, v)) / 255)).join(' ');
  const live = mode === 'flat' ? [] : markups; // flat: highlights and legend are in the picture already
  for (const m of live) {
    ops.push('q');
    if (m.hide && m.hide.length) {
      // never stack: hide this highlight where the ones above it are
      const pad = 20;
      ops.push(`${pn(-pad)} ${pn(-pad)} m ${pn(W + pad)} ${pn(-pad)} l ${pn(W + pad)} ${pn(H + pad)} l ${pn(-pad)} ${pn(H + pad)} l h`);
      pathOps(m.hide, ops);
      ops.push('W* n');
    }
    ops.push('/' + gsFor(m.opacity) + ' gs');
    ops.push(rgbOp(m.color) + ' rg');
    pathOps(m.rings, ops);
    ops.push('f*');
    if (m.borderPx > 0) {
      const ls = dashFor(m.borderStyle, m.borderPx, dashMin());
      ops.push(rgbOp(m.borderColor) + ' RG');
      ops.push(pn(m.borderPx) + ' w 0 j 4 M ' + (ls.cap === 'round' ? 1 : 0) + ' J');
      ops.push('[' + ls.dash.map(pn).join(' ') + '] 0 d');
      pathOps(m.rings, ops);
      ops.push('S');
    }
    ops.push('Q');
  }
  // dimensions (vector lines) and their text and area tags (pictures with transparency)
  if (annots && mode !== 'flat') {
    if (annots.lines && annots.lines.length) {
      ops.push('q 0 J 0 j [] 0 d');
      for (const l of annots.lines) {
        const p = l.pts;
        ops.push(`${rgbOp(l.color)} RG ${pn(l.w)} w ${pn(p[0])} ${pn(p[1])} m ${pn(p[2])} ${pn(p[3])} l S`);
      }
      ops.push('Q');
    }
  }
  let ti = 0;
  const placeImages = async (list) => {
    for (const im of list || []) {
      const px = await rgbaOfPng(im.png);
      const name = 'PlanTintT' + ti++;
      xobj.put(name, addPlainImage(out, px.rgb, px.w, px.h, px.alpha)); nX++;
      // the image's unit square onto the label's box, turned about its centre (sheet pixels, y down)
      const c = Math.cos(im.ang || 0), sn = Math.sin(im.ang || 0);
      const x0 = -im.w / 2, yb = im.h / 2;
      const mat = [c * im.w, sn * im.w, sn * im.h, -c * im.h, c * x0 - sn * yb + im.cx, sn * x0 + c * yb + im.cy];
      ops.push(`q ${mat.map(pn).join(' ')} cm /${name} Do Q`);
    }
  };
  if (annots && mode !== 'flat') await placeImages(annots.images);
  // legend
  if (lg && mode !== 'flat') {
    const L = await legendRgb(lg);
    xobj.put('PlanTintLegend', addPlainImage(out, L.rgb, L.w, L.h, null)); nX++;
    ops.push(`q ${pn(lg.w)} 0 0 ${pn(-lg.h)} ${pn(lg.x)} ${pn(lg.y + lg.h)} cm /PlanTintLegend Do Q`);
  }
  // snag pins, over everything
  if (annots && mode !== 'flat') await placeImages(annots.over);
  ops.push('Q');
  const overlay = ops.join('\n') + '\n';
  prog(0.85, 'Writing the PDF');

  if (src) {
    // add our resources next to the page's own ones (never replacing them)
    let pres = page.get('Resources');
    if (pres.isNull()) {
      const inh = page.getInheritable('Resources');
      pres = inh.isNull() ? out.newDictionary() : inh;
      page.put('Resources', pres);
    }
    const merge = (key, dict, count) => {
      if (!count) return;
      let d = pres.get(key);
      if (d.isNull()) { d = out.newDictionary(); pres.put(key, d); }
      dict.forEach((v, name) => d.put(name, v));
    };
    merge('XObject', xobj, nX);
    merge('ExtGState', gstates, gsNames.size);
    // wrap the original content in q/Q so our content starts from a clean graphics state
    const contents = page.get('Contents');
    const streams = [];
    if (contents.isArray()) for (let i = 0; i < contents.length; i++) streams.push(contents.get(i));
    else if (!contents.isNull()) streams.push(contents);
    const chunks = [];
    for (const s of streams) { try { chunks.push(s.readStream().asUint8Array()); } catch { /* unreadable stream */ } }
    const open = unbalancedSaves(chunks);
    const arr = out.newArray();
    arr.push(out.addStream('q\n', {}));
    for (const s of streams) arr.push(s);
    arr.push(out.addStream('Q\n'.repeat(1 + open) + overlay, {}));
    page.put('Contents', arr);
  } else {
    if (nX) res.put('XObject', xobj);
    if (gsNames.size) res.put('ExtGState', gstates);
    const pageObj = out.addPage([0, 0, pw, ph], 0, res, baseContent + overlay);
    out.insertPage(-1, pageObj);
  }
  try {
    if (title) out.setMetaData('info:Title', title);
    out.setMetaData('info:Creator', 'PlanTint 1.8');
  } catch { /* metadata is optional */ }
  prog(0.9, 'Compressing the PDF');
  const buf = out.saveToBuffer('compress,compress-images,compress-fonts,garbage');
  const bytes = buf.asUint8Array().slice();
  buf.destroy();
  out.destroy();
  prog(1, 'Done');
  return { result: bytes, transfer: [bytes.buffer] };
};

H_.reset = () => { freeRaster(); E.gen++; return true; };
H_.inkGrid = () => (E.ink ? { result: { ...E.ink, ink: E.ink.ink.slice() }, transfer: [] } : null);

// ------------------------------------------------------------------ dispatch

self.onmessage = async (ev) => {
  const { id, cmd, args } = ev.data;
  const fn = H_[cmd];
  if (!fn) { post({ id, ok: false, error: 'Unknown command ' + cmd }); return; }
  try {
    const out = await fn(args || {}, id);
    if (out && typeof out === 'object' && 'result' in out && 'transfer' in out) post({ id, ok: true, result: out.result }, out.transfer);
    else post({ id, ok: true, result: out });
  } catch (e) {
    post({ id, ok: false, error: (e && e.message) || String(e) });
  }
};
post({ type: 'ready' });
