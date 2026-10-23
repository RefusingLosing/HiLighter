// Snag pins: numbered markers for defects found on site. Each pin has a note, a trade, a status
// (Open, Fixed, Closed), the dates it was raised and closed, and an optional photo. Numbers are
// permanent: a deleted pin's number is never given again, so a list sent out earlier stays right.
// Pins are drawn on top of everything and print. Sizes follow the text size of tags and dimensions.

import { S, uid, ptToPx } from './state.js';
import { measureAt } from './measure.js';
import * as G from './geom.js';
import { annotSizes, ANNOT_FONT } from './annot.js';

export const PIN_STATUSES = Object.freeze([
  Object.freeze({ id: 'open', label: 'Open', color: '#D92D20', key: '1', tip: 'Still to be fixed' }),
  Object.freeze({ id: 'fixed', label: 'Fixed', color: '#E07C00', key: '2', tip: 'Fixed by the contractor, waiting for your check' }),
  Object.freeze({ id: 'closed', label: 'Closed', color: '#16A34A', key: '3', tip: 'Checked and accepted' }),
]);
export const PIN_STATUS = Object.freeze(Object.fromEntries(PIN_STATUSES.map((s) => [s.id, s])));
export const TRADES = Object.freeze(['Civil', 'Mechanical', 'Electrical', 'Firefighting', 'Landscape', 'Other']);
/** On screen a pin never gets smaller than this (CSS pixels of head radius), so it stays easy to click. */
export const PIN_MIN_CSS = 9;

/** Today as YYYY-MM-DD, local time. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// the trade of the last pin edited is the trade of the next one (a site walk is often one trade)
let lastTrade = 'Civil';
try { const t = localStorage.getItem('plantint.trade'); if (t) lastTrade = t; } catch { /* storage is optional */ }
export function rememberTrade(t) {
  if (!t) return;
  lastTrade = t;
  try { localStorage.setItem('plantint.trade', t); } catch { /* storage is optional */ }
}

export function makePin(x, y) {
  return Object.freeze({ id: uid('p'), n: S.pinNext, x, y, note: '', trade: lastTrade, status: 'open', photo: null, raised: today(), closed: null });
}

/** The pin with fields changed. Closing it stamps today's date; opening it again clears the date. */
export function withPin(p, props) {
  const next = { ...p, ...props };
  if (!PIN_STATUS[next.status]) next.status = 'open';
  if (props.status !== undefined) next.closed = next.status === 'closed' ? (p.status === 'closed' && p.closed ? p.closed : today()) : null;
  if (typeof next.note !== 'string') next.note = '';
  if (typeof next.trade !== 'string') next.trade = '';
  return Object.freeze(next);
}

export const movedPin = (p, dx, dy) => Object.freeze({ ...p, x: p.x + dx, y: p.y + dy });

/** A pin read from a project file (positions scaled by sx, sy), or null when it is not usable. */
export function readPin(q, sx = 1, sy = 1) {
  if (!q || typeof q !== 'object' || !Number.isFinite(q.x) || !Number.isFinite(q.y) || !(q.n >= 1)) return null;
  const status = PIN_STATUS[q.status] ? q.status : 'open';
  return Object.freeze({
    id: typeof q.id === 'string' && q.id[0] === 'p' ? q.id : uid('p'),
    n: Math.round(q.n), x: q.x * sx, y: q.y * sy,
    note: typeof q.note === 'string' ? q.note : '', trade: typeof q.trade === 'string' ? q.trade : '',
    status, photo: typeof q.photo === 'string' ? q.photo : null,
    raised: isDay(q.raised) ? q.raised : null, closed: status === 'closed' && isDay(q.closed) ? q.closed : null,
  });
}

export const selectedPins = () => S.pins.filter((p) => S.selection.has(p.id));
export const pinsByNumber = (list = S.pins) => [...list].sort((a, b) => a.n - b.n);

/** Counts by status: { open, fixed, closed }. */
export function pinCounts(list = S.pins) {
  const c = { open: 0, fixed: 0, closed: 0 };
  for (const p of list) c[p.status] = (c[p.status] || 0) + 1;
  return c;
}

/** Trades in use, the standard ones first. */
export function tradesInUse() {
  const used = new Set(S.pins.map((p) => p.trade).filter(Boolean));
  return [...TRADES.filter((t) => used.has(t)), ...[...used].filter((t) => !TRADES.includes(t)).sort()];
}

// ------------------------------------------------------------------ geometry

/** Sizes in sheet pixels: head radius r, tail (tip to head centre), outline lw. minR keeps it big enough on screen. */
export function pinSize(minR = 0) {
  const fs = annotSizes().fs;
  const r = Math.max(fs * 1.05, minR);
  return { r, tail: r * 1.75, lw: Math.max(r * 0.14, ptToPx(0.4)) };
}

