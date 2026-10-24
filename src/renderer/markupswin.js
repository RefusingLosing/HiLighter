// The markups window: every markup of the drawing in a table, in a window of its own that sits beside
// the drawing (or on a second screen) at any size. Find markups by name, colour or status, select them
// (the sheet shows the same selection, and brings the one clicked into view), rename them, recolour
// them, set their status, units and % done, zoom to them, merge them (drag a row onto another) and
// delete them. The drawing page builds the window and keeps it up to date itself, so what is done
// here is done in the drawing, with undo, and the other way round.

import { S, on, withProps, setSelection as setSel } from './state.js';
import { change } from './history.js';
import { icon } from './ui.js';
import { tintOnPaper, colorName, normalizeHex } from './colors.js';
import { favourites, onPrefs } from './prefs.js';
import { actionOf, keyLabel } from './keys.js';
import { measureAt, totals } from './measure.js';
import { hasScale, areaLabel, lengthLabel } from './units.js';
import { STATUSES, STATUS, progressOn, progressBy, progOf, withProg } from './progress.js';
import { mergeMarkups } from './merge.js';
import { T } from './render.js';

const NAME = 'plantint-markups';
const FOLLOW_KEY = 'plantint.markups.follow';
let win = null;            // the window, while it is open
let actions = {};          // from main: zoomTo(ids), reveal(ids), undo(), redo(), requestUI()
let offs = [];             // listeners on the drawing, removed when the window closes
let watch = 0;
let el = {};               // the window's parts
const rows = new Map();    // markup id -> row
const view = { q: '', colour: null, status: null, sort: null, dir: 1, follow: loadFollow() };
let anchor = null;         // the row Shift+click selects from
let queued = false;
let lastShown = [];        // ids in the order the table shows them
let colsKey = '';
let press = null;          // a row pressed with the mouse: { id, x, y, pid, tr, deferClick }
let fromHere = false;      // the last change of selection was made in this window
let selKey = '';           // the selection the table last showed
let drag = null;           // rows being dragged onto another: { ids, target, cx, cy, ghost, raf }

/** Selects in the drawing from this window (a selection made on the sheet scrolls the table to it). */
function setSelection(ids) { fromHere = true; setSel(ids); }

function loadFollow() { try { return localStorage.getItem(FOLLOW_KEY) !== '0'; } catch { return true; } }
function saveFollow(v) { try { localStorage.setItem(FOLLOW_KEY, v ? '1' : '0'); } catch { /* this session only */ } }

export const markupsWindowOpen = () => !!(win && !win.closed);

/** Opens the window (or brings it to the front). */
export function openMarkupsWindow(acts) {
  actions = acts || actions;
  if (win && !win.closed) { win.focus(); return win; }
  if (!S.doc) return null;
  const w = window.open('about:blank', NAME, 'width=720,height=720');
  if (!w) return null;
  win = w;
  build();
  offs = [onPrefs(() => { if (el.pal) fillPalette(el.pal); later(); }), on('doc', later), on('selection', later), on('scale', later), on('docLoaded', () => {
    // another drawing in this tab: start with everything shown
    Object.assign(view, { q: '', colour: null, status: null, sort: null, dir: 1 });
    if (el.search) el.search.value = '';
    el.headKey = '';
    later();
  })];
  watch = setInterval(() => { if (!win || win.closed) cleanup(); }, 1000);
  win.addEventListener('pagehide', cleanup);
  refresh();
  return win;
}

export function closeMarkupsWindow() {
  if (win && !win.closed) win.close();
  cleanup();
}

// the window goes with the drawing page
window.addEventListener('pagehide', () => closeMarkupsWindow());

function cleanup() {
  if (!win && !offs.length) return;
  endDrag(false);
  press = null;
  for (const off of offs) off();
  offs = [];
  clearInterval(watch);
  rows.clear();
  el = {};
  win = null;
  colsKey = '';
  selKey = '';
  if (T.hoverId) { T.hoverId = null; if (actions.requestUI) actions.requestUI(); }
}

function later() {
  if (queued || !win) return;
  queued = true;
  setTimeout(() => { queued = false; refresh(); }, 0);
}

// ------------------------------------------------------------------ building the window

