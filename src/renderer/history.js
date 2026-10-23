// Undo / redo. Every entry stores the before and after document snapshot. Because markups,
// gap lines and the legend are immutable values, snapshots only copy array references.
// Colour taken out of the drawing is tracked as raster ops; the engine keeps their pixels.

import { S, emit, saveMeasPrefs } from './state.js';
import * as engine from './engine.js';

const LIMIT = 200;
const undoStack = [];
const redoStack = [];
let seq = 1;
let savedId = 0;         // state last saved in any form (project or picture)
let projectSavedId = 0;  // state last saved as an editable project
let busy = Promise.resolve();

export const snapshot = () => ({ markups: S.markups, gaps: S.gaps, legend: S.legend, ops: S.rasterOps, dims: S.dims, meas: S.meas, calib: S.calib });

const currentId = () => (undoStack.length ? undoStack[undoStack.length - 1].id : 0);
export const stateId = currentId;
export const isDirty = () => currentId() !== savedId;
/** 'saved' (project up to date), 'picture' (only a picture has the latest marking), 'unsaved'. */
export function saveState() {
  const c = currentId();
  if (c === projectSavedId) return 'saved';
  if (c === savedId) return 'picture';
  return 'unsaved';
}
export function markSaved(asProject) {
  savedId = currentId();
  if (asProject) projectSavedId = savedId;
  emit('dirty');
}
/** After restoring unsaved work: nothing is saved yet. */
export function markUnsaved() { savedId = -1; projectSavedId = -1; emit('dirty'); }
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export const undoLabel = () => (undoStack.length ? undoStack[undoStack.length - 1].label : '');
export const redoLabel = () => (redoStack.length ? redoStack[redoStack.length - 1].label : '');

export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  savedId = 0;
  projectSavedId = 0;
  emit('history');
  emit('dirty');
}

function sameSnap(a, b) {
  return a.markups === b.markups && a.gaps === b.gaps && a.legend === b.legend && a.ops === b.ops
    && a.dims === b.dims && a.meas === b.meas && a.calib === b.calib;
}

function opsIn(entries) {
  const s = new Set();
  for (const e of entries) { for (const o of e.before.ops) s.add(o.id); for (const o of e.after.ops) s.add(o.id); }
  return s;
}

/** Records a change that has already been applied to S. */
export function commit(label, before) {
  const after = snapshot();
  if (sameSnap(before, after)) return false;
  undoStack.push({ id: seq++, label, before, after });
  if (redoStack.length) {
    const dropped = redoStack.splice(0);
    const alive = opsIn(undoStack);
    for (const o of S.rasterOps) alive.add(o.id);
    const dead = [...opsIn(dropped)].filter((id) => !alive.has(id));
    if (dead.length) engine.call('disposeOps', { ids: dead });
  }
  while (undoStack.length > LIMIT) {
    const e = undoStack.shift();
    // the oldest reachable state is now e.after: its colour removals can no longer be undone
    if (e.after.ops.length) engine.call('forgetPatches', { ids: e.after.ops.map((o) => o.id) });
    if (savedId === e.id) savedId = -1;
    if (projectSavedId === e.id) projectSavedId = -1;
  }
  emit('history');
  emit('dirty');
  emit('doc');
  return true;
}

/** Runs fn (which mutates S), then commits it as one undoable step. */
export function change(label, fn) {
  const before = snapshot();
  fn();
  return commit(label, before);
}

async function applySnapshot(t) {
  const target = new Set(t.ops.map((o) => o.id));
  const current = new Set(S.rasterOps.map((o) => o.id));
  const revert = S.rasterOps.filter((o) => !target.has(o.id)).reverse();
  const apply = t.ops.filter((o) => !current.has(o.id));
  for (const o of revert) await engine.call('revertOp', { opId: o.id });
  for (const o of apply) await engine.call('reapplyOp', { opId: o.id });
  const gapsChanged = S.gaps !== t.gaps;
  const scaleChanged = S.calib !== t.calib || S.meas !== t.meas;
  if (S.meas !== t.meas) saveMeasPrefs(t.meas);
  S.markups = t.markups;
  S.gaps = t.gaps;
  S.legend = t.legend;
  S.rasterOps = t.ops;
  S.dims = t.dims;
  S.meas = t.meas;
  S.calib = t.calib;
  if (gapsChanged) await engine.call('setGaps', { lines: S.gaps.map((g) => g.pts) });
  const ids = new Set([...S.markups.map((m) => m.id), ...S.dims.map((d) => d.id)]);
  S.selection = new Set([...S.selection].filter((id) => ids.has(id)));
  if (!S.legend || !S.legend.visible) S.legendSelected = false;
  emit('selection');
  if (scaleChanged) emit('scale');
  emit('doc');
}

function serial(fn) {
  const run = busy.then(fn, fn);
  busy = run.catch(() => {});
  return run;
}

/** Runs an async change so undo/redo wait for it (and it waits for them). */
export const runExclusive = (fn) => serial(fn);

export function undo() {
  return serial(async () => {
    const e = undoStack.pop();
    if (!e) return null;
    await applySnapshot(e.before);
    redoStack.push(e);
    emit('history'); emit('dirty');
    return e.label;
  });
}

export function redo() {
  return serial(async () => {
    const e = redoStack.pop();
    if (!e) return null;
    await applySnapshot(e.after);
    undoStack.push(e);
    emit('history'); emit('dirty');
    return e.label;
  });
}
