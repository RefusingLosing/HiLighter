// Side panel: snag pins. The Snags section lists every pin with its number, status, note, trade and
// place, and saves the snag list. When pins are selected, the card at the top of the panel edits them
// instead of the markup style: status, trade, note and photo (from a file, pasted, or dropped on it).

import { S, on, emit, setSelection } from './state.js';
import { h, icon, toast, modal, scrollWithin } from './ui.js';
import { change } from './history.js';
import { V, zoomToRect, visibleSheetRect, clampPan } from './view.js';
import { requestAll } from './render.js';
import {
  PIN_STATUSES, PIN_STATUS, TRADES, withPin, selectedPins, pinsByNumber, pinCounts, pinPlace, tradesInUse,
  rememberTrade, preparePhoto, addPhoto, photoUrl, pinSize,
} from './pins.js';

let actions = {};
let els = {};
let filter = 'all';
let open = false;
try { open = localStorage.getItem('plantint.snagsOpen') === '1'; } catch { /* storage is optional */ }

const fmtDay = (s) => (s ? s.split('-').reverse().join('/') : '');
const short = (s, n = 60) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** Ends typing in the panel (commits it) before the selection changes. */
export function flushEdits() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.closest('#panel')) a.blur();
}

/** Changes the given pins (the selected ones by default) as one undo step. */
export function setPins(label, props, ids = new Set(selectedPins().map((p) => p.id))) {
  if (!ids.size) return false;
  return change(label, () => { S.pins = S.pins.map((p) => (ids.has(p.id) ? withPin(p, props) : p)); });
}

export function setPinStatus(st) {
  const n = selectedPins().length;
  if (!n) return false;
  return setPins(`Set ${n > 1 ? n + ' pins' : 'pin'} to ${PIN_STATUS[st].label}`, { status: st });
}

/** Moves the view to show the pins (closer when they are far away or out of sight). */
export function showPins(pins) {
  if (!pins.length || !S.doc) return;
  const z = pinSize();
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pins) b = [Math.min(b[0], p.x - z.r), Math.min(b[1], p.y - z.tail - z.r), Math.max(b[2], p.x + z.r), Math.max(b[3], p.y)];
  const pad = Math.min(S.doc.W, S.doc.H) * 0.08;
  const r = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  const vis = visibleSheetRect();
  if (!(r[0] >= vis[0] && r[1] >= vis[1] && r[2] <= vis[2] && r[3] <= vis[3])) {
    const s0 = V.scale;
    zoomToRect(r[0], r[1], r[2], r[3], 40);
    if (V.scale < s0) {
      // already closer than that: keep the zoom, just bring the pins to the middle
      V.scale = s0;
      V.tx = V.cw / 2 - ((b[0] + b[2]) / 2) * s0;
      V.ty = V.ch / 2 - ((b[1] + b[3]) / 2) * s0;
      clampPan();
    }
  }
  requestAll();
  emit('view');
}

/** Puts the keys in the note of the one selected pin. */
export function editPinNote() {
  setTimeout(() => {
    const n = els.note;
    if (!n || els.card.hidden) return;
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  }, 0);
}

// ------------------------------------------------------------------ photos

async function attachBytes(id, bytes, type) {
  const p = S.pins.find((q) => q.id === id);
  if (!p) return;
  try {
    const ph = await preparePhoto(bytes, type);
    const pid = addPhoto(ph);
    setPins(p.photo ? 'Replace photo' : 'Add photo', { photo: pid }, new Set([id]));
    toast(`Photo added to snag ${p.n}.`);
  } catch (err) {
    toast(err.message || String(err), { kind: 'error', timeout: 6000 });
  }
}

/** Asks for a photo file for a pin. */
export async function choosePhoto(id) {
  const f = await window.plantint.openPhoto();
  if (f) await attachBytes(id, f.bytes, '');
}

