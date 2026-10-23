// Schedules: every markup with its area and perimeter, totals by colour, and the dimensions,
// as an Excel workbook (.xlsx, written here as plain Office Open XML) or as CSV.

import { zipSync, strToU8 } from 'fflate';
import { S } from './state.js';
import { measureAt } from './measure.js';
import { dimLayout } from './annot.js';
import { colorName } from './colors.js';
import {
  areaNumber, lengthNumber, areaUnitLabel, lengthUnitInfo, areaDecimals, lengthDecimals,
  fmtScale, scaleSource, hasScale,
} from './units.js';

/** The numbers behind a schedule, in the chosen units (feet and inches are given as decimal feet). */
export function scheduleData() {
  const lu = lengthUnitInfo(S.meas.len);
  const lenLabel = lu.id === 'ftin' ? 'ft' : lu.label;
  const rows = S.markups.map((m, i) => {
    const r = measureAt(i);
    return { name: (m.name || '').trim() || 'Untitled', hex: m.color.toUpperCase(), colour: colorName(m.color), area: areaNumber(r.area), perim: lengthNumber(r.perim) };
  });
  const groups = [];
  const byHex = new Map();
  for (const r of rows) {
    let g = byHex.get(r.hex);
    if (!g) { g = { hex: r.hex, colour: r.colour, n: 0, area: 0, perim: 0 }; byHex.set(r.hex, g); groups.push(g); }
    g.n++; g.area += r.area; g.perim += r.perim;
  }
  const dims = S.dims.map((d, i) => ({ n: i + 1, length: lengthNumber(dimLayout(d).len) }));
  const total = rows.reduce((t, r) => ({ area: t.area + r.area, perim: t.perim + r.perim }), { area: 0, perim: 0 });
  const src = { calib: 'calibrated from a known length', typed: 'typed', title: 'from the title block', none: 'none' }[scaleSource()];
  return {
    rows, groups, dims, total,
    areaUnit: areaUnitLabel(), lenUnit: lenLabel, areaDec: areaDecimals(), lenDec: lu.id === 'ftin' ? 2 : lengthDecimals(),
    drawing: (S.doc.projectName || S.doc.name || 'Drawing').replace(/\.[^.]+$/, ''),
    page: S.doc.pageCount > 1 ? S.doc.pageIndex + 1 : 0,
    scale: hasScale() ? `${fmtScale()} (${src})` : 'none',
  };
}

// ------------------------------------------------------------------ CSV

const round = (v, d) => (Number.isFinite(v) ? (Math.round(v * 10 ** d) / 10 ** d).toFixed(d) : '');
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function scheduleCsv(data = scheduleData()) {
  const L = [];
  const line = (...cells) => L.push(cells.map(csvCell).join(','));
  line('Name', 'Colour', 'Colour code', `Area (${data.areaUnit})`, `Perimeter (${data.lenUnit})`);
  for (const r of data.rows) line(r.name, r.colour, r.hex, round(r.area, data.areaDec), round(r.perim, data.lenDec));
  line('Total', '', '', round(data.total.area, data.areaDec), round(data.total.perim, data.lenDec));
  L.push('');
  line('Totals by colour', 'Colour code', 'Markups', `Area (${data.areaUnit})`, `Perimeter (${data.lenUnit})`);
  for (const g of data.groups) line(g.colour, g.hex, g.n, round(g.area, data.areaDec), round(g.perim, data.lenDec));
  if (data.dims.length) {
    L.push('');
    line('Dimension', `Length (${data.lenUnit})`);
    for (const d of data.dims) line(d.n, round(d.length, data.lenDec));
  }
  L.push('');
  line('Drawing', data.drawing + (data.page ? ` (page ${data.page})` : ''));
  line('Scale', data.scale);
  line('Measured', 'Visible parts only: areas leave out what is erased or covered by markups above.');
  // a byte order mark so Excel reads the names (Arabic too) and the unit symbols correctly
  return strToU8('﻿' + L.join('\r\n') + '\r\n');
}

// ------------------------------------------------------------------ Excel

const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
const numFmt = (dec) => (dec > 0 ? '#,##0.' + '0'.repeat(dec) : '#,##0');

