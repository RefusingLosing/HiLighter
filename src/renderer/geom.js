// Geometry: rings are flat arrays [x0,y0,x1,y1,...] in sheet pixels, filled even-odd.

import ClipperLib from 'clipper-lib';

const SC = 16; // clipper integer scale (1/16 px precision)

export function ringsBBox(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      const x = r[i], y = r[i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

export const translateRings = (rings, dx, dy) => rings.map((r) => r.map((v, i) => (i & 1 ? v + dy : v + dx)));

export function signedArea(r) {
  let a = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a / 2;
}

export function ringsArea(rings) {
  const sol = execEvenOdd(ClipperLib.ClipType.ctUnion, toPaths(rings), null);
  let a = 0;
  for (const p of sol) a += ClipperLib.Clipper.Area(p);
  return Math.abs(a) / (SC * SC);
}

export function pointInRings(rings, x, y) {
  let inside = false;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function pathFromRings(rings) {
  const p = new Path2D();
  for (const r of rings) {
    if (r.length < 6) continue;
    p.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
    p.closePath();
  }
  return p;
}

export const vertexCount = (rings) => rings.reduce((n, r) => n + (r.length >> 1), 0);

// ------------------------------------------------------------------ clipper wrappers

function toPaths(rings) {
  return rings.map((r) => {
    const p = [];
    for (let i = 0; i < r.length; i += 2) p.push({ X: Math.round(r[i] * SC), Y: Math.round(r[i + 1] * SC) });
    return p;
  });
}

function fromPaths(paths) {
  const out = [];
  for (const p of paths) {
    if (p.length < 3) continue;
    const r = [];
    for (const q of p) r.push(q.X / SC, q.Y / SC);
    out.push(r);
  }
  return out;
}

function execEvenOdd(type, subj, clip) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const sol = new ClipperLib.Paths();
  c.Execute(type, sol, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return sol;
}

/** a minus the union of several ring sets. */
export function difference(a, bList) {
  if (!bList.length) return a;
  const clipU = unionMany(bList);
  return fromPaths(execEvenOdd(ClipperLib.ClipType.ctDifference, toPaths(a), toPaths(clipU)));
}

/** Union of several ring sets (each even-odd) -> rings. */
export function unionMany(list) {
  if (!list.length) return [];
  const c = new ClipperLib.Clipper();
  for (const rings of list) {
    // normalise each shape on its own so its holes stay holes
    const norm = execEvenOdd(ClipperLib.ClipType.ctUnion, toPaths(rings), null);
    c.AddPaths(norm, ClipperLib.PolyType.ptSubject, true);
  }
  const sol = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromPaths(sol);
}

export function cleanRings(rings) {
  return fromPaths(execEvenOdd(ClipperLib.ClipType.ctUnion, toPaths(rings), null));
}

/** Grows (delta > 0) or shrinks a shape; holes behave as expected. */
export function offsetRings(rings, delta) {
  if (!delta) return rings;
  const norm = execEvenOdd(ClipperLib.ClipType.ctUnion, toPaths(rings), null);
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SC);
  co.AddPaths(norm, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const sol = new ClipperLib.Paths();
  co.Execute(sol, delta * SC);
  return fromPaths(sol);
}

/** Where two shapes overlap -> rings. */
export function intersectRings(a, b) {
  if (!a.length || !b.length) return [];
  return fromPaths(execEvenOdd(ClipperLib.ClipType.ctIntersection, toPaths(a), toPaths(b)));
}

const boxesMeet = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

/**
 * Several shapes as one: their union, with the narrow gaps between neighbours filled in (the line or
 * the writing that kept them apart, up to 2 × reach wide), so neighbours become one continuous shape.
 * Only gaps that lie between two of the shapes are filled: each shape's own outline, its notches and
 * its holes stay as they were, and shapes further apart stay apart (as parts of the one shape).
 */
export function mergeRings(list, reach) {
  const shapes = list.filter((r) => r && r.length);
  const all = unionMany(shapes);
  if (shapes.length < 2 || !(reach > 0) || !all.length) return all;
  // closing (grow, then shrink back): fills every gap narrower than 2 × reach, nothing else changes
  const closed = offsetRings(offsetRings(all, reach), -reach);
  const gaps = difference(closed, [all]);
  if (!gaps.length) return all;
  // ...of which only the parts within reach of two different shapes are gaps between neighbours
  const grown = shapes.map((r) => offsetRings(r, 2 * reach));
  const boxes = grown.map(ringsBBox);
  const between = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (!boxesMeet(boxes[i], boxes[j])) continue;
      const both = intersectRings(grown[i], grown[j]);
      if (both.length) between.push(both);
    }
  }
  if (!between.length) return all;
  const bridges = intersectRings(gaps, unionMany(between));
  return bridges.length ? withoutSpecks(unionMany([all, bridges])) : all;
}

/** Leaves out specks (parts and holes under 1 px²) that rounding can leave along an outline. */
function withoutSpecks(rings) {
  const out = [];
  let dropped = false;
  for (const p of pieces(rings)) {
    if (p.area < 1) { dropped = true; continue; }
    out.push(p.rings[0]);
    for (const hole of p.rings.slice(1)) {
      if (Math.abs(signedArea(hole)) < 1) dropped = true;
      else out.push(hole);
    }
  }
  return dropped ? out : rings;
}

function treeOf(rings) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(toPaths(rings), ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return tree;
}

/** Splits rings into separate pieces: [{ rings: [outer, ...holes], area }]. */
export function pieces(rings) {
  const out = [];
  const walk = (node) => {
    for (const ch of node.Childs()) {
      if (!ch.IsHole()) {
        const rs = [ch.Contour()];
        for (const hole of ch.Childs()) { rs.push(hole.Contour()); walk(hole); }
        const area = rs.reduce((a, p, i) => a + (i === 0 ? 1 : -1) * Math.abs(ClipperLib.Clipper.Area(p)), 0) / (SC * SC);
        out.push({ rings: fromPaths(rs), area });
      }
    }
  };
  walk(treeOf(rings));
  return out;
}

export function pieceAt(rings, x, y) {
  for (const p of pieces(rings)) if (pointInRings(p.rings, x, y)) return p.rings;
  return null;
}

/** Round-capped area swept by a brush of the given radius along a polyline. */
export function strokeArea(points, radius) {
  const path = [];
  for (let i = 0; i < points.length; i += 2) path.push({ X: Math.round(points[i] * SC), Y: Math.round(points[i + 1] * SC) });
  if (path.length === 1) path.push({ X: path[0].X + 1, Y: path[0].Y });
  const co = new ClipperLib.ClipperOffset(2, 0.25 * SC);
  co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound);
  const sol = new ClipperLib.Paths();
  co.Execute(sol, radius * SC);
  return fromPaths(sol);
}

