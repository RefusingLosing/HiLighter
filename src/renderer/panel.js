// Side panel: style (colour, opacity, border thickness, line style, border colour) for the
// selection or the next markup, the legend controls, and the markup list (the only part of
// the panel that scrolls).

import { S, on, emit, withProps, selectedMarkups, setSelection, pxToPt, setMeas } from './state.js';
import { h, icon, toast, showMenu, scrollWithin } from './ui.js';
import { measureAt, totals } from './measure.js';
import {
  LENGTH_UNITS, AREA_UNITS, hasScale, areaLabel, lengthLabel, fmtScale, scaleSource, lengthUnitLabel,
} from './units.js';
import { resetScale } from './scale.js';
import { PALETTE, normalizeHex, tintOnPaper, borderColorOf, autoBorder } from './colors.js';
import { change, commit, snapshot } from './history.js';
import { legendLimits, clampLegendSizes, bestLegendSpot } from './legend.js';
import { requestScene, T, geo } from './render.js';
import { zoomToRect, V, clampPan, minScale } from './view.js';
import { LINE_STYLES, dashFor } from '../shared/linestyle.js';
import { progressOn, progLabel, shown } from './progress.js';
import { buildProgress } from './progresspanel.js';
import { buildSnags, buildPinCard, flushEdits } from './snagpanel.js';
import { pinSize } from './pins.js';

let els = {};
let actions = {}; // provided by main: { setTool, toggleLegend, deleteSelected, duplicate, zoomTo, requestUI, markupMenu }

// ------------------------------------------------------------------ helpers

const target = () => (S.selection.size ? selectedMarkups() : null);

function current() {
  const t = target();
  if (t && t.length) return { color: t[0].color, opacity: t[0].opacity, borderPt: t[0].borderPt, borderColor: t[0].borderColor, borderStyle: t[0].borderStyle || 'solid', cover: t[0].cover !== false };
  return { ...S.style, cover: S.style.cover !== false };
}

function sameAll(key) {
  const t = target();
  if (!t || t.length < 2) return true;
  return t.every((m) => (m[key] || null) === (t[0][key] || null));
}

let txn = null;
// with the progress map on, the sheet shows status colours: say so once when a colour is changed
let progressHinted = false;
function progressHint(props) {
  if (progressHinted || !progressOn() || !['color', 'opacity', 'borderColor'].some((k) => k in props)) return;
  progressHinted = true;
  toast('The progress map is on, so the sheet shows each zone’s status colour. Your colours come back when you turn it off.', { timeout: 6000 });
}

function liveApply(label, props) {
  progressHint(props);
  const t = target();
  if (t && t.length) {
    if (!txn) txn = { label, before: snapshot() };
    const ids = S.selection;
    S.markups = S.markups.map((m) => (ids.has(m.id) ? withProps(m, props) : m));
    emit('doc');
  } else {
    S.style = { ...S.style, ...props };
    emit('style');
  }
}
function endLive() {
  if (txn) { const t = txn; txn = null; commit(t.label, t.before); }
}

export function applyStyle(label, props) {
  progressHint(props);
  const t = target();
  if (t && t.length) {
    change(label, () => {
      const ids = S.selection;
      S.markups = S.markups.map((m) => (ids.has(m.id) ? withProps(m, props) : m));
    });
  } else {
    S.style = { ...S.style, ...props };
    emit('style');
  }
}

/** Sets the border line style. A style needs a visible border, so borderless markups get 1.5 pt. */
export function applyLineStyle(style) {
  const t = target();
  if (t && t.length) {
    change('Change border style', () => {
      const ids = S.selection;
      S.markups = S.markups.map((m) => (ids.has(m.id) ? withProps(m, m.borderPt > 0 ? { borderStyle: style } : { borderStyle: style, borderPt: 1.5 }) : m));
    });
  } else {
    S.style = { ...S.style, borderStyle: style, borderPt: S.style.borderPt > 0 ? S.style.borderPt : 1.5 };
    emit('style');
  }
}

/** A short line drawn in a given style, for buttons and swatches. */
export function linePreview(style, w = 26, hgt = 10, sw = 2) {
  const ls = dashFor(style, sw, sw);
  const dash = ls.dash.length ? `stroke-dasharray="${ls.dash.join(' ')}"` : '';
  return `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" aria-hidden="true"><line x1="1" y1="${hgt / 2}" x2="${w - 1}" y2="${hgt / 2}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="${ls.cap}" ${dash}/></svg>`;
}

// ------------------------------------------------------------------ build

