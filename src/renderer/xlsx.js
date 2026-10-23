// A small Excel writer (.xlsx written as plain Office Open XML): sheets of cells with shared styles,
// merged cells, column widths, row heights, a frozen header, a filter, print settings and pictures
// anchored to cells. Pictures use the classic drawing part, which every Excel version (and
// LibreOffice) shows; they move and size with their cells, so sorting and filtering keep them on
// their rows.

import { zipSync, strToU8 } from 'fflate';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PX_EMU = 9525; // one screen pixel (1/96 inch) in EMUs

export const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const colName = (i) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
/** A1-style reference of a 0-based column and row. */
export const ref = (c, r) => colName(c) + (r + 1);
/** A sheet name as it is written in formulas: 'Snag list'. */
export const sheetRef = (name) => `'${String(name).replace(/'/g, "''")}'`;

/** Excel's day number for a YYYY-MM-DD date, or null. */
export function excelDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Width of a column in screen pixels for a width in characters (Calibri 11). */
export const colPx = (chars) => Math.floor(((256 * chars + Math.floor(128 / 7)) / 256) * 7);

const BUILTIN_FMT = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };

/**
 * Cell styles, made on demand and shared. xf({ bold, italic, size, color, fill, border, fmt, wrap,
 * h: 'left'|'center'|'right', v: 'top'|'center' }) gives the style index for a cell's s.
 */