const CSS = `
:root { --film:#F3F4F1; --film-2:#E8EAE5; --rule:#D3D7D1; --rule-2:#C1C6BF; --ink:#2B302D; --ink-2:#565D58; --ink-3:#858C86;
  --blue:#2457C5; --blue-soft:rgba(36,87,197,.10); --blue-soft-2:rgba(36,87,197,.17); --red:#C8322B;
  --font:"IBM Plex Sans","IBM Plex Sans Arabic","Segoe UI",system-ui,sans-serif; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; background: #fff; color: var(--ink); font: 13px/1.38 var(--font); -webkit-font-smoothing: antialiased; min-width: 0; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
.ico { display: block; flex: 0 0 auto; }
.mw-top { display: flex; align-items: center; gap: 8px 10px; padding: 10px 14px; background: var(--film); border-bottom: 1px solid var(--rule); flex-wrap: wrap; }
.mw-find { position: relative; flex: 1 1 200px; max-width: 280px; min-width: 150px; }
.mw-find .ico { position: absolute; left: 9px; top: 7px; color: var(--ink-3); pointer-events: none; }
.mw-search { width: 100%; height: 30px; border: 1px solid var(--rule-2); border-radius: 6px; padding: 0 28px 0 30px; background: #fff; }
.mw-search:focus { border-color: var(--blue); }
.mw-clear { position: absolute; right: 3px; top: 3px; width: 24px; height: 24px; border: 0; background: none; border-radius: 4px; color: var(--ink-3); display: grid; place-items: center; }
.mw-clear:hover { background: var(--film-2); color: var(--ink); }
.mw-chips { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.mw-chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border: 1px solid var(--rule-2); border-radius: 13px; background: #fff; font-size: 12px; white-space: nowrap; }
.mw-chip:hover { background: var(--film); }
.mw-chip.on { border-color: var(--blue); box-shadow: inset 0 0 0 1px var(--blue); color: var(--blue); }
.mw-chip .n { color: var(--ink-3); }
.mw-dot { width: 12px; height: 12px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.2); flex: 0 0 auto; }
.mw-label { color: var(--ink-2); font-size: 12px; }
.mw-count { margin-left: auto; color: var(--ink-2); white-space: nowrap; }
.mw-act { display: flex; align-items: center; gap: 6px 8px; padding: 8px 14px; border-bottom: 1px solid var(--rule); flex-wrap: wrap; min-height: 46px; }
.mw-act .grp { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.mw-act .sep { width: 1px; height: 22px; background: var(--rule); margin: 0 2px; }
.mw-act .spring { flex: 1 1 0; min-width: 0; }
.mw-act.none .needs-sel, .mw-act.few .needs-two { opacity: .38; pointer-events: none; }
.mw-sel-title { font-weight: 600; min-width: 104px; white-space: nowrap; }
.mw-sw { width: 22px; height: 22px; border-radius: 5px; border: 1px solid rgba(0,0,0,.18); padding: 0; }
.mw-sw:hover { transform: scale(1.08); }
.mw-btn { height: 28px; padding: 0 10px; border: 1px solid var(--rule-2); border-radius: 6px; background: #fff; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.mw-btn:hover { background: var(--film); }
.mw-btn.danger { color: var(--red); }
.mw-st-btn .mw-dot { border-radius: 50%; }
.mw-follow { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px; white-space: nowrap; color: var(--ink-2); cursor: pointer; user-select: none; }
.mw-follow input { accent-color: var(--blue); margin: 0; }
.mw-wrap { flex: 1; overflow: auto; position: relative; }
table.mw-t { width: 100%; border-collapse: separate; border-spacing: 0; }
.mw-t th { position: sticky; top: 0; z-index: 1; background: #fff; text-align: left; font-weight: 600; font-size: 12px; color: var(--ink-2); padding: 8px; border-bottom: 1px solid var(--rule); white-space: nowrap; user-select: none; }
.mw-t th.sort { cursor: pointer; }
.mw-t th.sort:hover { color: var(--ink); }
.mw-t th .arrow { display: inline-block; width: 12px; color: var(--blue); }
.mw-t td { padding: 3px 8px; border-bottom: 1px solid #EEF0EC; white-space: nowrap; }
.mw-t tbody tr { cursor: default; user-select: none; }
.mw-t tbody tr:hover td { background: #F7F8F5; }
.mw-t tbody tr.sel td { background: var(--blue-soft); }
.mw-t tbody tr.sel:hover td { background: var(--blue-soft-2); }
.mw-t .num { text-align: right; font-variant-numeric: tabular-nums; }
.mw-t .c-idx { color: var(--ink-3); width: 1%; padding-left: 2px; }
.mw-t .c-idx .in { display: inline-flex; align-items: center; gap: 2px; }
.mw-grip { color: var(--ink-3); opacity: 0; cursor: grab; display: inline-grid; place-items: center; width: 14px; }
.mw-t tbody tr:hover .mw-grip, .mw-t tbody tr.sel .mw-grip { opacity: .9; }
.mw-t .c-chk { width: 1%; }
.mw-t .c-chk input { accent-color: var(--blue); margin: 0; }
.mw-swb { width: 34px; height: 22px; border-radius: 5px; border: 1px solid rgba(0,0,0,.18); padding: 0; display: block; }
.mw-name { width: 100%; min-width: 150px; height: 26px; border: 1px solid transparent; border-radius: 5px; padding: 0 6px; background: transparent; user-select: text; }
.mw-name:hover { border-color: var(--rule); background: #fff; }
.mw-name:focus { border-color: var(--blue); background: #fff; }
.mw-sel { height: 26px; border: 1px solid var(--rule-2); border-radius: 5px; background: #fff; padding: 0 4px; }
.mw-numin { width: 70px; height: 26px; border: 1px solid var(--rule-2); border-radius: 5px; padding: 0 6px; text-align: right; background: #fff; }
.mw-numin:focus, .mw-sel:focus { border-color: var(--blue); }
.mw-icon { width: 28px; height: 26px; border: 0; background: transparent; border-radius: 5px; color: var(--ink-2); display: inline-grid; place-items: center; vertical-align: middle; }
.mw-icon:hover { background: var(--film-2); color: var(--ink); }
.mw-icon.del:hover { color: var(--red); }
.mw-empty { padding: 48px 20px; text-align: center; color: var(--ink-3); }
.mw-foot { display: flex; gap: 14px; align-items: center; padding: 8px 14px; border-top: 1px solid var(--rule); background: var(--film); color: var(--ink-2); font-size: 12px; min-height: 38px; }
.mw-tot { font-variant-numeric: tabular-nums; color: var(--ink); white-space: nowrap; }
.mw-hint { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mw-msg { margin-left: auto; color: var(--ink); display: flex; gap: 8px; align-items: center; white-space: nowrap; }
.mw-msg:empty { display: none; }
.mw-link { border: 0; background: none; color: var(--blue); padding: 0; }
.mw-link:hover { text-decoration: underline; }
.mw-pop { position: fixed; z-index: 10; background: #fff; border: 1px solid var(--rule-2); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 8px; }
.mw-pop .pal { display: grid; grid-template-columns: repeat(6, 24px); gap: 6px; }
.mw-pop .more { margin-top: 8px; display: flex; align-items: center; gap: 6px; }
.mw-pop input[type=color] { width: 0; height: 0; opacity: 0; border: 0; padding: 0; position: absolute; }
/* dragging rows onto another to merge them */
body.mw-dragging, body.mw-dragging * { cursor: grabbing !important; }
.mw-t tbody tr.dragged td { opacity: .5; }
.mw-t tbody tr.drop td { background: rgba(36,87,197,.18) !important; box-shadow: inset 0 2px 0 var(--blue), inset 0 -2px 0 var(--blue); }
.mw-ghost { position: fixed; z-index: 20; pointer-events: none; display: flex; align-items: center; gap: 7px; max-width: min(460px, 80vw); padding: 6px 10px; border-radius: 7px; background: var(--ink); color: #fff; font-size: 12px; box-shadow: 0 8px 22px rgba(0,0,0,.28); white-space: nowrap; }
.mw-ghost.ok { background: var(--blue); }
.mw-ghost span { overflow: hidden; text-overflow: ellipsis; }
/* a narrow window, beside the drawing */
@media (max-width: 1000px) { .mw-act .pal-inline { display: none; } }
@media (max-width: 860px) { .mw-st-btn .lbl { display: none; } .mw-st-btn { padding: 0 8px; } .mw-hint { display: none; } }
@media (max-width: 700px) { .mw-act .mw-btn.icon-ok .lbl { display: none; } .mw-act .mw-btn.icon-ok { padding: 0 8px; } .mw-t .c-perim { display: none; } .mw-sel-title { min-width: 0; } }
@media (max-width: 540px) { .mw-follow .lbl { display: none; } .mw-t .c-act { display: none; } .mw-name { min-width: 110px; } .mw-top, .mw-act { padding-left: 10px; padding-right: 10px; } }
`;