export function initPanel(root, acts) {
  actions = acts;
  const head = h('div', { class: 'sc-head' },
    h('span', { class: 'sc-target', id: 'sc-target' }, 'Next markup'),
    h('span', { class: 'sc-scope', id: 'sc-scope' }));
  const chip = h('div', { class: 'chip', id: 'chip' },
    h('div', { class: 'chip-plan', html: PLAN_SVG }),
    h('div', { class: 'chip-tint', id: 'chip-tint' }),
    h('div', { class: 'chip-border', id: 'chip-border' }),
    h('div', { class: 'chip-meta' }, h('span', { id: 'chip-hex' }), h('span', { id: 'chip-op' })));
  const pal = h('div', { class: 'palette', role: 'listbox', 'aria-label': 'Colours' });
  for (const p of PALETTE) {
    const b = h('button', { class: 'sw', 'data-hex': p.hex, 'data-tip': p.name, 'data-tip-side': 'top', style: { background: p.hex }, onclick: () => applyStyle('Change colour', { color: p.hex }) });
    pal.append(b);
  }
  const colorInput = h('input', { type: 'color', class: 'hidden-color', id: 'custom-color' });
  colorInput.addEventListener('input', () => liveApply('Change colour', { color: colorInput.value.toUpperCase() }));
  colorInput.addEventListener('change', () => endLive());
  const hexInput = h('input', { class: 'hex', id: 'hex-input', spellcheck: 'false', maxlength: 7, 'aria-label': 'Colour code' });
  hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexInput.blur(); e.stopPropagation(); });
  hexInput.addEventListener('change', () => {
    const v = normalizeHex(hexInput.value);
    if (v) applyStyle('Change colour', { color: v }); else { toast('Type a colour code like #FFD60A.'); refreshStyle(); }
  });
  const customBtn = h('button', { class: 'tool-mini', 'data-tip': 'Any colour', 'data-tip-side': 'top', onclick: () => colorInput.click(), html: icon('plus', 16) });
  const pickBtn = h('button', { class: 'tool-mini', 'data-tip': 'Pick a colour from the sheet', 'data-key': 'I', 'data-tip-side': 'top', onclick: () => actions.setTool('pick'), html: icon('pipette', 16) });
  const colorRow = h('div', { class: 'color-row' }, hexInput, customBtn, pickBtn, colorInput);

  const opRange = h('input', { type: 'range', min: 0, max: 100, step: 1, id: 'op-range', 'aria-label': 'Opacity' });
  const opVal = h('span', { class: 'val', id: 'op-val' });
  opRange.addEventListener('input', () => { liveApply('Change opacity', { opacity: +opRange.value / 100 }); opVal.textContent = opRange.value + '%'; });
  opRange.addEventListener('change', endLive);

  const bdRange = h('input', { type: 'range', min: 0, max: 8, step: 0.25, id: 'bd-range', 'aria-label': 'Border thickness' });
  const bdVal = h('span', { class: 'val', id: 'bd-val' });
  bdRange.addEventListener('input', () => { liveApply('Change border', { borderPt: +bdRange.value }); bdVal.textContent = fmtPt(+bdRange.value); });
  bdRange.addEventListener('change', endLive);

  const styleSegs = h('div', { class: 'segs line-segs', id: 'line-segs', role: 'radiogroup', 'aria-label': 'Border line style' });
  for (const ls of LINE_STYLES) {
    const b = h('button', { class: 'seg seg-line', 'data-style': ls.id, 'data-tip': ls.label, 'data-tip-side': 'top', role: 'radio', 'aria-label': ls.label, html: linePreview(ls.id) });
    b.addEventListener('click', () => applyLineStyle(ls.id));
    styleSegs.append(b);
  }

  const bdColorInput = h('input', { type: 'color', class: 'hidden-color' });
  bdColorInput.addEventListener('input', () => liveApply('Change border colour', { borderColor: bdColorInput.value.toUpperCase() }));
  bdColorInput.addEventListener('change', endLive);
  const bdAuto = h('button', { class: 'seg', id: 'bd-auto', 'data-tip': 'A deeper shade of the fill colour', 'data-tip-side': 'top', onclick: () => applyStyle('Change border colour', { borderColor: null }) }, 'Auto');
  const bdSwatch = h('button', { class: 'seg seg-sw', id: 'bd-sw', 'data-tip': 'Choose the border colour', 'data-tip-side': 'top', onclick: () => { bdColorInput.value = borderColorOf(current()); bdColorInput.click(); } }, h('span', { class: 'mini-sw', id: 'bd-sw-dot' }));

  // on a drawing that is already coloured, the highlight replaces that colour (lines and text stay)
  const coverInput = h('input', { type: 'checkbox', id: 'cover-check', onchange: (e) => applyStyle(e.target.checked ? 'Cover colour under highlight' : 'Tint colour under highlight', { cover: e.target.checked }) });
  const coverCheck = h('label', { class: 'check', 'data-tip': 'Takes out colour already painted on the drawing under the highlight, so it shows its own colour. Lines and text stay. Off: the highlight tints that colour, like a highlighter pen.', 'data-tip-side': 'top' },
    coverInput, h('span', null, 'Cover colour already on the drawing'));

  const card = h('section', { class: 'style-card' },
    head, chip, pal, colorRow,
    h('div', { class: 'field' }, h('label', { for: 'op-range' }, 'Opacity'), opRange, opVal),
    h('div', { class: 'field' }, h('label', { for: 'bd-range' }, 'Border'), bdRange, bdVal),
    h('div', { class: 'field field-line' }, h('span', { class: 'sub-label' }, 'Line'), styleSegs),
    h('div', { class: 'field field-sub' }, h('span', { class: 'sub-label' }, 'Border colour'), h('div', { class: 'segs' }, bdAuto, bdSwatch), bdColorInput),
    h('div', { class: 'field field-cover' }, coverCheck));

  // ---- legend section
  const legSwitch = h('button', { class: 'switch', id: 'leg-switch', role: 'switch', 'aria-checked': 'false', onclick: () => actions.toggleLegend() }, h('span', { class: 'knob' }));
  const legHead = h('div', { class: 'sec-head' }, h('span', { class: 'sec-title' }, 'Legend on sheet'), legSwitch);
  const stepper = (id, label, key) => {
    const val = h('span', { class: 'step-val', id }, '');
    const minus = h('button', { class: 'step-btn', 'aria-label': 'Smaller ' + label, onclick: () => stepLegend(key, -1), html: icon('minus', 14) });
    const plus = h('button', { class: 'step-btn', 'aria-label': 'Larger ' + label, onclick: () => stepLegend(key, +1), html: icon('plus', 14) });
    return h('div', { class: 'stepper' }, h('span', { class: 'step-label' }, label), minus, val, plus);
  };
  const merge = h('label', { class: 'check', 'data-tip': 'Markups with the same name and colour share one row' }, h('input', { type: 'checkbox', id: 'leg-merge', onchange: (e) => setLegend('Change legend', { merge: e.target.checked }) }), h('span', null, 'Merge repeated rows'));
  const legBody = h('div', { class: 'leg-body', id: 'leg-body' },
    h('div', { class: 'steppers' }, stepper('leg-title', 'Column titles', 'titlePx'), stepper('leg-name', 'Names', 'namePx')),
    h('div', { class: 'leg-foot' }, merge, h('button', { class: 'link-btn', 'data-tip': 'Move the legend to the emptiest part of the sheet', onclick: () => resetLegendPlace() }, 'Move to a clear spot')),
    h('p', { class: 'leg-note', id: 'leg-note' }));
  const legSec = h('section', { class: 'leg-sec' }, legHead, legBody);

  // ---- list
  const listHead = h('div', { class: 'list-head' },
    h('span', { class: 'sec-title' }, 'Markups'), h('span', { class: 'count', id: 'list-count' }, '0'),
    h('span', { class: 'flex' }),
    h('span', { class: 'list-total', id: 'list-total', 'data-tip': 'Total of all markups (visible parts)', 'data-tip-side': 'top' }),
    h('button', { class: 'tool-mini', id: 'mk-window', 'data-tip': 'All markups in a larger window: find, select, rename, recolour and set their status', onclick: () => actions.openMarkups(), html: icon('square-arrow-out-up-right', 16) }));
  const list = h('div', { class: 'mk-list', id: 'mk-list', role: 'listbox', 'aria-multiselectable': 'true', tabindex: '0' });
  const empty = h('div', { class: 'mk-empty', id: 'mk-empty' }, 'Fill an area or draw a polygon. Each markup appears here with its name.');
  const listSec = h('section', { class: 'list-sec' }, listHead, h('div', { class: 'mk-scroll' }, list, empty));

  const measSec = buildMeasure();
  // the sections between the style card and the markup list scroll when they do not fit, so the card
  // on top (style or snag pin) always shows and the list keeps its room
  const mid = h('div', { class: 'panel-mid', id: 'panel-mid' }, legSec, measSec, buildProgress(actions), buildSnags(actions));
  root.append(buildPinCard(actions), card, mid, listSec);
  els = { opRange, opVal, bdRange, bdVal, hexInput, pal, list, empty, legSwitch, legBody, legSec, styleSegs, coverInput };

  list.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'F2') { e.preventDefault(); const s = selectedMarkups(); if (s.length === 1) startRename(s[0].id); }
  });

  on('selection', () => { refreshStyle(); refreshList(); });
  on('doc', () => { refreshStyle(); refreshList(); refreshLegend(); refreshMeasure(); });
  on('scale', () => { refreshStyle(); refreshList(); refreshMeasure(); });
  on('docLoaded', refreshMeasure);
  on('style', refreshStyle);
  refreshStyle(); refreshList(); refreshLegend(); refreshMeasure();
}

