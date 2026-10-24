// Opening drawings and projects, saving, exporting, the exit question and crash recovery.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { S, emit, on, ptToPx, loadMeasPrefs, MEAS_DEFAULT, PROGRESS_DEFAULT } from './state.js';
import * as engine from './engine.js';
import { resetTiles, requestAll, geo } from './render.js';
import { fit } from './view.js';
import { resetHistory, saveState, markSaved, markUnsaved, stateId } from './history.js';
import { busy, toast, modal, h } from './ui.js';
import { pickPage, sheetName, chooseSaveType, SAVE_TYPES } from './dialogs.js';
import { legendPng, clampLegendSizes } from './legend.js';
import { hexToRgb, borderColorOf } from './colors.js';
import { isLineStyle } from '../shared/linestyle.js';
import { detectScale, scaleRatio, scaleSource, hasScale, isLengthUnit, isAreaUnit } from './units.js';
import * as G from './geom.js';
import { annotExport } from './annot.js';
import { scheduleXlsx, scheduleCsv } from './schedule.js';
import { shown, readProg } from './progress.js';
import { pinExport, readPin } from './pins.js';
import { progressXlsx, snagXlsx } from './reports.js';
import { syncCovers } from './covers.js';

const IMG_EXT = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'webp'];
const MAX_IMAGE_PX = 100e6;
let gen = 0;
let loading = false;

export const isLoading = () => loading;

/** Best practical resolution: 300 dpi (400 for small sheets), capped near 72 megapixels. */
export function chooseDpi(wPt, hPt) {
  const sq = (wPt / 72) * (hPt / 72);
  const MAXPX = 72e6;
  let dpi = Math.floor(Math.sqrt(MAXPX / sq));
  dpi = Math.min(sq < 260 ? 400 : 300, dpi);
  dpi = Math.min(dpi, Math.floor(16000 / (Math.max(wPt, hPt) / 72)));
  return Math.max(72, dpi);
}

const baseName = (n) => String(n || 'Drawing').replace(/\.[^.]+$/, '');

function setTitle() {
  const d = S.doc;
  const el = document.getElementById('doc-title');
  if (!d) { window.plantint.setTitle({ text: 'PlanTint', name: '', unsaved: false }); if (el) el.innerHTML = ''; return; }
  const st = saveState();
  const page = d.pageCount > 1 ? `page ${d.pageIndex + 1} of ${d.pageCount}` : '';
  const name = d.projectName || d.name;
  window.plantint.setTitle({ text: `${st === 'saved' ? '' : '• '}${name} — PlanTint`, name, unsaved: st !== 'saved' });
  if (el) {
    el.innerHTML = '';
    el.append(h('span', { class: 'dt-name', title: d.projectPath || d.path || name }, name));
    if (page) el.append(h('span', { class: 'dt-page' }, page));
    if (st !== 'saved') el.append(h('span', { class: 'dt-dirty', title: st === 'picture' ? 'Saved as a picture or PDF only' : 'Not saved' }, st === 'picture' ? 'saved as picture' : 'not saved'));
  }
}

export function initIO() {
  on('dirty', setTitle);
  on('docLoaded', setTitle);
  setTitle();
}

// ------------------------------------------------------------------ opening

const canOpen = (name) => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ext === 'plantint' || ext === 'pdf' || IMG_EXT.includes(ext);
};

/** Ctrl+O and Open. A tab that already has a drawing keeps it: the main process opens the chosen file in a new tab. */
export async function openFromDialog() {
  if (loading) return;
  const f = await window.plantint.openDialog({ newTab: !!S.doc });
  if (f) await openFile(f, true); // an empty tab takes the drawing in (or says what PlanTint opens)
}