// ------------------------------------------------------------------ nearest features

export function nearestPointOnSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L = vx * vx + vy * vy;
  let t = L > 0 ? ((px - ax) * vx + (py - ay) * vy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * vx, y = ay + t * vy;
  return { x, y, t, d: Math.hypot(px - x, py - y) };
}

export function nearestVertex(rings, x, y, maxD) {
  let best = null;
  rings.forEach((r, ri) => {
    for (let i = 0; i < r.length; i += 2) {
      const d = Math.hypot(r[i] - x, r[i + 1] - y);
      if (d <= maxD && (!best || d < best.d)) best = { ri, vi: i >> 1, x: r[i], y: r[i + 1], d };
    }
  });
  return best;
}

export function nearestEdge(rings, x, y, maxD) {
  let best = null;
  rings.forEach((r, ri) => {
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const q = nearestPointOnSeg(x, y, r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1]);
      if (q.d <= maxD && (!best || q.d < best.d)) best = { ri, si: i, x: q.x, y: q.y, d: q.d, ax: r[i * 2], ay: r[i * 2 + 1], bx: r[j * 2], by: r[j * 2 + 1] };
    }
  });
  return best;
}

function segIntersects(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** True when the shape overlaps the axis-aligned rectangle at all. */
export function ringsTouchRect(rings, [x0, y0, x1, y1]) {
  const b = ringsBBox(rings);
  if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) return false;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) if (r[i] >= x0 && r[i] <= x1 && r[i + 1] >= y0 && r[i + 1] <= y1) return true;
  if (pointInRings(rings, (x0 + x1) / 2, (y0 + y1) / 2)) return true;
  const edges = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      for (const e of edges) if (segIntersects(r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], e[0], e[1], e[2], e[3])) return true;
    }
  }
  return false;
}

/** Distance from a point to a polyline (flat array). */
export function distToPolyline(pts, x, y) {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) best = Math.min(best, nearestPointOnSeg(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]).d);
  return best;
}