// ------------------------------------------------------------------ measurements

const DECIMALS = [['auto', 'Auto'], [0, '0'], [1, '0.0'], [2, '0.00'], [3, '0.000']];
const FTIN_STEPS = [['auto', 'Auto'], [0, '1"'], [1, '1/2"'], [2, '1/4"'], [3, '1/8"'], [4, '1/16"']];
// open unless closed before; on short screens it starts closed so the markup list keeps its room
let measOpen = window.innerHeight >= 860;
try { const v = localStorage.getItem('plantint.measOpen'); if (v !== null) measOpen = v !== '0'; } catch { /* storage is optional */ }
let mEls = {};

function setMeasUndoable(label, props) {
  if (!S.doc) { setMeas(props); refreshMeasure(); return; }
  const keys = Object.keys(props);
  if (keys.every((k) => S.meas[k] === props[k])) return;
  change(label, () => setMeas(props));
  actions.requestUI();
}

function buildMeasure() {
  const chev = h('span', { class: 'ms-chev', html: icon('chevron-right', 15) });
  const sum = h('span', { class: 'ms-sum', id: 'ms-sum' });
  const head = h('button', { class: 'sec-head ms-head', id: 'ms-head', 'aria-expanded': String(measOpen), onclick: () => {
    measOpen = !measOpen;
    try { localStorage.setItem('plantint.measOpen', measOpen ? '1' : '0'); } catch { /* ignore */ }
    refreshMeasure();
  } }, chev, h('span', { class: 'sec-title' }, 'Measurements'), sum);

  const scaleTxt = h('span', { class: 'ms-scale', id: 'ms-scale' });
  const calBtn = h('button', { class: 'btn small', id: 'ms-cal', 'data-tip': 'Click both ends of a length you know, then type it', 'data-key': 'C', 'data-tip-side': 'top', onclick: () => actions.setTool('calib') }, 'Calibrate');
  const resetBtn = h('button', { class: 'link-btn', id: 'ms-reset', onclick: () => { resetScale(); actions.requestUI(); } }, 'Reset');

  const sel = (id, label, items, onPick) => {
    const el = h('select', { class: 'ms-select', id, 'aria-label': label, 'data-tip': label, 'data-tip-side': 'top' }, ...items.map(([v, t]) => h('option', { value: String(v) }, t)));
    el.addEventListener('change', () => onPick(el.value));
    el.addEventListener('keydown', (e) => e.stopPropagation());
    return el;
  };
  // decimals mean inch rounding in feet and inches: switching in or out of it starts again from Auto
  const lenSel = sel('ms-len', 'Length unit', LENGTH_UNITS.map((u) => [u.id, u.label]), (v) => setMeasUndoable('Change length unit', (v === 'ftin') !== (S.meas.len === 'ftin') ? { len: v, dec: 'auto' } : { len: v }));
  const areaSel = sel('ms-area', 'Area unit', AREA_UNITS.map((u) => [u.id, u.label]), (v) => setMeasUndoable('Change area unit', { area: v }));
  const decSel = sel('ms-dec', 'Decimals', DECIMALS, (v) => setMeasUndoable('Change decimals', { dec: v === 'auto' ? 'auto' : +v }));

  const check = (id, label, key, tip, undoLabel) => {
    const input = h('input', { type: 'checkbox', id, onchange: (e) => setMeasUndoable(undoLabel(e.target.checked), { [key]: e.target.checked }) });
    return h('label', { class: 'check', 'data-tip': tip, 'data-tip-side': 'top' }, input, h('span', null, label));
  };
  const cArea = check('ms-show-area', 'Area', 'showArea', 'Measure the area of each markup', (on_) => (on_ ? 'Show areas' : 'Hide areas'));
  const cPerim = check('ms-show-perim', 'Perimeter', 'showPerim', 'Measure the length of each markup’s outline', (on_) => (on_ ? 'Show perimeters' : 'Hide perimeters'));
  const cTags = check('ms-tags', 'Tags', 'tags', 'Write the values inside each markup on the sheet (they print). Drag a tag to move it.', (on_) => (on_ ? 'Show area tags' : 'Hide area tags'));
  const cLegend = check('ms-legend', 'Legend', 'legend', 'Add the values to the legend as columns, with a total row', (on_) => (on_ ? 'Show values in legend' : 'Hide values in legend'));
  const cDims = check('ms-dims', 'Dimensions', 'dims', 'Show the dimension lines (they print). Add them with K.', (on_) => (on_ ? 'Show dimensions' : 'Hide dimensions'));

  const dimColor = h('input', { type: 'color', class: 'hidden-color', id: 'ms-dim-color-in' });
  dimColor.addEventListener('change', () => setMeasUndoable('Change dimension colour', { dimColor: dimColor.value.toUpperCase() }));
  const dimSw = h('button', { class: 'seg seg-sw ms-dim-sw', id: 'ms-dim-sw', 'data-tip': 'Colour of dimensions', 'data-tip-side': 'top', onclick: () => { dimColor.value = S.meas.dimColor; dimColor.click(); } }, h('span', { class: 'mini-sw', id: 'ms-dim-dot' }));
  const tVal = h('span', { class: 'step-val', id: 'ms-text' });
  const tMinus = h('button', { class: 'step-btn', 'aria-label': 'Smaller text', onclick: () => stepText(-1), html: icon('minus', 14) });
  const tPlus = h('button', { class: 'step-btn', 'aria-label': 'Larger text', onclick: () => stepText(+1), html: icon('plus', 14) });

  const total = h('span', { class: 'ms-total', id: 'ms-total' });
  const exportBtn = h('button', { class: 'link-btn', id: 'ms-export', 'data-tip': 'Save every markup with its area and perimeter as an Excel or CSV schedule', 'data-tip-side': 'top', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: 'Excel workbook (.xlsx)…', icon: 'file-spreadsheet', onClick: () => actions.saveAs('xlsx') },
      { label: 'CSV file…', icon: 'file-text', onClick: () => actions.saveAs('csv') },
    ]);
  } }, 'Schedule…');
  const dimInfo = h('span', { class: 'ms-diminfo', id: 'ms-diminfo' });
  const clearDims = h('button', { class: 'link-btn', id: 'ms-clear-dims', onclick: () => {
    const n = S.dims.length;
    if (!n) return;
    change(n > 1 ? `Delete ${n} dimensions` : 'Delete dimension', () => { S.dims = []; });
    toast(n > 1 ? `Deleted ${n} dimensions.` : 'Deleted 1 dimension.', { action: 'Undo', onAction: () => actions.undo && actions.undo() });
  } }, 'Remove all');

  const body = h('div', { class: 'ms-body', id: 'ms-body' },
    h('div', { class: 'ms-row' }, h('span', { class: 'ms-label' }, 'Scale'), scaleTxt, resetBtn, calBtn),
    h('div', { class: 'ms-row' }, h('span', { class: 'ms-label' }, 'Units'), lenSel, areaSel, decSel),
    h('div', { class: 'ms-row' }, h('span', { class: 'ms-label' }, 'Measure'), cArea, cPerim),
    h('div', { class: 'ms-row' }, h('span', { class: 'ms-label' }, 'Show'), cTags, cLegend, cDims),
    h('div', { class: 'ms-row' }, h('span', { class: 'ms-label' }, 'Text'), tMinus, tVal, tPlus, h('span', { class: 'flex' }), h('span', { class: 'ms-sub' }, 'Colour'), dimSw, dimColor),
    h('div', { class: 'ms-row ms-foot' }, dimInfo, clearDims, h('span', { class: 'flex' }), exportBtn),
    h('p', { class: 'ms-note', id: 'ms-note' }));
  const sec = h('section', { class: 'ms-sec', id: 'ms-sec' }, head, body);
  mEls = { sec, head, sum, scaleTxt, calBtn, resetBtn, lenSel, areaSel, decSel, cArea, cPerim, cTags, cLegend, cDims, tVal, tMinus, tPlus, total, exportBtn, dimInfo, clearDims, dimSw };
  return sec;
}