/** A file dropped on the window: in a new tab beside this drawing, or here when this tab is empty. */
export async function openDropped(file, filePath) {
  if (loading) return;
  if (!canOpen(file.name)) { await openFile({ path: filePath || null, name: file.name, bytes: null }, true); return; }
  if (S.doc && filePath) { window.plantint.openInNewTab(filePath); return; }
  if (!(await confirmDiscard('opening another drawing'))) return;
  await openFile({ path: filePath || null, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, true);
}

export async function openFile(f, confirmed = false) {
  if (loading) return;
  if (!confirmed && !(await confirmDiscard('opening another drawing'))) return;
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'plantint') await openProject(f.bytes, f.path, f.name);
    else if (ext === 'pdf') await openPdf(f.bytes, f.name, f.path);
    else if (IMG_EXT.includes(ext)) await openImage(f.bytes, f.name, f.path, ext);
    else toast('PlanTint opens PDF drawings, pictures (PNG, JPEG, TIFF, BMP, GIF, WebP) and PlanTint projects.');
  } catch (err) {
    busy.hide();
    loading = false;
    toast(err.message || String(err), { kind: 'error', timeout: 7000 });
  }
}

function setDoc(doc) {
  S.doc = doc;
  S.markups = [];
  S.gaps = [];
  S.dims = [];
  S.legend = null;
  S.rasterOps = [];
  S.calib = null;
  S.meas = loadMeasPrefs();
  S.progress = PROGRESS_DEFAULT;
  S.pins = [];
  S.pinNext = 1;
  S.photos = new Map();
  S.selection = new Set();
  S.legendSelected = false;
  resetHistory();
  fit();
  engine.call('inkGrid').then((g) => { if (S.doc === doc) doc.ink = g; }).catch(() => {});
  emit('selection');
  emit('doc');
  emit('docLoaded');
  emit('view');
  requestAll();
}

async function openPdf(bytes, name, path, pageIndex = null, dpiOverride = null) {
  loading = true;
  busy.show(`Opening ${name}`);
  try {
    const info = await engine.call('openPdf', { bytes });
    let index = pageIndex;
    if (index === null) {
      index = 0;
      if (info.pageCount > 1) {
        busy.hide();
        index = await pickPage({ fileName: name, pages: info.pages, kind: 'pdf', thumb: (i) => engine.call('pdfThumb', { index: i, max: 260 }) });
        if (index === null) return null;
      }
    }
    const p = info.pages[index];
    const dpi = dpiOverride || chooseDpi(p.w, p.h);
    const myGen = ++gen;
    resetTiles(myGen);
    busy.show(`Rendering at ${dpi} dpi`, 0);
    const r = await engine.call('loadPdfPage', { index, dpi, gen: myGen }, { onProgress: (f, msg) => busy.update(msg, f) });
    const text = r.text || [];
    const scale = detectScale(text, r.pageSizePt);
    setDoc({
      name, path, kind: 'pdf', ext: 'pdf', bytes, pageIndex: index, pageCount: info.pageCount,
      dpi, W: r.W, H: r.H, pageSizePt: r.pageSizePt, text, paper: r.paper, physical: true,
      sheet: sheetName(r.pageSizePt[0], r.pageSizePt[1]), scale, scaleSource: scale ? 'title' : '',
    });
    return true;
  } finally {
    busy.hide();
    loading = false;
  }
}

