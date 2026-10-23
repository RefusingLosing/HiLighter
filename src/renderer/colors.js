// Colour helpers and the highlighter palette.

export const PALETTE = [
  { hex: '#FFD60A', name: 'Yellow' },
  { hex: '#FF9F1C', name: 'Orange' },
  { hex: '#F25F5C', name: 'Red' },
  { hex: '#FF8FAB', name: 'Pink' },
  { hex: '#B07CE0', name: 'Purple' },
  { hex: '#5B6CFF', name: 'Indigo' },
  { hex: '#3FA7E0', name: 'Blue' },
  { hex: '#2EC4B6', name: 'Teal' },
  { hex: '#57CC99', name: 'Green' },
  { hex: '#B5E48C', name: 'Lime' },
  { hex: '#C8925A', name: 'Brown' },
  { hex: '#8D99AE', name: 'Slate' },
];

export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!/^[0-9a-fA-F]{6}$/.test(h) || Number.isNaN(n)) return [255, 214, 10];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function normalizeHex(s) {
  let h = String(s || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return '#' + h.toUpperCase();
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Border colour used when a markup's border is set to Auto: a deeper shade of the fill. */
export function autoBorder(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([h, Math.min(1, s * 1.05 + 0.05), Math.max(0.12, l * 0.62)]));
}

export function borderColorOf(m) {
  return m.borderColor || autoBorder(m.color);
}

/** How a highlight looks on white paper (multiply at the given opacity). */
export function tintOnPaper(hex, opacity) {
  const c = hexToRgb(hex);
  return rgbToHex(c.map((v) => 255 - (255 - v) * opacity));
}

/** A plain-language name for any colour ("Pale yellow", "Dark blue"). */
export function colorName(hex) {
  const p = PALETTE.find((x) => x.hex.toUpperCase() === String(hex).toUpperCase());
  if (p) return p.name;
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  if (s < 0.12 || (l > 0.93 && s < 0.4)) return l > 0.93 ? 'White' : l > 0.8 ? 'Light grey' : l > 0.6 ? 'Grey' : l > 0.3 ? 'Dark grey' : 'Black';
  const deg = h * 360;
  const hues = [[12, 'Red'], [41, 'Orange'], [66, 'Yellow'], [85, 'Lime'], [150, 'Green'], [178, 'Teal'], [200, 'Cyan'], [240, 'Blue'], [262, 'Indigo'], [292, 'Purple'], [330, 'Pink'], [361, 'Red']];
  let name = hues.find(([lim]) => deg < lim)[1];
  if (name === 'Orange' && l < 0.42) name = 'Brown';
  const tone = l > 0.82 ? 'Pale ' : l > 0.68 ? 'Light ' : l < 0.3 ? 'Dark ' : '';
  return tone ? tone + name.toLowerCase() : name;
}