function stepText(dir) {
  const v = Math.max(4, Math.min(36, Math.round((S.meas.textPt || 8) + dir)));
  setMeasUndoable('Change text size', { textPt: v });
}

export function refreshMeasure() {
  if (!mEls.sec) return;
  const M = S.meas;
  const doc = !!S.doc;
  mEls.sec.classList.toggle('open', measOpen);
  mEls.head.setAttribute('aria-expanded', String(measOpen));
  const scaled = doc && hasScale();
  const src = doc ? scaleSource() : 'none';
  mEls.sum.textContent = !doc ? '' : scaled ? `${fmtScale()} · ${M.len === 'ftin' ? 'ft-in' : lengthUnitLabel()}` : 'no scale';
  mEls.sum.classList.toggle('warn', doc && !scaled);
  const srcText = { title: 'title block', typed: 'typed', calib: 'calibrated', none: '' }[src];
  mEls.scaleTxt.textContent = !doc ? '—' : scaled ? fmtScale() : 'Not set';
  mEls.scaleTxt.append(srcText && scaled ? h('span', { class: 'ms-src' }, ' ' + srcText) : '');
  mEls.scaleTxt.title = scaled ? `${fmtScale()} (${{ title: 'read from the title block', typed: 'typed in the status bar', calib: 'calibrated from a known length' }[src]})` : '';
  mEls.scaleTxt.classList.toggle('warn', doc && !scaled);
  mEls.resetBtn.hidden = !(doc && S.calib);
  mEls.resetBtn.setAttribute('data-tip', S.doc && S.doc.scale ? `Back to the title block scale (1:${S.doc.scale})` : 'Forget this scale');
  mEls.calBtn.disabled = !doc;
  mEls.lenSel.value = M.len;
  mEls.areaSel.value = M.area;
  const decItems = M.len === 'ftin' ? FTIN_STEPS : DECIMALS;
  if (mEls.decSel.options.length !== decItems.length || mEls.decSel.options[1].textContent !== decItems[1][1]) {
    mEls.decSel.innerHTML = '';
    for (const [v, t] of decItems) mEls.decSel.append(h('option', { value: String(v) }, t));
  }
  mEls.decSel.value = String(M.dec);
  mEls.decSel.setAttribute('data-tip', M.len === 'ftin' ? 'Rounding of inches' : 'Decimals');
  mEls.cArea.querySelector('input').checked = !!M.showArea;
  mEls.cPerim.querySelector('input').checked = !!M.showPerim;
  mEls.cTags.querySelector('input').checked = !!M.tags;
  mEls.cLegend.querySelector('input').checked = !!M.legend;
  mEls.cDims.querySelector('input').checked = !!M.dims;
  document.getElementById('ms-dim-dot').style.background = M.dimColor;
  mEls.tVal.textContent = (M.textPt || 8) + ' pt';
  const nd = doc ? S.dims.length : 0;
  mEls.dimInfo.textContent = nd ? (nd > 1 ? `${nd} dimensions` : '1 dimension') : 'No dimensions yet (K)';
  mEls.clearDims.hidden = !nd;
  mEls.exportBtn.disabled = !doc;
  const note = document.getElementById('ms-note');
  note.textContent = !doc ? '' : !scaled
    ? 'Set the scale to measure: Calibrate on a length you know, or type the scale in the bar at the bottom while drawing.'
    : (M.tags || M.legend) && !(M.showArea || M.showPerim) ? 'Tick Area or Perimeter to show values on the sheet.' : '';
  note.hidden = !note.textContent;
}