/** The favourite colours (Preferences) in the bar above the table. */
function fillPalette(pal) {
  pal.innerHTML = '';
  pal.append(...favourites().map((p) => E('button', { class: 'mw-sw', title: p.name, 'aria-label': p.name, style: { background: p.hex }, onclick: () => recolour(selectedIds(), p.hex) })));
}

/** An element in the window's own document (like h() in ui.js). */
function E(tag, attrs, ...children) {
  const d = win.document;
  const x = d.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') x.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(x.style, v);
      else if (k.startsWith('on') && typeof v === 'function') x.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') x.innerHTML = v;
      else if (v === true) x.setAttribute(k, '');
      else x.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    x.append(c.nodeType ? c : d.createTextNode(String(c)));
  }
  return x;
}

const lbl = (text) => `<span class="lbl">${text}</span>`;

function build() {
  const d = win.document;
  d.open();
  d.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Markups</title></head><body></body></html>');
  d.close();
  const base = new URL('.', window.location.href).href;
  d.head.append(E('link', { rel: 'stylesheet', href: base + 'fonts.css' }), E('style', null, CSS));

  // ---- top: find, filters, count
  const search = E('input', { class: 'mw-search', type: 'search', placeholder: 'Find by name', 'aria-label': 'Find by name', spellcheck: 'false' });
  search.addEventListener('input', () => { view.q = search.value; later(); });
  const clear = E('button', { class: 'mw-clear', title: 'Clear', 'aria-label': 'Clear', html: icon('x', 14), onclick: () => { search.value = ''; view.q = ''; later(); search.focus(); } });
  const find = E('div', { class: 'mw-find' }, E('span', { html: icon('search', 15) }), search, clear);
  const colours = E('div', { class: 'mw-chips', 'aria-label': 'Show one colour' });
  const statuses = E('div', { class: 'mw-chips', 'aria-label': 'Show one status' });
  const count = E('span', { class: 'mw-count' });
  const top = E('div', { class: 'mw-top' }, find, colours, statuses, count);

  // ---- what to do with the selected markups
  const selTitle = E('span', { class: 'mw-sel-title' });
  const pal = E('div', { class: 'grp pal-inline needs-sel', 'aria-label': 'Colour of the selected markups' });
  fillPalette(pal);
  const colourBtn = E('button', { class: 'mw-btn icon-ok needs-sel mw-colour', title: 'Colour of the selected markups', html: icon('swatch-book', 15) + lbl('Colour') });
  colourBtn.addEventListener('click', () => colourPop(colourBtn, selectedIds()));
  const stGrp = E('div', { class: 'grp needs-sel', 'aria-label': 'Status of the selected markups' },
    ...STATUSES.map((st) => E('button', { class: 'mw-btn mw-st-btn', title: `Set the selected markups to ${st.label}`, 'aria-label': st.label, onclick: () => setProg(selectedIds(), { st: st.id }) },
      E('span', { class: 'mw-dot', style: { background: st.color } }), E('span', { class: 'lbl' }, st.label))));
  const stSep = E('span', { class: 'sep' });
  const zoomBtn = E('button', { class: 'mw-btn icon-ok needs-sel', html: icon('locate', 15) + lbl('Zoom to'), title: 'Zoom the sheet to the selected markups', 'aria-label': 'Zoom to', onclick: () => zoomTo(selectedIds()) });
  const mergeBtn = E('button', { class: 'mw-btn needs-two mw-merge', html: icon('squares-unite', 15) + lbl('Merge'), 'aria-label': 'Merge', onclick: () => mergeSelectedHere() });
  const delBtn = E('button', { class: 'mw-btn icon-ok danger needs-sel', html: icon('trash-2', 15) + lbl('Delete'), title: 'Delete the selected markups', 'aria-label': 'Delete', onclick: () => remove(selectedIds()) });
  const followBox = E('input', { type: 'checkbox' });
  followBox.checked = view.follow;
  followBox.addEventListener('change', () => { view.follow = followBox.checked; saveFollow(view.follow); });
  const followLbl = E('label', { class: 'mw-follow', title: 'A click on a row brings its markup into view on the drawing, beside this window, and makes it flash' },
    followBox, E('span', { html: icon('scan-eye', 15) }), E('span', { class: 'lbl' }, 'Show on drawing'));
  const allBtn = E('button', { class: 'mw-btn', title: 'Select every markup shown in the table', onclick: () => selectShown() }, 'Select all');
  const noneBtn = E('button', { class: 'mw-btn needs-sel', title: 'Select nothing (Esc)', onclick: () => setSelection([]) }, 'Clear');
  const act = E('div', { class: 'mw-act' }, selTitle, pal, colourBtn, stSep, stGrp, E('span', { class: 'sep' }), zoomBtn, mergeBtn, delBtn,
    E('span', { class: 'spring' }), followLbl, allBtn, noneBtn);

  // ---- the table
  const thead = E('thead');
  const tbody = E('tbody');
  const table = E('table', { class: 'mw-t' }, thead, tbody);
  const empty = E('div', { class: 'mw-empty' });
  const wrap = E('div', { class: 'mw-wrap' }, table, empty);

  // ---- foot: totals, hints and messages
  const tot = E('span', { class: 'mw-tot' });
  const hint = E('span', { class: 'mw-hint' }, 'Click a row to select it; Ctrl+click adds, Shift+click selects a range. Drag a row onto another to merge them. Double-click zooms to it.');
  const msg = E('span', { class: 'mw-msg' });
  const foot = E('div', { class: 'mw-foot' }, tot, hint, msg);

  d.body.append(top, act, wrap, foot);
  el = { search, colours, statuses, count, selTitle, act, pal, stGrp, stSep, mergeBtn, followBox, thead, tbody, table, empty, wrap, tot, msg };

  d.addEventListener('keydown', onKey);
  d.addEventListener('pointerdown', (e) => { if (el.pop && !el.pop.contains(e.target)) closePop(); }, true);
  d.addEventListener('pointermove', onPressMove);
  d.addEventListener('pointerup', onPressUp);
  d.addEventListener('pointercancel', () => { endDrag(false); press = null; });
  win.addEventListener('blur', () => {
    endDrag(false);
    press = null;
    if (T.hoverId) { T.hoverId = null; actions.requestUI && actions.requestUI(); }
  });
}

