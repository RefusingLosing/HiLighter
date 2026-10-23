// Setting the drawing's scale: from a known length (calibration), by typing 1:n, or back to the
// title block. Each is one undo step and is saved with the project.

import { S, emit, setMeas } from './state.js';
import { change } from './history.js';
import { mPerPxForRatio } from './units.js';

const IMPERIAL = ['in', 'ft', 'ftin', 'yd'];

/** Calibration from two points `px` sheet pixels apart that are `lengthM` metres long in reality. */
export function setCalibration({ a, b, px, lengthM, unit }) {
  if (!S.doc || !(px > 0) || !(lengthM > 0)) return false;
  const mPerPx = lengthM / px;
  const ok = change('Calibrate scale', () => {
    S.calib = Object.freeze({ kind: 'calib', mPerPx, a: [a[0], a[1]], b: [b[0], b[1]], lengthM, unit });
    // typing a length in feet means the drawing is read in feet (and the other way round)
    const imp = IMPERIAL.includes(unit), curImp = IMPERIAL.includes(S.meas.len);
    if (unit && imp !== curImp) setMeas(imp ? { len: unit, area: 'ft2' } : { len: unit === 'mm' || unit === 'cm' ? unit : 'm', area: 'm2' });
  });
  emit('scale');
  return ok;
}

/** A typed 1:n scale (sheets with a print size); n = 0 means "no scale" (sizes on paper). */
export function setTypedScale(n) {
  if (!S.doc) return;
  const mPerPx = n > 0 ? mPerPxForRatio(n) : 0;
  change(n > 0 ? `Set scale 1:${n}` : 'Clear scale', () => {
    S.calib = Object.freeze(n > 0 && mPerPx > 0 ? { kind: 'typed', mPerPx, ratio: n } : { kind: 'none', mPerPx: 0 });
  });
  emit('scale');
}

/** Forgets the calibration or typed scale: the title block's scale (if any) applies again. */
export function resetScale() {
  if (!S.doc || !S.calib) return;
  change('Use title block scale', () => { S.calib = null; });
  emit('scale');
}