async function openImage(bytes, name, path, ext, pageIndex = null) {
  loading = true;
  busy.show(`Opening ${name}`);
  try {
    const info = await engine.call('probeImage', { bytes, ext });
    let index = pageIndex;
    if (index === null) {
      index = 0;
      if (info.pageCount > 1) {
        busy.hide();
        index = await pickPage({ fileName: name, pages: info.pages, kind: 'image', thumb: (i) => engine.call('imageThumb', { index: i, max: 260 }) });
        if (index === null) return null;
      }
    }
    const myGen = ++gen;
    resetTiles(myGen);
    busy.show('Decoding the picture', 0);
    const r = await engine.call('loadImagePage', { index, gen: myGen, maxPixels: MAX_IMAGE_PX, ext }, { onProgress: (f, msg) => busy.update(msg, f) });
    const dpi = info.dpi > 20 ? info.dpi : 150;
    await engine.call('setDpi', { dpi });
    setDoc({
      name, path, kind: 'image', ext, bytes, pageIndex: index, pageCount: info.pageCount,
      dpi, W: r.W, H: r.H, pageSizePt: [(r.W * 72) / dpi, (r.H * 72) / dpi], text: [], paper: r.paper, physical: info.dpi > 20,
      sheet: null, scale: 0, scaleSource: '',
    });
    if (r.downscaled) toast(`This picture is very large, so it opened at ${r.W} × ${r.H} pixels.`, { timeout: 6000 });
    return true;
  } finally {
    busy.hide();
    loading = false;
  }
}

// ------------------------------------------------------------------ project files

const round2 = (v) => Math.round(v * 100) / 100;

