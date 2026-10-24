// Image-processing primitives for PlanTint. Pure functions over typed arrays (no DOM),
// so they run inside the engine worker and can be unit-tested in Node.
//
// Conventions
//   rgba  : Uint8ClampedArray, 4 bytes per pixel, row-major, alpha always 255
//   masks : Uint8Array, 1 byte per pixel, non-zero = inside
//   rings : flat arrays [x0,y0,x1,y1,...] in sheet pixels; pixel (i,j) covers [i,i+1]x[j,j+1]

// ------------------------------------------------------------------ distance transform

/**
 * Chessboard distance from every pixel to the nearest "barrier" pixel, capped at 255.
 * A pixel is a barrier when any channel differs from the seed colour by more than tol,
 * or when it is set in gapMask (user-drawn gap lines).
 */
export function barrierDistance(rgba, W, H, sr, sg, sb, tol, gapMask, out) {
  const d = out && out.length === W * H ? out : new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      const p = i << 2;
      let dr = rgba[p] - sr; if (dr < 0) dr = -dr;
      let dg = rgba[p + 1] - sg; if (dg < 0) dg = -dg;
      let db = rgba[p + 2] - sb; if (db < 0) db = -db;
      if (dr > tol || dg > tol || db > tol || (gapMask !== null && gapMask[i] !== 0)) { d[i] = 0; continue; }
      let v = 255, a;
      if (x > 0) { a = d[i - 1] + 1; if (a < v) v = a; }
      if (y > 0) {
        const u = i - W;
        a = d[u] + 1; if (a < v) v = a;
        if (x > 0) { a = d[u - 1] + 1; if (a < v) v = a; }
        if (x < W - 1) { a = d[u + 1] + 1; if (a < v) v = a; }
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    const row = y * W;
    for (let x = W - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      let a;
      if (x < W - 1) { a = d[i + 1] + 1; if (a < v) v = a; }
      if (y < H - 1) {
        const dn = i + W;
        a = d[dn] + 1; if (a < v) v = a;
        if (x < W - 1) { a = d[dn + 1] + 1; if (a < v) v = a; }
        if (x > 0) { a = d[dn - 1] + 1; if (a < v) v = a; }
      }
      d[i] = v;
    }
  }
  return d;
}

// ------------------------------------------------------------------ flood fill

/**
 * Scan-line flood fill (4-connected) over pixels whose distance value is > thr and that are
 * not covered by an existing markup (wall). Marks R.
 */
export function floodFill(dt, W, H, sx, sy, thr, R, wall = null) {
  let stack = new Int32Array(1 << 16);
  let sp = 0;
  const push = (x, y) => {
    if (sp + 2 > stack.length) { const n = new Int32Array(stack.length * 2); n.set(stack); stack = n; }
    stack[sp++] = x; stack[sp++] = y;
  };
  const ok = wall
    ? (j) => R[j] === 0 && dt[j] > thr && wall[j] === 0
    : (j) => R[j] === 0 && dt[j] > thr;
  push(sx, sy);
  let area = 0, x0 = sx, x1 = sx, y0 = sy, y1 = sy;
  while (sp > 0) {
    const y = stack[--sp];
    const x = stack[--sp];
    const row = y * W;
    if (!ok(row + x)) continue;
    let l = x, r = x;
    while (l > 0 && ok(row + l - 1)) l--;
    while (r < W - 1 && ok(row + r + 1)) r++;
    for (let k = l; k <= r; k++) R[row + k] = 1;
    area += r - l + 1;
    if (l < x0) x0 = l;
    if (r > x1) x1 = r;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    for (let dy = -1; dy <= 1; dy += 2) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      const nrow = ny * W;
      let span = false;
      for (let k = l; k <= r; k++) {
        if (ok(nrow + k)) { if (!span) { push(k, ny); span = true; } } else span = false;
      }
    }
  }
  return { area, x0, y0, x1, y1 };
}

/** Even-odd scan conversion of rings into a mask window (pixel centres). */
export function rasterizeRings(rings, x0, y0, w, h, out) {
  const xs = [];
  for (let y = 0; y < h; y++) {
    const sy = y0 + y + 0.5;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const yi = r[i + 1], yj = r[j + 1];
        if ((yi > sy) !== (yj > sy)) xs.push(r[i] + ((sy - yi) * (r[j] - r[i])) / (yj - yi));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let a = Math.ceil(xs[k] - 0.5 - x0), b = Math.floor(xs[k + 1] - 0.5 - x0);
      if (a < 0) a = 0;
      if (b > w - 1) b = w - 1;
      if (a <= b) out.fill(1, y * w + a, y * w + b + 1);
    }
  }
}

// ------------------------------------------------------------------ windows

export function cropMask(src, W, x0, y0, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const s = (y0 + y) * W + x0;
    out.set(src.subarray(s, s + w), y * w);
  }
  return out;
}

export function clearRect(arr, W, x0, y0, w, h) {
  for (let y = 0; y < h; y++) {
    const s = (y0 + y) * W + x0;
    arr.fill(0, s, s + w);
  }
}

export function countMask(m) {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i] !== 0) n++;
  return n;
}

// ------------------------------------------------------------------ morphology (square element)