/** A picture file (dropped or pasted) for the one selected pin. Returns true when it was taken. */
export async function photoFile(file) {
  const ps = selectedPins();
  if (ps.length !== 1 || !file || !/^image\//.test(file.type || '')) return false;
  await attachBytes(ps[0].id, new Uint8Array(await file.arrayBuffer()), file.type);
  return true;
}

function viewPhoto(p) {
  const url = photoUrl(p.photo);
  if (!url) return;
  modal({
    title: `Snag ${p.n}` + (p.note ? `: ${short(p.note, 70)}` : ''),
    body: h('div', { class: 'pc-view' }, h('img', { src: url, alt: `Photo of snag ${p.n}` })),
    wide: true,
    buttons: [{ label: 'Close', value: true, primary: true }],
  });
}

// ------------------------------------------------------------------ the pin card

export function buildPinCard(acts) {
  actions = acts;
  const num = h('span', { class: 'pc-num', id: 'pc-num' });
  const title = h('span', { class: 'pc-title', id: 'pc-title' });
  const place = h('span', { class: 'pc-place', id: 'pc-place' });
  const head = h('div', { class: 'pc-head' }, num, h('div', { class: 'pc-tw' }, title, place));
  const st = h('div', { class: 'segs pc-st', id: 'pc-st', role: 'radiogroup', 'aria-label': 'Status' }, ...PIN_STATUSES.map((x) => h('button', {
    class: 'seg', 'data-st': x.id, role: 'radio', 'data-tip': x.tip, 'data-key': x.key, 'data-tip-side': 'top', onclick: () => setPinStatus(x.id),
  }, h('span', { class: 'pg-dot', style: { background: x.color } }), x.label)));

  const trades = h('datalist', { id: 'pc-trades' });
  const trade = h('input', { class: 'pc-input', id: 'pc-trade', list: 'pc-trades', spellcheck: 'false', maxlength: 60, placeholder: 'Trade', 'aria-label': 'Trade' });
  trade.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') trade.blur();
    else if (e.key === 'Escape') {
      // back to what it was, so leaving the box changes nothing
      const ps = selectedPins();
      trade.value = ps.length && ps.every((p) => p.trade === ps[0].trade) ? ps[0].trade : '';
      trade.blur();
    }
  });
  trade.addEventListener('change', () => {
    const v = trade.value.replace(/\s+/g, ' ').trim();
    const ps = selectedPins();
    if (!ps.length || ps.every((p) => p.trade === v)) return;
    setPins('Change trade', { trade: v });
    rememberTrade(v);
  });
  trade.addEventListener('blur', () => refreshPinCard());

  const note = h('textarea', { class: 'pc-note', id: 'pc-note', rows: 3, maxlength: 2000, spellcheck: 'true', placeholder: 'What is wrong, and where exactly', 'aria-label': 'Note' });
  let editing = null; // the pin whose note is being typed
  note.addEventListener('focus', () => { const ps = selectedPins(); editing = ps.length === 1 ? ps[0].id : null; });
  note.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); note.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); const p = S.pins.find((q) => q.id === editing); note.value = p ? p.note : ''; note.blur(); }
  });
  note.addEventListener('blur', () => {
    const id = editing;
    editing = null;
    const p = S.pins.find((q) => q.id === id);
    const v = note.value.replace(/\s+$/, '');
    if (p && v !== p.note) setPins('Edit snag note', { note: v }, new Set([id]));
    else refreshPinCard();
  });

  const thumb = h('button', { class: 'pc-thumb', id: 'pc-thumb', 'aria-label': 'Show the photo larger', onclick: () => { const ps = selectedPins(); if (ps.length === 1) viewPhoto(ps[0]); } });
  const drop = h('div', { class: 'pc-drop', id: 'pc-drop' }, h('span', { html: icon('camera', 18) }), h('span', null, 'Drop or paste a photo'));
  const addBtn = h('button', { class: 'btn small', id: 'pc-add', onclick: () => { const ps = selectedPins(); if (ps.length === 1) choosePhoto(ps[0].id); } });
  const rmBtn = h('button', { class: 'link-btn', id: 'pc-rm', onclick: () => setPins('Remove photo', { photo: null }) }, 'Remove photo');
  const photoRow = h('div', { class: 'pc-photo', id: 'pc-photo' }, thumb, drop, h('div', { class: 'pc-photo-btns' }, addBtn, rmBtn));
  const dates = h('span', { class: 'pc-dates', id: 'pc-dates' });
  const del = h('button', { class: 'link-btn pc-del', onclick: () => actions.deleteSelected() }, 'Delete');
  const card = h('section', { class: 'pin-card', id: 'pin-card', hidden: true },
    head, st,
    h('div', { class: 'pc-row' }, h('span', { class: 'ms-label' }, 'Trade'), trade, trades),
    note, photoRow,
    h('div', { class: 'pc-foot' }, dates, h('span', { class: 'flex' }), del));
  els = { ...els, card, num, title, place, st, trade, trades, note, thumb, drop, addBtn, rmBtn, photoRow, dates };
  for (const ev of ['doc', 'selection', 'docLoaded']) on(ev, refreshPinCard);
  return card;
}