// ------------------------------------------------------------------ what the table shows

function columns() {
  const cols = [
    { id: 'chk' }, { id: 'idx', label: '#', sort: 'idx', title: 'Drawing order: a markup drawn later sits on top' },
    { id: 'colour', label: 'Colour', sort: 'colour' }, { id: 'name', label: 'Name', sort: 'name' },
  ];
  if (hasScale()) cols.push({ id: 'area', label: 'Area', sort: 'area', num: true }, { id: 'perim', label: 'Perimeter', sort: 'perim', num: true });
  if (progressOn()) {
    cols.push({ id: 'status', label: 'Status', sort: 'status' }, { id: 'pct', label: '% done', sort: 'pct', num: true });
    if (progressBy() === 'units') cols.push({ id: 'units', label: 'Units', sort: 'units', num: true });
  }
  cols.push({ id: 'act' });
  return cols;
}

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function shownList() {
  const q = view.q.trim().toLowerCase();
  const list = S.markups.map((m, i) => ({ m, i }))
    .filter(({ m }) => !q || (m.name || '').toLowerCase().includes(q))
    .filter(({ m }) => !view.colour || m.color.toUpperCase() === view.colour)
    .filter(({ m }) => !view.status || !progressOn() || progOf(m).st === view.status);
  const key = view.sort;
  if (!key || key === 'idx') { if (key === 'idx' && view.dir < 0) list.reverse(); return list; }
  const val = ({ m, i }) => {
    if (key === 'name') return m.name || '';
    if (key === 'colour') return colorName(m.color) + m.color;
    if (key === 'area') return measureAt(i).area;
    if (key === 'perim') return measureAt(i).perim;
    if (key === 'status') return STATUSES.findIndex((s) => s.id === progOf(m).st);
    if (key === 'pct') return progOf(m).pct;
    if (key === 'units') return progOf(m).units;
    return i;
  };
  list.sort((a, b) => {
    const va = val(a), vb = val(b);
    const c = typeof va === 'string' ? natural.compare(va, vb) : va - vb;
    return (c || a.i - b.i) * view.dir;
  });
  return list;
}

function refresh() {
  if (!win || win.closed) { cleanup(); return; }
  if (!S.doc) { closeMarkupsWindow(); return; }
  const d = S.doc;
  win.document.title = `Markups — ${d.projectName || d.name}`;
  // the columns change with the scale and the progress map
  const cols = columns();
  const key = cols.map((c) => c.id).join(',');
  if (key !== colsKey) {
    colsKey = key;
    rows.clear();
    el.tbody.innerHTML = '';
  }
  renderHead(cols);
  renderChips();
  const list = shownList();
  lastShown = list.map((x) => x.m.id);
  const keep = new Set(lastShown);
  for (const [id, r] of rows) if (!keep.has(id)) { r.tr.remove(); rows.delete(id); }
  let prev = null;
  for (const { m, i } of list) {
    const r = rowFor(m, cols);
    updateRow(r, m, i, cols);
    const want = prev ? prev.nextSibling : el.tbody.firstChild;
    if (want !== r.tr) el.tbody.insertBefore(r.tr, want);
    prev = r.tr;
  }
  // selection: one made on the sheet brings its row into view
  const key2 = [...S.selection].join();
  if (key2 !== selKey) {
    selKey = key2;
    if (!fromHere) { const id = lastShown.find((q) => S.selection.has(q)); if (id) scrollToRow(rows.get(id).tr); }
  }
  fromHere = false;
  const nSel = S.markups.filter((m) => S.selection.has(m.id)).length;
  const shownSel = lastShown.filter((id) => S.selection.has(id)).length;
  if (el.all) {
    el.all.checked = lastShown.length > 0 && shownSel === lastShown.length;
    el.all.indeterminate = shownSel > 0 && shownSel < lastShown.length;
  }
  el.act.classList.toggle('none', nSel === 0);
  el.act.classList.toggle('few', nSel < 2);
  el.selTitle.textContent = nSel ? `${nSel} selected` : 'Nothing selected';
  const into = nSel >= 2 ? S.markups.find((m) => m.id === mergeTarget()) : null;
  el.mergeBtn.title = into
    ? `Merge the ${nSel} selected markups into “${short(into.name)}” (the first selected in the table), which keeps its name, colour and status${keyLabel('edit.merge') ? ` (${keyLabel('edit.merge')})` : ''}. Or drag a row onto another.`
    : 'Merge markups into one: select two or more, or drag a row onto another';
  el.stGrp.hidden = el.stSep.hidden = !progressOn();
  const n = S.markups.length;
  el.count.textContent = `${n} markup${n === 1 ? '' : 's'}` + (lastShown.length !== n ? ` · ${lastShown.length} shown` : '');
  el.empty.hidden = lastShown.length > 0;
  el.empty.textContent = n ? 'No markup matches. Clear the search or the filters.' : 'No markups yet. Fill an area or draw a polygon on the sheet.';
  el.table.hidden = lastShown.length === 0;
  // totals of what is shown
  if (hasScale() && lastShown.length) {
    const t = totals(new Set(lastShown));
    el.tot.textContent = `${lastShown.length === n ? 'All' : 'Shown'}: ${areaLabel(t.area)} · P ${lengthLabel(t.perim)}`;
  } else el.tot.textContent = '';
}

