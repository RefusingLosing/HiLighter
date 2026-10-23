// Border line styles, shared by the screen renderer and every exporter so a dashed border
// looks the same on screen, in pictures and in PDFs.

export const LINE_STYLES = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'short', label: 'Short dash' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'dashdot', label: 'Dash-dot' },
  { id: 'dashdotdot', label: 'Dash-dot-dot' },
];

export const isLineStyle = (s) => LINE_STYLES.some((l) => l.id === s);

/**
 * Dash pattern for a border of width w. minUnit keeps the dashes of very thin borders long
 * enough to read. All values are in the same unit as w.
 */
export function dashFor(style, w, minUnit = 0) {
  const u = Math.max(w, minUnit);
  switch (style) {
    case 'dashed': return { dash: [6 * u, 3 * u], cap: 'butt' };
    case 'short': return { dash: [2.6 * u, 2 * u], cap: 'butt' };
    case 'dotted': return { dash: [0, 2.4 * u], cap: 'round' };
    case 'dashdot': return { dash: [8 * u, 2.6 * u, w, 2.6 * u], cap: 'butt' };
    case 'dashdotdot': return { dash: [8 * u, 2.2 * u, w, 2.2 * u, w, 2.2 * u], cap: 'butt' };
    default: return { dash: [], cap: 'butt' };
  }
}