export function dilate(src, w, h, r) {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let last = -1e9;
    for (let x = 0; x < w; x++) { if (src[o + x] !== 0) last = x; if (x - last <= r) tmp[o + x] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (src[o + x] !== 0) last = x; if (last - x <= r) tmp[o + x] = 1; }
  }
  const out = new Uint8Array(w * h);
  const lastA = new Int32Array(w).fill(-1e9);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) { if (tmp[o + x] !== 0) lastA[x] = y; if (y - lastA[x] <= r) out[o + x] = 1; }
  }
  lastA.fill(1e9);
  for (let y = h - 1; y >= 0; y--) {
    const o = y * w;
    for (let x = 0; x < w; x++) { if (tmp[o + x] !== 0) lastA[x] = y; if (lastA[x] - y <= r) out[o + x] = 1; }
  }
  return out;
}

export function erode(src, w, h, r) {
  if (r <= 0) return src.slice();
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = src[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  // pixels near the window edge are treated as outside
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x < r || y < r || x >= w - r || y >= h - r) d[y * w + x] = 0;
  }
  return d;
}

// ------------------------------------------------------------------ holes

/**
 * Finds holes (background components not connected to the window border) and lets `decide`
 * choose whether each one is filled. decide(area, indices, count) -> boolean.
 */
export function fillHoles(mask, w, h, decide) {
  const N = w * h;
  const lab = new Uint8Array(N); // 0 unvisited background, 1 fg, 2 outside, 3 hole visited
  for (let i = 0; i < N; i++) if (mask[i]) lab[i] = 1;
  let stack = new Int32Array(1 << 14);
  let sp = 0;
  const push = (i) => {
    if (sp >= stack.length) { const n = new Int32Array(stack.length * 2); n.set(stack); stack = n; }
    stack[sp++] = i;
  };
  const seedOutside = (i) => { if (lab[i] === 0) { lab[i] = 2; push(i); } };
  for (let x = 0; x < w; x++) { seedOutside(x); seedOutside((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seedOutside(y * w); seedOutside(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0 && lab[i - 1] === 0) { lab[i - 1] = 2; push(i - 1); }
    if (x < w - 1 && lab[i + 1] === 0) { lab[i + 1] = 2; push(i + 1); }
    if (i >= w && lab[i - w] === 0) { lab[i - w] = 2; push(i - w); }
    if (i + w < N && lab[i + w] === 0) { lab[i + w] = 2; push(i + w); }
  }
  let list = new Int32Array(1 << 12);
  let filled = 0;
  for (let s = 0; s < N; s++) {
    if (lab[s] !== 0) continue;
    let n = 0;
    lab[s] = 3; push(s);
    while (sp > 0) {
      const i = stack[--sp];
      if (n >= list.length) { const nl = new Int32Array(list.length * 2); nl.set(list); list = nl; }
      list[n++] = i;
      const x = i % w;
      if (x > 0 && lab[i - 1] === 0) { lab[i - 1] = 3; push(i - 1); }
      if (x < w - 1 && lab[i + 1] === 0) { lab[i + 1] = 3; push(i + 1); }
      if (i >= w && lab[i - w] === 0) { lab[i - w] = 3; push(i - w); }
      if (i + w < N && lab[i + w] === 0) { lab[i + w] = 3; push(i + w); }
    }
    if (decide(n, list, n)) {
      for (let k = 0; k < n; k++) mask[list[k]] = 1;
      filled += n;
    }
  }
  return filled;
}

/**
 * Grows a region by absorbing small free-space pockets that sit next to it behind thin lines
 * (lines up to about 2*d pixels thick), such as furniture standing against a wall. Pockets that
 * reach the window border, or that would add more than maxArea in total, are left alone.
 * Returns the number of pixels added.
 */
export function absorbPockets(region, w, h, isFree, d, maxArea) {
  const N = w * h;
  const lab = new Int32Array(N);   // 0 unvisited, -1 not free, >0 component id
  const order = new Int32Array(N); // pixels of each component, stored one after another
  const starts = [0], ends = [0], areas = [0], borders = [false], taken = [false];
  let top = 0;
  for (let s = 0; s < N; s++) {
    if (lab[s] !== 0) continue;
    if (region[s] || !isFree(s)) { lab[s] = -1; continue; }
    const id = starts.length;
    const begin = top;
    let read = top, border = false;
    lab[s] = id; order[top++] = s;
    while (read < top) {
      const i = order[read++];
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      let j;
      if (x > 0) { j = i - 1; if (lab[j] === 0) { if (region[j] || !isFree(j)) lab[j] = -1; else { lab[j] = id; order[top++] = j; } } }
      if (x < w - 1) { j = i + 1; if (lab[j] === 0) { if (region[j] || !isFree(j)) lab[j] = -1; else { lab[j] = id; order[top++] = j; } } }
      if (y > 0) { j = i - w; if (lab[j] === 0) { if (region[j] || !isFree(j)) lab[j] = -1; else { lab[j] = id; order[top++] = j; } } }
      if (y < h - 1) { j = i + w; if (lab[j] === 0) { if (region[j] || !isFree(j)) lab[j] = -1; else { lab[j] = id; order[top++] = j; } } }
    }
    starts.push(begin); ends.push(top); areas.push(top - begin); borders.push(border); taken.push(false);
  }
  let added = 0;
  for (let pass = 0; pass < 3; pass++) {
    const near = dilate(region, w, h, d);
    const touched = new Set();
    for (let i = 0; i < N; i++) if (near[i] && lab[i] > 0) touched.add(lab[i]);
    const cand = [...touched].filter((k) => !taken[k] && !borders[k]).sort((a, b) => areas[a] - areas[b]);
    let any = false;
    for (const k of cand) {
      if (added + areas[k] > maxArea) break;
      for (let t = starts[k]; t < ends[k]; t++) region[order[t]] = 1;
      taken[k] = true;
      added += areas[k];
      any = true;
    }
    if (!any) break;
  }
  return added;
}

// ------------------------------------------------------------------ contours

/**
 * Traces the pixel-edge boundaries of a mask. Outer boundaries come out clockwise
 * (positive shoelace area in y-down coordinates), holes counter-clockwise.
 */
export function traceContours(mask, w, h, ox, oy) {
  const visited = new Uint8Array(w * h);
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] !== 0;
  const rings = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] === 0 || visited[i] !== 0) continue;
      if (y > 0 && mask[i - w] !== 0) continue;
      const pts = [];
      let cx = x, cy = y, d = 0, prev = -1, guard = 0;
      const limit = 4 * (w + 1) * (h + 1);
      do {
        if (d === 0) visited[cy * w + cx] = 1;
        if (d !== prev) { pts.push(cx + ox, cy + oy); prev = d; }
        cx += DX[d]; cy += DY[d];
        const dx = DX[d], dy = DY[d], rx = -dy, ry = dx;
        const arx = dx + rx, ary = dy + ry, alx = dx - rx, aly = dy - ry;
        const rIn = inside(cx + (arx < 0 ? -1 : 0), cy + (ary < 0 ? -1 : 0));
        if (!rIn) d = (d + 1) & 3;
        else if (inside(cx + (alx < 0 ? -1 : 0), cy + (aly < 0 ? -1 : 0))) d = (d + 3) & 3;
        if (++guard > limit) break;
      } while (!(cx === x && cy === y && d === 0));
      if (pts.length >= 6) rings.push(pts);
    }
  }
  return rings;
}