/** Small sheet builder: rows of cells { v, s, f } (value, style index, formula). */
function sheetXml(rows, { widths = [], freeze = 0 } = {}) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
  out.push('<sheetViews><sheetView workbookViewId="0">' + (freeze ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>` : '') + '</sheetView></sheetViews>');
  if (widths.length) out.push('<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>');
  out.push('<sheetData>');
  rows.forEach((cells, ri) => {
    if (!cells || !cells.length) { out.push(`<row r="${ri + 1}"/>`); return; }
    const cs = cells.map((c, ci) => {
      if (c === null || c === undefined) return '';
      const cell = typeof c === 'object' ? c : { v: c };
      const ref = colName(ci) + (ri + 1);
      const st = cell.s ? ` s="${cell.s}"` : '';
      if (cell.f) return `<c r="${ref}"${st}><f>${esc(cell.f)}</f>${Number.isFinite(cell.v) ? `<v>${cell.v}</v>` : ''}</c>`;
      if (typeof cell.v === 'number') return Number.isFinite(cell.v) ? `<c r="${ref}"${st}><v>${cell.v}</v></c>` : `<c r="${ref}"${st}/>`;
      if (cell.v === '' || cell.v === undefined) return cell.s ? `<c r="${ref}"${st}/>` : '';
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
    }).join('');
    out.push(`<row r="${ri + 1}">${cs}</row>`);
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

export function scheduleXlsx(data = scheduleData()) {
  // styles: 0 normal, 1 bold, 2 area, 3 length, 4 bold area, 5 bold length, 6 muted, 7+ colour swatches
  const hexes = [...new Set(data.rows.map((r) => r.hex))];
  const fills = hexes.map((h) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${h.slice(1)}"/><bgColor indexed="64"/></patternFill></fill>`);
  const swatch = (hex) => 7 + hexes.indexOf(hex);
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="${esc(numFmt(data.areaDec))}"/><numFmt numFmtId="165" formatCode="${esc(numFmt(data.lenDec))}"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF6B716D"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="${2 + fills.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills.join('')}</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${7 + hexes.length}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
${hexes.map((_, k) => `<xf numFmtId="0" fontId="0" fillId="${2 + k}" borderId="0" xfId="0" applyFill="1"/>`).join('\n')}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  // sheet 1: markups, total, totals by colour, notes
  const n = data.rows.length;
  const first = 2, last = 1 + n;
  const rows = [[{ v: 'Name', s: 1 }, { v: 'Colour', s: 1 }, { v: 'Colour code', s: 1 }, { v: `Area (${data.areaUnit})`, s: 1 }, { v: `Perimeter (${data.lenUnit})`, s: 1 }]];
  for (const r of data.rows) rows.push([r.name, r.colour, { v: r.hex, s: swatch(r.hex) }, { v: r.area, s: 2 }, { v: r.perim, s: 3 }]);
  const sum = (col, v) => (n ? { f: `SUM(${col}${first}:${col}${last})`, v } : { v: 0 });
  rows.push([{ v: 'Total', s: 1 }, '', '', { ...sum('D', data.total.area), s: 4 }, { ...sum('E', data.total.perim), s: 5 }]);
  rows.push([]);
  rows.push([{ v: 'Totals by colour', s: 1 }, { v: 'Markups', s: 1 }, { v: 'Colour code', s: 1 }, { v: `Area (${data.areaUnit})`, s: 1 }, { v: `Perimeter (${data.lenUnit})`, s: 1 }]);
  for (const g of data.groups) {
    const r = rows.length + 1;
    rows.push([g.colour, { f: `COUNTIF($C$${first}:$C$${last},C${r})`, v: g.n }, { v: g.hex, s: swatch(g.hex) },
      { f: `SUMIF($C$${first}:$C$${last},C${r},$D$${first}:$D$${last})`, v: g.area, s: 2 },
      { f: `SUMIF($C$${first}:$C$${last},C${r},$E$${first}:$E$${last})`, v: g.perim, s: 3 }]);
  }
  rows.push([]);
  rows.push([{ v: 'Drawing', s: 6 }, { v: data.drawing + (data.page ? ` (page ${data.page})` : ''), s: 6 }]);
  rows.push([{ v: 'Scale', s: 6 }, { v: data.scale, s: 6 }]);
  rows.push([{ v: 'Measured', s: 6 }, { v: 'Visible parts only: areas leave out what is erased or covered by markups above.', s: 6 }]);
  const sheets = [{ name: 'Areas', xml: sheetXml(rows, { widths: [34, 14, 13, 16, 18], freeze: 1 }) }];

  // sheet 2: dimensions
  if (data.dims.length) {
    const dr = [[{ v: 'Dimension', s: 1 }, { v: `Length (${data.lenUnit})`, s: 1 }]];
    for (const d of data.dims) dr.push([d.n, { v: d.length, s: 3 }]);
    sheets.push({ name: 'Dimensions', xml: sheetXml(dr, { widths: [12, 16], freeze: 1 }) });
  }

  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(data.drawing)} schedule</dc:title><dc:creator>PlanTint</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PlanTint</Application></Properties>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
  };
  sheets.forEach((sh, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sh.xml; });
  const z = {};
  for (const [k, v] of Object.entries(files)) z[k] = strToU8(v);
  return zipSync(z, { level: 6 });
}
