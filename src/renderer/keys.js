// Keyboard shortcuts: every action that has a key, its default keys, and the keys the user chose in
// Preferences. A key is the key's place on the keyboard (KeyboardEvent.code), not the letter it types,
// so shortcuts work whatever language the keyboard is set to (F is F on an Arabic keyboard too).
// Keys are written like "F", "Ctrl+Shift+S", "Del", "F2", "=".

import { prefs, setPrefs, onPrefs } from './prefs.js';

/** The actions, in the order Preferences lists them. keys: the defaults (the first one is shown). */
export const ACTIONS = Object.freeze([
  { id: 'tool.select', group: 'Tools', label: 'Select and move', keys: ['S'] },
  { id: 'tool.fill', group: 'Tools', label: 'Fill an enclosed area', keys: ['F'] },
  { id: 'tool.polygon', group: 'Tools', label: 'Polygon', keys: ['P'] },
  { id: 'tool.rect', group: 'Tools', label: 'Rectangle', keys: ['R'] },
  { id: 'tool.gap', group: 'Tools', label: 'Gap line', keys: ['G'] },
  { id: 'tool.dim', group: 'Tools', label: 'Dimension', keys: ['K'] },
  { id: 'tool.calib', group: 'Tools', label: 'Calibrate the scale', keys: ['C'] },
  { id: 'tool.pin', group: 'Tools', label: 'Snag pin', keys: ['X'] },
  { id: 'tool.pick', group: 'Tools', label: 'Pick a colour', keys: ['I'] },
  { id: 'tool.erase', group: 'Tools', label: 'Eraser', keys: ['E'] },
  { id: 'view.loupe', group: 'View', label: 'Magnifier', keys: ['M'] },
  { id: 'view.legend', group: 'View', label: 'Legend on sheet', keys: ['L'] },
  { id: 'detect', group: 'View', label: 'Find painted colour', keys: ['D'] },
  { id: 'view.fit', group: 'View', label: 'Fit the sheet', keys: ['Ctrl+0'] },
  { id: 'view.real', group: 'View', label: 'Real size', keys: ['Ctrl+1'] },
  { id: 'view.zoomIn', group: 'View', label: 'Zoom in', keys: ['=', 'Shift+=', 'Num +'], show: '+' },
  { id: 'view.zoomOut', group: 'View', label: 'Zoom out', keys: ['-', 'Shift+-', 'Num -'], show: '−' },
  { id: 'markups.window', group: 'View', label: 'Markups window', keys: [] },
  { id: 'edit.undo', group: 'Edit', label: 'Undo', keys: ['Ctrl+Z'] },
  { id: 'edit.redo', group: 'Edit', label: 'Redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'] },
  { id: 'edit.selectAll', group: 'Edit', label: 'Select all', keys: ['Ctrl+A'] },
  { id: 'edit.copy', group: 'Edit', label: 'Copy', keys: ['Ctrl+C'] },
  { id: 'edit.paste', group: 'Edit', label: 'Paste', keys: ['Ctrl+V'] },
  { id: 'edit.duplicate', group: 'Edit', label: 'Duplicate', keys: ['Ctrl+D'] },
  { id: 'edit.merge', group: 'Edit', label: 'Merge the selected markups', keys: ['Ctrl+M'] },
  { id: 'edit.rename', group: 'Edit', label: 'Rename', keys: ['F2'] },
  { id: 'edit.delete', group: 'Edit', label: 'Delete', keys: ['Del'] },
  { id: 'file.open', group: 'File', label: 'Open', keys: ['Ctrl+O'] },
  { id: 'file.save', group: 'File', label: 'Save', keys: ['Ctrl+S'] },
  { id: 'file.saveAs', group: 'File', label: 'Save as (choose a type)', keys: ['Ctrl+Shift+S'] },
  { id: 'prefs', group: 'File', label: 'Preferences', keys: ['Ctrl+,'] },
  { id: 'help', group: 'File', label: 'Keys and mouse', keys: ['F1', 'Shift+/'] },
]);
const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

/** Keys that keep their own meaning and cannot be given to an action, with the reason shown. */
export const RESERVED = Object.freeze([
  [/^(Esc|Enter|Tab|Space|Backspace|Up|Down|Left|Right)$/, 'used while drawing and selecting'],
  [/^(Shift\+)?(Up|Down|Left|Right)$/, 'used to nudge the selection'],
  [/^(Num )?\d$/, 'used for statuses and for typing sizes'],
  [/^(H|V|A|N|F8)$/, 'used while drawing a polygon'],
  [/^(\[|\])$/, 'used to change the eraser and magnifier size'],
  [/^Ctrl\+(N|W|Tab)$|^Ctrl\+Shift\+Tab$/, 'used for tabs'],
  [/^(Ctrl|Alt|Shift|Ctrl\+Shift|Ctrl\+Alt|Alt\+Shift|Ctrl\+Alt\+Shift)$/, 'needs a key as well'],
]);