export function ringArea(r) {
  let a = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a / 2;
}

function segDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L = vx * vx + vy * vy;
  let t = L > 0 ? ((px - ax) * vx + (py - ay) * vy) / L : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const dx = ax + t * vx - px, dy = ay + t * vy - py;
  return dx * dx + dy * dy;
}

/** Douglas–Peucker on a closed ring (flat array). */
export function simplifyClosed(r, eps) {
  const n = r.length >> 1;
  if (n <= 4) return r.slice();
  const X = (i) => r[(i % n) * 2], Y = (i) => r[(i % n) * 2 + 1];
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) {
    const dx = X(i) - X(0), dy = Y(i) - Y(0);
    const dd = dx * dx + dy * dy;
    if (dd > best) { best = dd; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[far] = 1;
  const eps2 = eps * eps;
  const stack = [0, far, far, n];
  while (stack.length) {
    const b = stack.pop(), a = stack.pop();
    if (b - a < 2) continue;
    let idx = -1, md = eps2;
    const ax = X(a), ay = Y(a), bx = X(b), by = Y(b);
    for (let i = a + 1; i < b; i++) {
      const dd = segDist2(X(i), Y(i), ax, ay, bx, by);
      if (dd > md) { md = dd; idx = i; }
    }
    if (idx >= 0) { keep[idx % n] = 1; stack.push(a, idx, idx, b); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(r[i * 2], r[i * 2 + 1]);
  return removeCollinear(out);
}

export function removeCollinear(r) {
  let pts = r;
  let changed = true;
  while (changed && pts.length >= 8) {
    changed = false;
    const n = pts.length >> 1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n;
      const ax = pts[p * 2], ay = pts[p * 2 + 1], bx = pts[i * 2], by = pts[i * 2 + 1], cx = pts[q * 2], cy = pts[q * 2 + 1];
      const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
      const dup = ax === bx && ay === by;
      if (dup || Math.abs(cross) < 1e-9) { changed = true; continue; }
      out.push(bx, by);
    }
    if (out.length < 6) return pts;
    pts = out;
  }
  return pts;
}

/** Trace + simplify + drop specks. Returns rings in sheet coordinates. */
export function maskToRings(mask, w, h, ox, oy, eps = 0.9, minArea = 3) {
  const raw = traceContours(mask, w, h, ox, oy);
  const out = [];
  for (const r of raw) {
    if (Math.abs(ringArea(r)) < minArea) continue;
    const s = simplifyClosed(r, eps);
    if (s.length >= 6 && Math.abs(ringArea(s)) >= minArea) out.push(s);
  }
  return out;
}

// ------------------------------------------------------------------ pyramid

/** 2:1 reduction that keeps thin dark lines visible (mean blended with minimum). */
export function reduce2x(src, sw, sh, dst, dw, rx0, ry0, rx1, ry1) {
  for (let y = ry0; y < ry1; y++) {
    const sy0 = 2 * y, sy1 = Math.min(2 * y + 1, sh - 1);
    for (let x = rx0; x < rx1; x++) {
      const sx0 = 2 * x, sx1 = Math.min(2 * x + 1, sw - 1);
      const a = (sy0 * sw + sx0) << 2, b = (sy0 * sw + sx1) << 2, c = (sy1 * sw + sx0) << 2, d = (sy1 * sw + sx1) << 2;
      const o = (y * dw + x) << 2;
      for (let ch = 0; ch < 3; ch++) {
        const v0 = src[a + ch], v1 = src[b + ch], v2 = src[c + ch], v3 = src[d + ch];
        let mn = v0 < v1 ? v0 : v1;
        const m2 = v2 < v3 ? v2 : v3;
        if (m2 < mn) mn = m2;
        dst[o + ch] = (((v0 + v1 + v2 + v3) >> 2) + mn) >> 1;
      }
      dst[o + 3] = 255;
    }
  }
}

/**
 * reduce2x reading from part of the source picture: src holds columns [ox, ox + bw) and rows
 * [oy, oy + bh) of an sw x sh picture, and must include every pixel the destination rows need.
 */
export function reduce2xFrom(src, bw, ox, oy, sw, sh, dst, dw, rx0, ry0, rx1, ry1) {
  for (let y = ry0; y < ry1; y++) {
    const sy0 = 2 * y - oy, sy1 = Math.min(2 * y + 1, sh - 1) - oy;
    for (let x = rx0; x < rx1; x++) {
      const sx0 = 2 * x - ox, sx1 = Math.min(2 * x + 1, sw - 1) - ox;
      const a = (sy0 * bw + sx0) << 2, b = (sy0 * bw + sx1) << 2, c = (sy1 * bw + sx0) << 2, d = (sy1 * bw + sx1) << 2;
      const o = (y * dw + x) << 2;
      for (let ch = 0; ch < 3; ch++) {
        const v0 = src[a + ch], v1 = src[b + ch], v2 = src[c + ch], v3 = src[d + ch];
        let mn = v0 < v1 ? v0 : v1;
        const m2 = v2 < v3 ? v2 : v3;
        if (m2 < mn) mn = m2;
        dst[o + ch] = (((v0 + v1 + v2 + v3) >> 2) + mn) >> 1;
      }
      dst[o + 3] = 255;
    }
  }
}

/** A copy of the rectangle (x0, y0, w, h) of an RGBA picture W pixels wide. */
export function copyRect(rgba, W, x0, y0, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * W + x0) * 4;
    out.set(rgba.subarray(s, s + w * 4), y * w * 4);
  }
  return out;
}