const fmtPt = (v) => (v === 0 ? 'None' : (Math.round(v * 100) / 100) + ' pt');

// ------------------------------------------------------------------ style refresh

export function refreshStyle() {
  const t = target();
  const c = current();
  const tgt = document.getElementById('sc-target');
  const scope = document.getElementById('sc-scope');
  if (t && t.length === 1) { tgt.textContent = t[0].name || 'Untitled'; scope.textContent = 'Selected'; }
  else if (t && t.length > 1) { tgt.textContent = t.length + ' markups'; scope.textContent = 'Selected'; }
  else { tgt.textContent = 'Next markup'; scope.textContent = 'Nothing selected'; }
  const sd = S.doc ? S.dims.filter((d) => S.selection.has(d.id)) : [];
  if ((!t || !t.length) && sd.length) {
    tgt.textContent = sd.length > 1 ? `${sd.length} dimensions` : 'Dimension';
    scope.textContent = sd.length === 1 ? 'Selected · ' + lengthLabel(Math.hypot(sd[0].b[0] - sd[0].a[0], sd[0].b[1] - sd[0].a[1])) : 'Selected';
    document.querySelector('.style-card').classList.add('has-sel');
  }
  if (t && t.length && S.doc && hasScale() && (S.meas.showArea || S.meas.showPerim)) {
    const q = totals(new Set(t.map((m) => m.id)));
    scope.textContent = 'Selected · ' + (S.meas.showArea ? areaLabel(q.area) : 'P ' + lengthLabel(q.perim));
  }
  document.querySelector('.style-card').classList.toggle('has-sel', !!(t && t.length));
  const tint = document.getElementById('chip-tint');
  tint.style.background = c.color;
  tint.style.opacity = c.opacity;
  const bpx = c.borderPt > 0 ? Math.min(7, Math.max(1.5, c.borderPt * 1.4)) : 0;
  const bor = document.getElementById('chip-border');
  if (bpx) {
    const ls = dashFor(c.borderStyle || 'solid', bpx, bpx);
    const dash = ls.dash.length ? `stroke-dasharray="${ls.dash.join(' ')}"` : '';
    const cw = bor.clientWidth || 272, chh = bor.clientHeight || 62;
    bor.innerHTML = `<svg width="${cw}" height="${chh}" aria-hidden="true"><rect x="${bpx / 2}" y="${bpx / 2}" width="${cw - bpx}" height="${chh - bpx}" fill="none" stroke="${borderColorOf(c)}" stroke-width="${bpx}" stroke-linecap="${ls.cap}" ${dash}/></svg>`;
  } else bor.innerHTML = '';
  document.getElementById('chip-hex').textContent = sameAll('color') ? c.color.toUpperCase() : 'Mixed colours';
  document.getElementById('chip-op').textContent = (sameAll('opacity') ? Math.round(c.opacity * 100) + '%' : 'Mixed') + ' opacity';
  for (const b of els.pal.children) b.classList.toggle('on', sameAll('color') && b.getAttribute('data-hex') === c.color.toUpperCase());
  if (document.activeElement !== els.hexInput) els.hexInput.value = c.color.toUpperCase();
  els.opRange.value = Math.round(c.opacity * 100);
  els.opVal.textContent = sameAll('opacity') ? Math.round(c.opacity * 100) + '%' : 'Mixed';
  els.bdRange.value = c.borderPt;
  els.bdVal.textContent = sameAll('borderPt') ? fmtPt(c.borderPt) : 'Mixed';
  const style = c.borderStyle || 'solid';
  for (const b of els.styleSegs.children) {
    const onNow = sameAll('borderStyle') && b.getAttribute('data-style') === style;
    b.classList.toggle('on', onNow);
    b.setAttribute('aria-checked', onNow ? 'true' : 'false');
  }
  els.styleSegs.classList.toggle('dim', !(c.borderPt > 0));
  document.getElementById('bd-auto').classList.toggle('on', !c.borderColor);
  document.getElementById('bd-sw').classList.toggle('on', !!c.borderColor);
  document.getElementById('bd-sw-dot').style.background = c.borderColor || autoBorder(c.color);
  els.coverInput.checked = c.cover;
  els.coverInput.indeterminate = !!(t && t.length > 1 && t.some((m) => (m.cover !== false) !== c.cover));
}