async function buildProject() {
  const d = S.doc;
  const ids = S.rasterOps.map((o) => o.id);
  const opData = ids.length ? await engine.call('opData', { ids }) : {};
  const srcName = 'source/' + (d.name || 'drawing').replace(/[\\/:*?"<>|]/g, '_');
  const files = {};
  const ops = S.rasterOps.map((o) => ({
    id: o.id, label: o.label,
    parts: (opData[o.id] || []).map((p, k) => {
      const file = `ops/${o.id}-${k}.rle`;
      files[file] = new Uint8Array(p.rle.buffer, p.rle.byteOffset, p.rle.byteLength);
      return { x0: p.x0, y0: p.y0, w: p.w, h: p.h, colors: p.colors, file };
    }),
  }));
  const src = scaleSource();
  // photos of the pins (stored JPEGs, kept as they are)
  const photoIds = [...new Set(S.pins.map((p) => p.photo).filter((id) => id && S.photos.has(id)))];
  for (const id of photoIds) files[`photos/${id}.jpg`] = [S.photos.get(id).bytes, { level: 0 }];
  const meta = {
    format: 'plantint', version: 4, app: 'PlanTint 1.5', saved: new Date().toISOString(),
    source: {
      name: d.name, kind: d.kind, ext: d.ext, file: srcName, pageIndex: d.pageIndex, pageCount: d.pageCount,
      dpi: d.dpi, W: d.W, H: d.H, pageSizePt: d.pageSizePt, physical: d.physical,
    },
    // the scale as PlanTint 1.1 reads it; 1.2 uses calib below
    scale: src === 'none' ? 0 : Math.round(scaleRatio() * 100) / 100, scaleSource: src === 'title' ? 'title' : src === 'none' ? '' : 'user',
    calib: S.calib ? { ...S.calib } : null,
    meas: { ...S.meas },
    markups: S.markups.map((m) => ({
      id: m.id, name: m.name, kind: m.kind, color: m.color, opacity: m.opacity,
      borderPt: m.borderPt, borderColor: m.borderColor, borderStyle: m.borderStyle || 'solid',
      ...(m.cover === false ? { cover: false } : {}),
      rings: m.rings.map((r) => r.map(round2)),
      ...(m.tagAt ? { tagAt: m.tagAt.map(round2) } : {}),
      ...(m.prog ? { prog: { ...m.prog } } : {}),
    })),
    gaps: S.gaps.map((g) => ({ id: g.id, pts: g.pts.map(round2) })),
    dims: S.dims.map((q) => ({ id: q.id, a: q.a.map(round2), b: q.b.map(round2), off: round2(q.off || 0) })),
    legend: S.legend,
    style: S.style,
    fill: S.fill,
    ops,
    // 1.5: the progress map and snag pins
    progress: { ...S.progress },
    pins: S.pins.map((p) => ({
      id: p.id, n: p.n, x: round2(p.x), y: round2(p.y), note: p.note, trade: p.trade, status: p.status,
      photo: p.photo && photoIds.includes(p.photo) ? p.photo : null, raised: p.raised, closed: p.closed,
    })),
    pinNext: S.pinNext,
    photos: photoIds.map((id) => ({ id, file: `photos/${id}.jpg`, w: S.photos.get(id).w, h: S.photos.get(id).h })),
  };
  files['project.json'] = strToU8(JSON.stringify(meta));
  files[srcName] = [d.bytes, { level: 0 }];
  return zipSync(files, { level: 6 });
}

async function openProject(bytes, path, name, restored = false) {
  let files;
  try { files = unzipSync(bytes); } catch { throw new Error('This project file is damaged and cannot be opened.'); }
  if (!files['project.json']) throw new Error('This is not a PlanTint project.');
  const meta = JSON.parse(strFromU8(files['project.json']));
  if (meta.format !== 'plantint') throw new Error('This is not a PlanTint project.');
  const src = meta.source;
  const data = files[src.file];
  if (!data) throw new Error('The drawing inside this project is missing.');
  const ok = src.kind === 'pdf'
    ? await openPdf(data, src.name, null, src.pageIndex, src.dpi)
    : await openImage(data, src.name, null, src.ext, src.pageIndex);
  if (!ok) return;
  loading = true;
  busy.show('Restoring markups');
  try {
    const d = S.doc;
    const sx = d.W / src.W, sy = d.H / src.H;
    const fixRings = (rings) => (sx === 1 && sy === 1 ? rings : rings.map((r) => r.map((v, i) => (i & 1 ? v * sy : v * sx))));
    const ops = [];
    for (const op of meta.ops || []) {
      const parts = op.parts.map((p) => {
        const raw = files[p.file];
        const rle = new Uint32Array(raw.slice().buffer);
        return { x0: p.x0, y0: p.y0, w: p.w, h: p.h, colors: p.colors || [p.color], rle };
      });
      if (sx === 1 && sy === 1 && parts.length) {
        await engine.call('applyOp', { opId: op.id, parts });
        ops.push(Object.freeze({ id: op.id, label: op.label }));
      }
    }
    S.rasterOps = ops;
    const fixPt = (p) => [p[0] * sx, p[1] * sy];
    S.markups = (meta.markups || []).map((m) => Object.freeze({
      id: m.id, name: m.name, kind: m.kind || 'fill', color: m.color, opacity: m.opacity,
      borderPt: m.borderPt || 0, borderColor: m.borderColor || null, borderStyle: isLineStyle(m.borderStyle) ? m.borderStyle : 'solid',
      ...(m.cover === false ? { cover: false } : {}),
      rings: fixRings(m.rings),
      ...(Array.isArray(m.tagAt) && m.tagAt.length === 2 ? { tagAt: fixPt(m.tagAt) } : {}),
      ...(readProg(m.prog) ? { prog: readProg(m.prog) } : {}),
    }));
    // 1.5: the progress map and snag pins with their photos
    S.photos = new Map();
    for (const ph of Array.isArray(meta.photos) ? meta.photos : []) {
      const raw = ph && typeof ph.id === 'string' && files[ph.file];
      if (raw) S.photos.set(ph.id, Object.freeze({ bytes: raw, w: +ph.w || 0, h: +ph.h || 0 }));
    }
    S.pins = (Array.isArray(meta.pins) ? meta.pins : []).map((q) => readPin(q, sx, sy)).filter(Boolean)
      .map((p) => (p.photo && !S.photos.has(p.photo) ? Object.freeze({ ...p, photo: null }) : p));
    S.pinNext = Math.max(1, Number.isFinite(meta.pinNext) ? Math.round(meta.pinNext) : 1, ...S.pins.map((p) => p.n + 1));
    if (meta.progress && typeof meta.progress === 'object') {
      S.progress = Object.freeze({ on: !!meta.progress.on, by: meta.progress.by === 'units' ? 'units' : 'area', labels: meta.progress.labels !== false });
    }
    S.gaps = (meta.gaps || []).map((g) => Object.freeze({ id: g.id, pts: fixRings([g.pts])[0] }));
    S.dims = (meta.dims || []).filter((q) => Array.isArray(q.a) && Array.isArray(q.b)).map((q) => Object.freeze({
      id: String(q.id || '').startsWith('d') ? q.id : 'd' + Math.random().toString(36).slice(2, 10), a: fixPt(q.a), b: fixPt(q.b), off: (+q.off || 0) * sx,
    }));
    if (meta.meas && typeof meta.meas === 'object') {
      const mm = { ...MEAS_DEFAULT, ...meta.meas };
      if (!isLengthUnit(mm.len)) mm.len = MEAS_DEFAULT.len;
      if (!isAreaUnit(mm.area)) mm.area = MEAS_DEFAULT.area;
      S.meas = Object.freeze(mm);
    }
    if (S.gaps.length) await engine.call('setGaps', { lines: S.gaps.map((g) => g.pts) });
    S.legend = meta.legend ? Object.freeze(clampLegendSizes(meta.legend)) : null;
    if (meta.style) S.style = { ...S.style, ...meta.style, borderStyle: isLineStyle(meta.style.borderStyle) ? meta.style.borderStyle : 'solid' };
    if (meta.fill) S.fill = { ...S.fill, ...meta.fill };
    if (meta.version >= 3 && 'calib' in meta) {
      const c = meta.calib;
      S.calib = c && typeof c === 'object' && c.mPerPx >= 0 ? Object.freeze({ ...c, mPerPx: c.mPerPx / sx, ...(c.a ? { a: fixPt(c.a), b: fixPt(c.b) } : {}) }) : null;
    } else if (typeof meta.scale === 'number') {
      // projects from 1.0 and 1.1: a typed scale, or no scale where the title block had one
      if (meta.scaleSource === 'user' && meta.scale > 0 && meta.scale !== d.scale) S.calib = Object.freeze({ kind: 'typed', mPerPx: (meta.scale * 0.0254) / d.dpi, ratio: meta.scale });
      else if (!meta.scale && d.scale) S.calib = Object.freeze({ kind: 'none', mPerPx: 0 });
    }
    d.projectPath = restored ? null : path;
    d.projectName = restored ? null : name;
    resetHistory();
    if (restored) markUnsaved(); else markSaved(true);
    emit('scale');
    emit('style');
    emit('doc');
    emit('docLoaded');
    requestAll();
  } finally {
    busy.hide();
    loading = false;
  }
}

// ------------------------------------------------------------------ export

function exportMarkups() {
  return S.markups.map((m0) => {
    const m = shown(m0); // its status colour on the progress map
    return {
      rings: m.rings,
      color: hexToRgb(m.color),
      opacity: m.opacity,
      borderPx: m.borderPt > 0 ? ptToPx(m.borderPt) : 0,
      borderColor: hexToRgb(borderColorOf(m)),
      borderStyle: m.borderStyle || 'solid',
      bbox: geo(m0).bbox,
    };
  });
}

async function exportImage(type) {
  await syncCovers(); // the engine takes paint out under covering highlights: make sure it has them all
  const legend = await legendPng(1);
  const annots = await annotExport(1);
  annots.over = await pinExport(1);
  return engine.call('exportImage', { type, quality: 0.92, markups: exportMarkups(), legend, annots }, { onProgress: (f, msg) => busy.update(msg, f) });
}

async function exportPdf(flat) {
  await syncCovers();
  const ms = exportMarkups();
  if (!flat) {
    // highlights never stack: each one is hidden where the ones above it (and their borders) are
    let above = null;
    for (let i = ms.length - 1; i >= 0; i--) {
      ms[i].hide = above ? above : [];
      const m = S.markups[i];
      const own = m.borderPt > 0 ? G.offsetRings(m.rings, ptToPx(m.borderPt) / 2) : m.rings;
      above = above ? G.unionMany([above, own]) : G.cleanRings(own);
    }
  }
  const legend = await legendPng(flat ? 1 : 2);
  const annots = await annotExport(flat ? 1 : 3);
  annots.over = await pinExport(flat ? 1 : 3);
  const d = S.doc;
  return engine.call('exportPdf', { mode: flat ? 'flat' : 'vector', markups: ms, legend, annots, title: baseName(d.projectName || d.name) }, { onProgress: (f, msg) => busy.update(msg, f) });
}

// ------------------------------------------------------------------ saving

let saving = false;

async function saveTo(path, type) {
  if (saving) return false;
  saving = true;
  const label = { plantint: 'project', png: 'PNG picture', jpg: 'JPEG picture', pdf: 'PDF', pdfflat: 'flattened PDF', xlsx: 'schedule', csv: 'schedule', progress: 'progress report', snags: 'snag list' }[type];
  const isSchedule = type === 'xlsx' || type === 'csv' || type === 'progress' || type === 'snags';
  busy.show(`Saving the ${label}`, null);
  try {
    let bytes;
    if (type === 'plantint') bytes = await buildProject();
    else if (type === 'png' || type === 'jpg') bytes = await exportImage(type);
    else if (type === 'pdf' || type === 'pdfflat') bytes = await exportPdf(type === 'pdfflat');
    else if (type === 'xlsx') bytes = scheduleXlsx();
    else if (type === 'csv') bytes = scheduleCsv();
    else if (type === 'progress') bytes = progressXlsx();
    else if (type === 'snags') bytes = await snagXlsx();
    else throw new Error('Unknown file type.');
    busy.update('Writing the file', 0.98);
    await window.plantint.writeFile(path, bytes);
    const fname = path.split(/[\\/]/).pop();
    if (type === 'plantint') { S.doc.projectPath = path; S.doc.projectName = fname; }
    // a schedule is a list of numbers, not the marking: it does not count as saving the work
    if (!isSchedule) markSaved(type === 'plantint');
    S.doc.lastSave = { path, type };
    toast(`Saved ${fname}`, { action: 'Show in folder', onAction: () => window.plantint.showInFolder(path), timeout: 5000 });
    if (type === 'plantint') window.plantint.recoveryClear();
    emit('docLoaded');
    return true;
  } catch (err) {
    const msg = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    toast('Could not save. ' + msg, { kind: 'error', timeout: 9000 });
    return false;
  } finally {
    busy.hide();
    saving = false;
  }
}

/** Asks which kind of file, then where to save it. keepWork: asked before closing (no schedules). */
export async function saveAs(presetType, keepWork = false) {
  if (!S.doc) return false;
  const type = presetType || (await chooseSaveType(undefined, keepWork));
  if (!type) return false;
  if ((type === 'xlsx' || type === 'csv') && !hasScale()) {
    toast('A schedule needs the drawing’s scale. Calibrate from a known length (C) or type the scale, then save again.', { timeout: 7000 });
    return false;
  }
  if (type === 'progress' && !S.markups.length) {
    toast('There are no zones yet. Fill or draw the zones, give them a status, then save the progress report.', { timeout: 7000 });
    return false;
  }
  if (type === 'snags' && !S.pins.length) {
    toast('There are no snag pins yet. Drop pins with the Snag pin tool (X), then save the snag list.', { timeout: 7000 });
    return false;
  }
  const t = SAVE_TYPES.find((q) => q.id === type);
  const d = S.doc;
  const dir = d.projectPath ? d.projectPath.replace(/[^\\/]*$/, '') : (d.path ? d.path.replace(/[^\\/]*$/, '') : '');
  let base = baseName(d.projectName || d.name) + (d.pageCount > 1 && !d.projectName ? ` - page ${d.pageIndex + 1}` : '');
  if (type === 'pdfflat') base += ' - flattened';
  if (type === 'xlsx' || type === 'csv') base += ' - schedule';
  if (type === 'progress') base += ' - progress';
  if (type === 'snags') base += ' - snag list';
  const r = await window.plantint.saveDialog({ title: 'Save ' + t.title, defaultPath: dir + base + '.' + t.ext, type });
  if (!r) return false;
  return saveTo(r.path, type);
}

/** Ctrl+S: saves the project in place when it already has a file, otherwise asks. */
export async function save(forceAsk = false) {
  if (!S.doc) return false;
  if (!forceAsk && S.doc.projectPath) return saveTo(S.doc.projectPath, 'plantint');
  return saveAs();
}

// ------------------------------------------------------------------ leaving

async function askSave(action) {
  const st = saveState();
  const name = S.doc.projectName || S.doc.name;
  const text = st === 'picture'
    ? 'The latest marking is saved as a picture or PDF only. Save it as a PlanTint project too, so it stays editable?'
    : 'Your marking will be lost if you don’t save it.';
  return modal({
    title: `Save changes to “${name}” before ${action}?`,
    body: text,
    buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Don’t save', value: 'discard' }, { label: 'Save…', value: 'save', primary: true }],
    cancelValue: 'cancel',
  });
}

export async function confirmDiscard(action) {
  if (!S.doc || saveState() === 'saved') return true;
  const c = await askSave(action);
  // a schedule alone does not keep the marking, so it does not count as saving here
  if (c === 'save') return (await saveAs(null, true)) && saveState() !== 'unsaved';
  return c === 'discard';
}

let closing = false;
export function initCloseFlow() {
  window.plantint.onCloseRequest(async () => {
    window.plantint.closeAck();
    if (closing) return;
    closing = true;
    try {
      if (!S.doc || saveState() === 'saved') {
        await window.plantint.recoveryClear();
        window.plantint.quit();
        return;
      }
      const c = await askSave('closing');
      if (c === 'discard') { await window.plantint.recoveryClear(); window.plantint.quit(); return; }
      if (c === 'save' && (await saveAs(null, true)) && saveState() !== 'unsaved') { await window.plantint.recoveryClear(); window.plantint.quit(); return; }
      // the tab stays open: the question was cancelled
      window.plantint.closeCancel();
    } finally {
      closing = false;
    }
  });
}

// ------------------------------------------------------------------ crash recovery

let recoveryTimer = 0;
let lastRecovery = null;
export function startRecovery(intervalMs = 90000) {
  clearInterval(recoveryTimer);
  recoveryTimer = setInterval(writeRecovery, intervalMs);
}
export async function writeRecovery() {
  if (!S.doc || loading || saving || saveState() === 'saved') return false;
  const key = S.doc.name + '|' + stateId();
  if (lastRecovery === key) return false;
  try {
    const bytes = await buildProject();
    await window.plantint.recoveryWrite(bytes, { name: S.doc.projectName || S.doc.name, time: new Date().toISOString() });
    lastRecovery = key;
    return true;
  } catch { return false; }
}

/** Offers one crash-recovery copy. Returns 'none' (no copy), 'restored' or 'discarded'. */
export async function offerRecovery() {
  const rec = await window.plantint.recoveryRead();
  if (!rec) return 'none';
  const when = new Date(rec.meta.time);
  const c = await modal({
    title: 'Restore unsaved marking?',
    body: `PlanTint closed before “${rec.meta.name}” was saved. A copy from ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} is available.`,
    buttons: [{ label: 'Discard it', value: 'discard' }, { label: 'Restore', value: 'restore', primary: true }],
    cancelValue: 'later', dismissible: false,
  });
  if (c === 'restore') {
    try { await openProject(rec.bytes, null, rec.meta.name, true); } catch (err) { toast('The saved copy could not be restored: ' + err.message, { kind: 'error' }); }
    return 'restored';
  }
  await window.plantint.recoveryClear();
  return 'discarded';
}
