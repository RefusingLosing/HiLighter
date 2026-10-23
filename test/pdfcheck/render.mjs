// Renders page 1 of a PDF with MuPDF at a given dpi (used as one of the four reference engines).
import * as mupdf from '../../node_modules/mupdf/dist/mupdf.js';
import fs from 'fs';
const [, , inp, outp, dpiS] = process.argv;
const doc = mupdf.Document.openDocument(fs.readFileSync(inp), 'application/pdf');
const page = doc.loadPage(0);
const s = (+dpiS || 72) / 72;
const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
fs.writeFileSync(outp, pix.asPNG());