// ------------------------------------------------------------------ RLE (masks)

export function rleEncode(mask) {
  const runs = [];
  let cur = 0, len = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] !== 0 ? 1 : 0;
    if (v === cur) len++;
    else { runs.push(len); cur = v; len = 1; }
  }
  runs.push(len);
  return Uint32Array.from(runs);
}

export function rleDecode(runs, n) {
  const out = new Uint8Array(n);
  let pos = 0, v = 0;
  for (let k = 0; k < runs.length; k++) {
    const len = runs[k];
    if (v) out.fill(1, pos, Math.min(n, pos + len));
    pos += len;
    v ^= 1;
  }
  return out;
}

// ------------------------------------------------------------------ paint removal

/**
 * Removes painted colour from the drawing inside a mask while keeping line work.
 *
 * Each pixel (relative to the paper colour) is modelled as   pixel = k * (paper + a * (paint - paper))
 * where k is how dark the line work is and a how much paint covers the pixel. When that model fits
 * one of the paint colours closely, the paint is taken out and the pixel becomes k * paper:
 * paint turns back into paper, black lines stay black, and anti-aliased line edges keep their
 * softness. Pixels of other colours (red revision clouds, a neighbouring zone) do not fit and stay.
 * For a neutral (grey) paint only grey pixels are touched.
 *
 * part: { x0, y0, w, h, mask, colors: [[r,g,b], ...] }  (colors in drawing pixel values)
 * Returns { patch, changed }: the original pixels of the window (for undo) and the count changed.
 */
export function unpaint(rgba, W, part, paper, tol = 16) {
  const { x0, y0, w, h, mask } = part;
  const r32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2);
  const patch = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) patch.set(r32.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + w), y * w);
  const changed = unpaintPixels(rgba, W, x0, y0, w, h, mask, w, 0, 0, paintModels(part.colors || [part.color], paper), tol);
  return { patch, changed };
}

/** Paint colours (drawing pixel values) prepared for unpaintPixels: relative to paper, with the least-squares terms solved. */
export function paintModels(colors, paper) {
  const pr = Math.max(paper[0], 1), pg = Math.max(paper[1], 1), pb = Math.max(paper[2], 1);
  const cand = colors.map((c) => {
    const cr = Math.min(1, c[0] / pr), cg = Math.min(1, c[1] / pg), cb = Math.min(1, c[2] / pb);
    const ur = cr - 1, ug = cg - 1, ub = cb - 1;
    const eu = ur + ug + ub, uu = ur * ur + ug * ug + ub * ub;
    const det = 3 * uu - eu * eu;
    const mx = Math.max(cr, cg, cb), mn = Math.min(cr, cg, cb);
    return { cr, cg, cb, ur, ug, ub, eu, uu, det, neutral: mx - mn < 0.035 || det < 1e-4, lum: 0.3 * cr + 0.59 * cg + 0.11 * cb };
  });
  return { pr, pg, pb, cand };
}

