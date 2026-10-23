// Side panel: the progress map. The switch colours the sheet by status (red not started, amber in
// progress, green done). The section shows the % complete, the zones by status, what the % is
// weighted by, and sets the status, % done and units of the selected zones.

import { S, on, emit, selectedMarkups } from './state.js';
import { h, scrollWithin } from './ui.js';
import { change, commit, snapshot } from './history.js';
import { hasScale } from './units.js';
import { STATUSES, STATUS, progOf, withProg, progressSummary, progressOn, commonStatus, fmtPct } from './progress.js';

let els = {};
let actions = {};

/** Changes the progress map settings as one undo step. */
export function setProgress(label, props) {
  if (!S.doc) return;
  const next = Object.freeze({ ...S.progress, ...props });
  if (Object.keys(props).every((k) => S.progress[k] === next[k])) return;
  change(label, () => { S.progress = next; });
  if (actions.requestUI) actions.requestUI();
}

/** Sets status, % done or units of the selected zones as one undo step. Returns false when none is selected. */
export function setZoneProg(props, label = null) {
  const ids = S.selection;
  const ms = S.markups.filter((m) => ids.has(m.id));
  if (!ms.length) return false;
  const what = ms.length > 1 ? `${ms.length} zones` : 'zone';
  const lbl = label || (props.st ? `Set ${what} to ${STATUS[props.st].label}` : props.pct !== undefined ? 'Change % done' : 'Change units');
  change(lbl, () => { S.markups = S.markups.map((m) => (ids.has(m.id) ? withProg(m, props) : m)); });
  return true;
}

// a slider drag is one undo step
let txn = null;
function liveProg(props) {
  const ids = S.selection;
  if (!S.markups.some((m) => ids.has(m.id))) return;
  if (!txn) txn = snapshot();
  S.markups = S.markups.map((m) => (ids.has(m.id) ? withProg(m, props) : m));
  emit('doc');
}
function endLive() {
  if (!txn) return;
  const before = txn;
  txn = null;
  commit('Change % done', before);
}

export function buildProgress(acts) {
  actions = acts;
  const sw = h('button', {
    class: 'switch', id: 'pg-switch', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Progress map',
    'data-tip': 'Colour the sheet by status: red not started, amber in progress, green done', 'data-tip-side': 'top',
    onclick: () => {
      setProgress(progressOn() ? 'Progress map off' : 'Progress map on', { on: !progressOn() });
      if (progressOn()) scrollWithin(document.getElementById('panel-mid'), els.sec);
    },
  }, h('span', { class: 'knob' }));
  const sum = h('span', { class: 'pg-sum', id: 'pg-sum' });
  const head = h('div', { class: 'sec-head' }, h('span', { class: 'sec-title' }, 'Progress map'), sum, sw);

  const big = h('span', { class: 'pg-big', id: 'pg-big' });
  const bar = h('div', { class: 'pg-bar', id: 'pg-bar' }, ...['done', 'doing', 'todo'].map((id) => h('span', { class: 'pg-seg', 'data-st': id, style: { background: STATUS[id].color } })));
  const counts = h('div', { class: 'pg-counts', id: 'pg-counts' });

  const bySegs = h('div', { class: 'segs', id: 'pg-by' }, ...[
    ['area', 'Area', 'Weigh each zone by its area on the sheet'],
    ['units', 'Units', 'Weigh each zone by the units you give it, such as the number of play areas in it'],
  ].map(([v, label, tip]) => h('button', { class: 'seg', 'data-v': v, 'data-tip': tip, 'data-tip-side': 'top', onclick: () => setProgress(v === 'units' ? 'Count by units' : 'Count by area', { by: v }) }, label)));
  const labels = h('label', { class: 'check', 'data-tip': 'Write each zone’s % done on the sheet (it prints). Drag a label to move it.', 'data-tip-side': 'top' },
    h('input', { type: 'checkbox', id: 'pg-labels', onchange: (e) => setProgress(e.target.checked ? 'Show % on sheet' : 'Hide % on sheet', { labels: e.target.checked }) }),
    h('span', null, '% on sheet'));

  const selTitle = h('div', { class: 'pg-sel-title', id: 'pg-sel-title' });
  const stBtns = h('div', { class: 'pg-st', id: 'pg-st', role: 'radiogroup', 'aria-label': 'Status of the selected zones' }, ...STATUSES.map((st) => h('button', {
    class: 'pg-st-btn', 'data-st': st.id, role: 'radio', 'data-tip': st.id === 'skip' ? 'Leave out of every total, like a cancelled item' : `Set the selected zones to ${st.label}`, 'data-key': st.key, 'data-tip-side': 'top',
    onclick: () => setZoneProg({ st: st.id }),
  }, h('span', { class: 'pg-dot', style: { background: st.color } }), st.label)));
  const pct = h('input', { type: 'range', min: 0, max: 100, step: 5, id: 'pg-pct', 'aria-label': '% done' });
  const pctVal = h('span', { class: 'val', id: 'pg-pct-val' });
  pct.addEventListener('input', () => { pctVal.textContent = pct.value + '%'; liveProg({ pct: +pct.value }); });
  pct.addEventListener('change', endLive);
  const units = h('input', { type: 'number', min: '0.01', step: '1', class: 'pg-units', id: 'pg-units', 'aria-label': 'Units of the selected zones' });
  units.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') units.blur(); if (e.key === 'Escape') { refreshProgress(); units.blur(); } });
  units.addEventListener('change', () => {
    const v = parseFloat(String(units.value).replace(',', '.'));
    if (v > 0) setZoneProg({ units: v }, 'Change units'); else refreshProgress();
  });
  const pctRow = h('div', { class: 'field', id: 'pg-pct-row' }, h('label', { for: 'pg-pct' }, '% done'), pct, pctVal);
  const unitsRow = h('div', { class: 'ms-row', id: 'pg-units-row' }, h('span', { class: 'ms-label' }, 'Units'), units, h('span', { class: 'ms-sub' }, 'each selected zone'));
  const sel = h('div', { class: 'pg-sel', id: 'pg-sel' }, selTitle, stBtns, pctRow, unitsRow);
  const note = h('p', { class: 'pg-note', id: 'pg-note' });
  const report = h('button', { class: 'link-btn', id: 'pg-report', 'data-tip': 'Save every zone with its status and % done, and the % complete, as an Excel workbook', 'data-tip-side': 'top', onclick: () => actions.saveAs('progress') }, 'Progress report…');
  const body = h('div', { class: 'pg-body', id: 'pg-body' },
    h('div', { class: 'pg-total' }, big, bar), counts,
    h('div', { class: 'ms-row' }, h('span', { class: 'ms-label' }, 'Count by'), bySegs, h('span', { class: 'flex' }), labels),
    sel, note,
    h('div', { class: 'ms-row ms-foot' }, h('span', { class: 'flex' }), report));
  const sec = h('section', { class: 'pg-sec', id: 'pg-sec' }, head, body);
  els = { sec, sw, sum, big, bar, counts, bySegs, labels, sel, selTitle, stBtns, pct, pctVal, units, note, pctRow, unitsRow };
  for (const ev of ['doc', 'selection', 'docLoaded', 'scale']) on(ev, refreshProgress);
  refreshProgress();
  return sec;
}