export function refreshPinCard() {
  if (!els.card) return;
  const ps = selectedPins();
  const others = S.markups.some((m) => S.selection.has(m.id)) || S.dims.some((d) => S.selection.has(d.id));
  const show = !!S.doc && ps.length > 0 && !others;
  els.card.hidden = !show;
  const style = document.querySelector('.style-card');
  if (style) style.hidden = show;
  if (!show) return;
  const one = ps.length === 1 ? ps[0] : null;
  const cs = ps.every((p) => p.status === ps[0].status) ? ps[0].status : null;
  els.num.textContent = one ? String(one.n) : String(ps.length);
  els.num.style.background = (PIN_STATUS[cs] || { color: '#7A817C' }).color;
  els.title.textContent = one ? `Snag ${one.n}` : `${ps.length} snags`;
  els.place.textContent = one ? (pinPlace(one) || 'Not inside a zone') : pinsByNumber(ps).map((p) => p.n).join(', ');
  for (const b of els.st.children) {
    const on_ = b.getAttribute('data-st') === cs;
    b.classList.toggle('on', on_);
    b.setAttribute('aria-checked', on_ ? 'true' : 'false');
  }
  els.trades.replaceChildren(...[...new Set([...TRADES, ...tradesInUse()])].map((t) => h('option', { value: t })));
  if (document.activeElement !== els.trade) {
    const t = ps[0].trade;
    const same = ps.every((p) => p.trade === t);
    els.trade.value = same ? t : '';
    els.trade.placeholder = same ? 'Trade' : 'Mixed trades';
  }
  els.note.hidden = !one;
  if (one && document.activeElement !== els.note) els.note.value = one.note;
  els.photoRow.hidden = !one;
  if (one) {
    const url = one.photo ? photoUrl(one.photo) : '';
    els.thumb.hidden = !url;
    els.drop.hidden = !!url;
    if (url) els.thumb.replaceChildren(h('img', { src: url, alt: `Photo of snag ${one.n}` }));
    els.addBtn.innerHTML = icon('camera', 14) + `<span>${url ? 'Replace…' : 'Add photo…'}</span>`;
    els.rmBtn.hidden = !url;
  }
  els.dates.textContent = one ? [one.raised ? `Raised ${fmtDay(one.raised)}` : '', one.closed ? `closed ${fmtDay(one.closed)}` : ''].filter(Boolean).join(', ') : '';
}

// ------------------------------------------------------------------ the Snags section

