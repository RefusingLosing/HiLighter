// Preferences: the menu of the gear button in the top bar, and the Preferences dialog with its pages:
// Shortcuts, Favourite colours, Side panel, New highlights and Fill, Names of new areas and Interface size.
// Every change applies at once, in every tab; Done closes the dialog.

import { S } from './state.js';
import { h, icon, showMenu, modal, seg } from './ui.js';
import { prefs, setPrefs, resetPrefs, onPrefs, favourites, PANEL_WIDTH, UI_ZOOMS, MAX_COLOURS } from './prefs.js';
import { ACTIONS, keyLabel, comboOf, reservedWhy, setKey, resetKey, resetAllKeys, isChanged, actionWithKey, actionLabel, keysOf } from './keys.js';
import { colorName, normalizeHex } from './colors.js';
import { LINE_STYLES } from '../shared/linestyle.js';

const PAGES = [
  ['keys', 'Shortcuts', 'keyboard'],
  ['colours', 'Favourite colours', 'swatch-book'],
  ['panel', 'Side panel', 'panel-right'],
  ['newWork', 'New highlights and Fill', 'paint-bucket'],
  ['naming', 'Names of new areas', 'tag'],
  ['ui', 'Interface size', 'zoom-in'],
];

const SECTIONS = [
  ['legend', 'Legend on sheet'], ['meas', 'Measurements'], ['progress', 'Progress map'], ['snags', 'Snags'], ['list', 'Markups list'],
];

let dlg = null;        // the open dialog: { show(page) }
let quiet = 0;         // > 0 while the dialog itself changes preferences (its page is already up to date)
let note = null;       // a message for the top of the page: { text, warn }
let selColour = 0;     // the colour selected on the Favourite colours page

const set = (patch) => { quiet++; try { setPrefs(patch); } finally { quiet--; } };

// ------------------------------------------------------------------ the gear button's menu

/** The menu under the gear button: the pages of Preferences, and quick switches for the side panel. */
export function prefsMenu(anchor, hooks) {
  const r = anchor.getBoundingClientRect();
  const p = prefs().panel;
  const toggle = (key) => () => setPrefs({ panel: { [key]: !prefs().panel[key] } });
  showMenu(r.left, r.bottom + 4, [
    ...PAGES.map(([id, label, ic]) => ({ label: label + '…', icon: ic, onClick: () => openPrefs(id) })),
    'sep',
    ...SECTIONS.map(([key, label]) => ({ label: `${label} in the side panel`, icon: p[key] ? 'check' : null, onClick: toggle(key) })),
    'sep',
    { label: 'Markups window', icon: 'square-arrow-out-up-right', act: 'markups.window', disabled: !S.doc, onClick: () => hooks.openMarkups() },
  ]);
}

// ------------------------------------------------------------------ the dialog

/** Opens Preferences at a page (or shows that page when it is already open). */
export function openPrefs(page = 'keys') {
  if (!PAGES.some((x) => x[0] === page)) page = 'keys';
  if (dlg) { dlg.show(page); return; }
  const nav = h('nav', { class: 'prefs-nav', 'aria-label': 'Preferences' });
  const body = h('div', { class: 'prefs-page' });
  const wrap = h('div', { class: 'prefs' }, nav, body);
  let current = page;
  const tabs = new Map();
  for (const [id, label, ic] of PAGES) {
    const b = h('button', { class: 'prefs-tab', 'data-page': id, html: icon(ic, 16), onclick: () => show(id) });
    b.append(h('span', null, label));
    tabs.set(id, b);
    nav.append(b);
  }
  function show(id) {
    stopRecording();
    if (id !== current) note = null;
    current = id;
    for (const [k, b] of tabs) b.classList.toggle('on', k === id);
    const top = body.scrollTop;
    body.innerHTML = '';
    body.append(BUILD[id](() => show(current)));
    body.scrollTop = top;
  }
  // a change made in another tab (or by the menu) shows here too
  const off = onPrefs(() => { if (!quiet && !recording) show(current); });
  show(page);
  dlg = { show };
  modal({ title: 'Preferences', body: wrap, wide: true, buttons: [{ label: 'Done', value: true, primary: true }] }).then(() => {
    off();
    stopRecording();
    dlg = null;
    note = null;
  });
}