// ------------------------------------------------------------------ legend

function setLegend(label, props) {
  if (!S.legend) return;
  change(label, () => { S.legend = Object.freeze(clampLegendSizes({ ...S.legend, ...props })); });
}

function stepLegend(key, dir) {
  if (!S.legend) return;
  const dpi = S.doc ? S.doc.dpi : 150;
  const pt = Math.round(pxToPt(S.legend[key]));
  const next = ((pt + dir) * dpi) / 72;
  const lim = legendLimits();
  const min = key === 'namePx' ? lim.nameMin : lim.titleMin;
  if (next < min - 0.5) { toast('That is the smallest size that stays readable in the exported file.'); }
  setLegend('Change legend size', { [key]: Math.max(min, next) });
}

function resetLegendPlace() {
  if (!S.legend || !S.doc) return;
  const [x, y] = bestLegendSpot({ ...S.legend });
  setLegend('Move legend', { x, y });
}

export function refreshLegend() {
  const L = S.legend;
  const on_ = !!(L && L.visible);
  els.legSwitch.setAttribute('aria-checked', on_ ? 'true' : 'false');
  els.legSwitch.classList.toggle('on', on_);
  els.legSec.classList.toggle('open', on_);
  els.legSwitch.disabled = !S.doc;
  if (!L) return;
  const lim = legendLimits();
  const pt = (px) => Math.round(pxToPt(px));
  document.getElementById('leg-title').textContent = pt(L.titlePx) + ' pt';
  document.getElementById('leg-name').textContent = pt(L.namePx) + ' pt';
  document.getElementById('leg-merge').checked = !!L.merge;
  document.getElementById('leg-note').textContent = `Drag the table on the sheet to move it, or its corner to resize. Sizes never go below ${pt(lim.titleMin)} pt for titles and ${pt(lim.nameMin)} pt for names, so the exported file stays readable.`;
}

// ------------------------------------------------------------------ list

let anchorId = null;
const rowMap = new Map();
const CSS_LINE = { solid: 'solid', dashed: 'dashed', short: 'dashed', dotted: 'dotted', dashdot: 'dashed', dashdotdot: 'dashed' };

