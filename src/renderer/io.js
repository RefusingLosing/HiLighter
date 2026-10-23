// Opening drawings and projects, saving, exporting, the exit question and crash recovery.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { S, emit, on, ptToPx } from './state.js';
import * as engine from './engine.js';
import { resetTiles, requestAll, geo } from './render.js';
import { fit } from './view.js';
import { resetHistory, saveState, markSaved, markUnsaved, stateId } from './history.js';
import { busy, toast, modal, h } from './ui.js';
import { pickPage, sheetName, chooseSaveType, SAVE_TYPES } from './dialogs.js';
import { legendPng, clampLegendSizes } from './legend.js';
import { hexToRgb, borderColorOf } from './colors.js';
import { isLineStyle } from '../shared/linestyle.js';
import { detectScale } from './units.js';
import * as G from './geom.js';

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
  if (!d) { window.plantint.setTitle('PlanTint'); if (el) el.innerHTML = ''; return; }
  const st = saveState();
  const page = d.pageCount > 1 ? `page ${d.pageIndex + 1} of ${d.pageCount}` : '';
  const name = d.projectName || d.name;
  window.plantint.setTitle(`${st === 'saved' ? '' : '• '}${name} — PlanTint`);
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

export async function openFromDialog() {
  if (loading) return;
  if (!(await confirmDiscard('opening another drawing'))) return;
  const f = await window.plantint.openDialog();
  if (f) await openFile(f, true);
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
  S.legend = null;
  S.rasterOps = [];
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
  const meta = {
    format: 'plantint', version: 2, app: 'PlanTint 1.1', saved: new Date().toISOString(),
    source: {
      name: d.name, kind: d.kind, ext: d.ext, file: srcName, pageIndex: d.pageIndex, pageCount: d.pageCount,
      dpi: d.dpi, W: d.W, H: d.H, pageSizePt: d.pageSizePt, physical: d.physical,
    },
    scale: d.scale || 0, scaleSource: d.scaleSource || '',
    markups: S.markups.map((m) => ({
      id: m.id, name: m.name, kind: m.kind, color: m.color, opacity: m.opacity,
      borderPt: m.borderPt, borderColor: m.borderColor, borderStyle: m.borderStyle || 'solid',
      rings: m.rings.map((r) => r.map(round2)),
    })),
    gaps: S.gaps.map((g) => ({ id: g.id, pts: g.pts.map(round2) })),
    legend: S.legend,
    style: S.style,
    fill: S.fill,
    ops,
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
    S.markups = (meta.markups || []).map((m) => Object.freeze({
      id: m.id, name: m.name, kind: m.kind || 'fill', color: m.color, opacity: m.opacity,
      borderPt: m.borderPt || 0, borderColor: m.borderColor || null, borderStyle: isLineStyle(m.borderStyle) ? m.borderStyle : 'solid',
      rings: fixRings(m.rings),
    }));
    S.gaps = (meta.gaps || []).map((g) => Object.freeze({ id: g.id, pts: fixRings([g.pts])[0] }));
    if (S.gaps.length) await engine.call('setGaps', { lines: S.gaps.map((g) => g.pts) });
    S.legend = meta.legend ? Object.freeze(clampLegendSizes(meta.legend)) : null;
    if (meta.style) S.style = { ...S.style, ...meta.style, borderStyle: isLineStyle(meta.style.borderStyle) ? meta.style.borderStyle : 'solid' };
    if (meta.fill) S.fill = { ...S.fill, ...meta.fill };
    if (typeof meta.scale === 'number') { d.scale = meta.scale; d.scaleSource = meta.scaleSource || (meta.scale ? 'user' : ''); }
    d.projectPath = restored ? null : path;
    d.projectName = restored ? null : name;
    resetHistory();
    if (restored) markUnsaved(); else markSaved(true);
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
  return S.markups.map((m) => ({
    rings: m.rings,
    color: hexToRgb(m.color),
    opacity: m.opacity,
    borderPx: m.borderPt > 0 ? ptToPx(m.borderPt) : 0,
    borderColor: hexToRgb(borderColorOf(m)),
    borderStyle: m.borderStyle || 'solid',
    bbox: geo(m).bbox,
  }));
}

async function exportImage(type) {
  const legend = await legendPng(1);
  return engine.call('exportImage', { type, quality: 0.92, markups: exportMarkups(), legend }, { onProgress: (f, msg) => busy.update(msg, f) });
}

async function exportPdf(flat) {
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
  const d = S.doc;
  return engine.call('exportPdf', { mode: flat ? 'flat' : 'vector', markups: ms, legend, title: baseName(d.projectName || d.name) }, { onProgress: (f, msg) => busy.update(msg, f) });
}

// ------------------------------------------------------------------ saving

let saving = false;

async function saveTo(path, type) {
  if (saving) return false;
  saving = true;
  const label = { plantint: 'project', png: 'PNG picture', jpg: 'JPEG picture', pdf: 'PDF', pdfflat: 'flattened PDF' }[type];
  busy.show(`Saving the ${label}`, null);
  try {
    let bytes;
    if (type === 'plantint') bytes = await buildProject();
    else if (type === 'png' || type === 'jpg') bytes = await exportImage(type);
    else if (type === 'pdf' || type === 'pdfflat') bytes = await exportPdf(type === 'pdfflat');
    else throw new Error('Unknown file type.');
    busy.update('Writing the file', 0.98);
    await window.plantint.writeFile(path, bytes);
    const fname = path.split(/[\\/]/).pop();
    if (type === 'plantint') { S.doc.projectPath = path; S.doc.projectName = fname; }
    markSaved(type === 'plantint');
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

/** Asks which kind of file, then where to save it. */
export async function saveAs(presetType) {
  if (!S.doc) return false;
  const type = presetType || (await chooseSaveType());
  if (!type) return false;
  const t = SAVE_TYPES.find((q) => q.id === type);
  const d = S.doc;
  const dir = d.projectPath ? d.projectPath.replace(/[^\\/]*$/, '') : (d.path ? d.path.replace(/[^\\/]*$/, '') : '');
  let base = baseName(d.projectName || d.name) + (d.pageCount > 1 && !d.projectName ? ` - page ${d.pageIndex + 1}` : '');
  if (type === 'pdfflat') base += ' - flattened';
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
  if (c === 'save') return saveAs();
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
      if (c === 'discard') { await window.plantint.recoveryClear(); window.plantint.quit(); }
      else if (c === 'save') { if (await saveAs()) { await window.plantint.recoveryClear(); window.plantint.quit(); } }
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

export async function offerRecovery() {
  const rec = await window.plantint.recoveryRead();
  if (!rec) return false;
  const when = new Date(rec.meta.time);
  const c = await modal({
    title: 'Restore unsaved marking?',
    body: `PlanTint closed before “${rec.meta.name}” was saved. A copy from ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} is available.`,
    buttons: [{ label: 'Discard it', value: 'discard' }, { label: 'Restore', value: 'restore', primary: true }],
    cancelValue: 'later', dismissible: false,
  });
  if (c === 'restore') {
    try { await openProject(rec.bytes, null, rec.meta.name, true); } catch (err) { toast('The saved copy could not be restored: ' + err.message, { kind: 'error' }); }
    return true;
  }
  await window.plantint.recoveryClear();
  return false;
}