const msg = () => (note ? h('div', { class: 'prefs-msg' + (note.warn ? ' warn' : '') }, note.text) : null);
const foot = (...items) => h('div', { class: 'prefs-foot' }, ...items);
const row = (label, ...items) => h('div', { class: 'prefs-row' }, h('span', { class: 'lab' }, label), ...items);
const range = (min, max, step, value, onInput) => {
  const r = h('input', { type: 'range', min, max, step, value });
  r.addEventListener('input', () => onInput(+r.value));
  return r;
};
const check = (label, checked, onChange) => h('label', { class: 'check' },
  h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('span', null, label));

// ------------------------------------------------------------------ Shortcuts

let recording = null; // { stop } while a key is being recorded

function stopRecording() { if (recording) recording.stop(); }

function keysPage(rerender) {
  const groups = new Map();
  for (const a of ACTIONS) { if (!groups.has(a.group)) groups.set(a.group, []); groups.get(a.group).push(a); }
  const grid = h('div', { class: 'keys-grid' });
  for (const [g, list] of groups) {
    const sec = h('section', { class: 'keys-sec' }, h('h3', null, g));
    for (const a of list) {
      const label = keyLabel(a.id);
      const cap = h('button', { class: 'keycap' + (label ? '' : ' none'), 'data-action': a.id, title: 'Click, then press the new key' }, label || 'No key');
      cap.addEventListener('click', () => record(a, cap, rerender));
      const clear = keysOf(a.id).length
        ? h('button', { class: 'mini', title: 'No key', 'aria-label': `No key for ${a.label}`, html: icon('x', 13), onclick: () => { setKeyQuiet(a.id, ''); note = { text: `${a.label} has no key now.` }; rerender(); } })
        : h('span');
      const back = isChanged(a.id)
        ? h('button', { class: 'mini', title: `Back to ${a.show || a.keys[0] || 'no key'}`, 'aria-label': `Back to the usual key for ${a.label}`, html: icon('rotate-ccw', 13), onclick: () => { quiet++; try { resetKey(a.id); } finally { quiet--; } note = null; rerender(); } })
        : h('span');
      sec.append(h('div', { class: 'key-row' + (isChanged(a.id) ? ' changed' : '') }, h('span', { class: 'key-label' }, a.label), cap, clear, back));
    }
    grid.append(sec);
  }
  const fixed = [
    ['Esc', 'Stop drawing, clear the selection, close'], ['Enter', 'Finish a polygon, gap line or dimension'],
    ['Space + drag', 'Move around the sheet'], ['Arrows', 'Nudge the selection (Shift: 10×)'],
    ['Backspace', 'Back one step while drawing'], ['H  V  A  N  F8', 'While drawing a polygon'],
    ['[  ]', 'Eraser and magnifier size'], ['1  2  3  0', 'Status of the selected zones or pins'],
    ['Ctrl+N  Ctrl+W  Ctrl+Tab', 'New, close and next tab'],
  ];
  return h('div', null,
    h('p', { class: 'prefs-intro' }, 'Click a key, then press the new one, with Ctrl, Alt or Shift if you like. Esc stops without changing it. Keys go by where they are on the keyboard, so they work whatever language the keyboard is set to.'),
    msg(), grid,
    h('h3', null, 'Keys that stay as they are'),
    h('dl', { class: 'fixed-keys' }, ...fixed.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    foot(h('button', { class: 'btn small', onclick: () => { quiet++; try { resetAllKeys(); } finally { quiet--; } note = { text: 'Every shortcut is back to how PlanTint comes.' }; rerender(); } }, 'Reset all shortcuts')));
}

function setKeyQuiet(id, combo) { quiet++; try { setKey(id, combo); } finally { quiet--; } }

function record(a, cap, rerender) {
  stopRecording();
  cap.textContent = 'Press keys…';
  cap.classList.add('rec');
  const onKey = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { stop(); rerender(); return; }
    const combo = comboOf(e);
    if (!combo || /^(Ctrl|Alt|Shift)(\+(Ctrl|Alt|Shift))*$/.test(combo)) { cap.textContent = combo ? combo + '+…' : 'Press keys…'; return; }
    stop();
    const why = reservedWhy(combo);
    if (why) { note = { text: `${combo} is ${why}, so it cannot be a shortcut. Choose another key.`, warn: true }; rerender(); return; }
    const other = actionWithKey(combo, a.id);
    setKeyQuiet(a.id, combo);
    note = other
      ? { text: `${combo} is now “${a.label}”. “${actionLabel(other)}” ${keysOf(other).length ? 'keeps ' + keyLabel(other) : 'has no key now'}.`, warn: !keysOf(other).length }
      : { text: `“${a.label}”: ${combo}.` };
    rerender();
  };
  const onDown = (e) => { if (e.target !== cap) { stop(); rerender(); } };
  const stop = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onDown, true);
    recording = null;
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onDown, true);
  recording = { stop };
}