export function refreshProgress() {
  if (!els.sec) return;
  const doc = !!S.doc;
  const onNow = doc && progressOn();
  els.sw.classList.toggle('on', onNow);
  els.sw.setAttribute('aria-checked', String(onNow));
  els.sw.disabled = !doc;
  els.sec.classList.toggle('open', onNow);
  if (!onNow) { els.sum.textContent = ''; return; }
  const s = progressSummary();
  const any = S.markups.length > 0;
  els.sum.textContent = any ? fmtPct(s.pct) : '';
  els.big.textContent = any ? `${fmtPct(s.pct)} complete` : 'No zones yet';
  for (const seg of els.bar.children) {
    const g = s.groups[seg.getAttribute('data-st')];
    seg.style.width = (s.wAll > 0 ? (g.w / s.wAll) * 100 : 0) + '%';
  }
  const g = s.groups;
  els.counts.textContent = any
    ? [`${g.done.n} done`, `${g.doing.n} in progress`, `${g.todo.n} not started`, g.skip.n ? `${g.skip.n} not counted` : ''].filter(Boolean).join(' · ')
    : '';
  for (const b of els.bySegs.children) b.classList.toggle('on', b.getAttribute('data-v') === s.by);
  els.labels.querySelector('input').checked = !!S.progress.labels;

  // the status of the selected zones (the box shows only while zones are selected)
  const ms = selectedMarkups();
  els.sel.hidden = !ms.length;
  els.selTitle.textContent = !ms.length ? '' : ms.length === 1 ? (ms[0].name || 'Untitled') : `${ms.length} zones selected`;
  const cs = commonStatus(ms);
  for (const b of els.stBtns.children) {
    const onB = !!ms.length && b.getAttribute('data-st') === cs;
    b.classList.toggle('on', onB);
    b.setAttribute('aria-checked', onB ? 'true' : 'false');
    b.disabled = !ms.length;
  }
  const doing = ms.length > 0 && cs === 'doing';
  els.pctRow.hidden = !doing;
  if (doing && !txn) {
    const v = progOf(ms[0]).setPct;
    els.pct.value = v;
    els.pctVal.textContent = ms.every((m) => progOf(m).setPct === v) ? v + '%' : 'Mixed';
  }
  const byUnits = s.by === 'units';
  els.unitsRow.hidden = !(byUnits && ms.length);
  if (byUnits && ms.length && document.activeElement !== els.units) {
    const u = progOf(ms[0]).units;
    els.units.value = ms.every((m) => progOf(m).units === u) ? String(u) : '';
    els.units.placeholder = ms.every((m) => progOf(m).units === u) ? '' : 'Mixed';
  }
  els.note.textContent = !any
    ? 'Fill or draw the zones first. Each one starts as Not started.'
    : !ms.length ? 'Select zones to set their status. Keys: 1 not started, 2 in progress, 3 done, 0 not counted.'
      : s.by === 'area' && !hasScale() ? 'No scale set: the % uses the zones’ areas on the sheet, which gives the same %.' : '';
  els.note.hidden = !els.note.textContent;
}