function renderHead(cols) {
  const key = colsKey + '|' + view.sort + '|' + view.dir;
  if (el.headKey === key) return;
  el.headKey = key;
  el.thead.innerHTML = '';
  const tr = E('tr');
  for (const c of cols) {
    if (c.id === 'chk') {
      el.all = E('input', { type: 'checkbox', 'aria-label': 'Select all shown', title: 'Select all shown (Ctrl+A)' });
      el.all.addEventListener('change', () => (el.all.checked ? selectShown() : setSelection(S.markups.filter((m) => S.selection.has(m.id) && !lastShown.includes(m.id)).map((m) => m.id))));
      tr.append(E('th', { class: 'c-chk' }, el.all));
      continue;
    }
    if (c.id === 'act') { tr.append(E('th', { class: 'c-act' })); continue; }
    const on_ = view.sort === c.sort || (!view.sort && c.sort === 'idx');
    const arrow = E('span', { class: 'arrow' }, on_ ? (view.dir > 0 ? '▲' : '▼') : '');
    const th = E('th', { class: `sort c-${c.id}` + (c.num ? ' num' : ''), title: c.title || `Sort by ${c.label.toLowerCase()}` }, c.label, ' ', arrow);
    th.addEventListener('click', () => {
      if (view.sort === c.sort || (!view.sort && c.sort === 'idx')) view.dir = -view.dir;
      else { view.sort = c.sort; view.dir = 1; }
      el.headKey = '';
      later();
    });
    tr.append(th);
  }
  el.thead.append(tr);
}

function renderChips() {
  // colours in use (their own colour, not the status colour), most used first
  const byColour = new Map();
  for (const m of S.markups) { const k = m.color.toUpperCase(); byColour.set(k, (byColour.get(k) || 0) + 1); }
  if (view.colour && !byColour.has(view.colour)) view.colour = null;
  const ck = [...byColour].map(([k, n]) => k + n).join() + '|' + view.colour;
  if (el.colKey !== ck) {
    el.colKey = ck;
    el.colours.innerHTML = '';
    if (byColour.size > 1) {
      el.colours.append(E('span', { class: 'mw-label' }, 'Colour'));
      el.colours.append(E('button', { class: 'mw-chip' + (view.colour ? '' : ' on'), onclick: () => { view.colour = null; later(); } }, 'All'));
      for (const [k, n] of [...byColour].sort((a, b) => b[1] - a[1])) {
        el.colours.append(E('button', { class: 'mw-chip' + (view.colour === k ? ' on' : ''), title: `Show only ${colorName(k).toLowerCase()} markups`, onclick: () => { view.colour = view.colour === k ? null : k; later(); } },
          E('span', { class: 'mw-dot', style: { background: k } }), colorName(k), E('span', { class: 'n' }, String(n))));
      }
    }
  }
  // statuses, on the progress map
  const pk = progressOn() ? STATUSES.map((s) => s.id + S.markups.filter((m) => progOf(m).st === s.id).length).join() + '|' + view.status : 'off';
  if (el.stKey !== pk) {
    el.stKey = pk;
    el.statuses.innerHTML = '';
    if (!progressOn()) { view.status = null; return; }
    el.statuses.append(E('span', { class: 'mw-label' }, 'Status'));
    el.statuses.append(E('button', { class: 'mw-chip' + (view.status ? '' : ' on'), onclick: () => { view.status = null; later(); } }, 'All'));
    for (const st of STATUSES) {
      const n = S.markups.filter((m) => progOf(m).st === st.id).length;
      el.statuses.append(E('button', { class: 'mw-chip' + (view.status === st.id ? ' on' : ''), onclick: () => { view.status = view.status === st.id ? null : st.id; later(); } },
        E('span', { class: 'mw-dot', style: { background: st.color, borderRadius: '50%' } }), st.label, E('span', { class: 'n' }, String(n))));
    }
  }
}

// ------------------------------------------------------------------ rows