export function styleBook() {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const numFmts = [];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const seen = new Map();
  const put = (arr, x) => { let i = arr.indexOf(x); if (i < 0) { arr.push(x); i = arr.length - 1; } return i; };
  const rgb = (hex) => 'FF' + hex.replace('#', '').toUpperCase();
  function xf(o = {}) {
    const key = JSON.stringify(o);
    if (seen.has(key)) return seen.get(key);
    const font = `<font>${o.bold ? '<b/>' : ''}${o.italic ? '<i/>' : ''}<sz val="${o.size || 11}"/>${o.color ? `<color rgb="${rgb(o.color)}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`;
    const fontId = put(fonts, font);
    const fillId = o.fill ? put(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${rgb(o.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = (n) => `<${n} style="thin"><color rgb="FFB4BAB5"/></${n}>`;
    const borderId = o.border ? put(borders, `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`) : 0;
    let numFmtId = 0;
    if (o.fmt) {
      if (o.fmt in BUILTIN_FMT) numFmtId = BUILTIN_FMT[o.fmt];
      else {
        let f = numFmts.find((q) => q.code === o.fmt);
        if (!f) { f = { id: 164 + numFmts.length, code: o.fmt }; numFmts.push(f); }
        numFmtId = f.id;
      }
    }
    const align = o.wrap || o.h || o.v ? `<alignment${o.h ? ` horizontal="${o.h}"` : ''}${o.v ? ` vertical="${o.v}"` : ''}${o.wrap ? ' wrapText="1"' : ''}/>` : '';
    const attrs = `numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`
      + (numFmtId ? ' applyNumberFormat="1"' : '') + (fontId ? ' applyFont="1"' : '') + (fillId ? ' applyFill="1"' : '') + (borderId ? ' applyBorder="1"' : '');
    xfs.push(align ? `<xf ${attrs} applyAlignment="1">${align}</xf>` : `<xf ${attrs}/>`);
    const id = xfs.length - 1;
    seen.set(key, id);
    return id;
  }
  function xml() {
    return XML_HEAD + `<styleSheet xmlns="${NS_MAIN}">`
      + (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${esc(f.code)}"/>`).join('')}</numFmts>` : '')
      + `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`
      + `<fills count="${fills.length}">${fills.join('')}</fills>`
      + `<borders count="${borders.length}">${borders.join('')}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>';
  }
  return { xf, xml };
}

function cellXml(c, ref_) {
  if (c === null || c === undefined) return '';
  const cell = typeof c === 'object' ? c : { v: c };
  const st = cell.s ? ` s="${cell.s}"` : '';
  if (cell.f) return `<c r="${ref_}"${st}><f>${esc(cell.f)}</f>${Number.isFinite(cell.v) ? `<v>${cell.v}</v>` : ''}</c>`;
  if (typeof cell.v === 'number') return Number.isFinite(cell.v) ? `<c r="${ref_}"${st}><v>${cell.v}</v></c>` : `<c r="${ref_}"${st}/>`;
  if (cell.v === '' || cell.v === undefined || cell.v === null) return cell.s ? `<c r="${ref_}"${st}/>` : '';
  return `<c r="${ref_}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
}

function sheetXml(sh, drawingRid) {
  const fit = !!(sh.landscape || sh.fitWidth);
  const out = [XML_HEAD, `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`];
  if (fit) out.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  out.push('<sheetViews><sheetView workbookViewId="0">'
    + (sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freeze + 1}" sqref="A${sh.freeze + 1}"/>` : '')
    + '</sheetView></sheetViews>');
  out.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (sh.widths && sh.widths.length) out.push('<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>');
  out.push('<sheetData>');
  sh.rows.forEach((cells, ri) => {
    const ht = sh.heights && sh.heights[ri];
    const attrs = ht ? ` ht="${Math.round(ht * 100) / 100}" customHeight="1"` : '';
    const cs = (cells || []).map((c, ci) => cellXml(c, ref(ci, ri))).join('');
    out.push(`<row r="${ri + 1}"${attrs}>${cs}</row>`);
  });
  out.push('</sheetData>');
  if (sh.filter) out.push(`<autoFilter ref="${sh.filter}"/>`);
  if (sh.merges && sh.merges.length) out.push(`<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);
  out.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
  if (fit) out.push(`<pageSetup paperSize="9"${sh.landscape ? ' orientation="landscape"' : ''} fitToWidth="1" fitToHeight="0"/>`);
  if (drawingRid) out.push(`<drawing r:id="${drawingRid}"/>`);
  out.push('</worksheet>');
  return out.join('');
}

/** Pictures of one sheet, each fitted into its cell with a margin (dx, dy in px). */
function drawingXml(images) {
  const anchors = images.map((im, i) => {
    const dx = im.dx ?? 4, dy = im.dy ?? 4;
    const from = `<xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${Math.round(dx * PX_EMU)}</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>${Math.round(dy * PX_EMU)}</xdr:rowOff></xdr:from>`;
    const to = `<xdr:to><xdr:col>${im.col}</xdr:col><xdr:colOff>${Math.round((dx + im.w) * PX_EMU)}</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>${Math.round((dy + im.h) * PX_EMU)}</xdr:rowOff></xdr:to>`;
    const pic = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="${esc(im.name || 'Picture ' + (i + 1))}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
      + `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
      + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(im.w * PX_EMU)}" cy="${Math.round(im.h * PX_EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
    return `<xdr:twoCellAnchor editAs="twoCell">${from}${to}${pic}<xdr:clientData/></xdr:twoCellAnchor>`;
  });
  return XML_HEAD + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + NS_REL + '">' + anchors.join('') + '</xdr:wsDr>';
}

/**
 * The workbook as bytes.
 * sheets: [{ name, rows: [[cell]], widths, heights: { [row]: points }, freeze (rows), filter ('A3:H9'),
 *   merges: ['A1:D1'], landscape, fitWidth, printTitles: [first, last] (1-based rows repeated on each page),
 *   images: [{ row, col, bytes, ext: 'jpeg' | 'png', w, h (px), dx, dy, name }] }]
 * cell: a value, or { v, s (style index), f (formula) }.
 */
export function buildXlsx({ sheets, styles, title = '' }) {
  const files = {};
  const overrides = [];
  let media = 0, drawings = 0;
  const exts = new Set();
  const defined = [];
  sheets.forEach((sh, i) => {
    const n = i + 1;
    let drawingRid = null;
    if (sh.images && sh.images.length) {
      drawings++;
      drawingRid = 'rId1';
      files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = XML_HEAD + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/drawing${drawings}.xml"/></Relationships>`;
      files[`xl/drawings/drawing${drawings}.xml`] = drawingXml(sh.images);
      const rels = sh.images.map((im, k) => {
        media++;
        const ext = im.ext === 'png' ? 'png' : 'jpeg';
        exts.add(ext);
        files[`xl/media/image${media}.${ext}`] = im.bytes;
        return `<Relationship Id="rId${k + 1}" Type="${NS_REL}/image" Target="../media/image${media}.${ext}"/>`;
      });
      files[`xl/drawings/_rels/drawing${drawings}.xml.rels`] = XML_HEAD + `<Relationships xmlns="${NS_PKG}">${rels.join('')}</Relationships>`;
      overrides.push(`<Override PartName="/xl/drawings/drawing${drawings}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    }
    files[`xl/worksheets/sheet${n}.xml`] = sheetXml(sh, drawingRid);
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (sh.filter) {
      const abs = sh.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
      defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(sheetRef(sh.name) + '!' + abs)}</definedName>`);
    }
    if (sh.printTitles) defined.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(sheetRef(sh.name) + `!$${sh.printTitles[0]}:$${sh.printTitles[1]}`)}</definedName>`);
  });
  files['[Content_Types].xml'] = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + (exts.has('jpeg') ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : '') + (exts.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : '')
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + overrides.join('')
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  files['_rels/.rels'] = XML_HEAD + `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  files['docProps/core.xml'] = XML_HEAD + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>PlanTint</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;
  files['docProps/app.xml'] = XML_HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PlanTint</Application></Properties>';
  files['xl/workbook.xml'] = XML_HEAD + `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>`
    + sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
    + (defined.length ? `<definedNames>${defined.join('')}</definedNames>` : '')
    + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  files['xl/_rels/workbook.xml.rels'] = XML_HEAD + `<Relationships xmlns="${NS_PKG}">`
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
  files['xl/styles.xml'] = styles.xml();
  const z = {};
  for (const [k, v] of Object.entries(files)) z[k] = typeof v === 'string' ? strToU8(v) : [v, { level: 0 }];
  return zipSync(z, { level: 6 });
}
