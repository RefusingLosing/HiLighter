// Finds colour that was already painted into a drawing (solid zone fills, coloured rooms,
// optionally coloured hatching) and returns it as regions that can become markups.
//
// Colours are judged relative to the paper (so yellowish scans and pale tints both work).
// Pixels are clustered by colour, then analysed on a coarse grid (cells of a few pixels):
// a closing bridges thin line work crossing a painted zone (text, furniture, revision clouds),
// and an opening drops thin colour (coloured text and lines) so only painted areas remain.

import { dilate, erode, fillHoles, maskToRings, countMask } from './imgproc.js';

const bin15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * opts:
 *   paper            paper colour [r,g,b]
 *   minAreaPx        smallest region kept
 *   cell             coarse grid cell size in pixels
 *   mergeDist        colours closer than this (0..255 RGB, relative to paper) are one colour
 *   hatch            also find areas marked with coloured hatching
 *   hatchPx          typical hatch line spacing in pixels
 *   target           find only this colour ([r,g,b] drawing values); greys allowed
 *   targetTol        how far a pixel may be from the target colour
 */
export function detectPaint(rgba, W, H, opts) {
  const {
    paper = [255, 255, 255], minChroma = 12, minValue = 60,
    mergeDist = 30, maxClusters = 24, minAreaPx = 2000, cell = 3,
    closeR = 1, openR = 2, hatch = false, hatchPx = 40,
    target = null, targetTol = 26,
    progress = () => {},
  } = opts;
  const assignDist = Math.round(mergeDist * 1.4);
  const N = W * H;
  const lr = new Uint8Array(256), lg = new Uint8Array(256), lb = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lr[v] = Math.min(255, Math.round((v * 255) / Math.max(paper[0], 1)));
    lg[v] = Math.min(255, Math.round((v * 255) / Math.max(paper[1], 1)));
    lb[v] = Math.min(255, Math.round((v * 255) / Math.max(paper[2], 1)));
  }

  // 1. clusters (paper-relative colours)
  const hist = new Uint32Array(32768);
  const centers = [];
  let tn = null;
  if (target) {
    tn = [lr[Math.round(target[0])], lg[Math.round(target[1])], lb[Math.round(target[2])]];
    centers.push({ r: tn[0], g: tn[1], b: tn[2], w: 1 });
  } else {
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      const r = lr[rgba[p]], g = lg[rgba[p + 1]], b = lb[rgba[p + 2]];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx - mn >= minChroma && mx >= minValue) hist[bin15(r, g, b)]++;
    }
    progress(0.12);
    const bins = [];
    for (let k = 0; k < 32768; k++) if (hist[k] >= 24) bins.push(k);
    bins.sort((a, b) => hist[b] - hist[a]);
    const seedMin = Math.max(60, Math.floor(minAreaPx / 10));
    for (const k of bins) {
      const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4, w = hist[k];
      let best = -1, bd = 1e9;
      for (let c = 0; c < centers.length; c++) {
        const C = centers[c];
        const d = Math.hypot(C.r - r, C.g - g, C.b - b);
        if (d < bd) { bd = d; best = c; }
      }
      if (best >= 0 && bd <= mergeDist) {
        const C = centers[best];
        const tw = C.w + w;
        // the centre stays at the heavier (purer) colour; light anti-aliasing only adds weight
        C.r = (C.r * C.w + r * w) / tw; C.g = (C.g * C.w + g * w) / tw; C.b = (C.b * C.w + b * w) / tw; C.w = tw;
      } else if (centers.length < maxClusters && w >= seedMin) {
        centers.push({ r, g, b, w });
      }
    }
  }
  if (!centers.length) return { groups: [] };

  // 2. label image + exact cluster colours (in drawing pixel values)
  const L = new Uint8Array(N);
  const sum = centers.map(() => [0, 0, 0, 0]);
  if (target) {
    const tol = targetTol;
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      const r = lr[rgba[p]], g = lg[rgba[p + 1]], b = lb[rgba[p + 2]];
      if (Math.abs(r - tn[0]) <= tol && Math.abs(g - tn[1]) <= tol && Math.abs(b - tn[2]) <= tol &&
          Math.hypot(r - tn[0], g - tn[1], b - tn[2]) <= tol) {
        L[i] = 1; const s = sum[0]; s[0] += rgba[p]; s[1] += rgba[p + 1]; s[2] += rgba[p + 2]; s[3]++;
      }
    }
  } else {
    const lut = new Uint8Array(32768);
    for (let k = 0; k < 32768; k++) {
      if (!hist[k]) continue;
      const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
      let best = -1, bd = 1e9;
      for (let c = 0; c < centers.length; c++) {
        const C = centers[c];
        const d = Math.hypot(C.r - r, C.g - g, C.b - b);
        if (d < bd) { bd = d; best = c; }
      }
      if (best >= 0 && bd <= assignDist) lut[k] = best + 1;
    }
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      const r = lr[rgba[p]], g = lg[rgba[p + 1]], b = lb[rgba[p + 2]];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (mx - mn >= minChroma && mx >= minValue) {
        const k = lut[bin15(r, g, b)];
        if (k) {
          // keep colours of one family apart: the pixel must be near its own centre
          const C = centers[k - 1];
          if (Math.abs(C.r - r) + Math.abs(C.g - g) + Math.abs(C.b - b) <= assignDist * 1.6) {
            L[i] = k; const s = sum[k - 1]; s[0] += rgba[p]; s[1] += rgba[p + 1]; s[2] += rgba[p + 2]; s[3]++;
          }
        }
      }
    }
  }
  progress(0.3);

  // 3. coarse cell labels (majority colour of each cell)
  const f = Math.max(2, cell | 0);
  const cw = Math.ceil(W / f), ch = Math.ceil(H / f);
  const CL = new Uint8Array(cw * ch);
  const CF = new Uint8Array(cw * ch); // how full the cell is (0..255)
  const tally = new Uint16Array(centers.length + 1);
  const minCell = hatch ? 1 : Math.max(1, Math.floor((f * f) / 5));
  for (let cy = 0; cy < ch; cy++) {
    const y0 = cy * f, y1 = Math.min(H, y0 + f);
    for (let cx = 0; cx < cw; cx++) {
      const x0 = cx * f, x1 = Math.min(W, x0 + f);
      tally.fill(0);
      let any = false;
      for (let y = y0; y < y1; y++) {
        const o = y * W;
        for (let x = x0; x < x1; x++) { const k = L[o + x]; if (k) { tally[k]++; any = true; } }
      }
      if (!any) continue;
      let bk = 0, bv = 0;
      for (let k = 1; k < tally.length; k++) if (tally[k] > bv) { bv = tally[k]; bk = k; }
      if (bv >= minCell) { CL[cy * cw + cx] = bk; CF[cy * cw + cx] = Math.min(255, Math.round((255 * bv) / ((x1 - x0) * (y1 - y0)))); }
    }
  }
  progress(0.42);

  // 4. per colour: closing + opening on the coarse grid, then components -> regions
  const groups = centers.map((C, ci) => {
    const s = sum[ci];
    const color = s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [C.r, C.g, C.b];
    return { key: ci + 1, color: color.map((v) => Math.round(v)), regions: [], area: 0 };
  });
  const minCells = Math.max(4, Math.floor((minAreaPx * 0.5) / (f * f)));
  const groupColor = (k) => groups[k - 1].color;
  const strength = (c) => Math.max(...[0, 1, 2].map((i) => 1 - Math.min(1, c[i] / Math.max(paper[i], 1))));
  const hatchR = Math.max(2, Math.ceil(hatchPx / 2 / f) + 1);
  let stack = new Int32Array(1 << 15);
  let list = new Int32Array(1 << 15);
  for (let k = 1; k <= centers.length; k++) {
    if (sum[k - 1][3] < (hatch ? minAreaPx * 0.05 : minAreaPx * 0.3)) continue;
    let M = new Uint8Array(cw * ch);
    let cnt = 0;
    for (let i = 0; i < M.length; i++) if (CL[i] === k) { M[i] = 1; cnt++; }
    if (cnt < (hatch ? 4 : minCells)) continue;
    const solid = M.slice();
    const cr = hatch ? hatchR : closeR;
    M = erode(dilate(M, cw, ch, cr), cw, ch, cr);
    M = dilate(erode(M, cw, ch, openR), cw, ch, openR);
    for (let s0 = 0; s0 < M.length; s0++) {
      if (!M[s0]) continue;
      let sp = 0, n = 0;
      let bx0 = cw, by0 = ch, bx1 = 0, by1 = 0;
      M[s0] = 0; stack[sp++] = s0;
      while (sp > 0) {
        const i = stack[--sp];
        if (n >= list.length) { const nl = new Int32Array(list.length * 2); nl.set(list); list = nl; }
        list[n++] = i;
        const x = i % cw, y = (i - x) / cw;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        if (sp + 4 >= stack.length) { const ns = new Int32Array(stack.length * 2); ns.set(stack); stack = ns; }
        if (x > 0 && M[i - 1]) { M[i - 1] = 0; stack[sp++] = i - 1; }
        if (x < cw - 1 && M[i + 1]) { M[i + 1] = 0; stack[sp++] = i + 1; }
        if (y > 0 && M[i - cw]) { M[i - cw] = 0; stack[sp++] = i - cw; }
        if (y < ch - 1 && M[i + cw]) { M[i + cw] = 0; stack[sp++] = i + cw; }
      }
      if (n < minCells) continue;
      // how much of the component is actually painted: low for hatching
      let painted = 0;
      for (let t = 0; t < n; t++) if (solid[list[t]]) painted += CF[list[t]];
      const density = painted / (n * 255);
      const isHatch = hatch && density < 0.45;
      // solid paint covers most of its area; scattered specks of a colour (JPEG halos around
      // coloured lines, noise) do not
      if (!isHatch && density < 0.4) continue;
      // hatching is drawn in a clear colour; a pale tint cannot be hatch lines
      if (isHatch && strength(groupColor(k)) < 0.3) continue;
      // component cells (padded window), grown by one cell to reach painted edges
      const pc = 3;
      const cx0 = Math.max(0, bx0 - pc), cy0 = Math.max(0, by0 - pc);
      const cx1 = Math.min(cw - 1, bx1 + pc), cy1 = Math.min(ch - 1, by1 + pc);
      const ccw = cx1 - cx0 + 1, cch = cy1 - cy0 + 1;
      let comp = new Uint8Array(ccw * cch);
      for (let t = 0; t < n; t++) { const i = list[t]; const x = i % cw, y = (i - x) / cw; comp[(y - cy0) * ccw + (x - cx0)] = 1; }
      comp = dilate(comp, ccw, cch, 1);
      const wx0 = cx0 * f, wy0 = cy0 * f;
      const wx1 = Math.min(W, (cx1 + 1) * f), wy1 = Math.min(H, (cy1 + 1) * f);
      const w = wx1 - wx0, h = wy1 - wy0;
      let region = new Uint8Array(w * h);
      const colourPx = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        const ro = (wy0 + y) * W + wx0;
        const crow = ((((wy0 + y) / f) | 0) - cy0) * ccw;
        for (let x = 0; x < w; x++) {
          const inComp = comp[crow + ((((wx0 + x) / f) | 0) - cx0)];
          if (!inComp) continue;
          if (L[ro + x] === k) { colourPx[y * w + x] = 1; region[y * w + x] = 1; }
        }
      }
      if (isHatch) {
        // hatching: the area is the closed shape of the hatch lines
        const hr = Math.max(2, Math.ceil(hatchPx / 2) + 2);
        region = erode(dilate(region, w, h, hr), w, h, hr);
      } else {
        // bridge thin line work that crosses the paint (furniture, text, clouds)
        const crr = Math.max(2, Math.round(f * 1.3));
        region = erode(dilate(region, w, h, crr), w, h, crr);
      }
      // fill holes made by text and line work; keep holes that are mostly bare paper
      const smallHole = (f * 6) * (f * 6);
      fillHoles(region, w, h, (area, idx, c) => {
        if (area <= smallHole) return true;
        let paperLike = 0;
        for (let t = 0; t < c; t++) {
          const i = idx[t];
          const x = i % w, y = (i - x) / w;
          const p = (((wy0 + y) * W) + wx0 + x) << 2;
          const r = lr[rgba[p]], g = lg[rgba[p + 1]], b = lb[rgba[p + 2]];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mn > 228 && mx - mn < 14) paperLike++;
        }
        return paperLike / c < (isHatch ? 0.95 : 0.55);
      });
      const area = countMask(region);
      if (area < minAreaPx) continue;
      // what gets lifted out of the drawing: the paint (or hatch lines) plus anti-aliased edges
      const rem = isHatch ? dilate(colourPx, w, h, 2).map((v, i) => v & region[i]) : dilate(region, w, h, 2);
      const rings = maskToRings(isHatch ? region : rem, w, h, wx0, wy0, 0.9, 6);
      if (!rings.length) continue;
      if (isHatch) {
        // an outline drawn in colour (a revision cloud, a boundary line) is not a hatched area:
        // hatched areas are wide compared with their outline
        let per = 0;
        for (const r of rings) for (let i = 0; i < r.length; i += 2) {
          const j = (i + 2) % r.length;
          per += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]);
        }
        if ((2 * area) / Math.max(per, 1) < hatchPx * 2.5) continue;
      }
      const g = groups[k - 1];
      g.regions.push({ rings, area, bbox: [wx0, wy0, wx1, wy1], hatch: isHatch, part: { x0: wx0, y0: wy0, w, h, mask: rem, colors: [g.color] } });
      g.area += area;
    }
    progress(0.42 + 0.55 * (k / centers.length));
  }
  progress(0.98);
  if (hatch) foldHatchTints(groups, paper);
  const out = groups.filter((g) => g.regions.length).sort((a, b) => b.area - a.area);
  for (const g of out) {
    // colour that recreates the paint when it tints the paper
    g.liftColor = g.color.map((c, i) => Math.max(0, Math.min(255, Math.round((c * 255) / Math.max(paper[i], 1)))));
    g.regions.sort((a, b) => b.area - a.area);
    for (const r of g.regions) r.part.colors = [g.color, ...(r.extra || [])];
  }
  return { groups: out };
}