function rowFor(m, cols) {
  let r = rows.get(m.id);
  if (r) return r;
  const id = m.id;
  r = { id, m: null, cells: {}, vals: {} };
  const tr = E('tr', { 'data-id': id });
  for (const c of cols) {
    let td;
    if (c.id === 'chk') {
      const cb = E('input', { type: 'checkbox', 'aria-label': 'Selected' });
      cb.addEventListener('click', (e) => { e.stopPropagation(); toggle(id); });
      td = E('td', null, cb);
      r.cells.chk = cb;
    } else if (c.id === 'idx') {
      // the grip: drag the row onto another to merge them
      const n = E('span', { class: 'n' });
      td = E('td', { class: 'num' }, E('span', { class: 'in' }, E('span', { class: 'mw-grip', title: 'Drag onto another markup to merge them', html: icon('grip-vertical', 14) }), n));
      r.cells.idxN = n;
    } else if (c.id === 'colour') {
      const b = E('button', { class: 'mw-swb', title: 'Change the colour' });
      b.addEventListener('click', (e) => { e.stopPropagation(); colourPop(b, S.selection.has(id) ? selectedIds() : [id]); });
      td = E('td', null, b);
      r.cells.colour = b;
    } else if (c.id === 'name') {
      const inp = E('input', { class: 'mw-name', maxlength: 120, spellcheck: 'false', 'aria-label': 'Name' });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); inp.value = r.m.name || ''; inp.blur(); }
      });
      inp.addEventListener('change', () => rename(id, inp.value));
      inp.addEventListener('focus', () => { if (!S.selection.has(id)) { setSelection([id]); anchor = id; } });
      td = E('td', { style: { width: '40%' } }, inp);
      r.cells.name = inp;
    } else if (c.id === 'status') {
      const sel = E('select', { class: 'mw-sel', 'aria-label': 'Status' }, ...STATUSES.map((st) => E('option', { value: st.id }, st.label)));
      sel.addEventListener('change', () => setProg([id], { st: sel.value }));
      td = E('td', null, sel);
      r.cells.status = sel;
    } else if (c.id === 'pct') {
      const inp = E('input', { class: 'mw-numin', type: 'number', min: 0, max: 100, step: 5, 'aria-label': '% done' });
      inp.addEventListener('change', () => setProg([id], { pct: +inp.value }));
      const txt = E('span');
      td = E('td', { class: 'num' }, inp, txt);
      r.cells.pct = inp; r.cells.pctTxt = txt;
    } else if (c.id === 'units') {
      const inp = E('input', { class: 'mw-numin', type: 'number', min: 0, step: 1, 'aria-label': 'Units' });
      inp.addEventListener('change', () => setProg([id], { units: +inp.value }));
      td = E('td', { class: 'num' }, inp);
      r.cells.units = inp;
    } else if (c.id === 'act') {
      const z = E('button', { class: 'mw-icon', title: 'Zoom to it on the sheet', 'aria-label': 'Zoom to it', html: icon('locate', 15) });
      z.addEventListener('click', (e) => { e.stopPropagation(); zoomTo([id]); });
      const del = E('button', { class: 'mw-icon del', title: 'Delete', 'aria-label': 'Delete', html: icon('trash-2', 15) });
      del.addEventListener('click', (e) => { e.stopPropagation(); remove([id]); });
      td = E('td', { class: 'num' }, z, del);
    } else {
      td = E('td', { class: c.num ? 'num' : '' });
    }
    td.classList.add('c-' + c.id);
    r.cells['td_' + c.id] = td;
    tr.append(td);
  }
  tr.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select')) return;
    pressRow(id, e, tr);
  });
  tr.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, select')) zoomTo([id]); });
  tr.addEventListener('pointerenter', () => { if (drag) return; T.hoverId = id; actions.requestUI && actions.requestUI(); });
  tr.addEventListener('pointerleave', () => { if (drag) return; if (T.hoverId === id) { T.hoverId = null; actions.requestUI && actions.requestUI(); } });
  r.tr = tr;
  rows.set(id, r);
  return r;
}

/** Scrolls the table just enough to show a row (clear of the column titles). */
function scrollToRow(tr) {
  const wrap = el.wrap, head = el.thead.offsetHeight;
  const top = tr.offsetTop, bottom = top + tr.offsetHeight;
  if (top < wrap.scrollTop + head) wrap.scrollTop = Math.max(0, top - head - 4);
  else if (bottom > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = bottom - wrap.clientHeight + 4;
}

function setText(r, key, text) {
  if (r.vals[key] === text) return;
  r.vals[key] = text;
  r.cells['td_' + key].textContent = text;
}

function updateRow(r, m, i, cols) {
  const d = win.document;
  const sel = S.selection.has(m.id);
  r.tr.classList.toggle('sel', sel);
  if (r.cells.chk.checked !== sel) r.cells.chk.checked = sel;
  const idx = String(i + 1);
  if (r.vals.idx !== idx) { r.vals.idx = idx; r.cells.idxN.textContent = idx; }
  const bg = tintOnPaper(m.color, Math.max(m.opacity, 0.35));
  if (r.vals.bg !== bg) { r.vals.bg = bg; r.cells.colour.style.background = bg; r.cells.colour.title = `${colorName(m.color)} ${m.color.toUpperCase()}: change the colour`; }
  if (d.activeElement !== r.cells.name && r.cells.name.value !== (m.name || '')) r.cells.name.value = m.name || '';
  for (const c of cols) {
    if (c.id === 'area') setText(r, 'area', areaLabel(measureAt(i).area));
    else if (c.id === 'perim') setText(r, 'perim', lengthLabel(measureAt(i).perim));
    else if (c.id === 'status') { const st = progOf(m).st; if (r.cells.status.value !== st) r.cells.status.value = st; r.cells.status.style.borderColor = STATUS[st].color; }
    else if (c.id === 'pct') {
      const p = progOf(m);
      const edit = p.st === 'doing';
      r.cells.pct.hidden = !edit;
      r.cells.pctTxt.hidden = edit;
      if (edit && d.activeElement !== r.cells.pct && +r.cells.pct.value !== p.setPct) r.cells.pct.value = String(p.setPct);
      r.cells.pctTxt.textContent = p.st === 'skip' ? '—' : p.pct + '%';
    } else if (c.id === 'units') {
      const u = progOf(m).units;
      if (d.activeElement !== r.cells.units && +r.cells.units.value !== u) r.cells.units.value = String(u);
    }
  }
  r.m = m;
}

// ------------------------------------------------------------------ selecting

const selectedIds = () => S.markups.filter((m) => S.selection.has(m.id)).map((m) => m.id);
const short = (s) => { const t = String(s || ''); return t.length > 32 ? t.slice(0, 31) + '…' : t; };

function clickRow(id, e) {
  if (e.shiftKey && anchor && lastShown.includes(anchor)) {
    const a = lastShown.indexOf(anchor), b = lastShown.indexOf(id);
    const range = lastShown.slice(Math.min(a, b), Math.max(a, b) + 1);
    setSelection(e.ctrlKey ? [...new Set([...selectedIds(), ...range])] : range);
    return;
  }
  if (e.ctrlKey || e.metaKey) { toggle(id); return; }
  setSelection([id]);
  anchor = id;
}

function toggle(id) {
  const s = new Set(selectedIds());
  if (s.has(id)) s.delete(id); else s.add(id);
  setSelection([...s]);
  anchor = id;
}

function selectShown() { setSelection([...lastShown]); }

/** Shows on the drawing the markup of a row just clicked (with Show on drawing ticked). */
function follow(id) {
  if (view.follow && S.selection.has(id) && actions.reveal) actions.reveal([id]);
}

// ------------------------------------------------------------------ pressing and dragging rows

function pressRow(id, e, tr) {
  endDrag(false);
  const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey;
  // a plain press on one row of a selection of several may be the start of dragging them all: the
  // click that selects that row alone waits until the button comes up without a drag
  const deferClick = plain && S.selection.has(id) && selectedIds().length > 1;
  if (!deferClick) clickRow(id, e);
  press = { id, x: e.clientX, y: e.clientY, pid: e.pointerId, tr, deferClick };
  try { tr.setPointerCapture(e.pointerId); } catch { /* the document still hears the moves */ }
}

function onPressMove(e) {
  if (!press || e.pointerId !== press.pid) return;
  if (!drag) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
    startDrag();
  }
  drag.cx = e.clientX;
  drag.cy = e.clientY;
  dragOver();
}

