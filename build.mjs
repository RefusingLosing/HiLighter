// Build: bundles the renderer and the engine worker, copies MuPDF, fonts and static files
// into dist/app (which Electron runs and electron-builder packages).

import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, 'dist', 'app');
const rOut = path.join(out, 'renderer');
const minify = process.argv.includes('--minify');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(rOut, 'vendor', 'mupdf'), { recursive: true });
fs.mkdirSync(path.join(rOut, 'fonts'), { recursive: true });

// ---- icons (Lucide, ISC licence)
const ICONS = ['mouse-pointer-2', 'hand', 'paint-bucket', 'pentagon', 'square', 'fence', 'pipette', 'eraser', 'search', 'table-2', 'swatch-book',
  'folder-open', 'save', 'undo-2', 'redo-2', 'zoom-in', 'zoom-out', 'maximize', 'pen-line', 'trash-2', 'locate', 'eye', 'eye-off', 'keyboard',
  'x', 'check', 'chevron-down', 'plus', 'minus', 'layers', 'copy', 'arrow-up-to-line', 'arrow-down-to-line',
  'file-text', 'file-image', 'image', 'ruler-dimension-line', 'ruler', 'file-spreadsheet', 'tag', 'chevron-right', 'sigma',
  'map-pin', 'camera', 'chart-pie', 'square-arrow-out-up-right'];
const iconSrc = {};
for (const n of ICONS) {
  const svg = fs.readFileSync(path.join(root, 'node_modules/lucide-static/icons', n + '.svg'), 'utf8');
  iconSrc[n] = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '').trim();
}
fs.writeFileSync(path.join(root, 'src/renderer/icons.gen.js'), '// Generated from lucide-static (ISC). Do not edit.\nexport const ICONS = ' + JSON.stringify(iconSrc, null, 1) + ';\n');

// ---- bundles
const common = { bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', minify, sourcemap: false, legalComments: 'none', logLevel: 'warning' };
await esbuild.build({ ...common, entryPoints: [path.join(root, 'src/renderer/main.js')], outfile: path.join(rOut, 'app.js') });
await esbuild.build({ ...common, entryPoints: [path.join(root, 'src/engine/engine.worker.js')], outfile: path.join(rOut, 'engine.worker.js'), external: ['./vendor/mupdf/mupdf.js'] });

// ---- static files
for (const f of ['index.html', 'styles.css', 'tabs.html', 'tabs.css', 'tabs.js']) fs.copyFileSync(path.join(root, 'src/renderer', f), path.join(rOut, f));
for (const f of ['mupdf.js', 'mupdf-wasm.js', 'mupdf-wasm.wasm']) fs.copyFileSync(path.join(root, 'node_modules/mupdf/dist', f), path.join(rOut, 'vendor/mupdf', f));
fs.copyFileSync(path.join(root, 'src/main/main.js'), path.join(out, 'main.js'));
fs.copyFileSync(path.join(root, 'src/main/preload.js'), path.join(out, 'preload.js'));
if (fs.existsSync(path.join(root, 'assets/icon.png'))) fs.copyFileSync(path.join(root, 'assets/icon.png'), path.join(out, 'icon.png'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'plantint', productName: 'PlanTint', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, main: 'main.js' }, null, 2));

// ---- fonts (IBM Plex Sans + IBM Plex Sans Arabic, OFL)
let css = '';
const fontPkgs = [
  ['ibm-plex-sans', ['latin', 'latin-ext'], ['400', '500', '600']],
  ['ibm-plex-sans-arabic', ['arabic'], ['400', '500', '600']],
];
for (const [pkg, subsets, weights] of fontPkgs) {
  for (const w of weights) {
    const src = fs.readFileSync(path.join(root, 'node_modules/@fontsource', pkg, w + '.css'), 'utf8');
    const blocks = src.split('@font-face').slice(1).map((b) => '@font-face' + b.trim());
    for (const b of blocks) {
      const m = /\/\* ([\w-]+) \*\//.exec(b) || [];
      const subsetMatch = subsets.find((s) => b.includes(`-${s}-${w}-normal.woff2`));
      if (!subsetMatch) continue;
      const file = `${pkg}-${subsetMatch}-${w}-normal.woff2`;
      fs.copyFileSync(path.join(root, 'node_modules/@fontsource', pkg, 'files', file), path.join(rOut, 'fonts', file));
      const unicode = (/unicode-range:\s*([^;]+);/.exec(b) || [])[1];
      const family = pkg === 'ibm-plex-sans' ? 'IBM Plex Sans' : 'IBM Plex Sans Arabic';
      css += `@font-face{font-family:"${family}";font-style:normal;font-display:block;font-weight:${w};src:url(fonts/${file}) format("woff2");${unicode ? 'unicode-range:' + unicode + ';' : ''}}\n`;
      void m;
    }
  }
}
fs.writeFileSync(path.join(rOut, 'fonts.css'), css);

const size = (p) => fs.statSync(p).size;
console.log('built', path.relative(root, out), 'app.js', size(path.join(rOut, 'app.js')), 'engine.worker.js', size(path.join(rOut, 'engine.worker.js')), 'fonts', css.split('\n').length - 1);