function rowFor(m) {
  let r = rowMap.get(m.id);
  if (!r) {
    const sw = h('span', { class: 'mk-sw' });
    const name = h('span', { class: 'mk-name' });
    const pen = h('button', { class: 'mk-btn pen', 'data-tip': 'Rename', 'data-key': 'F2', 'aria-label': 'Rename', html: icon('pen-line', 15) });
    const loc = h('button', { class: 'mk-btn', 'data-tip': 'Zoom to it', 'aria-label': 'Zoom to it', html: icon('locate', 15) });
    const del = h('button', { class: 'mk-btn del', 'data-tip': 'Delete', 'data-key': 'Del', 'aria-label': 'Delete', html: icon('trash-2', 15) });
    const meas = h('span', { class: 'mk-meas' });
    const el = h('div', { class: 'mk-row', role: 'option', 'data-id': m.id }, sw, name, meas, pen, loc, del);
    r = { el, sw, name, meas, pen, loc, del, m: null, mt: '', pk: false };
    rowMap.set(m.id, r);
    const id = m.id;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || e.target.tagName === 'INPUT') return;
      clickRow(id, e);
    });
    el.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) startRename(id); });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!S.selection.has(id)) setSelection([id]);
      actions.markupMenu(e.clientX, e.clientY, id);
    });
    el.addEventListener('pointerenter', () => { T.hoverId = id; actions.requestUI(); });
    el.addEventListener('pointerleave', () => { if (T.hoverId === id) { T.hoverId = null; actions.requestUI(); } });
    pen.addEventListener('click', () => startRename(id));
    loc.addEventListener('click', () => actions.zoomTo([id]));
    del.addEventListener('click', () => { setSelection([id]); actions.deleteSelected(); });
  }
  if (r.m !== m || r.pk !== progressOn()) {
    r.m = m;
    r.pk = progressOn();
    const sm = shown(m); // the status colour on the progress map
    r.sw.style.background = tintOnPaper(sm.color, sm.opacity);
    if (m.borderPt > 0) { r.sw.style.border = `2px ${CSS_LINE[m.borderStyle] || 'solid'} ${borderColorOf(sm)}`; r.sw.style.boxShadow = 'none'; }
    else { r.sw.style.border = '0'; r.sw.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.18)'; }
    if (!r.el.querySelector('input')) r.name.textContent = m.name || 'Untitled';
    r.name.title = m.name || '';
  }
  return r;
}

function clickRow(id, e) {
  flushEdits();
  const order = S.markups.map((m) => m.id);
  if (e.shiftKey && anchorId && order.includes(anchorId)) {
    const a = order.indexOf(anchorId), b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    setSelection(e.ctrlKey ? [...new Set([...S.selection, ...range])] : range);
  } else if (e.ctrlKey || e.metaKey) {
    const s = new Set(S.selection);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelection([...s]);
    anchorId = id;
  } else {
    setSelection([id]);
    anchorId = id;
  }
  els.list.focus({ preventScroll: true });
}

export function refreshList() {
  const list = els.list;
  const ids = new Set(S.markups.map((m) => m.id));
  for (const [id, r] of rowMap) if (!ids.has(id)) { r.el.remove(); rowMap.delete(id); }
  let prev = null;
  const showA = !!(S.doc && hasScale() && S.meas.showArea), showP = !!(S.doc && hasScale() && S.meas.showPerim);
  S.markups.forEach((m, i) => {
    const r = rowFor(m);
    // area and perimeter of what is visible
    let mt = '';
    if (showA || showP) {
      const q = measureAt(i);
      mt = [showA ? areaLabel(q.area) : '', showP ? 'P ' + lengthLabel(q.perim) : ''].filter(Boolean).join('\n');
    }
    // on the progress map: the zone's % done first
    if (progressOn()) mt = [progLabel(m) || 'Not counted', mt.split('\n')[0]].filter(Boolean).join('\n');
    if (mt !== r.mt) {
      r.mt = mt;
      r.meas.innerHTML = '';
      for (const line of mt ? mt.split('\n') : []) r.meas.append(h('span', null, line));
      r.meas.classList.toggle('two', mt.includes('\n'));
    }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== r.el) list.insertBefore(r.el, want);
    r.el.classList.toggle('sel', S.selection.has(m.id));
    r.el.setAttribute('aria-selected', S.selection.has(m.id) ? 'true' : 'false');
    prev = r.el;
  });
  document.getElementById('list-count').textContent = S.markups.length;
  els.empty.hidden = S.markups.length > 0;
  const tot = document.getElementById('list-total');
  const t = (showA || showP) && S.markups.length ? totals() : null;
  tot.textContent = t ? (showA ? areaLabel(t.area) : 'P ' + lengthLabel(t.perim)) : '';
  tot.hidden = !t;
}

export function revealInList(id) {
  const r = rowMap.get(id);
  if (r) scrollWithin(r.el.closest('.mk-scroll'), r.el);
}