const CODE_NAMES = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\',
  IntlBackslash: '\\', Comma: ',', Period: '.', Slash: '/', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Enter', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn', Backspace: 'Backspace', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Space: 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Pause: 'Pause', ContextMenu: 'Menu',
};
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^CapsLock$|^NumLock$/;

/** The name of a key from its place on the keyboard (e.code), or null for a modifier or an unknown key. */
export function keyName(code, key = '') {
  if (!code || code === 'Unidentified') {
    // no place given (some generated events): go by the character, if it is a plain one
    if (/^[a-z]$/i.test(key)) return key.toUpperCase();
    if (/^[0-9]$/.test(key)) return key;
    if (key === 'Delete') return 'Del';
    if (/^F\d{1,2}$/.test(key)) return key;
    return null;
  }
  if (MODIFIER_CODES.test(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return CODE_NAMES[code] || null;
}

/** The keys pressed, as written in Preferences ("Ctrl+Shift+S"); only the modifiers while no key is down. */
export function comboOf(e) {
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const k = keyName(e.code, e.key);
  return k ? [...mods, k].join('+') : mods.join('+');
}

/** Why a key cannot be used, or '' when it can. */
export function reservedWhy(combo) {
  for (const [re, why] of RESERVED) if (re.test(combo)) return why;
  return '';
}

// ------------------------------------------------------------------ the keys in use

let table = null; // combo -> action id

/** The keys of an action: the user's choice ('' for none), else its defaults. */
export function keysOf(id) {
  const own = prefs().keys;
  if (own && Object.prototype.hasOwnProperty.call(own, id)) return own[id] ? [own[id]] : [];
  const a = BY_ID.get(id);
  return a ? a.keys : [];
}

/** How an action's key is shown (in tooltips, menus and help): '' when it has none. */
export function keyLabel(id) {
  const own = prefs().keys;
  const a = BY_ID.get(id);
  if (!a) return '';
  if (own && Object.prototype.hasOwnProperty.call(own, id)) return own[id] || '';
  return a.show || a.keys[0] || '';
}

export const isChanged = (id) => { const own = prefs().keys; return !!own && Object.prototype.hasOwnProperty.call(own, id); };

function build() {
  table = new Map();
  for (const a of ACTIONS) for (const k of keysOf(a.id)) if (!table.has(k)) table.set(k, a.id);
}
onPrefs(() => { table = null; });

/** The action the keys of this event are for, or null. */
export function actionOf(e) {
  if (!table) build();
  return table.get(comboOf(e)) || null;
}

/** True when the event is the key of the action `id`. */
export const isAction = (e, id) => actionOf(e) === id;

/** The action that has this key now, other than `except`. */
export function actionWithKey(combo, except = null) {
  for (const a of ACTIONS) if (a.id !== except && keysOf(a.id).includes(combo)) return a.id;
  return null;
}

export const actionLabel = (id) => (BY_ID.get(id) || { label: id }).label;

/** Sets an action's key ('' for none); a key another action had is taken from it. */
export function setKey(id, combo) {
  const keys = { ...(prefs().keys || {}) };
  if (combo) {
    const other = actionWithKey(combo, id);
    if (other) {
      // the other action loses only this key: its other defaults stay if it had several
      const rest = keysOf(other).filter((k) => k !== combo);
      keys[other] = rest.length && !isChanged(other) ? rest[0] : '';
    }
  }
  const a = BY_ID.get(id);
  if (a && a.keys.length === 1 && a.keys[0] === combo) delete keys[id];
  else keys[id] = combo;
  setPrefs({ keys });
}

export function resetKey(id) {
  const keys = { ...(prefs().keys || {}) };
  delete keys[id];
  // a default key now used by another action stays with that action: this one gets none
  for (const k of (BY_ID.get(id) || { keys: [] }).keys) {
    const other = Object.keys(keys).find((o) => keys[o] === k);
    if (other) { keys[id] = ''; break; }
  }
  setPrefs({ keys });
}

export function resetAllKeys() { setPrefs({ keys: {} }); }

/**
 * A hint text with {action.id} in it, each replaced by that action's key. A sentence naming an action
 * that has no key is left out.
 */
export function withKeys(text) {
  return String(text)
    .split(/(?<=\.)\s+/)
    .filter((sentence) => [...sentence.matchAll(/\{([a-z.A-Z]+)\}/g)].every((m) => keyLabel(m[1])))
    .map((sentence) => sentence.replace(/\{([a-z.A-Z]+)\}/g, (_m, id) => keyLabel(id)))
    .join(' ');
}