/** True when `pale` is `deep` thinned towards the paper (an anti-aliased fringe of it). */
function isTintOf(pale, deep, paper) {
  const u = [0, 1, 2].map((i) => 1 - Math.min(1, deep[i] / Math.max(paper[i], 1)));
  const v = [0, 1, 2].map((i) => 1 - Math.min(1, pale[i] / Math.max(paper[i], 1)));
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  if (uu < 1e-4) return false;
  const t = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / uu;
  if (t < 0.06 || t > 0.94) return false;
  return Math.hypot(v[0] - t * u[0], v[1] - t * u[1], v[2] - t * u[2]) < 0.07;
}

const bboxOverlap = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const I = ix * iy;
  return I / Math.max(1, Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])));
};

/**
 * Hatch lines are anti-aliased: their pale fringe can come out as a second colour covering the
 * same area. Such a region is folded into the hatching it belongs to (and its colour is lifted
 * together with it).
 */
function foldHatchTints(groups, paper) {
  const hr = [];
  for (const g of groups) for (const r of g.regions) if (r.hatch) hr.push({ g, r });
  for (const a of hr) {
    for (const b of hr) {
      if (a === b || a.g === b.g || a.r.dropped || b.r.dropped) continue;
      if (bboxOverlap(a.r.bbox, b.r.bbox) < 0.6) continue;
      if (!isTintOf(b.g.color, a.g.color, paper)) continue;
      b.r.dropped = true;
      (a.r.extra ||= []).push(b.g.color);
    }
  }
  for (const g of groups) {
    if (!g.regions.some((r) => r.dropped)) continue;
    g.regions = g.regions.filter((r) => !r.dropped);
    g.area = g.regions.reduce((s, r) => s + r.area, 0);
  }
}

