// Shared application state and a tiny event bus.
// Markups, gap lines, the legend and raster-op lists are treated as immutable values:
// edits always produce new objects, which makes undo snapshots cheap and safe.

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  const set = listeners.get(evt);
  if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error(e); } }
}

let idSeq = Date.now() % 1e6;
export const uid = (p = 'm') => p + (++idSeq).toString(36) + Math.random().toString(36).slice(2, 6);

export const S = {
  doc: null,            // see io.js: { name, path, kind, ext, bytes, pageIndex, pageCount, dpi, W, H, pageSizePt, text, paper, scale, projectPath }
  markups: [],
  gaps: [],
  legend: null,         // { visible, x, y, titlePx, namePx, merge }
  rasterOps: [],        // [{ id, label }] colour taken out of the drawing (pixel data lives in the engine)
  selection: new Set(), // markup ids
  legendSelected: false,
  tool: 'select',
  style: { color: '#FFD60A', opacity: 0.45, borderPt: 0, borderColor: null, borderStyle: 'solid' },
  fill: { tol: 25, gaps: 1, cover: true, autoName: true },
  eraser: { size: 30, mode: 'both' }, // mode: both | highlights | drawing
  lock: { mode: 'free', once: null, refIdx: -1, extRef: null },
  loupe: { on: false, power: 3 },
  showGaps: true,
  snapDrawing: true,
  busy: false,
};

// ------------------------------------------------------------------ markup helpers

export function markupById(id) {
  return S.markups.find((m) => m.id === id) || null;
}

export function selectedMarkups() {
  return S.markups.filter((m) => S.selection.has(m.id));
}

export function nextAreaName() {
  let max = 0;
  for (const m of S.markups) {
    const mm = /^Area (\d+)$/.exec(m.name || '');
    if (mm) max = Math.max(max, +mm[1]);
  }
  return 'Area ' + (max + 1);
}

export function makeMarkup({ kind, rings, name, style }) {
  const st = style || S.style;
  return Object.freeze({
    id: uid('m'),
    name: name || nextAreaName(),
    kind,
    rings,
    color: st.color,
    opacity: st.opacity,
    borderPt: st.borderPt || 0,
    borderColor: st.borderColor || null,
    borderStyle: st.borderStyle || 'solid',
  });
}

export function withProps(m, props) {
  return Object.freeze({ ...m, ...props });
}

/** Points (pt on the printed sheet) to sheet pixels. */
export const ptToPx = (pt) => (pt * (S.doc ? S.doc.dpi : 150)) / 72;
export const pxToPt = (px) => (px * 72) / (S.doc ? S.doc.dpi : 150);

export function setSelection(ids, legend = false) {
  S.selection = new Set(ids);
  S.legendSelected = legend;
  emit('selection');
}
