// Highlights cover the paint under them: on a drawing that is already coloured (a layout with its
// buildings filled green, a plan with painted rooms), a highlight shows its own colour instead of a
// mix with the old one. The engine takes the paint out under each covering highlight wherever the
// drawing is shown or exported (see setCovers in the engine); this keeps its list of them in step
// with the markups. A markup with cover: false tints the drawing like a highlighter pen instead.

import { S, on } from './state.js';
import * as engine from './engine.js';
import { shown } from './progress.js';

/** Whether a markup covers the paint under it (the default) or tints it. */
export const covers = (m) => m.cover !== false;

/** Whether it takes paint out now: an outline with no fill (0% opacity) has no colour to show instead. */
export const covering = (m) => covers(m) && shown(m).opacity > 0.02;

// a key per shape: markups are immutable, so the same rings array is the same shape
const shapeKeys = new WeakMap();
let shapeSeq = 0;
function keyOf(m) {
  let k = shapeKeys.get(m.rings);
  if (!k) { k = ++shapeSeq; shapeKeys.set(m.rings, k); }
  return m.id + ':' + k;
}

let sentFor = null;     // the document the engine's list belongs to
let sent = new Map();   // id -> key the engine has the shape for
let lastSig = null;
let queued = false;
let running = Promise.resolve();
let pending = 0;

async function doSync() {
  if (!S.doc) { sentFor = null; sent = new Map(); lastSig = null; return; }
  if (sentFor !== S.doc) { sentFor = S.doc; sent = new Map(); lastSig = null; }
  const doc = S.doc;
  const items = S.markups.filter(covering).map((m) => ({ id: m.id, key: keyOf(m), rings: m.rings }));
  const sig = items.map((i) => i.key).join('|');
  if (sig === lastSig) return;
  // shapes go only where the engine does not have them yet
  const list = (need) => items.map((i) => (need.has(i.id) ? { id: i.id, key: i.key, rings: i.rings } : { id: i.id, key: i.key }));
  let res = await engine.call('setCovers', { list: list(new Set(items.filter((i) => sent.get(i.id) !== i.key).map((i) => i.id))) });
  if (res && res.need && res.need.length) res = await engine.call('setCovers', { list: list(new Set(res.need)) });
  if (S.doc !== doc) return;
  sent = new Map(items.map((i) => [i.id, i.key]));
  lastSig = sig;
}

/** Brings the engine's list up to date now; resolves when the engine has it (exports wait for this). */
export function syncCovers() {
  pending++;
  running = running.then(doSync, doSync).catch((e) => console.error(e)).finally(() => { pending--; });
  return running;
}

/** True when the engine has the current list (used by the tests). */
export const coversIdle = () => pending === 0 && !queued;

/** Keeps the engine's list in step after every change to the markups (once per burst of changes). */
export function initCovers() {
  const later = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; syncCovers(); });
  };
  on('doc', later);
  on('docLoaded', later);
}