/**
 * The pixel loop of unpaint, over the window (x0, y0, w, h) of rgba (row width W), for the pixels
 * where mask[(my0 + y) * mw + mx0 + x] is set. models: from paintModels.
 * loose (highlights that cover paint): a pixel that is close to a paint colour but does not fit the
 * model, such as JPEG noise or a blurred scan, is read as that paint at its own lightness, so no
 * specks of the old colour stay behind. It is the largest distance (sum over r, g, b, relative to
 * paper) at which that applies; 0 = off. Returns the number of pixels changed.
 */
export function unpaintPixels(rgba, W, x0, y0, w, h, mask, mw, mx0, my0, models, tol = 16, loose = 0) {
  const { pr, pg, pb, cand } = models;
  if (!cand.length) return 0;
  const tol2 = (tol / 255) * (tol / 255);
  let changed = 0;
  for (let y = 0; y < h; y++) {
    const mrow = (my0 + y) * mw + mx0;
    for (let x = 0; x < w; x++) {
      if (!mask[mrow + x]) continue;
      const p = ((y0 + y) * W + x0 + x) << 2;
      const R = rgba[p], G = rgba[p + 1], B = rgba[p + 2];
      const Pr = R / pr, Pg = G / pg, Pb = B / pb;
      const pmx = Math.max(Pr, Pg, Pb), pmn = Math.min(Pr, Pg, Pb);
      let bestErr = tol2, bestK = -1, bestA = 1;
      for (let i = 0; i < cand.length; i++) {
        const c = cand[i];
        let k;
        if (c.neutral) {
          // grey paint: only grey pixels; the pixel is read as the paint darkened by line work
          // (k = 1 is the paint itself, which becomes paper). It wins over a coloured paint that
          // only fits by finding none of its colour in the pixel.
          if (pmx - pmn > 0.05) continue;
          const lum = (Pr + Pg + Pb) / 3;
          if (lum >= 0.985) continue; // already paper
          const lv = (c.cr + c.cg + c.cb) / 3;
          if (lum < lv * 0.35) continue; // ink (walls, lines, text), not paint
          k = Math.min(1, lum / Math.max(lv, 0.05));
          if (0 < bestErr || bestA < 0.05) { bestErr = 0; bestK = k; bestA = 1; }
          continue;
        }
        // least squares for P ~ A*e + Bc*u  (e = 1,1,1 ; u = paint - paper)
        const ep = Pr + Pg + Pb, up = c.ur * Pr + c.ug * Pg + c.ub * Pb;
        const A = (c.uu * ep - c.eu * up) / c.det;
        const Bc = (3 * up - c.eu * ep) / c.det;
        if (A <= 0.002) continue; // black: nothing to remove
        let a = Bc / A;
        if (a < 0) a = 0; else if (a > 1) a = 1;
        const vr = 1 + a * c.ur, vg = 1 + a * c.ug, vb = 1 + a * c.ub;
        const vv = vr * vr + vg * vg + vb * vb;
        k = (vr * Pr + vg * Pg + vb * Pb) / vv;
        const er = Pr - k * vr, eg = Pg - k * vg, eb = Pb - k * vb;
        const err = er * er + eg * eg + eb * eb;
        if (err < bestErr) { bestErr = err; bestK = k; bestA = a; }
      }
      if (bestK < 0 && loose > 0) {
        // near a paint colour without fitting it: that paint, at the pixel's own lightness
        let bd = loose;
        const lp = 0.3 * Pr + 0.59 * Pg + 0.11 * Pb;
        for (let i = 0; i < cand.length; i++) {
          const c = cand[i];
          if (c.neutral) continue;
          const d = Math.abs(Pr - c.cr) + Math.abs(Pg - c.cg) + Math.abs(Pb - c.cb);
          if (d <= bd) { bd = d; bestK = lp / Math.max(c.lum, 0.05); }
        }
      }
      if (bestK < 0) continue;
      if (bestK > 1) bestK = 1;
      const nr = pr * bestK, ng = pg * bestK, nb = pb * bestK;
      if (Math.abs(nr - R) + Math.abs(ng - G) + Math.abs(nb - B) < 3) continue;
      rgba[p] = nr; rgba[p + 1] = ng; rgba[p + 2] = nb;
      changed++;
    }
  }
  return changed;
}

// ------------------------------------------------------------------ highlights that cover paint

/** Colours that can be paint (fills), relative to paper (0..255): coloured, or a light grey. */
function paintish(R, G, B) {
  const mx = R > G ? (R > B ? R : B) : (G > B ? G : B);
  const mn = R < G ? (R < B ? R : B) : (G < B ? G : B);
  if (mx - mn >= 14) return mx >= 60;
  if (mx - mn < 10) { const v = (R + G + B) / 3; return v >= 140 && v <= 244; }
  return false;
}

/**
 * The paint under a highlight: colour filled into areas of the drawing (a building painted green, a
 * room painted yellow, water painted blue) that a highlight on top replaces, so the highlight shows
 * its own colour. Coloured lines, text, hatching and symbols are not fills (nothing solid inside
 * them), so they stay; so do black and dark grey (walls, line work). A light grey fill counts as paint.
 *
 * Looks at the pixels where mask is set in the window (x0, y0, w, h) of rgba (W x H). A colour is a
 * fill where its pixels have the same colour r pixels away in all four directions (r is about
 * 0.3 mm, so lines thinner than about 0.7 mm never count) and at least minSolid pixels of it are
 * like that. Returns the paint colours in drawing pixel values: a few shades per fill, so that noise
 * in pictures and scans is covered too.
 */
