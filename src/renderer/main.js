// PlanTint renderer entry: builds the interface and wires the modules together.

import { S, on, emit, setSelection, loadMeasPrefs } from './state.js';
import * as engine from './engine.js';
import { V, fit, zoomAt, setZoomPercent, zoomPercent } from './view.js';
import { initRender, resize, requestAll, requestUI, setLoupeVisible, T, scheduleSharp } from './render.js';
import { initTools, setTool, TOOL_INFO, hintFor, updateCursor, setLock, deleteSelected, duplicate, markupMenu, clearGaps, resetInteraction, rectWaiting } from './tools.js';
import { initPanel, zoomToIds } from './panel.js';
import { h, icon, initTooltips, showMenu, toast, modalOpen, seg } from './ui.js';
import { undo, redo, canUndo, canRedo, undoLabel, redoLabel, change } from './history.js';
import { initIO, openFromDialog, openFile, save, saveAs, initCloseFlow, startRecovery, offerRecovery, isLoading, confirmDiscard, writeRecovery } from './io.js';
import { detectColours, detectActive, detectApi, showHelp } from './dialogs.js';
import { defaultLegend, legendRect, legendLayout, legendRows } from './legend.js';
import { lengthUnitLabel, scaleSource, fmtScale, hasScale, scaleRatio } from './units.js';
import { setTypedScale, resetScale } from './scale.js';
import * as measure from './measure.js';
import * as annot from './annot.js';
import * as units from './units.js';

const $ = (id) => document.getElementById(id);