/** The colour under a click: the dominant paint (or grey fill) in a small window. */
export function colourAt(rgba, W, H, x, y, paper, minChroma = 12) {
  const r0 = 6;
  const ix = Math.round(x), iy = Math.round(y);
  const hist = new Map();
  const nr = 255 / Math.max(paper[0], 1), ng = 255 / Math.max(paper[1], 1), nb = 255 / Math.max(paper[2], 1);
  let n = 0;
  for (let yy = Math.max(0, iy - r0); yy <= Math.min(H - 1, iy + r0); yy++) {
    for (let xx = Math.max(0, ix - r0); xx <= Math.min(W - 1, ix + r0); xx++) {
      const p = (yy * W + xx) << 2;
      const r = Math.min(255, rgba[p] * nr), g = Math.min(255, rgba[p + 1] * ng), b = Math.min(255, rgba[p + 2] * nb);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      // skip paper and dark line work
      if (mx - mn < minChroma && (lum > 244 || lum < 120)) continue;
      if (mx < 60) continue;
      const k = bin15(r, g, b);
      const e = hist.get(k) || { c: 0, s: [0, 0, 0] };
      e.c++; e.s[0] += rgba[p]; e.s[1] += rgba[p + 1]; e.s[2] += rgba[p + 2];
      hist.set(k, e);
      n++;
    }
  }
  if (!n) return null;
  let best = null;
  for (const e of hist.values()) if (!best || e.c > best.c) best = e;
  if (best.c < 4) return null;
  return best.s.map((v) => v / best.c);
}
