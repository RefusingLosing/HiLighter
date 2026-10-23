// Runs the engine worker inside Node for algorithm and PDF-export tests (browser APIs mocked).
import fs from 'fs';
import path from 'path';
import url from 'url';
const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
// mirror the source tree with the vendored MuPDF where the worker expects it
const work = path.join(here, '.work');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'engine/vendor'), { recursive: true });
fs.mkdirSync(path.join(work, 'shared'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'src/engine'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(root, 'src/engine', f), path.join(work, 'engine', f));
for (const f of fs.readdirSync(path.join(root, 'src/shared'))) fs.copyFileSync(path.join(root, 'src/shared', f), path.join(work, 'shared', f));
fs.symlinkSync(path.join(root, 'node_modules/mupdf/dist'), path.join(work, 'engine/vendor/mupdf'));
fs.writeFileSync(path.join(work, 'package.json'), '{"type":"module"}');

globalThis.ImageData = class { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } };
globalThis.createImageBitmap = async (src) => ({ width: src.width || 1, height: src.height || 1, close() {} });
const pending = new Map();
let seq = 0;
globalThis.self = {
  postMessage(m) {
    if (m.type) return;
    const p = pending.get(m.id);
    if (!p || 'progress' in m) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
  },
};
await import(path.join(work, 'engine/engine.worker.js'));
export function call(cmd, args = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    self.onmessage({ data: { id, cmd, args } });
  });
}
export async function openPdf(file, dpi = 150, index = 0) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  await call('openPdf', { bytes });
  return call('loadPdfPage', { index, dpi, gen: 1 });
}