// ------------------------------------------------------------------ Favourite colours

function coloursPage(rerender) {
  const list = favourites().map((c) => ({ ...c }));
  selColour = Math.max(0, Math.min(selColour, list.length - 1));
  const save = (next) => { set({ colours: next }); rerender(); };
  const grid = h('div', { class: 'fav-grid', role: 'listbox', 'aria-label': 'Favourite colours' });
  list.forEach((c, i) => {
    grid.append(h('button', { class: 'fav-sw' + (i === selColour ? ' on' : ''), title: `${c.name} ${c.hex}`, 'aria-label': c.name, style: { background: c.hex }, onclick: () => { selColour = i; rerender(); } }));
  });
  const c = list[selColour];
  const picker = h('input', { type: 'color', class: 'hidden-color', value: c.hex.toLowerCase() });
  picker.addEventListener('change', () => {
    const hex = normalizeHex(picker.value);
    if (!hex) return;
    const auto = c.name === colorName(c.hex);
    list[selColour] = { hex, name: auto ? colorName(hex) : c.name };
    save(list);
  });
  const adder = h('input', { type: 'color', class: 'hidden-color', value: '#888888' });
  adder.addEventListener('change', () => {
    const hex = normalizeHex(adder.value);
    if (!hex) return;
    add(hex);
  });
  const add = (hex) => {
    if (list.some((x) => x.hex === hex)) { selColour = list.findIndex((x) => x.hex === hex); note = { text: `${colorName(hex)} ${hex} is already a favourite.` }; rerender(); return; }
    if (list.length >= MAX_COLOURS) { note = { text: `Up to ${MAX_COLOURS} colours. Remove one first.`, warn: true }; rerender(); return; }
    list.push({ hex, name: colorName(hex) });
    selColour = list.length - 1;
    note = null;
    save(list);
  };
  const move = (d) => {
    const j = selColour + d;
    if (j < 0 || j >= list.length) return;
    [list[selColour], list[j]] = [list[j], list[selColour]];
    selColour = j;
    save(list);
  };
  const name = h('input', { class: 'prefs-field', value: c.name, maxlength: 40, spellcheck: 'false', 'aria-label': 'Name of the colour' });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  name.addEventListener('change', () => { list[selColour] = { ...c, name: name.value.trim() || colorName(c.hex) }; save(list); });
  const cur = normalizeHex(S.style.color);
  return h('div', null,
    h('p', { class: 'prefs-intro' }, 'The colours in the side panel and in the markups window, in this order. New highlights start with the first one. Click a colour to change, rename, move or remove it.'),
    msg(), grid,
    h('div', { class: 'fav-edit' },
      h('span', { class: 'fav-big', style: { background: c.hex } }),
      h('div', { class: 'fav-info' }, name, h('span', { class: 'fav-hex' }, c.hex)),
      h('button', { class: 'btn small', onclick: () => picker.click() }, 'Change colour…'), picker,
      h('button', { class: 'btn small', title: 'Move left', 'aria-label': 'Move left', disabled: selColour === 0, html: icon('arrow-left', 14), onclick: () => move(-1) }),
      h('button', { class: 'btn small', title: 'Move right', 'aria-label': 'Move right', disabled: selColour === list.length - 1, html: icon('arrow-right', 14), onclick: () => move(1) }),
      h('button', { class: 'btn small danger', disabled: list.length <= 1, onclick: () => { list.splice(selColour, 1); selColour = Math.max(0, selColour - 1); save(list); } }, 'Remove')),
    foot(
      h('button', { class: 'btn small', onclick: () => adder.click(), html: icon('plus', 14) + '<span>Add a colour…</span>' }), adder,
      cur ? h('button', { class: 'btn small', onclick: () => add(cur), html: `<span class="mini-dot" style="background:${cur}"></span><span>Add the colour in use</span>` }) : null,
      h('span', { class: 'flex' }),
      h('button', { class: 'btn small', onclick: () => { quiet++; try { resetPrefs('colours'); } finally { quiet--; } selColour = 0; note = { text: 'Back to the standard colours.' }; rerender(); } }, 'Standard colours')));
}

