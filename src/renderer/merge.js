// Merging markups: several areas become one markup. The one merged into keeps its name, colour,
// status, border and place in the drawing order; the others go into it. Neighbours become one
// continuous area: the line or the writing between them (up to 1.2 mm wide on the sheet) is filled
// in. Areas further apart stay where they are, as parts of the one markup. One undo step.

import { S, withProps, setSelection } from './state.js';
import { change } from './history.js';
import * as G from './geom.js';

/** The widest gap between two areas that merging fills in, in millimetres on the sheet. */
export const MERGE_GAP_MM = 1.2;

/** The markups with these ids, in drawing order. */
function markupsOf(ids) {
  const set = new Set(ids);
  return S.markups.filter((m) => set.has(m.id));
}

export const canMerge = (ids) => markupsOf(ids).length >= 2;

/** Sheet pixels within which two areas count as neighbours (half the widest gap filled in). */
export function mergeReach() {
  return (MERGE_GAP_MM / 2 / 25.4) * (S.doc && S.doc.dpi > 0 ? S.doc.dpi : 150);
}

/**
 * Merges the markups `ids` into the markup `intoId` (which may be one of them). Returns
 * { into, n } (the merged markup, and how many markups it was made of), or null when there are
 * not two markups to merge.
 */
export function mergeMarkups(ids, intoId) {
  const list = markupsOf([...ids, intoId]);
  const into = list.find((m) => m.id === intoId);
  if (!into || list.length < 2) return null;
  const others = list.filter((m) => m !== into);
  const rings = G.mergeRings([into.rings, ...others.map((m) => m.rings)], mergeReach());
  if (!rings.length) return null;
  let merged = withProps(into, { rings });
  // a tag moved by hand stays where it was put, as long as it is still on the area
  if (merged.tagAt && !G.pointInRings(rings, merged.tagAt[0], merged.tagAt[1])) merged = withProps(merged, { tagAt: null });
  const gone = new Set(others.map((m) => m.id));
  change(`Merge ${list.length} markups`, () => {
    S.markups = S.markups.filter((m) => !gone.has(m.id)).map((m) => (m.id === into.id ? merged : m));
  });
  setSelection([into.id]);
  return { into: merged, n: list.length };
}