/** The pin under a point (sheet px), topmost first. */
export function hitPin(x, y, minR = 0, tol = 0) {
  const z = pinSize(minR);
  for (let i = S.pins.length - 1; i >= 0; i--) {
    const p = S.pins[i];
    const cy = p.y - z.tail;
    if (Math.hypot(x - p.x, y - cy) <= z.r + z.lw + tol) return p;
    if (y >= cy && y <= p.y + tol && Math.abs(x - p.x) <= (z.r * (p.y - y)) / z.tail + tol) return p;
  }
  return null;
}

/** Pins whose tips lie inside a rectangle [x0, y0, x1, y1]. */
export const pinsIn = (r) => S.pins.filter((p) => p.x >= r[0] && p.x <= r[2] && p.y >= r[1] && p.y <= r[3]);

/** The zone a pin is in: the topmost markup that shows at its tip. */
export function pinZone(p) {
  for (let i = S.markups.length - 1; i >= 0; i--) {
    const r = measureAt(i);
    if (r.vis.length && G.pointInRings(r.vis, p.x, p.y)) return S.markups[i];
  }
  return null;
}

export function pinPlace(p) {
  const z = pinZone(p);
  return z ? (z.name || '').trim() : '';
}

// ------------------------------------------------------------------ drawing (sheet coordinates)

/** A map pin: its tip on the spot, a round head with the number. */
export function drawPin(ctx, p, z, dx = 0, dy = 0) {
  const x = p.x + dx, y = p.y + dy;
  const cy = y - z.tail;
  const phi = Math.acos(Math.min(1, z.r / z.tail));
  const a0 = Math.PI / 2 + phi, a1 = Math.PI / 2 - phi;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + z.r * Math.cos(a0), cy + z.r * Math.sin(a0));
  ctx.arc(x, cy, z.r, a0, a1 + Math.PI * 2);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = z.lw * 2;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.fillStyle = (PIN_STATUS[p.status] || PIN_STATUS.open).color;
  ctx.fill();
  const s = String(p.n);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr';
  ctx.font = `600 ${z.r * (s.length >= 3 ? 0.8 : s.length === 2 ? 0.98 : 1.12)}px ${ANNOT_FONT}`;
  ctx.fillText(s, x, cy + z.r * 0.05);
  ctx.restore();
}

/** Pins for export: pictures with transparency placed by their centre (k: finer for PDFs). */
export async function pinExport(k = 1) {
  const z = pinSize(0);
  const out = [];
  for (const p of S.pins) {
    const pad = z.lw * 1.25;
    const x0 = p.x - z.r - pad, x1 = p.x + z.r + pad, y0 = p.y - z.tail - z.r - pad, y1 = p.y + pad;
    const w = x1 - x0, h = y1 - y0;
    const kk = Math.max(1, Math.min(k, 4000 / Math.max(w, h)));
    const c = new OffscreenCanvas(Math.max(1, Math.ceil(w * kk)), Math.max(1, Math.ceil(h * kk)));
    const ctx = c.getContext('2d');
    ctx.scale(c.width / w, c.height / h);
    ctx.translate(-x0, -y0);
    drawPin(ctx, p, z);
    const blob = await c.convertToBlob({ type: 'image/png' });
    out.push({ png: new Uint8Array(await blob.arrayBuffer()), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w, h, ang: 0 });
  }
  return out;
}

// ------------------------------------------------------------------ photos

/** Largest side of a stored photo: enough to see the defect, small enough to keep projects light. */
export const PHOTO_MAX = 1600;

/** A photo ready to store: turned upright (camera orientation), at most PHOTO_MAX px, as JPEG. */
export async function preparePhoto(bytes, type = '') {
  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([bytes], type ? { type } : undefined), { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This file is not a picture PlanTint can read. Use a JPEG or PNG photo.');
  }
  const k = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

/** A smaller copy of a stored photo (for Excel), as JPEG. */
export async function photoThumb(ph, max) {
  if (ph.w > 0 && ph.h > 0 && Math.max(ph.w, ph.h) <= max) return ph;
  const bmp = await createImageBitmap(new Blob([ph.bytes], { type: 'image/jpeg' }));
  const k = max / Math.max(bmp.width, bmp.height);
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.84 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

export function addPhoto(ph) {
  const id = uid('ph');
  S.photos.set(id, Object.freeze({ bytes: ph.bytes, w: ph.w, h: ph.h }));
  return id;
}

const urls = new Map();
/** An address for showing a stored photo in the interface. */
export function photoUrl(id) {
  const ph = id && S.photos.get(id);
  if (!ph) return '';
  let u = urls.get(id);
  if (!u || u.ph !== ph) {
    if (u) URL.revokeObjectURL(u.url);
    u = { ph, url: URL.createObjectURL(new Blob([ph.bytes], { type: 'image/jpeg' })) };
    urls.set(id, u);
  }
  return u.url;
}