const HIST = new Uint32Array(32768);
const NEAR = new Uint8Array(32768).fill(254); // 254: not worked out yet, 255: no shade near

export function coverPaints(rgba, W, H, x0, y0, w, h, mask, paper, r = 3, minSolid = 200) {
  const nr = 255 / Math.max(paper[0], 1), ng = 255 / Math.max(paper[1], 1), nb = 255 / Math.max(paper[2], 1);
  // big areas are looked at on a coarser grid, s pixels apart (fills are large, so nothing is lost)
  const n0 = w * h;
  const s = n0 > 6e6 ? 4 : n0 > 2.4e6 ? 3 : n0 > 6e5 ? 2 : 1;
  const rs = Math.max(1, Math.round(r / s)); // reach, in grid steps
  const cell = s * s;
  // the grid: the window and a rim of rs steps; sample (i, j) is pixel (gx0 + i * s, gy0 + j * s)
  const iw = Math.ceil(w / s), ih = Math.ceil(h / s);
  const gw = iw + 2 * rs, gh = ih + 2 * rs;
  const gx0 = x0 - rs * s, gy0 = y0 - rs * s;
  const norm = (p) => [Math.min(255, rgba[p] * nr), Math.min(255, rgba[p + 1] * ng), Math.min(255, rgba[p + 2] * nb)];
  // 1. the colours under the mask that can be paint, in bins of 8 levels
  const hist = HIST;
  const used = [];
  let total = 0;
  for (let j = 0; j < ih; j++) {
    const y = j * s;
    for (let i = 0; i < iw; i++) {
      const x = i * s;
      if (!mask[y * w + x]) continue;
      total++;
      const [R, G, B] = norm(((y0 + y) * W + x0 + x) << 2);
      if (!paintish(R, G, B)) continue;
      const k = ((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3);
      if (hist[k]++ === 0) used.push(k);
    }
  }
  // 2. shades (the heaviest bins, nearby bins joining them), grouped into fills around the heaviest shade of each
  const bins = used.filter((k) => hist[k] >= 2);
  bins.sort((a, b) => hist[b] - hist[a]);
  const counts = bins.map((k) => hist[k]);
  for (const k of used) hist[k] = 0;
  if (!total || !bins.length) return [];
  const shades = [];
  for (let q = 0; q < bins.length; q++) {
    const k = bins[q];
    const R = ((k >> 10) & 31) * 8 + 4, G = ((k >> 5) & 31) * 8 + 4, B = (k & 31) * 8 + 4;
    let best = -1, bd = 1e9;
    for (let c = 0; c < shades.length; c++) {
      const sh = shades[c];
      const d = Math.hypot(sh.r - R, sh.g - G, sh.b - B);
      if (d < bd) { bd = d; best = c; }
    }
    if (best >= 0 && bd <= 22) shades[best].w += counts[q];
    else if (shades.length < 160) {
      const neutral = Math.max(R, G, B) - Math.min(R, G, B) < 12;
      if (neutral && Math.min(R, G, B) >= 240) continue; // as good as paper
      shades.push({ r: R, g: G, b: B, w: counts[q], fam: -1, reach: neutral ? 30 : 58 });
    }
  }
  if (!shades.length) return [];
  const seeds = [];
  for (let c = 0; c < shades.length; c++) {
    const sh = shades[c];
    for (const f of seeds) { const q = shades[f]; if (Math.hypot(q.r - sh.r, q.g - sh.g, q.b - sh.b) <= 48) { sh.fam = shades[f].fam; break; } }
    if (sh.fam < 0) { sh.fam = seeds.length; seeds.push(c); }
  }
  const nf = seeds.length;
  // 3. every sample of the grid to its nearest shade (within reach), worked out once per colour bin; paper never
  const near = NEAR;
  const seen = [];
  const nearest = (k) => {
    const R = ((k >> 10) & 31) * 8 + 4, G = ((k >> 5) & 31) * 8 + 4, B = (k & 31) * 8 + 4;
    let best = 255;
    if (!(Math.min(R, G, B) >= 244 && Math.max(R, G, B) - Math.min(R, G, B) < 12)) {
      let bd = 1e9;
      for (let c = 0; c < shades.length; c++) {
        const sh = shades[c];
        const d = Math.abs(sh.r - R) + Math.abs(sh.g - G) + Math.abs(sh.b - B);
        if (d < sh.reach && d < bd) { bd = d; best = c; }
      }
    }
    seen.push(k);
    return (near[k] = best);
  };
  const fam = new Uint8Array(gw * gh).fill(255);
  const shadeAt = new Uint8Array(gw * gh).fill(255);
  for (let j = 0; j < gh; j++) {
    const py = gy0 + j * s;
    if (py < 0 || py >= H) continue;
    for (let i = 0; i < gw; i++) {
      const px = gx0 + i * s;
      if (px < 0 || px >= W) continue;
      const [R, G, B] = norm((py * W + px) << 2);
      const k = ((R >> 3) << 10) | ((G >> 3) << 5) | (B >> 3);
      let c = near[k];
      if (c === 254) c = nearest(k);
      if (c !== 255) { shadeAt[j * gw + i] = c; fam[j * gw + i] = shades[c].fam; }
    }
  }
  for (const k of seen) near[k] = 254;
  // 4. how much of each fill is solid
  const cnt = new Float64Array(nf), solid = new Float64Array(nf);
  const swt = new Float64Array(shades.length), sr = new Float64Array(shades.length), sg = new Float64Array(shades.length), sb = new Float64Array(shades.length);
  for (let j = 0; j < ih; j++) {
    const y = j * s, gj = j + rs;
    for (let i = 0; i < iw; i++) {
      const x = i * s;
      if (!mask[y * w + x]) continue;
      const g = gj * gw + i + rs;
      const f = fam[g];
      if (f === 255) continue;
      cnt[f]++;
      if (fam[g - rs] !== f || fam[g + rs] !== f || fam[g - rs * gw] !== f || fam[g + rs * gw] !== f) continue;
      solid[f]++;
      const c = shadeAt[g], p = ((y0 + y) * W + x0 + x) << 2;
      swt[c]++; sr[c] += rgba[p]; sg[c] += rgba[p + 1]; sb[c] += rgba[p + 2];
    }
  }
  // 5. the fills: their shades, as the mean colour of the solid pixels of each
  const keep = [];
  for (let f = 0; f < nf; f++) {
    if (solid[f] * cell < Math.min(minSolid, total * cell * 0.25) || solid[f] < 0.12 * cnt[f]) continue;
    keep.push(f);
  }
  keep.sort((a, b) => solid[b] - solid[a]);
  const out = [];
  for (const f of keep) {
    const own = [];
    for (let c = 0; c < shades.length; c++) if (shades[c].fam === f && swt[c] >= Math.max(3, solid[f] * 0.01)) own.push(c);
    own.sort((a, b) => swt[b] - swt[a]);
    for (const c of own.slice(0, 3)) {
      const col = [sr[c] / swt[c], sg[c] / swt[c], sb[c] / swt[c]];
      const nc = [col[0] * nr, col[1] * ng, col[2] * nb];
      if (Math.min(...nc) >= 245 && Math.max(...nc) - Math.min(...nc) < 10) continue; // paper
      out.push(col);
    }
    if (out.length >= 24) break;
  }
  return out;
}

export function restorePatch(rgba, W, part, patch) {
  const { x0, y0, w, h } = part;
  const r32 = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2);
  for (let y = 0; y < h; y++) r32.set(patch.subarray(y * w, y * w + w), (y0 + y) * W + x0);
}

