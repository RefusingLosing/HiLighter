// Progress map. Each markup (a zone) can carry a status: Not started, In progress (with its % done),
// Done, or Not counted (left out of every total, like a cancelled activity). With the progress map on,
// the sheet shows each zone in its status colour and PlanTint works out how much is complete,
// weighted by the zones' visible areas or by units given to each zone (for example the number of
// play areas in it). Markups without a status count as Not started.

import { S, withProps } from './state.js';
import { measureAt } from './measure.js';

export const STATUSES = Object.freeze([
  Object.freeze({ id: 'todo', label: 'Not started', color: '#E5484D', key: '1' }),
  Object.freeze({ id: 'doing', label: 'In progress', color: '#F5A524', key: '2' }),
  Object.freeze({ id: 'done', label: 'Done', color: '#30A46C', key: '3' }),
  Object.freeze({ id: 'skip', label: 'Not counted', color: '#9BA39D', key: '0' }),
]);
export const STATUS = Object.freeze(Object.fromEntries(STATUSES.map((s) => [s.id, s])));
/** Every zone's tint on the progress map (their own colours and opacities come back when it is off). */
export const PROGRESS_OPACITY = 0.5;
/** A zone set to In progress starts at this %. */
export const DOING_PCT = 50;

export const progressOn = () => !!(S.progress && S.progress.on);
export const progressBy = () => ((S.progress && S.progress.by) === 'units' ? 'units' : 'area');

const clampPct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const cleanUnits = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 1;
};

/**
 * A zone's progress: st (status id), pct (what it counts as: 100 when done, 0 when not started),
 * units (its weight when counting by units) and setPct (the % kept for In progress).
 */
export function progOf(m) {
  const p = (m && m.prog) || {};
  const st = STATUS[p.st] ? p.st : 'todo';
  const setPct = p.pct === undefined || p.pct === null ? DOING_PCT : clampPct(p.pct);
  return { st, pct: st === 'done' ? 100 : st === 'doing' ? setPct : 0, units: cleanUnits(p.units ?? 1), setPct };
}

/** The markup with its progress changed; props may hold st, pct and units. */
export function withProg(m, props) {
  const cur = m.prog || {};
  const next = { st: STATUS[cur.st] ? cur.st : 'todo' };
  if (cur.pct !== undefined) next.pct = cur.pct;
  if (cur.units !== undefined) next.units = cur.units;
  if (props.st !== undefined && STATUS[props.st]) next.st = props.st;
  if (props.pct !== undefined) next.pct = clampPct(props.pct);
  if (props.units !== undefined) next.units = cleanUnits(props.units);
  return withProps(m, { prog: Object.freeze(next) });
}

/** A progress value read from a project file, cleaned; undefined when there is none. */
export function readProg(p) {
  if (!p || typeof p !== 'object' || !STATUS[p.st]) return undefined;
  const out = { st: p.st };
  if (p.pct !== undefined && p.pct !== null) out.pct = clampPct(p.pct);
  if (p.units !== undefined && p.units !== null) out.units = cleanUnits(p.units);
  return Object.freeze(out);
}

/**
 * A percentage for people: whole numbers, never 100% before everything is done and never 0% once
 * something is ("99%", "1%").
 */
export function fmtPct(v) {
  if (!Number.isFinite(v)) return '0%';
  let r = Math.round(v);
  if (r >= 100 && v < 100 - 1e-9) r = 99;
  if (r <= 0 && v > 1e-9) r = 1;
  return r + '%';
}

/** The text on the sheet for a zone ("60%"); nothing for a zone that is not counted. */
export function progLabel(m) {
  const p = progOf(m);
  return p.st === 'skip' ? '' : p.pct + '%';
}

/**
 * The totals: for each status { n (zones), area (px²), units, w (weight) }, the weight counted
 * (Not counted left out), the weight done and the % complete. Areas are the visible parts.
 */
export function progressSummary() {
  const by = progressBy();
  const groups = {};
  for (const s of STATUSES) groups[s.id] = { id: s.id, label: s.label, color: s.color, n: 0, area: 0, units: 0, w: 0 };
  let wAll = 0, wDone = 0;
  S.markups.forEach((m, i) => {
    const p = progOf(m);
    const area = measureAt(i).area;
    const w = by === 'units' ? p.units : area;
    const g = groups[p.st];
    g.n++; g.area += area; g.units += p.units; g.w += w;
    if (p.st === 'skip') return;
    wAll += w;
    wDone += (w * p.pct) / 100;
  });
  return { by, groups, wAll, wDone, counted: S.markups.length - groups.skip.n, pct: wAll > 0 ? (wDone / wAll) * 100 : 0 };
}

const shownCache = new WeakMap();
/** The markup as the sheet shows it: in its status colour while the progress map is on. */
export function shown(m) {
  if (!progressOn()) return m;
  const { st } = progOf(m);
  const c = shownCache.get(m);
  if (c && c.st === st) return c.m;
  const dm = Object.freeze({ ...m, color: STATUS[st].color, opacity: PROGRESS_OPACITY, borderColor: null });
  shownCache.set(m, { st, m: dm });
  return dm;
}

/** The status the given markups share, or null when they differ (or there are none). */
export function commonStatus(ms) {
  if (!ms.length) return null;
  const st = progOf(ms[0]).st;
  return ms.every((m) => progOf(m).st === st) ? st : null;
}
