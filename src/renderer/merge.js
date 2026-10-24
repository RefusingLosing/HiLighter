// Merging markups: several areas become one markup, so they share one name, one colour, one status,
// one row in the list and the legend, and one total area. Each area keeps its own shape: nothing is
// filled in between them (areas apart stay as separate parts; overlapping ones count once). The one
// merged into keeps its name, colour, status, border and place in the drawing order. One undo step.

import { S, withProps, setSelection } from './state.js';
import { change } from './history.js';
import * as G from './geom.js';

/** The markups with these ids, in drawing order. */
function markupsOf(ids) {
  const set = new Set(ids);
  return S.markups.filter((m) => set.has(m.id));
}

export const canMerge = (ids) => markupsOf(ids).length >= 2;

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
  const rings = G.unionMany([into.rings, ...others.map((m) => m.rings)]);
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
