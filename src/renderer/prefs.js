// Preferences: the user's own choices for PlanTint on this computer: shortcuts, favourite colours, the
// side panel (which sections show, which side, how wide), what new highlights and Fill start with, the
// names of new areas, and the size of the interface. They are kept in the app's local storage, so every
// tab and the markups window share them, and a change made in one tab reaches the others at once.

import { PALETTE, normalizeHex, colorName } from './colors.js';

const KEY = 'plantint.prefs';

export const PREF_DEFAULTS = Object.freeze({
  keys: Object.freeze({}),          // action id -> key ('' for none); see keys.js
  colours: null,                    // favourite colours [{ hex, name }]; null: the standard palette
  panel: Object.freeze({ legend: true, meas: true, progress: true, snags: true, list: true, side: 'right', width: 300 }),
  newWork: Object.freeze({ opacity: 0.45, borderPt: 0, borderStyle: 'solid', cover: true, fillTol: 25, fillGaps: 1, fillCover: true, autoName: true }),
  naming: Object.freeze({ prefix: 'Area ', start: 1, digits: 0, suffix: '' }),
  ui: Object.freeze({ zoom: 1 }),
});

export const PANEL_WIDTH = Object.freeze({ min: 260, max: 480 });
export const UI_ZOOMS = Object.freeze([0.9, 1, 1.1, 1.25, 1.4]);
export const MAX_COLOURS = 24;

const num = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
const str = (v, max, dflt) => (typeof v === 'string' ? v.slice(0, max) : dflt);

/** A preferences object made safe: every value present and in range, whatever was stored. */
export function cleanPrefs(v) {
  const D = PREF_DEFAULTS;
  const src = v && typeof v === 'object' ? v : {};
  const keys = {};
  if (src.keys && typeof src.keys === 'object') {
    for (const [id, k] of Object.entries(src.keys)) if (typeof k === 'string' && k.length <= 40) keys[id] = k;
  }
  let colours = null;
  if (Array.isArray(src.colours)) {
    const seen = new Set();
    colours = [];
    for (const c of src.colours) {
      const hex = normalizeHex(c && c.hex);
      if (!hex || seen.has(hex) || colours.length >= MAX_COLOURS) continue;
      seen.add(hex);
      colours.push(Object.freeze({ hex, name: str(c.name, 40, '') || colorName(hex) }));
    }
    if (!colours.length) colours = null;
  }
  const p = src.panel || {}, w = src.newWork || {}, n = src.naming || {}, u = src.ui || {};
  return Object.freeze({
    keys: Object.freeze(keys),
    colours: colours && Object.freeze(colours),
    panel: Object.freeze({
      legend: bool(p.legend, D.panel.legend), meas: bool(p.meas, D.panel.meas), progress: bool(p.progress, D.panel.progress),
      snags: bool(p.snags, D.panel.snags), list: bool(p.list, D.panel.list),
      side: p.side === 'left' ? 'left' : 'right', width: Math.round(num(p.width, PANEL_WIDTH.min, PANEL_WIDTH.max, D.panel.width)),
    }),
    newWork: Object.freeze({
      opacity: num(w.opacity, 0.05, 1, D.newWork.opacity), borderPt: num(w.borderPt, 0, 8, D.newWork.borderPt),
      borderStyle: str(w.borderStyle, 20, D.newWork.borderStyle) || 'solid', cover: bool(w.cover, D.newWork.cover),
      fillTol: Math.round(num(w.fillTol, 5, 60, D.newWork.fillTol)), fillGaps: Math.round(num(w.fillGaps, 0, 3, D.newWork.fillGaps)),
      fillCover: bool(w.fillCover, D.newWork.fillCover), autoName: bool(w.autoName, D.newWork.autoName),
    }),
    naming: Object.freeze({
      prefix: str(n.prefix, 30, D.naming.prefix), start: Math.round(num(n.start, 0, 999999, D.naming.start)),
      digits: Math.round(num(n.digits, 0, 6, D.naming.digits)), suffix: str(n.suffix, 20, D.naming.suffix),
    }),
    ui: Object.freeze({ zoom: UI_ZOOMS.includes(Number(u.zoom)) ? Number(u.zoom) : D.ui.zoom }),
  });
}

function load() {
  try { return cleanPrefs(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return cleanPrefs(null); }
}

let cur = load();
const subs = new Set();

export const prefs = () => cur;

/** Changes some preferences: { panel: { snags: false } } changes only that, the rest stays. */
export function setPrefs(patch) {
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    const old = cur[k];
    next[k] = v && typeof v === 'object' && !Array.isArray(v) && old && typeof old === 'object' && !Array.isArray(old) && k !== 'keys' ? { ...old, ...v } : v;
  }
  const before = cur;
  cur = cleanPrefs(next);
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* this session only */ }
  notify(before);
}

/** Back to how PlanTint comes: all of it, or one part ('keys', 'colours', 'panel', ...). */
export function resetPrefs(part = null) {
  if (part) setPrefs({ [part]: PREF_DEFAULTS[part] });
  else {
    const before = cur;
    cur = cleanPrefs(null);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    notify(before);
  }
}

/** Calls fn(prefs, before) after every change, here or in another tab. Returns a function that stops it. */
export function onPrefs(fn) { subs.add(fn); return () => subs.delete(fn); }

function notify(before) { for (const fn of [...subs]) { try { fn(cur, before); } catch (e) { console.error(e); } } }

// another tab (or the markups window's drawing) changed them
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    const before = cur;
    cur = load();
    notify(before);
  });
}

/** The colours shown in the side panel and the markups window. */
export const favourites = () => cur.colours || PALETTE;

/** The name a new area gets: the pattern from Preferences, numbered after the highest one in use. */
export function nextName(existingNames) {
  const { prefix, start, digits, suffix } = cur.naming;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^' + esc(prefix) + '(\\d+)' + esc(suffix) + '$');
  let max = start - 1;
  for (const nm of existingNames) { const m = re.exec(nm || ''); if (m) max = Math.max(max, +m[1]); }
  return prefix + String(max + 1).padStart(digits, '0') + suffix;
}