/**
 * Finds the paint colours under a brush stroke: the dominant colours of the coloured pixels,
 * plus a light grey when a grey fill clearly dominates. Returns colours in drawing pixel values.
 */
export function estimatePaints(rgba, W, x0, y0, w, h, mask, paper, minChroma = 12) {
  const nr = 255 / Math.max(paper[0], 1), ng = 255 / Math.max(paper[1], 1), nb = 255 / Math.max(paper[2], 1);
  const hist = new Uint32Array(32768);
  const grey = new Uint32Array(256);
  let total = 0, chromatic = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      total++;
      const p = ((y0 + y) * W + x0 + x) << 2;
      const r = Math.min(255, rgba[p] * nr), g = Math.min(255, rgba[p + 1] * ng), b = Math.min(255, rgba[p + 2] * nb);
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx - mn >= minChroma && mx >= 60) { hist[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++; chromatic++; }
      else if (mx - mn < 8) grey[Math.round((r + g + b) / 3)]++;
    }
  }
  const out = [];
  if (chromatic >= Math.max(12, total * 0.01)) {
    const bins = [];
    for (let k = 0; k < 32768; k++) if (hist[k] >= 3) bins.push(k);
    bins.sort((a, b) => hist[b] - hist[a]);
    const centers = [];
    for (const k of bins) {
      const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4, wt = hist[k];
      let best = -1, bd = 1e9;
      for (let c = 0; c < centers.length; c++) {
        const C = centers[c];
        const d = Math.hypot(C.r - r, C.g - g, C.b - b);
        if (d < bd) { bd = d; best = c; }
      }
      if (best >= 0 && bd <= 30) centers[best].w += wt;
      else if (centers.length < 8) centers.push({ r, g, b, w: wt });
    }
    const keep = centers.filter((C) => C.w >= Math.max(10, chromatic * 0.04));
    // refine: mean of the pixels close to each centre, in drawing pixel values
    const acc = keep.map(() => [0, 0, 0, 0]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const p = ((y0 + y) * W + x0 + x) << 2;
        const r = Math.min(255, rgba[p] * nr), g = Math.min(255, rgba[p + 1] * ng), b = Math.min(255, rgba[p + 2] * nb);
        for (let c = 0; c < keep.length; c++) {
          const C = keep[c];
          if (Math.abs(C.r - r) + Math.abs(C.g - g) + Math.abs(C.b - b) <= 30) {
            const a = acc[c]; a[0] += rgba[p]; a[1] += rgba[p + 1]; a[2] += rgba[p + 2]; a[3]++;
            break;
          }
        }
      }
    }
    for (const a of acc) if (a[3]) out.push([a[0] / a[3], a[1] / a[3], a[2] / a[3]]);
  }
  // a light grey fill that covers a good part of the stroke
  let gl = -1, gc = 0;
  for (let v = 140; v <= 244; v++) {
    const c = grey[v - 2] + grey[v - 1] + grey[v] + grey[v + 1] + grey[v + 2];
    if (c > gc) { gc = c; gl = v; }
  }
  if (gl > 0 && gc >= total * 0.35) out.push([paper[0] * gl / 255, paper[1] * gl / 255, paper[2] * gl / 255]);
  return out;
}