export function buildSnags(acts) {
  actions = acts;
  const chev = h('span', { class: 'ms-chev', html: icon('chevron-right', 15) });
  const sum = h('span', { class: 'ms-sum', id: 'sn-sum' });
  const head = h('button', { class: 'sec-head ms-head', id: 'sn-head', 'aria-expanded': String(open), onclick: () => setOpen(!open) },
    chev, h('span', { class: 'sec-title' }, 'Snags'), sum);
  const addBtn = h('button', { class: 'btn small', id: 'sn-add', 'data-tip': 'Then click the sheet where the snag is', 'data-act': 'tool.pin', 'data-tip-side': 'top', onclick: () => actions.setTool('pin') });
  addBtn.innerHTML = icon('map-pin', 14) + '<span>Add pin</span>';
  const fil = h('div', { class: 'segs sn-filter', id: 'sn-filter' }, ...[['all', 'All'], ...PIN_STATUSES.map((x) => [x.id, x.label])].map(([v, label]) => h('button', {
    class: 'seg', 'data-v': v, onclick: () => { filter = v; refreshSnags(); },
  }, label)));
  const list = h('div', { class: 'sn-list', id: 'sn-list', role: 'listbox', 'aria-label': 'Snag pins' });
  const empty = h('div', { class: 'sn-empty', id: 'sn-empty' });
  const report = h('button', { class: 'link-btn', id: 'sn-report', 'data-tip': 'Save every pin with its number, place, trade, note, status, dates and photo as an Excel workbook', 'data-tip-side': 'top', onclick: () => actions.saveAs('snags') }, 'Snag list…');
  const body = h('div', { class: 'ms-body sn-body' },
    h('div', { class: 'ms-row' }, addBtn, h('span', { class: 'flex' }), fil),
    list, empty,
    h('div', { class: 'ms-row ms-foot' }, h('span', { class: 'flex' }), report));
  const sec = h('section', { class: 'ms-sec sn-sec', id: 'sn-sec' }, head, body);
  els = { ...els, sec, head, sum, list, empty, fil, report, addPin: addBtn };
  for (const ev of ['doc', 'selection', 'docLoaded']) on(ev, refreshSnags);
  on('tool', () => { if (S.tool === 'pin' && !open) setOpen(true); });
  refreshSnags();
  return sec;
}

function setOpen(v) {
  open = v;
  try { localStorage.setItem('plantint.snagsOpen', v ? '1' : '0'); } catch { /* ignore */ }
  refreshSnags();
  if (v) scrollWithin(document.getElementById('panel-mid'), els.sec);
}

let shownSel = '';

export function refreshSnags() {
  if (!els.sec) return;
  els.sec.classList.toggle('open', open);
  els.head.setAttribute('aria-expanded', String(open));
  const doc = !!S.doc;
  const c = pinCounts();
  const n = doc ? S.pins.length : 0;
  els.sum.textContent = n ? [c.open ? `${c.open} open` : '', c.fixed ? `${c.fixed} fixed` : '', c.closed ? `${c.closed} closed` : ''].filter(Boolean).join(' · ') : '';
  els.addPin.disabled = !doc;
  els.report.disabled = !n;
  for (const b of els.fil.children) b.classList.toggle('on', b.getAttribute('data-v') === filter);
  els.fil.hidden = n < 2;
  if (!open) return;
  const pins = doc ? pinsByNumber().filter((p) => filter === 'all' || p.status === filter) : [];
  els.list.replaceChildren(...pins.map((p) => {
    const meta = [p.trade, pinPlace(p)].filter(Boolean).join(' · ');
    const row = h('div', { class: 'sn-row' + (S.selection.has(p.id) ? ' sel' : ''), role: 'option', 'aria-selected': S.selection.has(p.id) ? 'true' : 'false', 'data-id': p.id },
      h('span', { class: 'sn-num', style: { background: (PIN_STATUS[p.status] || PIN_STATUS.open).color } }, String(p.n)),
      h('span', { class: 'sn-txt' }, h('span', { class: 'sn-note' + (p.note ? '' : ' muted') }, p.note || 'No note yet'), meta ? h('span', { class: 'sn-meta' }, meta) : null),
      p.photo ? h('span', { class: 'sn-cam', 'aria-label': 'Has a photo', html: icon('camera', 14) }) : null);
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      flushEdits();
      if (e.ctrlKey || e.metaKey) {
        const s = new Set(S.selection);
        if (s.has(p.id)) s.delete(p.id); else s.add(p.id);
        setSelection([...s]);
      } else {
        setSelection([p.id]);
        showPins([p]);
      }
    });
    row.addEventListener('dblclick', () => { setSelection([p.id]); editPinNote(); });
    return row;
  }));
  // a pin selected on the sheet: its row comes into view in the list
  const one = selectedPins();
  const key = one.length === 1 ? one[0].id : '';
  if (key && key !== shownSel) scrollWithin(els.list, els.list.querySelector(`[data-id="${key}"]`));
  shownSel = key;
  els.empty.hidden = pins.length > 0;
  els.empty.textContent = !doc ? '' : n ? 'No pins with this status.' : 'Press X, then click the sheet where a snag is. Each pin gets a number, a note, a trade and a photo.';
}
