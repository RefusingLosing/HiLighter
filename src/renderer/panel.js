// Side panel: style (colour, opacity, border thickness, line style, border colour) for the
// selection or the next markup, the legend controls, and the markup list (the only part of
// the panel that scrolls).

import { S, on, emit, withProps, selectedMarkups, setSelection, pxToPt } from './state.js';
import { h, icon, toast } from './ui.js';
import { PALETTE, normalizeHex, tintOnPaper, borderColorOf, autoBorder } from './colors.js';
import { change, commit, snapshot } from './history.js';
import { legendLimits, clampLegendSizes, bestLegendSpot } from './legend.js';
import { requestScene, T, geo } from './render.js';
import { zoomToRect } from './view.js';
import { LINE_STYLES, dashFor } from '../shared/linestyle.js';

let els = {};
let actions = {}; // provided by main: { setTool, toggleLegend, deleteSelected, duplicate, zoomTo, requestUI, markupMenu }

// ------------------------------------------------------------------ helpers

const target = () => (S.selection.size ? selectedMarkups() : null);

function current() {
  const t = target();
  if (t && t.length) return { color: t[0].color, opacity: t[0].opacity, borderPt: t[0].borderPt, borderColor: t[0].borderColor, borderStyle: t[0].borderStyle || 'solid' };
  return S.style;
}

function sameAll(key) {
  const t = target();
  if (!t || t.length < 2) return true;
  return t.every((m) => (m[key] || null) === (t[0][key] || null));
}

let txn = null;
function liveApply(label, props) {
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

  const card = h('section', { class: 'style-card' },
    head, chip, pal, colorRow,
    h('div', { class: 'field' }, h('label', { for: 'op-range' }, 'Opacity'), opRange, opVal),
    h('div', { class: 'field' }, h('label', { for: 'bd-range' }, 'Border'), bdRange, bdVal),
    h('div', { class: 'field field-line' }, h('span', { class: 'sub-label' }, 'Line'), styleSegs),
    h('div', { class: 'field field-sub' }, h('span', { class: 'sub-label' }, 'Border colour'), h('div', { class: 'segs' }, bdAuto, bdSwatch), bdColorInput));

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
    h('button', { class: 'tool-mini', 'data-tip': 'Select all', 'data-key': 'Ctrl+A', onclick: () => setSelection(S.markups.map((m) => m.id)), html: icon('layers', 16) }));
  const list = h('div', { class: 'mk-list', id: 'mk-list', role: 'listbox', 'aria-multiselectable': 'true', tabindex: '0' });
  const empty = h('div', { class: 'mk-empty', id: 'mk-empty' }, 'Fill an area or draw a polygon. Each markup appears here with its name.');
  const listSec = h('section', { class: 'list-sec' }, listHead, h('div', { class: 'mk-scroll' }, list, empty));

  root.append(card, legSec, listSec);
  els = { opRange, opVal, bdRange, bdVal, hexInput, pal, list, empty, legSwitch, legBody, legSec, styleSegs };

  list.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'F2') { e.preventDefault(); const s = selectedMarkups(); if (s.length === 1) startRename(s[0].id); }
  });

  on('selection', () => { refreshStyle(); refreshList(); });
  on('doc', () => { refreshStyle(); refreshList(); refreshLegend(); });
  on('style', refreshStyle);
  refreshStyle(); refreshList(); refreshLegend();
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
    const el = h('div', { class: 'mk-row', role: 'option', 'data-id': m.id }, sw, name, pen, loc, del);
    r = { el, sw, name, pen, loc, del, m: null };
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
  if (r.m !== m) {
    r.m = m;
    r.sw.style.background = tintOnPaper(m.color, m.opacity);
    if (m.borderPt > 0) { r.sw.style.border = `2px ${CSS_LINE[m.borderStyle] || 'solid'} ${borderColorOf(m)}`; r.sw.style.boxShadow = 'none'; }
    else { r.sw.style.border = '0'; r.sw.style.boxShadow = 'inset 0 0 0 1px rgba(0,0,0,0.18)'; }
    if (!r.el.querySelector('input')) r.name.textContent = m.name || 'Untitled';
    r.name.title = m.name || '';
  }
  return r;
}

function clickRow(id, e) {
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
  for (const m of S.markups) {
    const r = rowFor(m);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== r.el) list.insertBefore(r.el, want);
    r.el.classList.toggle('sel', S.selection.has(m.id));
    r.el.setAttribute('aria-selected', S.selection.has(m.id) ? 'true' : 'false');
    prev = r.el;
  }
  document.getElementById('list-count').textContent = S.markups.length;
  els.empty.hidden = S.markups.length > 0;
}

export function revealInList(id) {
  const r = rowMap.get(id);
  if (r) r.el.scrollIntoView({ block: 'nearest' });
}

export function startRename(id) {
  const r = rowMap.get(id);
  const m = S.markups.find((q) => q.id === id);
  if (!r || !m) return;
  r.el.scrollIntoView({ block: 'nearest' });
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
  if (!ms.length) return;
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of ms) { const g = geo(m).bbox; b = [Math.min(b[0], g[0]), Math.min(b[1], g[1]), Math.max(b[2], g[2]), Math.max(b[3], g[3])]; }
  zoomToRect(b[0], b[1], b[2], b[3], 80);
  T.flash = { ids, until: performance.now() + 900 };
  requestScene();
  emit('view');
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