// ------------------------------------------------------------------ snapping to line work

/**
 * Finds the faces of lines and walls near (x, y): vertical edges (x positions) and horizontal
 * edges (y positions) where ink starts or stops along a good part of a window around the point.
 */
export function snapEdges(rgba, W, H, x, y, r, paper) {
  const ix = Math.round(x), iy = Math.round(y);
  const pl = 0.3 * paper[0] + 0.59 * paper[1] + 0.11 * paper[2];
  const thr = pl * 0.55;
  const ink = (px, py) => { const p = (py * W + px) << 2; return 0.3 * rgba[p] + 0.59 * rgba[p + 1] + 0.11 * rgba[p + 2] < thr; };
  const L = 3 * r;
  const pick = (f, base) => {
    const out = [];
    for (let i = 1; i < f.length; i++) {
      const s = Math.abs(f[i] - f[i - 1]);
      if (s < 0.35) continue;
      const sl = i > 1 ? Math.abs(f[i - 1] - f[i - 2]) : 0, sr = i < f.length - 1 ? Math.abs(f[i + 1] - f[i]) : 0;
      if (s >= sl && s >= sr) out.push(base + i - 1);
    }
    return out;
  };
  const xs = [], ys = [];
  {
    const c0 = Math.max(1, ix - r), c1 = Math.min(W - 1, ix + r);
    const r0 = Math.max(0, iy - L), r1 = Math.min(H - 1, iy + L);
    if (c1 > c0 && r1 > r0) {
      const f = new Float32Array(c1 - c0 + 2);
      const n = r1 - r0 + 1;
      for (let c = c0 - 1; c <= c1; c++) { let k = 0; for (let yy = r0; yy <= r1; yy++) if (ink(c, yy)) k++; f[c - c0 + 1] = k / n; }
      xs.push(...pick(f, c0));
    }
  }
  {
    const r0 = Math.max(1, iy - r), r1 = Math.min(H - 1, iy + r);
    const c0 = Math.max(0, ix - L), c1 = Math.min(W - 1, ix + L);
    if (r1 > r0 && c1 > c0) {
      const f = new Float32Array(r1 - r0 + 2);
      const n = c1 - c0 + 1;
      for (let rr = r0 - 1; rr <= r1; rr++) { let k = 0; const o = rr * W; for (let xx = c0; xx <= c1; xx++) { const p = (o + xx) << 2; if (0.3 * rgba[p] + 0.59 * rgba[p + 1] + 0.11 * rgba[p + 2] < thr) k++; } f[rr - r0 + 1] = k / n; }
      ys.push(...pick(f, r0));
    }
  }
  return { xs, ys };
}

// ------------------------------------------------------------------ paper tone

export function estimatePaper(rgba, W, H) {
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
  const N = W * H;
  const step = Math.max(1, Math.floor(N / 2e6));
  let count = 0;
  for (let i = 0; i < N; i += step) {
    const p = i << 2;
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mn > 185 && mx - mn < 22) { hr[r]++; hg[g]++; hb[b]++; count++; }
  }
  if (count < 100) return [255, 255, 255];
  const mode = (h) => { let bi = 255, bv = -1; for (let i = 0; i < 256; i++) if (h[i] > bv) { bv = h[i]; bi = i; } return bi; };
  return [mode(hr), mode(hg), mode(hb)];
}

// ------------------------------------------------------------------ strokes

export function drawThickLine(mask, W, H, x0, y0, x1, y1, rad) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
  const r2 = rad * rad;
  for (let s = 0; s <= steps; s++) {
    const cx = x0 + (dx * s) / steps, cy = y0 + (dy * s) / steps;
    const ix0 = Math.max(0, Math.floor(cx - rad)), ix1 = Math.min(W - 1, Math.ceil(cx + rad));
    const iy0 = Math.max(0, Math.floor(cy - rad)), iy1 = Math.min(H - 1, Math.ceil(cy + rad));
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
      const ex = x + 0.5 - cx, ey = y + 0.5 - cy;
      if (ex * ex + ey * ey <= r2) mask[y * W + x] = 1;
    }
  }
}

/** Mask of a round brush dragged along pts (sheet px), in a window around the stroke. */
export function strokeMask(pts, rad, W, H) {
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    bx0 = Math.min(bx0, pts[i]); bx1 = Math.max(bx1, pts[i]);
    by0 = Math.min(by0, pts[i + 1]); by1 = Math.max(by1, pts[i + 1]);
  }
  const x0 = Math.max(0, Math.floor(bx0 - rad - 1)), y0 = Math.max(0, Math.floor(by0 - rad - 1));
  const x1 = Math.min(W, Math.ceil(bx1 + rad + 1)), y1 = Math.min(H, Math.ceil(by1 + rad + 1));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const mask = new Uint8Array(w * h);
  if (pts.length <= 2) drawThickLine(mask, w, h, pts[0] - x0, pts[1] - y0, pts[0] - x0, pts[1] - y0, rad);
  for (let i = 0; i + 3 < pts.length; i += 2) drawThickLine(mask, w, h, pts[i] - x0, pts[i + 1] - y0, pts[i + 2] - x0, pts[i + 3] - y0, rad);
  return { x0, y0, w, h, mask };
}
