import { call, openPdf } from './engine-node.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = process.env.PLANTINT_TESTDATA || path.join(root, 'testdata/out');
const out = process.argv[2] || path.join(process.env.PLANTINT_TEST_OUT || path.join(os.tmpdir(), 'plantint-test'), 'pdfnew');
fs.mkdirSync(out, { recursive: true });
const sq = (x0, y0, x1, y1) => [[x0, y0, x1, y0, x1, y1, x0, y1]];
for (const name of ['plan_A3_single', 'plan_rotated', 'plan_cropped', 'plan_layers']) {
  const d = await openPdf(`${DATA}/${name}.pdf`, 150);
  // two overlapping highlights (sheet px at 150 dpi), one with a dashed border
  const W = d.W, H = d.H;
  const a = { rings: sq(W * 0.2, H * 0.3, W * 0.5, H * 0.6), color: [255, 214, 10], opacity: 0.45, borderPx: 6, borderColor: [140, 100, 0], borderStyle: 'dashed', bbox: [0, 0, 0, 0] };
  const b = { rings: sq(W * 0.4, H * 0.5, W * 0.7, H * 0.8), color: [63, 167, 224], opacity: 0.45, borderPx: 0, borderColor: [0, 0, 0], borderStyle: 'solid', bbox: [0, 0, 0, 0] };
  a.hide = b.rings; // b sits above a
  for (const mode of ['vector', 'flat']) {
    if (mode === 'flat') continue; // flat needs a real canvas (tested in the app)
    const bytes = await call('exportPdf', { mode, markups: [a, b], legend: null, title: name });
    fs.writeFileSync(`${out}/${name}_${mode}.pdf`, bytes);
    console.log(name, mode, d.W, 'x', d.H, bytes.length, 'bytes');
  }
}
