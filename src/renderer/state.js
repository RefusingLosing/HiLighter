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

/**
 * Measuring settings (saved with the project; the last ones used start new drawings).
 * len/area: units; dec: decimals ('auto' or 0..4); showArea/showPerim: what is measured and
 * shown; tags: the values written on the sheet in each markup; legend: the values as legend
 * columns; dims: dimension lines shown and exported; textPt: text size of tags and dimensions.
 */
export const MEAS_DEFAULT = Object.freeze({
  len: 'm', area: 'm2', dec: 'auto',
  showArea: true, showPerim: false,
  tags: false, legend: false, dims: true,
  textPt: 8, dimColor: '#B42318',
});

export function loadMeasPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem('plantint.meas') || 'null');
    if (v && typeof v === 'object') return Object.freeze({ ...MEAS_DEFAULT, ...v });
  } catch { /* storage is optional */ }
  return MEAS_DEFAULT;
}
export function saveMeasPrefs(m) {
  try { localStorage.setItem('plantint.meas', JSON.stringify(m)); } catch { /* storage is optional */ }
}

export const S = {
  doc: null,            // see io.js: { name, path, kind, ext, bytes, pageIndex, pageCount, dpi, W, H, pageSizePt, text, paper, scale, projectPath }
  markups: [],
  gaps: [],
  dims: [],             // dimension lines: [{ id, a: [x, y], b: [x, y], off }] (sheet pixels)
  legend: null,         // { visible, x, y, titlePx, namePx, merge }
  rasterOps: [],        // [{ id, label }] colour taken out of the drawing (pixel data lives in the engine)
  calib: null,          // the drawing's scale when set here: { kind: 'calib'|'typed', mPerPx, a, b, lengthM, unit }
  meas: MEAS_DEFAULT,   // measuring settings, see MEAS_DEFAULT
  selection: new Set(), // markup and dimension ids
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

// ------------------------------------------------------------------ dimension helpers

export const isDimId = (id) => typeof id === 'string' && id[0] === 'd';
export const selectedDims = () => S.dims.filter((d) => S.selection.has(d.id));

export function makeDim(a, b, off = 0) {
  return Object.freeze({ id: uid('d'), a: [a[0], a[1]], b: [b[0], b[1]], off });
}

/** Sets measuring settings as one value (callers wrap it in an undo step). */
export function setMeas(props) {
  S.meas = Object.freeze({ ...S.meas, ...props });
  saveMeasPrefs(S.meas);
}

/** Points (pt on the printed sheet) to sheet pixels. */
export const ptToPx = (pt) => (pt * (S.doc ? S.doc.dpi : 150)) / 72;
export const pxToPt = (px) => (px * 72) / (S.doc ? S.doc.dpi : 150);

export function setSelection(ids, legend = false) {
  S.selection = new Set(ids);
  S.legendSelected = legend;
  emit('selection');
}