function onPressUp(e) {
  if (!press || e.pointerId !== press.pid) return;
  const p = press;
  press = null;
  if (drag) { endDrag(true); return; }
  if (p.deferClick) clickRow(p.id, { shiftKey: false, ctrlKey: false, metaKey: false });
  follow(p.id);
}

function startDrag() {
  const ids = S.selection.has(press.id) ? selectedIds() : [press.id];
  const ghost = E('div', { class: 'mw-ghost' });
  win.document.body.append(ghost);
  win.document.body.classList.add('mw-dragging');
  drag = { ids: new Set(ids), target: null, cx: press.x, cy: press.y, ghost, raf: 0 };
  for (const id of ids) { const r = rows.get(id); if (r) r.tr.classList.add('dragged'); }
  drag.raf = win.requestAnimationFrame(autoScroll);
}

/** Under the pointer: the row to merge into, if any; the label by the pointer says what will happen. */
function dragOver() {
  const g = drag;
  if (!g || !win) return;
  const hit = win.document.elementFromPoint(g.cx, g.cy);
  const tr = hit && hit.closest ? hit.closest('tbody tr[data-id]') : null;
  const id = tr ? tr.getAttribute('data-id') : null;
  const target = id && !g.ids.has(id) && S.markups.some((m) => m.id === id) ? id : null;
  if (target !== g.target) {
    if (g.target && rows.get(g.target)) rows.get(g.target).tr.classList.remove('drop');
    g.target = target;
    if (target && rows.get(target)) rows.get(target).tr.classList.add('drop');
    T.hoverId = target;
    actions.requestUI && actions.requestUI();
  }
  const list = S.markups.filter((m) => g.ids.has(m.id));
  const what = list.length > 1 ? `${list.length} markups` : `“${short(list[0] && list[0].name)}”`;
  const into = target ? S.markups.find((m) => m.id === target) : null;
  const sw = into || list[0];
  g.ghost.innerHTML = '';
  if (sw) g.ghost.append(E('span', { class: 'mw-dot', style: { background: tintOnPaper(sw.color, Math.max(sw.opacity, 0.35)) } }));
  g.ghost.append(E('span', null, into ? `Merge ${what} into “${short(into.name)}”` : `${what}: drop on another markup to merge`));
  g.ghost.classList.toggle('ok', !!into);
  const gw = g.ghost.offsetWidth, gh = g.ghost.offsetHeight;
  g.ghost.style.left = Math.max(4, Math.min(win.innerWidth - gw - 4, g.cx + 16)) + 'px';
  g.ghost.style.top = (g.cy + 18 + gh > win.innerHeight ? g.cy - gh - 12 : g.cy + 18) + 'px';
}

/** Near the top or the bottom of the table the rows scroll, so a row far away can be reached. */
function autoScroll() {
  if (!drag || !win) return;
  const wr = el.wrap.getBoundingClientRect();
  const head = el.thead.getBoundingClientRect().height;
  const zone = 34;
  let v = 0;
  if (drag.cy < wr.top + head + zone) v = -Math.ceil((wr.top + head + zone - drag.cy) / 3);
  else if (drag.cy > wr.bottom - zone) v = Math.ceil((drag.cy - (wr.bottom - zone)) / 3);
  if (v) {
    const before = el.wrap.scrollTop;
    el.wrap.scrollTop = before + Math.max(-40, Math.min(40, v));
    if (el.wrap.scrollTop !== before) dragOver();
  }
  drag.raf = win.requestAnimationFrame(autoScroll);
}

function endDrag(commit) {
  const g = drag;
  if (!g) return;
  drag = null;
  if (win && !win.closed) {
    win.cancelAnimationFrame(g.raf);
    g.ghost.remove();
    win.document.body.classList.remove('mw-dragging');
  }
  for (const r of rows.values()) r.tr.classList.remove('dragged', 'drop');
  T.hoverId = null;
  actions.requestUI && actions.requestUI();
  if (commit && g.target) mergeInto([...g.ids], g.target);
}

// ------------------------------------------------------------------ changing markups (one undo step each)

function setProps(ids, label, fn) {
  const set = new Set(ids);
  if (!set.size) return;
  change(label, () => { S.markups = S.markups.map((m) => (set.has(m.id) ? fn(m) : m)); });
}