const BRAND = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
<rect x="3.5" y="5.5" width="25" height="21" rx="2" fill="#fff" stroke="#2B302D" stroke-width="1.6"/>
<path d="M3.5 15.5H17.5V26.5" fill="none" stroke="#2B302D" stroke-width="1.4"/>
<path d="M4.3 6.3H17.5V15.5H4.3Z" fill="#FFD60A" opacity=".9" style="mix-blend-mode:multiply"/>
<path d="M17.5 15.5H27.7V25.7H17.5Z" fill="#3FA7E0" opacity=".55" style="mix-blend-mode:multiply"/>
<path d="M17.5 5.5V11" stroke="#2B302D" stroke-width="1.4"/>
</svg>`;

// ------------------------------------------------------------------ hooks shared with tools/panel

const hooks = {
  open: () => openFromDialog(),
  save: (ask) => save(ask),
  undo: () => doUndo(),
  redo: () => doRedo(),
  help: () => showHelp(),
  toggleLegend: (force) => toggleLegend(force),
  toggleLoupe: () => toggleLoupe(),
  detect: () => { if (S.doc) detectColours(hooks); },
  blocked: () => isLoading(),
  cursorMoved: () => {},
  detectActive: () => detectActive(),
  detectClick: (x, y, e) => { const a = detectApi(); if (a) a.click(x, y, e); },
  detectHover: (x, y) => { const a = detectApi(); if (a) a.hover(x, y); },
  detectCursor: () => { const a = detectApi(); return a ? a.cursor() : 'default'; },
  detectEscape: () => { const a = detectApi(); if (a) a.escape(); },
};

async function doUndo() {
  if (!canUndo()) { toast('Nothing to undo.'); return; }
  const l = await undo();
  if (l) toast(`Undid: ${l}`, { timeout: 1800 });
  requestAll();
}
async function doRedo() {
  if (!canRedo()) { toast('Nothing to redo.'); return; }
  const l = await redo();
  if (l) toast(`Redid: ${l}`, { timeout: 1800 });
  requestAll();
}

function toggleLegend(force) {
  if (!S.doc) return;
  const show = force !== undefined ? force : !(S.legend && S.legend.visible);
  change(show ? 'Show legend' : 'Hide legend', () => {
    S.legend = Object.freeze(S.legend ? { ...S.legend, visible: show } : defaultLegend());
  });
  if (show) { setTool('select'); setSelection([], true); }
  else if (S.legendSelected) setSelection([...S.selection], false);
  requestAll();
}

function toggleLoupe() {
  S.loupe.on = !S.loupe.on;
  emit('loupe');
  setLoupeVisible(S.loupe.on);
  updateCursor();
  requestAll();
}

// ------------------------------------------------------------------ top bar

function buildTopbar() {
  const bar = $('topbar');
  const openBtn = h('button', { class: 'tb-btn', id: 'btn-open', 'data-tip': 'Open a drawing or project', 'data-key': 'Ctrl+O', onclick: hooks.open });
  openBtn.innerHTML = icon('folder-open', 17) + '<span>Open</span>';
  const saveBtn = h('button', { class: 'tb-btn split-l', id: 'btn-save', 'data-tip': 'Save the project, a PDF or a picture', 'data-key': 'Ctrl+S', onclick: () => save(false) });
  saveBtn.innerHTML = icon('save', 17) + '<span>Save</span>';
  const saveMore = h('button', { class: 'tb-btn split-r', id: 'btn-save-more', 'aria-label': 'More save options', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'Save as… (choose file type)', key: 'Ctrl+Shift+S', icon: 'save', onClick: () => saveAs() },
      'sep',
      { label: 'Save as PDF…', icon: 'file-text', onClick: () => saveAs('pdf') },
      { label: 'Save as flattened PDF…', icon: 'file-image', onClick: () => saveAs('pdfflat') },
      { label: 'Save as PNG picture…', icon: 'image', onClick: () => saveAs('png') },
    ]);
  } });
  saveMore.innerHTML = icon('chevron-down', 14);
  const undoBtn = h('button', { class: 'tb-icon', id: 'btn-undo', 'data-tip': 'Undo', 'data-key': 'Ctrl+Z', onclick: hooks.undo, html: icon('undo-2', 18) });
  const redoBtn = h('button', { class: 'tb-icon', id: 'btn-redo', 'data-tip': 'Redo', 'data-key': 'Ctrl+Y', onclick: hooks.redo, html: icon('redo-2', 18) });
  const zoomOut = h('button', { class: 'tb-icon', 'data-tip': 'Zoom out', 'data-key': '−', onclick: () => { zoomAt(V.cw / 2, V.ch / 2, 0.8); requestAll(); emit('view'); }, html: icon('zoom-out', 18) });
  const zoomIn = h('button', { class: 'tb-icon', 'data-tip': 'Zoom in', 'data-key': '+', onclick: () => { zoomAt(V.cw / 2, V.ch / 2, 1.25); requestAll(); emit('view'); }, html: icon('zoom-in', 18) });
  const pct = h('button', { class: 'zoom-pct', id: 'zoom-pct', 'data-tip': '100% is the sheet at its printed size', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const z = (p) => () => { setZoomPercent(p); requestAll(); emit('view'); };
    showMenu(r.left, r.bottom + 4, [
      { label: 'Fit sheet', key: 'Ctrl+0', icon: 'maximize', onClick: () => { fit(); requestAll(); emit('view'); } },
      'sep',
      { label: '25%', onClick: z(25) }, { label: '50%', onClick: z(50) }, { label: '100% (printed size)', key: 'Ctrl+1', onClick: z(100) },
      { label: '200%', onClick: z(200) }, { label: '400%', onClick: z(400) },
      'sep',
      { label: 'Zoom to selection', icon: 'locate', disabled: !S.selection.size, onClick: () => zoomToIds([...S.selection]) },
    ]);
  } }, '100%');
  const fitBtn = h('button', { class: 'tb-icon', 'data-tip': 'Fit the sheet', 'data-key': 'Ctrl+0', onclick: () => { fit(); requestAll(); emit('view'); }, html: icon('maximize', 18) });
  const helpBtn = h('button', { class: 'tb-icon', 'data-tip': 'Keys and mouse', 'data-key': 'F1', onclick: hooks.help, html: icon('keyboard', 18) });
  bar.append(
    h('div', { class: 'brand', html: BRAND + '<span class="brand-name">PlanTint</span>' }),
    h('div', { class: 'tb-group' }, openBtn, h('div', { class: 'split' }, saveBtn, saveMore)),
    h('div', { class: 'tb-sep' }),
    h('div', { class: 'tb-group' }, undoBtn, redoBtn),
    h('div', { class: 'doc-title', id: 'doc-title' }),
    h('div', { class: 'doc-info', id: 'doc-info' }),
    h('div', { class: 'tb-spacer' }),
    h('div', { class: 'tb-group zoom' }, zoomOut, pct, zoomIn, fitBtn),
    h('div', { class: 'tb-sep' }),
    helpBtn,
    h('div', { class: 'wco-space' }));
  const upd = () => {
    undoBtn.disabled = !canUndo();
    redoBtn.disabled = !canRedo();
    undoBtn.setAttribute('data-tip', canUndo() ? `Undo ${undoLabel().toLowerCase()}` : 'Undo');
    redoBtn.setAttribute('data-tip', canRedo() ? `Redo ${redoLabel().toLowerCase()}` : 'Redo');
    saveBtn.disabled = !S.doc; saveMore.disabled = !S.doc;
  };
  on('history', upd); on('doc', upd); on('docLoaded', upd); upd();
  const updZoom = () => { pct.textContent = S.doc ? Math.round(zoomPercent()) + '%' : '—'; pct.disabled = !S.doc; zoomIn.disabled = zoomOut.disabled = fitBtn.disabled = !S.doc; };
  on('view', updZoom); on('docLoaded', updZoom); updZoom();
}

// ------------------------------------------------------------------ rail

function buildRail() {
  const rail = $('rail');
  const groups = [['select', 'hand'], ['fill', 'polygon', 'rect', 'gap'], ['dim', 'calib'], ['pick', 'erase']];
  const btns = {};
  groups.forEach((g, gi) => {
    if (gi) rail.append(h('div', { class: 'rail-sep' }));
    for (const t of g) {
      const info = TOOL_INFO[t];
      const b = h('button', { class: 'rail-btn', 'data-tool': t, 'data-tip': info.label, 'data-key': info.key, 'aria-label': info.label, onclick: () => setTool(t), html: icon(info.icon, 20) });
      btns[t] = b;
      rail.append(b);
    }
  });
  rail.append(h('div', { class: 'rail-sep' }));
  const loupeBtn = h('button', { class: 'rail-btn toggle', 'data-tip': 'Magnifier', 'data-key': 'M', 'aria-label': 'Magnifier', 'aria-pressed': 'false', onclick: toggleLoupe, html: icon('search', 20) });
  const legendBtn = h('button', { class: 'rail-btn toggle', 'data-tip': 'Legend on sheet', 'data-key': 'L', 'aria-label': 'Legend on sheet', 'aria-pressed': 'false', onclick: () => toggleLegend(), html: icon('table-2', 20) });
  const detectBtn = h('button', { class: 'rail-btn toggle', 'data-tip': 'Find colour already painted in the drawing', 'data-key': 'D', 'aria-label': 'Find painted colour', onclick: hooks.detect, html: icon('swatch-book', 20) });
  rail.append(loupeBtn, legendBtn, detectBtn);
  const upd = () => {
    for (const [t, b] of Object.entries(btns)) { b.classList.toggle('on', S.tool === t && !detectActive()); b.disabled = !S.doc; }
    loupeBtn.classList.toggle('on', S.loupe.on); loupeBtn.setAttribute('aria-pressed', S.loupe.on);
    const lv = !!(S.legend && S.legend.visible);
    legendBtn.classList.toggle('on', lv); legendBtn.setAttribute('aria-pressed', lv);
    detectBtn.classList.toggle('on', detectActive());
    loupeBtn.disabled = legendBtn.disabled = detectBtn.disabled = !S.doc;
  };
  on('tool', upd); on('loupe', upd); on('doc', upd); on('docLoaded', upd); upd();
}

// ------------------------------------------------------------------ status bar + tool options

/** The drawing scale in the status bar: typed 1:n (sheets with a print size) or the calibration. */
function scaleControl() {
  const d = S.doc;
  const src = scaleSource();
  const unit = h('span', { class: 'val unit' }, lengthUnitLabel());
  if (!d.physical) {
    // a picture with no print size: only a calibration gives real sizes
    if (src === 'calib') {
      return h('span', { class: 'opt', 'data-tip': 'Calibrated from a known length. Calibrate again (C) to change it.', 'data-tip-side': 'top' }, h('span', { class: 'opt-note' }, 'Calibrated: ' + fmtScale()), unit);
    }
    return h('span', { class: 'opt' }, h('span', { class: 'opt-note muted', 'data-tip': 'This picture has no print size. Calibrate from a known length to measure real sizes.', 'data-tip-side': 'top' }, 'Sizes in pixels'),
      h('button', { class: 'btn small', 'data-tip': 'Click both ends of a length you know, then type it', 'data-key': 'C', 'data-tip-side': 'top', onclick: () => setTool('calib') }, 'Calibrate'));
  }
  const n = scaleRatio();
  const shown = n > 0 ? (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1)) : '';
  const input = h('input', { class: 'scale-in', type: 'text', inputmode: 'numeric', value: shown, placeholder: 'paper', 'aria-label': 'Drawing scale', spellcheck: 'false' });
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
  input.addEventListener('change', () => {
    const t = String(input.value).trim();
    const v = parseFloat(t.replace(/^1\s*[:\/]\s*/, '').replace(',', '.'));
    if (!t) setTypedScale(0);
    else if (v > 0 && v <= 100000) { if (Math.abs(v - scaleRatio()) > 1e-6) setTypedScale(v); }
    else { toast('Type a scale such as 50 for 1:50.'); input.value = shown; }
    requestAll();
  });
  const tips = {
    title: `Read from the title block (1:${d.scale}). Type another scale, calibrate from a known length (C), or clear it for millimetres on the sheet.`,
    typed: 'The scale you typed. Calibrate from a known length (C) if the print may be scaled.',
    calib: S.calib && S.calib.lengthM ? `Calibrated from a known length (${fmtScale()}). Type a scale to replace it.` : 'Calibrated from a known length.',
    none: 'No scale: sizes are millimetres on the sheet. Type the scale (for example 50) or calibrate from a known length (C).',
  };
  const label = h('label', { class: 'opt', 'data-tip': tips[src], 'data-tip-side': 'top' }, h('span', null, src === 'calib' ? 'Calibrated 1:' : 'Scale 1:'), input, unit);
  if (src === 'title' || src === 'none') return label;
  return h('span', { class: 'opt' }, label, h('button', { class: 'link-btn', 'data-tip': d.scale ? `Back to the title block scale (1:${d.scale})` : 'Back to sizes on the sheet', 'data-tip-side': 'top', onclick: () => { resetScale(); requestAll(); } }, 'Reset'));
}

function buildStatus() {
  const hint = $('hint'), opts = $('tool-options'), info = $('doc-info');
  const render = () => {
    let text = S.doc ? hintFor(S.tool) : 'Open a PDF or a picture of a drawing to start.';
    if (S.doc && S.tool === 'rect' && rectWaiting()) text = 'Move to the opposite corner and click, or type the width (Tab for the height, Enter to finish). Esc cancels.';
    if (S.doc && S.tool === 'dim' && T.dim) text = T.dim.phase === 'b' ? 'Click the second point. Shift keeps it horizontal or vertical; Ctrl places it freely.' : 'Move to where the dimension line goes and click (Enter keeps it on the points). Backspace goes back.';
    if (S.doc && S.tool === 'calib' && T.calibLine) text = 'Click the other end of the length you know.';
    if (detectActive()) text = 'Painted colour: click outlined areas to leave them out or add them back. Esc closes.';
    hint.textContent = text;
    hint.title = text;
    opts.innerHTML = '';
    if (!S.doc) { info.innerHTML = ''; return; }
    const t = S.tool;
    if (t === 'fill') {
      const tol = h('input', { type: 'range', min: 5, max: 60, step: 1, value: S.fill.tol, 'aria-label': 'Colour tolerance' });
      const tv = h('span', { class: 'val' }, S.fill.tol + '%');
      tol.addEventListener('input', () => { S.fill.tol = +tol.value; tv.textContent = tol.value + '%'; });
      opts.append(
        h('label', { class: 'opt', 'data-tip': 'How different a pixel may be from the clicked paper and still be filled', 'data-tip-side': 'top' }, h('span', null, 'Tolerance'), tol, tv),
        h('div', { class: 'opt' }, h('span', null, 'Close gaps'), seg([[0, 'Off'], [1, 'Small', 'Bridges dashed door swings and hairline gaps'], [2, 'Medium'], [3, 'Large', 'Bridges gaps up to about 1.4 mm on paper']], S.fill.gaps, (v) => { S.fill.gaps = v; render(); })),
        h('label', { class: 'check', 'data-tip': 'Fill under furniture, fittings, symbols and room labels as well', 'data-tip-side': 'top' }, h('input', { type: 'checkbox', checked: S.fill.cover, onchange: (e) => { S.fill.cover = e.target.checked; } }), h('span', null, 'Cover furniture')),
        h('label', { class: 'check' + (S.doc.text && S.doc.text.length ? '' : ' disabled'), 'data-tip': S.doc.text && S.doc.text.length ? 'Name each new markup from the room label inside it' : 'This drawing has no readable text, so markups are numbered', 'data-tip-side': 'top' }, h('input', { type: 'checkbox', checked: S.fill.autoName, disabled: !(S.doc.text && S.doc.text.length), onchange: (e) => { S.fill.autoName = e.target.checked; } }), h('span', null, 'Use labels as names')));
    } else if (t === 'polygon') {
      const cur = S.lock.once || S.lock.mode;
      opts.append(h('div', { class: 'opt' }, h('span', null, 'Next edge'), seg([
        ['free', 'Free', 'Any direction', 'N'], ['h', 'Horizontal', 'Lock the next edge horizontal', 'H'], ['v', 'Vertical', 'Lock the next edge vertical', 'V'],
        ['perp', '90° to an edge', 'Lock at 90° to the last edge. Press A again for an earlier edge, or Alt+click another markup’s edge', 'A'],
        ['ortho', 'Ortho', 'Keep every edge horizontal or vertical', 'F8'],
      ], cur, (v) => setLock(v))));
      if (S.lock.mode === 'perp') opts.append(h('span', { class: 'opt-note' }, S.lock.extRef ? 'Following a picked edge' : (S.lock.refIdx >= 0 ? `Following edge ${S.lock.refIdx + 1}` : 'Following the last edge')));
      opts.append(snapToggle(), scaleControl());
    } else if (t === 'rect') {
      opts.append(snapToggle(), scaleControl());
    } else if (t === 'dim') {
      opts.append(snapToggle(), scaleControl());
      if (!S.meas.dims) opts.append(h('span', { class: 'opt-note' }, 'Dimensions are hidden; a new one shows them again'));
    } else if (t === 'calib') {
      opts.append(snapToggle(), scaleControl());
    } else if (t === 'gap') {
      opts.append(
        snapToggle(),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.showGaps, onchange: (e) => { S.showGaps = e.target.checked; requestAll(); } }), h('span', null, 'Show gap lines')),
        h('button', { class: 'btn small', disabled: !S.gaps.length, onclick: () => clearGaps() }, S.gaps.length ? `Remove all ${S.gaps.length}` : 'No gap lines yet'));
    } else if (t === 'erase') {
      const sz = h('input', { type: 'range', min: 6, max: 240, step: 1, value: S.eraser.size, 'aria-label': 'Eraser size' });
      const sv = h('span', { class: 'val' }, S.eraser.size + ' px');
      sz.addEventListener('input', () => { S.eraser.size = +sz.value; sv.textContent = sz.value + ' px'; });
      opts.append(
        h('div', { class: 'opt' }, h('span', null, 'Erase'), seg([
          ['both', 'Both', 'Highlights and colour painted in the drawing'],
          ['highlights', 'Highlights', 'Only the highlights you added'],
          ['drawing', 'Drawing colour', 'Only colour that was already in the imported drawing'],
        ], S.eraser.mode, (v) => { S.eraser.mode = v; render(); })),
        h('label', { class: 'opt' }, h('span', null, 'Size'), sz, sv));
      if (S.selection.size) opts.append(h('span', { class: 'opt-note' }, `Erasing only the ${S.selection.size} selected`));
    }
    if (S.loupe.on) {
      opts.append(h('div', { class: 'opt' }, h('span', null, 'Magnifier'), seg([[2, '2×'], [3, '3×'], [4, '4×'], [6, '6×'], [8, '8×']], S.loupe.power, (v) => { S.loupe.power = v; emit('loupe'); requestUI(); })));
    }
    const d = S.doc;
    info.innerHTML = '';
    if (d.kind === 'pdf') {
      const mmw = Math.round((d.pageSizePt[0] / 72) * 25.4), mmh = Math.round((d.pageSizePt[1] / 72) * 25.4);
      info.append(h('span', { class: 'pill', 'data-tip': 'Sheet size', 'data-tip-side': 'bottom' }, `${d.sheet ? d.sheet + ' ' : ''}${mmw} × ${mmh} mm`));
      info.append(h('span', { class: 'pill', 'data-tip': `Opened at ${d.dpi} dpi (${d.W} × ${d.H} pixels)`, 'data-tip-side': 'bottom' }, `${d.dpi} dpi`));
      const src = scaleSource();
      if (src !== 'none') info.append(h('span', { class: 'pill', 'data-tip': { title: 'Scale read from the title block', typed: 'Scale you typed', calib: 'Scale calibrated from a known length' }[src], 'data-tip-side': 'bottom' }, fmtScale()));
    } else {
      info.append(h('span', { class: 'pill', 'data-tip': 'Picture size', 'data-tip-side': 'bottom' }, `${d.W} × ${d.H} px`));
      info.append(h('span', { class: 'pill', 'data-tip': d.physical ? 'Resolution stored in the picture' : 'The picture has no resolution; sizes assume 150 dpi', 'data-tip-side': 'bottom' }, d.physical ? `${d.dpi} dpi` : '150 dpi assumed'));
      if (hasScale()) info.append(h('span', { class: 'pill', 'data-tip': 'Scale calibrated from a known length', 'data-tip-side': 'bottom' }, fmtScale()));
    }
  };
  const snapToggle = () => h('label', { class: 'check', 'data-tip': 'Corners snap to the faces of walls and lines in the drawing. Hold Ctrl to place freely.', 'data-tip-side': 'top' },
    h('input', { type: 'checkbox', checked: S.snapDrawing, onchange: (e) => { S.snapDrawing = e.target.checked; } }), h('span', null, 'Snap to lines'));
  ['tool', 'lock', 'loupe', 'docLoaded', 'selection', 'rect', 'scale', 'dimstep'].forEach((e) => on(e, render));
  on('doc', () => { if (S.tool === 'gap' || S.tool === 'dim' || S.tool === 'calib' || S.tool === 'polygon' || S.tool === 'rect') render(); });
  render();
}

// ------------------------------------------------------------------ empty state

function buildEmpty() {
  const el = $('empty');
  const openBtn = h('button', { class: 'btn primary big', onclick: hooks.open });
  openBtn.innerHTML = icon('folder-open', 18) + '<span>Open a drawing</span>';
  el.append(h('div', { class: 'empty-card' },
    h('div', { class: 'empty-mark', html: BRAND.replace('width="22" height="22"', 'width="56" height="56"') }),
    h('h1', null, 'Highlight a drawing'),
    h('p', { class: 'empty-sub' }, 'Open a PDF or a picture of a plan, then colour its rooms and zones.'),
    openBtn,
    h('p', { class: 'empty-drop' }, 'Or drop the file anywhere in this window.'),
    h('ol', { class: 'steps' },
      h('li', null, h('strong', null, 'Open'), ' a PDF, PNG, JPEG or TIFF. Multi-page files ask which page.'),
      h('li', null, h('strong', null, 'Fill'), ' rooms with one click, or draw polygons and rectangles. Each one gets a name.'),
      h('li', null, h('strong', null, 'Measure'), ' areas, perimeters and dimensions (K) at the drawing’s scale, or calibrate it from a length you know (C).'),
      h('li', null, h('strong', null, 'Save'), ' with the legend as a PDF, a picture, or a project to edit later.')),
    h('p', { class: 'empty-formats' }, 'Ctrl+O to open, F1 for every key.')));
  const upd = () => { el.hidden = !!S.doc; };
  on('docLoaded', upd);
  upd();
}

// ------------------------------------------------------------------ drag and drop

function initDrop() {
  const veil = h('div', { class: 'drop-veil' }, h('div', null, 'Drop to open'));
  document.body.append(veil);
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; veil.classList.add('show'); e.preventDefault(); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) veil.classList.remove('show'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    veil.classList.remove('show');
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f || modalOpen()) return;
    if (!(await confirmDiscard('opening another drawing'))) return;
    const p = window.plantint.pathForFile(f);
    const bytes = new Uint8Array(await f.arrayBuffer());
    openFile({ path: p || null, name: f.name, bytes }, true);
  });
}

// ------------------------------------------------------------------ start

async function start() {
  S.meas = loadMeasPrefs();
  engine.startEngine();
  initTooltips();
  buildTopbar();
  buildRail();
  buildStatus();
  buildEmpty();
  initRender($('scene'), $('ui'), $('loupe'));
  initPanel($('panel'), {
    setTool, toggleLegend, deleteSelected, duplicate, zoomTo: zoomToIds, requestUI,
    markupMenu: (x, y, id) => markupMenu(x, y, id),
    saveAs: (t) => saveAs(t), undo: () => hooks.undo(),
  });
  initTools($('ui'), hooks);
  initIO();
  initCloseFlow();
  initDrop();
  window.plantint.onOpenFile(async (p) => {
    try { const f = await window.plantint.readFile(p); openFile(f); } catch (err) { toast('Could not open the file: ' + err.message, { kind: 'error' }); }
  });
  let first = true;
  const ro = new ResizeObserver(() => {
    const keepFit = S.doc && first;
    resize();
    if (keepFit) { fit(); first = false; }
    emit('view');
  });
  ro.observe($('canvas-wrap'));
  window.addEventListener('resize', () => { if (Math.abs((window.devicePixelRatio || 1) - V.dpr) > 0.001) { resize(); emit('view'); } });
  on('docLoaded', () => { first = false; requestAll(); });
  on('docLoaded', resetInteraction);
  on('view', scheduleSharp);
  on('docLoaded', scheduleSharp);
  try {
    await Promise.all([
      document.fonts.load('500 16px "IBM Plex Sans"'), document.fonts.load('600 16px "IBM Plex Sans"'),
      document.fonts.load('400 16px "IBM Plex Sans"'), document.fonts.load('500 16px "IBM Plex Sans Arabic"', 'م'),
    ]);
  } catch { /* fonts are optional */ }
  requestAll();
  const restored = await offerRecovery();
  if (!restored) {
    const f = await window.plantint.startupFile();
    if (f) openFile(f, true);
  }
  startRecovery();
  window.__plantint = { S, V, T, hooks, setTool, fit, emit, engine, legendRect, writeRecovery, measure, annot, units, legend: { legendLayout, legendRows, legendRect } }; // used by the automated tests
}

start();