export function startRename(id) {
  const r = rowMap.get(id);
  const m = S.markups.find((q) => q.id === id);
  if (!r || !m) return;
  scrollWithin(r.el.closest('.mk-scroll'), r.el);
  if (r.el.querySelector('input')) return;
  const input = h('input', { class: 'mk-input', value: m.name || '', maxlength: 120, spellcheck: 'false', 'aria-label': 'Markup name' });
  r.name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const val = input.value.replace(/\s+/g, ' ').trim();
    input.replaceWith(r.name);
    const cur = S.markups.find((q) => q.id === id);
    if (save && cur && val && val !== cur.name) {
      change('Rename', () => { S.markups = S.markups.map((q) => (q.id === id ? withProps(q, { name: val }) : q)); });
    } else if (cur) r.name.textContent = cur.name || 'Untitled';
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

export function zoomToIds(ids) {
  const ms = S.markups.filter((m) => ids.includes(m.id));
  const ps = S.pins.filter((p) => ids.includes(p.id));
  if (!ms.length && !ps.length) return;
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of ms) { const g = geo(m).bbox; b = [Math.min(b[0], g[0]), Math.min(b[1], g[1]), Math.max(b[2], g[2]), Math.max(b[3], g[3])]; }
  if (ps.length) {
    // snag pins: the whole pin, with room around a lone one so it is seen in its place
    const z = pinSize();
    const pad = ms.length ? 0 : Math.min(S.doc.W, S.doc.H) * 0.05;
    for (const p of ps) b = [Math.min(b[0], p.x - z.r - pad), Math.min(b[1], p.y - z.tail - z.r - pad), Math.max(b[2], p.x + z.r + pad), Math.max(b[3], p.y + pad)];
  }
  zoomToRect(b[0], b[1], b[2], b[3], 80);
  T.flash = { ids, until: performance.now() + 900 };
  requestScene();
  emit('view');
}

/**
 * Shows where markups are on the sheet, so one can be told from the others: the sheet pans to them
 * when they are out of view or under the markups window (zooming out only when they do not fit
 * beside it), and their outlines flash.
 */
export async function revealIds(ids) {
  const ms = S.markups.filter((m) => ids.includes(m.id));
  if (!ms.length || !S.doc) return;
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of ms) { const g = geo(m).bbox; b = [Math.min(b[0], g[0]), Math.min(b[1], g[1]), Math.max(b[2], g[2]), Math.max(b[3], g[3])]; }
  let free = [0, 0, V.cw, V.ch];
  try {
    const c = window.plantint && window.plantint.markupsCover ? await window.plantint.markupsCover() : null;
    const ui = document.getElementById('ui');
    if (c && ui) {
      const r = ui.getBoundingClientRect(), d = V.dpr;
      free = uncovered(free, [(c.x - r.left) * d, (c.y - r.top) * d, (c.x + c.width - r.left) * d, (c.y + c.height - r.top) * d]);
    }
  } catch { /* all of the sheet */ }
  const m = 36 * V.dpr;
  const fw = free[2] - free[0] - 2 * m, fh = free[3] - free[1] - 2 * m;
  if (fw > 0 && fh > 0) {
    const s = V.scale;
    const X0 = b[0] * s + V.tx, Y0 = b[1] * s + V.ty, X1 = b[2] * s + V.tx, Y1 = b[3] * s + V.ty;
    const fcx = (free[0] + free[2]) / 2, fcy = (free[1] + free[3]) / 2;
    if (X1 - X0 > fw || Y1 - Y0 > fh) {
      // too big to show beside the window at this zoom: zoom out until it fits
      const ns = Math.max(minScale(), Math.min(fw / Math.max(1, b[2] - b[0]), fh / Math.max(1, b[3] - b[1])));
      V.scale = ns;
      V.tx = fcx - ((b[0] + b[2]) / 2) * ns;
      V.ty = fcy - ((b[1] + b[3]) / 2) * ns;
      clampPan();
    } else if (X0 < free[0] + m || Y0 < free[1] + m || X1 > free[2] - m || Y1 > free[3] - m) {
      V.tx += fcx - (X0 + X1) / 2;
      V.ty += fcy - (Y0 + Y1) / 2;
      clampPan();
    }
  }
  const now = performance.now();
  T.flash = { ids: ms.map((q) => q.id), start: now, until: now + 1600, pulse: true };
  requestScene();
  emit('view');
}

/** The biggest part of the rectangle `all` that `cover` leaves free (all of it when almost nothing is). */
function uncovered(all, cover) {
  const [x0, y0, x1, y1] = all, [c0, d0, c1, d1] = cover;
  if (c1 <= x0 || c0 >= x1 || d1 <= y0 || d0 >= y1) return all;
  let best = null, bestA = 0;
  for (const p of [[x0, y0, Math.min(c0, x1), y1], [Math.max(c1, x0), y0, x1, y1], [x0, y0, x1, Math.min(d0, y1)], [x0, Math.max(d1, y0), x1, y1]]) {
    const a = Math.max(0, p[2] - p[0]) * Math.max(0, p[3] - p[1]);
    if (a > bestA) { bestA = a; best = p; }
  }
  return best && bestA >= 0.12 * (x1 - x0) * (y1 - y0) ? best : all;
}

// A small floor-plan fragment drawn under the preview tint, so the chip shows
// exactly what a highlight does: tint the paper while the lines stay crisp.
const PLAN_SVG = `<svg viewBox="0 0 268 64" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<rect width="268" height="64" fill="#fff"/>
<g fill="none" stroke="#2B302D" stroke-width="1.2">
<path d="M-2 10H120M138 10H270M-2 54H270M60 10V54M196 10V30M196 44V54"/>
<path d="M120 10a18 18 0 0 0 18 18" stroke-dasharray="2 2" stroke-width="0.8"/>
<path d="M138 10V28" stroke-width="0.9"/>
<rect x="18" y="22" width="26" height="18" stroke-width="0.8"/>
<circle cx="226" cy="32" r="8" stroke-width="0.8"/>
</g>
<g fill="#2B302D" font-family="IBM Plex Sans, sans-serif" font-size="7" font-weight="600"><text x="78" y="36">LIVING</text></g>
</svg>`;