// ------------------------------------------------------------------ Side panel

function panelPage(rerender) {
  const p = prefs().panel;
  const wVal = h('span', { class: 'val' }, p.width + ' px');
  return h('div', null,
    h('p', { class: 'prefs-intro' }, 'Choose what the side panel shows, which side of the window it is on and how wide it is.'),
    msg(),
    h('h3', null, 'Sections'),
    h('div', { class: 'prefs-checks' }, ...SECTIONS.map(([key, label]) => check(label, p[key], (v) => set({ panel: { [key]: v } })))),
    h('p', { class: 'prefs-note' }, 'The colour and style card at the top always shows. A hidden section keeps working: the legend still shows on the sheet when it is on, and so do a progress map and snag pins. The gear menu shows and hides sections in one click.'),
    h('h3', null, 'Place'),
    row('Side', seg([['left', 'Left'], ['right', 'Right']], p.side, (v) => { set({ panel: { side: v } }); rerender(); })),
    row('Width', range(PANEL_WIDTH.min, PANEL_WIDTH.max, 10, p.width, (v) => { wVal.textContent = v + ' px'; set({ panel: { width: v } }); }), wVal),
    foot(h('button', { class: 'btn small', onclick: () => { quiet++; try { resetPrefs('panel'); } finally { quiet--; } rerender(); } }, 'Reset the side panel')));
}

// ------------------------------------------------------------------ New highlights and Fill

function newWorkPage(rerender) {
  const w = prefs().newWork;
  const opVal = h('span', { class: 'val' }, Math.round(w.opacity * 100) + '%');
  const bdVal = h('span', { class: 'val' }, w.borderPt ? w.borderPt + ' pt' : 'None');
  const tolVal = h('span', { class: 'val' }, w.fillTol + '%');
  const nw = (props) => set({ newWork: props });
  return h('div', null,
    h('p', { class: 'prefs-intro' }, 'What a new highlight and the Fill tool start with, in every drawing. New highlights take the first favourite colour. A change here also applies to the next highlight you make now.'),
    msg(),
    h('h3', null, 'New highlights'),
    row('Opacity', range(5, 100, 1, Math.round(w.opacity * 100), (v) => { opVal.textContent = v + '%'; nw({ opacity: v / 100 }); }), opVal),
    row('Border', range(0, 8, 0.25, w.borderPt, (v) => { bdVal.textContent = v ? v + ' pt' : 'None'; nw({ borderPt: v }); }), bdVal),
    row('Border line', seg(LINE_STYLES.map((ls) => [ls.id, ls.label]), w.borderStyle, (v) => { nw({ borderStyle: v }); rerender(); })),
    row('', check('Cover colour already on the drawing', w.cover, (v) => nw({ cover: v }))),
    h('h3', null, 'Fill'),
    row('Colour tolerance', range(5, 60, 1, w.fillTol, (v) => { tolVal.textContent = v + '%'; nw({ fillTol: v }); }), tolVal),
    row('Close gaps', seg([[0, 'Off'], [1, 'Small'], [2, 'Medium'], [3, 'Large']], w.fillGaps, (v) => { nw({ fillGaps: v }); rerender(); })),
    row('', check('Cover furniture', w.fillCover, (v) => nw({ fillCover: v }))),
    row('', check('Use labels as names', w.autoName, (v) => nw({ autoName: v }))),
    foot(h('button', { class: 'btn small', onclick: () => { quiet++; try { resetPrefs('newWork'); } finally { quiet--; } rerender(); } }, 'Reset these')));
}

