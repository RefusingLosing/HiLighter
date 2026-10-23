// Viewport: maps sheet pixels to canvas device pixels.

import { S } from './state.js';

export const V = { scale: 0.1, tx: 0, ty: 0, dpr: 1, cw: 1, ch: 1, cssW: 1, cssH: 1 };

export const toScreen = (x, y) => [x * V.scale + V.tx, y * V.scale + V.ty];
export const toSheet = (dx, dy) => [(dx - V.tx) / V.scale, (dy - V.ty) / V.scale];

export function fitScale() {
  if (!S.doc) return 1;
  const m = 28 * V.dpr;
  return Math.max(1e-4, Math.min((V.cw - 2 * m) / S.doc.W, (V.ch - 2 * m) / S.doc.H));
}

export const minScale = () => fitScale() / 6;
export const maxScale = () => 32 * V.dpr;

export function fit() {
  if (!S.doc) return;
  const s = fitScale();
  V.scale = s;
  V.tx = (V.cw - S.doc.W * s) / 2;
  V.ty = (V.ch - S.doc.H * s) / 2;
}

export function clampPan() {
  if (!S.doc) return;
  const w = S.doc.W * V.scale, h = S.doc.H * V.scale;
  const keep = 80 * V.dpr;
  V.tx = Math.min(V.cw - keep, Math.max(keep - w, V.tx));
  V.ty = Math.min(V.ch - keep, Math.max(keep - h, V.ty));
}

export function zoomAt(dx, dy, factor) {
  const ns = Math.min(maxScale(), Math.max(minScale(), V.scale * factor));
  const k = ns / V.scale;
  V.tx = dx - (dx - V.tx) * k;
  V.ty = dy - (dy - V.ty) * k;
  V.scale = ns;
  clampPan();
}

export function pan(dx, dy) {
  V.tx += dx; V.ty += dy;
  clampPan();
}

/** Zoom percentage as people read it: 100% = the printed sheet at its real size. */
export function percentFactor() {
  if (!S.doc) return 100;
  const physical = S.doc.physical ? S.doc.dpi / 96 : 1;
  return (100 * physical) / V.dpr;
}
export const zoomPercent = () => V.scale * percentFactor();

export function setZoomPercent(p, cx = V.cw / 2, cy = V.ch / 2) {
  const target = p / percentFactor();
  zoomAt(cx, cy, target / V.scale);
}

export function zoomToRect(x0, y0, x1, y1, pad = 60) {
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const p = pad * V.dpr;
  const s = Math.min(maxScale(), Math.max(minScale(), Math.min((V.cw - 2 * p) / w, (V.ch - 2 * p) / h)));
  V.scale = s;
  V.tx = V.cw / 2 - ((x0 + x1) / 2) * s;
  V.ty = V.ch / 2 - ((y0 + y1) / 2) * s;
  clampPan();
}

export function visibleSheetRect() {
  const [x0, y0] = toSheet(0, 0);
  const [x1, y1] = toSheet(V.cw, V.ch);
  return [x0, y0, x1, y1];
}
