// Areas and perimeters of markups, measured on what is visible: a markup counts only where its
// colour shows, so the parts erased or covered by markups above it are left out (the same rule
// the sheet, the pictures and the PDF follow). Values are in sheet pixels; units.js converts.

import { S } from './state.js';
import * as G from './geom.js';

const bboxes = new WeakMap();
function bboxOf(m) {
  let b = bboxes.get(m);
  if (!b) { b = G.ringsBBox(m.rings); bboxes.set(m, b); }
  return b;
}
const overlap = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

export function ringsPerimeter(rings) {
  let p = 0;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      p += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]);
    }
  }
  return p;
}

const cache = new WeakMap(); // markup -> { above, vis, area, perim }

/** { vis, area (px²), perim (px) } for the markup at index i of S.markups. */
export function measureAt(i) {
  const list = S.markups;
  const m = list[i];
  const b = bboxOf(m);
  const above = [];
  for (let j = i + 1; j < list.length; j++) if (overlap(b, bboxOf(list[j]))) above.push(list[j]);
  const c = cache.get(m);
  if (c && c.above.length === above.length && c.above.every((o, k) => o === above[k])) return c;
  let vis = above.length ? G.difference(m.rings, above.map((o) => o.rings)) : G.cleanRings(m.rings);
  vis = vis.filter((r) => r.length >= 6);
  const r = { above, vis, area: vis.length ? G.ringsArea(vis) : 0, perim: ringsPerimeter(vis) };
  cache.set(m, r);
  return r;
}

export function measureOf(m) {
  const i = S.markups.indexOf(m);
  return i < 0 ? { vis: m.rings, area: G.ringsArea(m.rings), perim: ringsPerimeter(m.rings), above: [] } : measureAt(i);
}

/** Sum of areas and perimeters (px², px) of the given markups (all by default). */
export function totals(ids = null) {
  let area = 0, perim = 0, n = 0;
  S.markups.forEach((m, i) => {
    if (ids && !ids.has(m.id)) return;
    const r = measureAt(i);
    area += r.area; perim += r.perim; n++;
  });
  return { area, perim, n };
}

// ------------------------------------------------------------------ label position

/** Signed distance from a point to the shape's outline (positive inside). */
function signedDist(rings, x, y) {
  let best = Infinity;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      best = Math.min(best, G.nearestPointOnSeg(x, y, r[i], r[i + 1], r[j], r[j + 1]).d);
    }
  }
  return (G.pointInRings(rings, x, y) ? 1 : -1) * best;
}

/** The point inside a shape farthest from its outline (the "pole of inaccessibility"). */
export function polylabel(rings) {
  const [x0, y0, x1, y1] = G.ringsBBox(rings);
  const w = x1 - x0, h = y1 - y0;
  const size = Math.min(w, h);
  if (!(size > 0)) return [x0, y0];
  const precision = Math.max(0.5, size / 120);
  const heap = [];
  const push = (c) => { heap.push(c); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].max >= heap[i].max) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let k = i;
        if (l < heap.length && heap[l].max > heap[k].max) k = l;
        if (r < heap.length && heap[r].max > heap[k].max) k = r;
        if (k === i) break;
        [heap[k], heap[i]] = [heap[i], heap[k]]; i = k;
      }
    }
    return top;
  };
  const cell = (x, y, hh) => { const d = signedDist(rings, x, y); return { x, y, h: hh, d, max: d + hh * Math.SQRT2 }; };
  const half = size / 2;
  for (let x = x0; x < x1; x += size) for (let y = y0; y < y1; y += size) push(cell(x + half, y + half, half));
  let best = cell(x0 + w / 2, y0 + h / 2, 0);
  let guard = 0;
  while (heap.length && guard++ < 20000) {
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const q = c.h / 2;
    push(cell(c.x - q, c.y - q, q)); push(cell(c.x + q, c.y - q, q));
    push(cell(c.x - q, c.y + q, q)); push(cell(c.x + q, c.y + q, q));
  }
  return [best.x, best.y];
}

function rectInside(rings, r) {
  const [x0, y0, x1, y1] = r;
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [xm, y0], [xm, y1], [x0, ym], [x1, ym], [xm, ym]]) {
    if (!G.pointInRings(rings, x, y)) return false;
  }
  return true;
}

function hitsText(r, pad) {
  const text = S.doc && S.doc.text;
  if (!text) return false;
  for (const l of text) {
    if (l.x1 + pad < r[0] || l.x0 - pad > r[2] || l.y1 + pad < r[1] || l.y0 - pad > r[3]) continue;
    return true;
  }
  return false;
}

/**
 * Where a w × h label sits inside a shape: at its most open point, moved off the drawing's own
 * text (room names and areas) when that is possible without leaving the shape.
 */
export function labelSpot(vis, w, h, others = []) {
  if (!vis.length) return null;
  const [px, py] = polylabel(vis);
  const cands = [[0, 0]];
  for (let k = 1; k <= 6; k++) cands.push([0, k * h * 0.75], [0, -k * h * 0.75], [k * w * 0.4, 0], [-k * w * 0.4, 0]);
  const pad = h * 0.15;
  for (const [dx, dy] of cands) {
    const x = px + dx, y = py + dy;
    const r = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    if (!rectInside(vis, r)) continue;
    if (hitsText(r, pad)) continue;
    if (others.some((o) => !(o[2] < r[0] || o[0] > r[2] || o[3] < r[1] || o[1] > r[3]))) continue;
    return [x, y];
  }
  return [px, py];
}