function recolour(ids, hex) {
  const v = normalizeHex(hex);
  if (!v || !ids.length) return;
  const n = ids.length;
  setProps(ids, n > 1 ? `Change colour of ${n} markups` : 'Change colour', (m) => (m.color === v ? m : withProps(m, { color: v })));
  if (progressOn()) say('The progress map is on, so the sheet shows status colours. The colours you set come back when you turn it off.');
}

function rename(id, value) {
  const v = String(value || '').replace(/\s+/g, ' ').trim();
  const m = S.markups.find((q) => q.id === id);
  if (!m) return;
  if (!v) { later(); return; }
  if (v !== m.name) setProps([id], 'Rename', (q) => withProps(q, { name: v }));
}

function setProg(ids, props) {
  if (!ids.length) return;
  const n = ids.length;
  const what = n > 1 ? `${n} zones` : 'zone';
  const label = props.st ? `Set ${what} to ${STATUS[props.st].label}` : props.pct !== undefined ? 'Change % done' : 'Change units';
  setProps(ids, label, (m) => withProg(m, props));
}

function remove(ids) {
  const set = new Set(ids);
  const n = S.markups.filter((m) => set.has(m.id)).length;
  if (!n) return;
  change(n > 1 ? `Delete ${n} markups` : 'Delete markup', () => { S.markups = S.markups.filter((m) => !set.has(m.id)); });
  setSelection([...S.selection].filter((id) => !set.has(id)));
  say(n > 1 ? `Deleted ${n} markups.` : 'Deleted 1 markup.', 'Undo', () => actions.undo && actions.undo());
}

/** The markup the selection merges into with the Merge button: the first selected in the table. */
function mergeTarget() {
  return lastShown.find((id) => S.selection.has(id)) || selectedIds()[0] || null;
}

function mergeSelectedHere() {
  const ids = selectedIds();
  if (ids.length < 2) { say('Select two or more markups to merge them, or drag a row onto another.'); return; }
  mergeInto(ids, mergeTarget());
}

/** Merges markups into one of them: one markup, each area keeping its own shape. */
function mergeInto(ids, intoId) {
  fromHere = true;
  const res = mergeMarkups(ids, intoId);
  if (!res) return;
  anchor = res.into.id;
  say(`Merged ${res.n} markups into “${short(res.into.name)}”.`, 'Undo', () => actions.undo && actions.undo());
  if (view.follow && actions.reveal) actions.reveal([res.into.id]);
}

function zoomTo(ids) { if (ids.length && actions.zoomTo) actions.zoomTo(ids); }

/** A message in the foot of the window, with an optional action (such as Undo). */
function say(text, actLabel = null, fn = null) {
  if (!el.msg) return;
  el.msg.innerHTML = '';
  el.msg.append(E('span', null, text));
  if (actLabel) el.msg.append(E('button', { class: 'mw-link', onclick: () => { el.msg.innerHTML = ''; fn(); } }, actLabel));
  clearTimeout(el.msgTimer);
  el.msgTimer = setTimeout(() => { if (el.msg) el.msg.innerHTML = ''; }, 7000);
}

// ------------------------------------------------------------------ colours

/** The palette (and any colour) for the markups `ids`, under the button that opened it. */
function colourPop(anchorEl, ids) {
  closePop();
  if (!ids.length) return;
  const any = E('input', { type: 'color' });
  any.addEventListener('change', () => { recolour(ids, any.value.toUpperCase()); closePop(); });
  const pop = E('div', { class: 'mw-pop', role: 'dialog', 'aria-label': 'Colour' },
    E('div', { class: 'pal' }, ...favourites().map((p) => E('button', { class: 'mw-sw', title: p.name, 'aria-label': p.name, style: { background: p.hex }, onclick: () => { recolour(ids, p.hex); closePop(); } }))),
    E('div', { class: 'more' }, E('button', { class: 'mw-btn', onclick: () => any.click() }, 'Any colour…'), any,
      ids.length > 1 ? E('span', { class: 'mw-label' }, `${ids.length} markups`) : null));
  win.document.body.append(pop);
  const r = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(6, Math.min(win.innerWidth - pw - 6, r.left)) + 'px';
  pop.style.top = (r.bottom + ph + 6 > win.innerHeight ? Math.max(6, r.top - ph - 4) : r.bottom + 4) + 'px';
  el.pop = pop;
}

function closePop() {
  if (el.pop) { el.pop.remove(); el.pop = null; }
}

// ------------------------------------------------------------------ keys

function onKey(e) {
  const typing = e.target && e.target.closest && e.target.closest('input:not([type=checkbox]), select, textarea');
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    if (drag) { e.preventDefault(); endDrag(false); press = null; return; }
    if (el.pop) { closePop(); return; }
    if (typing === el.search && view.q) { el.search.value = ''; view.q = ''; later(); return; }
    if (!typing) setSelection([]);
    return;
  }
  if (typing) return;
  // the keys set in Preferences, as on the sheet; Ctrl+F and Ctrl+W are this window's own
  const act = actionOf(e);
  const k = e.code === 'KeyF' ? 'f' : e.code === 'KeyW' ? 'w' : e.key.toLowerCase();
  if (act === 'edit.selectAll') { e.preventDefault(); selectShown(); }
  else if (act === 'edit.undo') { e.preventDefault(); actions.undo && actions.undo(); }
  else if (act === 'edit.redo') { e.preventDefault(); actions.redo && actions.redo(); }
  else if (act === 'edit.merge') { e.preventDefault(); mergeSelectedHere(); }
  else if (act === 'edit.delete') { e.preventDefault(); remove(selectedIds()); }
  else if (ctrl && !e.shiftKey && k === 'f') { e.preventDefault(); el.search.focus(); el.search.select(); }
  else if (ctrl && !e.shiftKey && k === 'w') { e.preventDefault(); win.close(); }
  else if (act === 'edit.rename') {
    const id = (anchor && S.selection.has(anchor)) ? anchor : selectedIds()[0];
    const r = id && rows.get(id);
    if (r) { e.preventDefault(); r.cells.name.focus(); r.cells.name.select(); }
  }
}