// ------------------------------------------------------------------ Names of new areas

function namingPage(rerender) {
  const n = prefs().naming;
  const prefix = h('input', { class: 'prefs-field', value: n.prefix, maxlength: 30, spellcheck: 'false', 'aria-label': 'Before the number' });
  const start = h('input', { class: 'prefs-field num', type: 'number', min: 0, step: 1, value: n.start, 'aria-label': 'First number' });
  const suffix = h('input', { class: 'prefs-field', value: n.suffix, maxlength: 20, spellcheck: 'false', 'aria-label': 'After the number' });
  const digits = h('select', { class: 'prefs-field', 'aria-label': 'Digits' },
    ...[[0, '1, 2 … 10'], [2, '01, 02 … 10'], [3, '001, 002 … 010'], [4, '0001 … 0010']].map(([v, l]) => h('option', { value: v, selected: v === n.digits }, l)));
  const preview = h('div', { class: 'prefs-preview' });
  const show = () => {
    const p = prefs().naming;
    const nm = (i) => p.prefix + String(p.start + i).padStart(p.digits, '0') + p.suffix;
    preview.textContent = `${nm(0)},  ${nm(1)},  ${nm(2)} …`;
  };
  const upd = () => {
    set({ naming: { prefix: prefix.value, start: Math.max(0, Math.round(+start.value || 0)), suffix: suffix.value, digits: +digits.value } });
    show();
  };
  for (const el of [prefix, start, suffix]) el.addEventListener('input', upd);
  digits.addEventListener('change', upd);
  show();
  return h('div', null,
    h('p', { class: 'prefs-intro' }, 'The names new areas get, for example B-001, B-002 for buildings or V1, V2 for villas. Numbering carries on after the highest number already used in the drawing.'),
    msg(),
    row('Before the number', prefix),
    row('First number', start),
    row('Digits', digits),
    row('After the number', suffix),
    row('New areas', preview),
    h('p', { class: 'prefs-note' }, 'With “Use labels as names” on, Fill names an area from the room label inside it; areas without a label get these names.'),
    foot(h('button', { class: 'btn small', onclick: () => { quiet++; try { resetPrefs('naming'); } finally { quiet--; } rerender(); } }, 'Back to Area 1, Area 2')));
}

// ------------------------------------------------------------------ Interface size

function uiPage(rerender) {
  const z = prefs().ui.zoom;
  let confirmAll = false;
  const resetAll = h('button', { class: 'btn small danger' }, 'Reset all preferences');
  resetAll.addEventListener('click', () => {
    if (!confirmAll) { confirmAll = true; resetAll.textContent = 'Click again to reset everything'; return; }
    quiet++;
    try { resetPrefs(); } finally { quiet--; }
    if (window.plantint && window.plantint.setUiZoom) window.plantint.setUiZoom(1);
    note = { text: 'Every preference is back to how PlanTint comes.' };
    rerender();
  });
  return h('div', null,
    h('p', { class: 'prefs-intro' }, 'Makes the buttons, text, menus and side panel larger or smaller, in every PlanTint window. The drawing itself does not change.'),
    msg(),
    row('Size', seg(UI_ZOOMS.map((v) => [v, Math.round(v * 100) + '%']), z, (v) => {
      set({ ui: { zoom: v } });
      if (window.plantint && window.plantint.setUiZoom) window.plantint.setUiZoom(v);
      rerender();
    })),
    foot(resetAll));
}

const BUILD = { keys: keysPage, colours: coloursPage, panel: panelPage, newWork: newWorkPage, naming: namingPage, ui: uiPage };
