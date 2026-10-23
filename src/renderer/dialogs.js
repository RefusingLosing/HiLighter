// Dialogs: page picker, painted-colour finder, save type chooser, keyboard help.

import { S, emit, makeMarkup, uid } from './state.js';
import { progressOn } from './progress.js';
import { h, icon, modal, toast, seg } from './ui.js';
import * as engine from './engine.js';
import { snapshot, commit, runExclusive } from './history.js';
import { T, requestAll } from './render.js';
import { rgbToHex, colorName } from './colors.js';
import { nameFromText } from './tools.js';
import { refreshList } from './panel.js';
import { pointInRings } from './geom.js';
import { V } from './view.js';
import { LENGTH_UNITS, parseRealLength, fmtLengthIn, fmtNum } from './units.js';

// ------------------------------------------------------------------ page picker

const mm = (pt) => Math.round((pt / 72) * 25.4);
const SHEETS = [['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297], ['B1', 707, 1000], ['ANSI D', 559, 864], ['ANSI E', 864, 1118]];
export function sheetName(wPt, hPt) {
  const a = Math.min(mm(wPt), mm(hPt)), b = Math.max(mm(wPt), mm(hPt));
  for (const [n, x, y] of SHEETS) if (Math.abs(a - x) <= 4 && Math.abs(b - y) <= 4) return n;
  return null;
}

/** Asks which page to open. Resolves with the page index or null. */
export function pickPage({ fileName, pages, kind, thumb }) {
  let chosen = 0;
  const grid = h('div', { class: 'pages' });
  const cards = pages.map((p, i) => {
    const cvs = h('canvas', { class: 'page-thumb', width: 180, height: 130 });
    const size = kind === 'pdf'
      ? `${sheetName(p.w, p.h) ? sheetName(p.w, p.h) + ', ' : ''}${mm(p.w)} × ${mm(p.h)} mm`
      : `${p.w} × ${p.h} px`;
    const label = p.label && p.label !== String(i + 1) ? ` (${p.label})` : '';
    const card = h('button', { class: 'page-card' + (i === 0 ? ' on' : ''), 'data-i': i },
      h('div', { class: 'thumb-box' }, cvs),
      h('div', { class: 'page-cap' }, h('strong', null, `Page ${i + 1}${label}`), h('span', null, size)));
    card.addEventListener('click', () => { chosen = i; for (const c of grid.children) c.classList.toggle('on', c === card); updateOpenLabel(); });
    grid.append(card);
    return { card, cvs, loaded: false };
  });
  let openBtn = null;
  const updateOpenLabel = () => { if (openBtn) openBtn.textContent = `Open page ${chosen + 1}`; };
  let queue = Promise.resolve();
  const load = (i) => {
    const c = cards[i];
    if (c.loaded) return;
    c.loaded = true;
    queue = queue.then(async () => {
      try {
        const bmp = await thumb(i);
        const ctx = c.cvs.getContext('2d');
        const s = Math.min(c.cvs.width / bmp.width, c.cvs.height / bmp.height);
        const w = bmp.width * s, hh = bmp.height * s;
        ctx.fillStyle = '#E4E7E2';
        ctx.fillRect(0, 0, c.cvs.width, c.cvs.height);
        ctx.drawImage(bmp, (c.cvs.width - w) / 2, (c.cvs.height - hh) / 2, w, hh);
        bmp.close();
      } catch { /* leave blank */ }
    });
  };
  const io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) load(+en.target.getAttribute('data-i')); }, { threshold: 0.01 });
  const body = h('div', null,
    h('p', { class: 'modal-text' }, `${fileName} has ${pages.length} pages. Choose the one to mark.`),
    h('div', { class: 'pages-scroll' }, grid));
  return modal({
    title: 'Choose a page',
    body,
    wide: true,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Open page 1', value: 'open', primary: true, id: 'open-page-btn' }],
    onMount: (card, finish) => {
      openBtn = card.querySelector('#open-page-btn');
      for (const c of cards) io.observe(c.card);
      grid.addEventListener('dblclick', (e) => { const c = e.target.closest('.page-card'); if (c) { chosen = +c.getAttribute('data-i'); finish('open'); } });
      grid.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          chosen = Math.max(0, Math.min(pages.length - 1, chosen + (e.key === 'ArrowRight' ? 1 : -1)));
          for (const c of grid.children) c.classList.toggle('on', +c.getAttribute('data-i') === chosen);
          cards[chosen].card.focus();
          updateOpenLabel();
        }
      });
    },
  }).then((v) => { io.disconnect(); return v === 'open' ? chosen : null; });
}

// ------------------------------------------------------------------ painted colour finder

const DET = { active: false, api: null };
export const detectActive = () => DET.active;
export const detectApi = () => DET.api;

const SIZES = [0.00008, 0.00025, 0.0008];

export async function detectColours(hooks) {
  if (!S.doc || DET.active) return;
  DET.active = true;
  const wrap = document.getElementById('canvas-wrap');
  const st = {
    size: 1, match: 1, hatch: false, per: 'area',
    groups: [], off: new Set(), targets: [], picking: false, running: false, runSeq: 0,
    placed: false, moved: false,
  };
  const panel = h('div', { class: 'float-panel det-panel', role: 'dialog', 'aria-label': 'Painted colour' });
  const title = h('h3', { class: 'fp-title' }, 'Painted colour');
  const closeX = h('button', { class: 'fp-x', 'aria-label': 'Close', html: icon('x', 16), onclick: () => close() });
  const header = h('div', { class: 'fp-head' }, title, closeX);
  const intro = h('p', { class: 'fp-text' }, 'Areas already coloured in the drawing can become markups. Their colour is lifted out of the drawing; lines and paper stay.');
  const list = h('div', { class: 'fp-body' });
  const hint = h('p', { class: 'fp-hint' });
  const opts = h('div', { class: 'det-opts' });
  const pickBtn = h('button', { class: 'btn small det-pick', onclick: () => setPicking(!st.picking) });
  const foot = h('div', { class: 'fp-foot' });
  const convertBtn = h('button', { class: 'btn primary', onclick: () => convert() }, 'Make markups');
  const cancelBtn = h('button', { class: 'btn', onclick: () => close() }, 'Cancel');
  foot.append(cancelBtn, convertBtn);
  panel.append(header, intro, list, hint, opts, h('div', { class: 'det-pickrow' }, pickBtn), foot);
  wrap.append(panel);

  // drag the panel by its title so it never hides the area you are looking at
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    header.setPointerCapture(e.pointerId);
    st.moved = true;
    const move = (ev) => {
      const x = Math.max(0, Math.min(wr.width - r.width, ev.clientX - wr.left - ox));
      const y = Math.max(0, Math.min(wr.height - 40, ev.clientY - wr.top - oy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    };
    const up = () => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', up); };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    DET.active = false;
    DET.api = null;
    T.detectPreview = null;
    T.detectHover = null;
    panel.remove();
    requestAll();
    emit('tool');
  };

  const regions = () => st.groups.flatMap((g) => g.regions.map((r) => ({ ...r, g })));
  const isOn = (r) => !st.off.has(r.rid);

  function updatePreview() {
    T.detectPreview = regions().map((r) => ({ rid: r.rid, rings: r.rings, on: isOn(r) }));
    requestAll();
    const chosen = regions().filter(isOn);
    let n = chosen.length;
    if (st.per === 'colour') n = new Set(chosen.map((r) => r.g.key)).size;
    convertBtn.disabled = n === 0 || st.running;
    convertBtn.textContent = n === 1 ? 'Make 1 markup' : `Make ${n} markups`;
    // group checkboxes follow their regions
    for (const row of list.querySelectorAll('.det-row')) {
      const g = st.groups.find((q) => q.key === +row.getAttribute('data-key'));
      if (!g) continue;
      const k = g.regions.filter(isOn).length;
      const cb = row.querySelector('input');
      cb.checked = k > 0;
      cb.indeterminate = k > 0 && k < g.regions.length;
      row.querySelector('.det-meta').textContent = metaFor(g);
    }
  }

  function metaFor(g) {
    const total = S.doc.W * S.doc.H;
    const k = g.regions.filter(isOn).length;
    const pct = (100 * g.area) / total;
    const areas = g.regions.length === 1 ? '1 area' : (k === g.regions.length ? `${g.regions.length} areas` : `${k} of ${g.regions.length} areas`);
    const hatch = g.regions.some((r) => r.hatch) ? ', hatched' : '';
    return `${areas}${hatch}, ${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;
  }

  function renderOptions() {
    opts.innerHTML = '';
    const row = (label, ctl) => h('div', { class: 'det-opt' }, h('span', { class: 'sub-label' }, label), ctl);
    opts.append(
      row('Colour match', seg([[0, 'Strict', 'Only nearly identical colours count as one'], [1, 'Normal'], [2, 'Loose', 'Similar shades count as one colour']], st.match, (v) => { st.match = v; run(); })),
      row('Smallest area', seg([[0, 'Small'], [1, 'Medium'], [2, 'Large']], st.size, (v) => { st.size = v; run(); })),
      row('Hatching', h('label', { class: 'check', 'data-tip': 'Also find areas marked with coloured hatch lines', 'data-tip-side': 'top' },
        h('input', { type: 'checkbox', checked: st.hatch, onchange: (e) => { st.hatch = e.target.checked; run(); } }), h('span', null, 'Find hatched areas too'))),
      row('Make', seg([['area', 'One per area', 'Each coloured area becomes its own markup'], ['colour', 'One per colour', 'All areas of one colour become one markup']], st.per, (v) => { st.per = v; renderOptions(); updatePreview(); })),
    );
    pickBtn.innerHTML = icon('pipette', 15) + (st.picking ? '<span>Click a colour on the sheet…</span>' : '<span>Find a colour I click on the sheet</span>');
    pickBtn.classList.toggle('on', st.picking);
  }

  function setPicking(v) {
    st.picking = v;
    renderOptions();
    hint.textContent = v ? 'Click inside a coloured area of the drawing. Pale tints and greys work too. Esc stops picking.'
      : (st.groups.length ? 'Click an outlined area on the sheet to leave it out or add it back.' : '');
    emit('tool');
  }

  function renderGroups() {
    list.innerHTML = '';
    if (!st.groups.length) {
      title.textContent = 'No painted colour found';
      list.append(h('p', { class: 'fp-text' }, st.targets.length
        ? 'No area of the picked colour is large enough. Try a looser colour match or a smaller area size.'
        : 'This sheet has no coloured areas large enough. Pick a colour on the sheet to look for it, or try other settings.'));
      hint.textContent = '';
      return;
    }
    title.textContent = st.groups.length === 1 ? '1 painted colour' : `${st.groups.length} painted colours`;
    for (const g of st.groups) {
      const hex = rgbToHex(g.color);
      const cb = h('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', () => {
        for (const r of g.regions) { if (cb.checked) st.off.delete(r.rid); else st.off.add(r.rid); }
        updatePreview();
      });
      list.append(h('label', { class: 'det-row', 'data-key': g.key }, cb,
        h('span', { class: 'det-sw', style: { background: hex }, 'data-tip': hex, 'data-tip-side': 'top' }),
        h('span', { class: 'det-name' }, colorName(hex) + (g.picked ? ' (picked)' : '')),
        h('span', { class: 'det-meta' }, metaFor(g))));
    }
    if (!st.picking) hint.textContent = 'Click an outlined area on the sheet to leave it out or add it back.';
  }

  async function run() {
    const my = ++st.runSeq;
    st.running = true;
    title.textContent = 'Looking for painted colour';
    list.innerHTML = '';
    const bar = h('div', { class: 'busy-bar' }, h('div', { class: 'busy-fill', style: { width: '0%' } }));
    list.append(bar);
    convertBtn.disabled = true;
    renderOptions();
    let res;
    try {
      res = await engine.call('detect', { minAreaPx: Math.round(S.doc.W * S.doc.H * SIZES[st.size]), match: st.match, hatch: st.hatch, targets: st.targets },
        { onProgress: (f) => { if (my === st.runSeq) bar.firstChild.style.width = Math.round(f * 100) + '%'; } });
    } catch (err) {
      if (!closed && my === st.runSeq) { toast('Colour search failed: ' + err.message, { kind: 'error' }); close(); }
      return;
    }
    if (closed || my !== st.runSeq) return;
    st.running = false;
    st.groups = res.groups;
    st.off = new Set();
    renderGroups();
    updatePreview();
    if (!st.placed && !st.moved) { st.placed = true; placePanel(); }
  }

  // move the panel to the corner of the view where it hides the fewest found areas
  function placePanel() {
    const wr = wrap.getBoundingClientRect();
    const pw = panel.offsetWidth, ph = panel.offsetHeight, m = 14;
    const boxes = regions().map((r) => [(r.bbox[0] * V.scale + V.tx) / V.dpr, (r.bbox[1] * V.scale + V.ty) / V.dpr, (r.bbox[2] * V.scale + V.tx) / V.dpr, (r.bbox[3] * V.scale + V.ty) / V.dpr]);
    const sheet = [V.tx / V.dpr, V.ty / V.dpr, (S.doc.W * V.scale + V.tx) / V.dpr, (S.doc.H * V.scale + V.ty) / V.dpr];
    const over = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const spots = [[m, m], [wr.width - pw - m, m], [m, wr.height - ph - m], [wr.width - pw - m, wr.height - ph - m]];
    let best = null;
    for (const [x, y] of spots) {
      const r = [x, y, x + pw, y + ph];
      const score = boxes.reduce((s, b) => s + over(r, b), 0) * 10 + over(r, sheet);
      if (!best || score < best.score - 1) best = { x, y, score };
    }
    panel.style.left = Math.max(0, best.x) + 'px';
    panel.style.top = Math.max(0, best.y) + 'px';
  }

  async function convert() {
    const chosen = regions().filter(isOn);
    if (!chosen.length) return;
    convertBtn.disabled = true;
    const rids = chosen.map((r) => r.rid);
    await runExclusive(async () => {
      const before = snapshot();
      const opId = uid('op');
      try {
        await engine.call('applyOp', { opId, rids });
      } catch (err) {
        toast('Could not lift the colour: ' + err.message, { kind: 'error' });
        return;
      }
      const made = [];
      const used = new Set(S.markups.map((m) => m.name));
      const unique = (base) => { let n = base, k = 1; while (used.has(n)) n = `${base} ${++k}`; used.add(n); return n; };
      // solid paint comes back at full strength (it looks as before); hatching becomes a normal
      // see-through highlight in the hatch colour
      const style = (g, hatched) => ({ color: rgbToHex(g.liftColor), opacity: hatched ? 0.45 : 1, borderPt: 0, borderColor: null, borderStyle: 'solid' });
      const mostlyHatched = (rs) => rs.reduce((a, r) => a + (r.hatch ? r.area : -r.area), 0) > 0;
      const byGroup = new Map();
      for (const r of chosen) { if (!byGroup.has(r.g.key)) byGroup.set(r.g.key, []); byGroup.get(r.g.key).push(r); }
      const counters = new Map(); // "Orange area 1, 2, ..." counts per colour name, across groups
      const nextName = (cname) => {
        let n = counters.get(cname) || 0, name;
        do { n++; name = `${cname} area ${n}`; } while (used.has(name));
        counters.set(cname, n);
        used.add(name);
        return name;
      };
      for (const [, rs] of byGroup) {
        const g = rs[0].g;
        const cname = colorName(rgbToHex(g.liftColor));
        if (st.per === 'colour' && rs.length > 1) {
          made.push(makeMarkup({ kind: 'painted', rings: rs.flatMap((r) => r.rings), name: unique(`${cname} areas`), style: style(g, mostlyHatched(rs)) }));
        } else {
          for (const r of rs) {
            const label = nameFromText(r.rings);
            made.push(makeMarkup({ kind: 'painted', rings: r.rings, name: label ? unique(label) : nextName(cname), style: style(g, r.hatch) }));
          }
        }
      }
      // paint was the drawing's bottom layer: keep it under highlights the user already drew
      S.markups = [...made, ...S.markups];
      S.rasterOps = [...S.rasterOps, Object.freeze({ id: opId, label: 'Painted colour' })];
      commit(made.length === 1 ? 'Turn painted colour into a markup' : `Turn painted colour into ${made.length} markups`, before);
      emit('doc');
      refreshList();
      toast(made.length === 1 ? 'Made 1 markup from painted colour.' : `Made ${made.length} markups from painted colour.`, { action: 'Undo', onAction: hooks.undo });
    });
    close();
  }

  // pointer routing while the panel is open (tools.js calls these)
  const regionAt = (x, y) => {
    let best = null;
    for (const r of regions()) {
      const b = r.bbox;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (pointInRings(r.rings, x, y) && (!best || r.area < best.area)) best = r;
    }
    return best;
  };
  DET.api = {
    click: async (x, y) => {
      if (st.picking) {
        const c = await engine.call('colourAt', { x, y });
        if (!c) { toast('No colour here. Click inside a coloured area, not on a line or bare paper.'); return; }
        st.targets.push(c);
        setPicking(false);
        run();
        return;
      }
      const r = regionAt(x, y);
      if (!r) return;
      if (st.off.has(r.rid)) st.off.delete(r.rid); else st.off.add(r.rid);
      updatePreview();
    },
    hover: (x, y) => {
      const r = st.picking ? null : regionAt(x, y);
      const id = r ? r.rid : null;
      if (id !== T.detectHover) { T.detectHover = id; requestAll(); }
    },
    cursor: () => (st.picking ? 'crosshair' : T.detectHover !== null ? 'pointer' : 'default'),
    escape: () => { if (st.picking) setPicking(false); else close(); },
    close,
  };
  renderOptions();
  run();
}

// ------------------------------------------------------------------ calibrate

const TYPED_UNIT = { mm: 'mm', cm: 'cm', m: 'm', km: 'km', in: 'in', inch: 'in', inches: 'in', ft: 'ft', feet: 'ft', foot: 'ft', yd: 'yd', yds: 'yd' };

/** The unit a typed length is in: its own suffix, feet-and-inches marks, or the chosen unit. */
function typedUnit(text, fallback) {
  const t = String(text || '').trim().toLowerCase();
  if (/['"′″’”]/.test(t)) return 'ftin';
  const m = /([a-z]+)$/.exec(t);
  return (m && TYPED_UNIT[m[1]]) || fallback;
}

/**
 * Asks how long the line just drawn (px sheet pixels) is in reality.
 * Resolves with { lengthM, unit } or null.
 */
export function calibrateDialog({ px }) {
  const d = S.doc;
  const paperMm = d.physical ? (px / d.dpi) * 25.4 : 0;
  const unit0 = S.meas.len;
  const input = h('input', { class: 'cal-in', id: 'cal-len', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-submit': '', 'aria-label': 'Real length', placeholder: unit0 === 'ftin' ? '12\'6"' : unit0 === 'mm' ? '4400' : '4.40' });
  const sel = h('select', { class: 'cal-unit', id: 'cal-unit', 'aria-label': 'Unit' }, ...LENGTH_UNITS.map((u) => h('option', { value: u.id, selected: u.id === unit0 }, `${u.label}  (${u.name.toLowerCase()})`)));
  const res = h('p', { class: 'cal-result', id: 'cal-result' });
  const read = () => { const m = parseRealLength(input.value, sel.value); return m > 0 ? m : NaN; };
  const update = () => {
    const m = read();
    if (!(m > 0)) { res.textContent = input.value.trim() ? 'That length is not readable. Try 4.40, 4400 mm or 14\'5".' : 'Type the real length.'; res.classList.add('muted'); return; }
    res.classList.remove('muted');
    const mpp = m / px;
    const n = d.physical ? (mpp * d.dpi) / 0.0254 : 0;
    let t = n ? `Scale 1:${n >= 100 ? n.toFixed(0) : n.toFixed(1)}` : `1 pixel = ${fmtLengthIn(mpp, 'mm', 2)}`;
    if (n && d.scale && Math.abs(n - d.scale) / d.scale > 0.02) t += `. The title block says 1:${d.scale}.`;
    res.textContent = t;
  };
  input.addEventListener('input', update);
  sel.addEventListener('change', update);
  const intro = paperMm ? `The line you drew is ${fmtNum(paperMm, 1)} mm long on the sheet.` : `The line you drew is ${Math.round(px)} pixels long.`;
  const body = h('div', null,
    h('p', { class: 'modal-text' }, intro + ' How long is it in reality?'),
    h('div', { class: 'cal-row' }, input, sel),
    res,
    h('p', { class: 'modal-text small' }, 'For the best accuracy use the longest length you know, such as an overall dimension or a grid spacing.'));
  return modal({
    title: 'Calibrate the scale',
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Set scale', primary: true, value: () => {
        const m = read();
        if (!(m > 0)) { input.focus(); update(); return undefined; }
        return { lengthM: m, unit: typedUnit(input.value, sel.value) };
      } },
    ],
    onMount: () => { update(); setTimeout(() => input.focus(), 40); },
  });
}

// ------------------------------------------------------------------ save type chooser

export const SAVE_TYPES = [
  { id: 'plantint', ext: 'plantint', icon: 'save', title: 'PlanTint project', text: 'Keeps every markup, name and setting editable. Open it again in PlanTint.' },
  { id: 'pdf', ext: 'pdf', icon: 'file-text', title: 'PDF', text: 'The drawing stays sharp at any zoom and its text stays searchable. Highlights print as on screen.' },
  { id: 'pdfflat', ext: 'pdf', icon: 'file-image', title: 'PDF, flattened', text: 'The finished sheet as one picture inside a PDF. Looks the same in every program, including CAD.' },
  { id: 'png', ext: 'png', icon: 'image', title: 'PNG picture', text: 'Full resolution and sharp lines. Prints at the drawing’s real size.' },
  { id: 'jpg', ext: 'jpg', icon: 'image', title: 'JPEG picture', text: 'Smaller file for sending; lines are slightly softer.' },
  { id: 'xlsx', ext: 'xlsx', icon: 'file-spreadsheet', schedule: true, title: 'Schedule (Excel)', text: 'Each markup with its area and perimeter, totals by colour, and the dimensions. Needs a scale.' },
  { id: 'csv', ext: 'csv', icon: 'file-spreadsheet', schedule: true, title: 'Schedule (CSV)', text: 'The same table as plain text, for any spreadsheet or database.' },
  { id: 'progress', ext: 'xlsx', icon: 'chart-pie', schedule: true, title: 'Progress report (Excel)', text: 'Each zone with its status and % done, the % complete and totals by status.' },
  { id: 'snags', ext: 'xlsx', icon: 'map-pin', schedule: true, title: 'Snag list (Excel)', text: 'Every snag pin with its number, place, trade, note, status, dates and photo.' },
];

let lastType = null;
try { lastType = localStorage.getItem('plantint.saveType'); } catch { /* storage is optional */ }

/**
 * Asks which kind of file to save. Resolves with a SAVE_TYPES id or null. keepWork: the question
 * is about keeping the marking (before closing), so schedules, which do not keep it, are left out.
 */
export function chooseSaveType(defaultType, keepWork = false) {
  // the progress report and the snag list are offered once there is something to put in them
  const inUse = { progress: progressOn() || S.markups.some((m) => m.prog), snags: S.pins.length > 0 };
  const types = SAVE_TYPES.filter((t) => (!keepWork || !t.schedule) && inUse[t.id] !== false);
  let chosen = defaultType || lastType || 'plantint';
  if (!types.some((t) => t.id === chosen)) chosen = 'plantint';
  const list = h('div', { class: 'save-types', role: 'radiogroup' });
  const cards = types.map((t) => {
    const c = h('button', { class: 'save-type' + (t.id === chosen ? ' on' : ''), role: 'radio', 'aria-checked': t.id === chosen ? 'true' : 'false', 'data-id': t.id },
      h('span', { class: 'st-ico', html: icon(t.icon, 20) }),
      h('span', { class: 'st-txt' }, h('strong', null, t.title, h('span', { class: 'st-ext' }, '.' + t.ext)), h('span', null, t.text)));
    c.addEventListener('click', () => {
      chosen = t.id;
      for (const k of cards) { const on_ = k.getAttribute('data-id') === chosen; k.classList.toggle('on', on_); k.setAttribute('aria-checked', on_ ? 'true' : 'false'); }
    });
    list.append(c);
    return c;
  });
  return modal({
    title: 'Save as',
    body: h('div', null, h('p', { class: 'modal-text' }, 'Choose the kind of file. Next you choose where to save it.'), list),
    buttons: [{ label: 'Cancel', value: null }, { label: 'Choose where…', value: () => chosen, primary: true }],
    onMount: (card, finish) => {
      list.addEventListener('dblclick', (e) => { const c = e.target.closest('.save-type'); if (c) finish(c.getAttribute('data-id')); });
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const i = types.findIndex((t) => t.id === chosen);
        const j = Math.max(0, Math.min(types.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        cards[j].click(); cards[j].focus();
      });
    },
  }).then((v) => {
    if (v) { lastType = v; try { localStorage.setItem('plantint.saveType', v); } catch { /* ignore */ } }
    return v;
  });
}

// ------------------------------------------------------------------ help

export function showHelp() {
  const rows = [
    ['Tools', [['S', 'Select and move'], ['F', 'Fill an enclosed area'], ['P', 'Polygon'], ['R', 'Rectangle'], ['G', 'Gap line (stops Fill at openings)'], ['K', 'Dimension'], ['C', 'Calibrate the scale'], ['X', 'Snag pin'], ['I', 'Pick a colour'], ['E', 'Eraser (highlights and drawing colour)'], ['M', 'Magnifier'], ['L', 'Legend on sheet'], ['D', 'Find painted colour']]],
    ['Progress map and snag pins', [['1 2 3 0', 'Selected zones: Not started, In progress, Done, Not counted (progress map on)'], ['1 2 3', 'Selected pins: Open, Fixed, Closed'], ['X, click', 'Drop a snag pin, then type its note'], ['Double-click a pin', 'Edit its note'], ['Ctrl+V', 'Paste a photo into the selected pin'], ['Drag a pin', 'Move it']]],
    ['Dimension (K) and Calibrate (C)', [['Click, click', 'The two points to measure between'], ['Click again', 'Where the dimension line goes (Enter: on the points)'], ['Shift', 'Horizontal or vertical'], ['Ctrl', 'Hold to stop snapping'], ['Backspace', 'Back one step'], ['Drag an end', 'Move a point of a selected dimension'], ['Drag the dot', 'Move the dimension line'], ['Calibrate', 'Click both ends of a known length, then type it']]],
    ['While drawing a polygon', [['H', 'Next edge horizontal'], ['V', 'Next edge vertical'], ['A', '90° to the last edge (press again for an earlier edge)'], ['Alt+click', 'Use an edge of another markup for 90°'], ['Shift', 'Horizontal or vertical, whichever is closer'], ['F8', 'Keep horizontal / vertical on'], ['Ctrl', 'Hold to stop snapping'], ['Enter', 'Close the polygon'], ['Backspace', 'Remove the last corner'], ['Esc', 'Cancel']]],
    ['Rectangle', [['Click, click', 'First corner, then the opposite corner'], ['Drag', 'Corner to corner'], ['Type a number', 'Exact width and height after the first corner'], ['Tab', 'Switch between width and height'], ['Shift', 'Keep it square'], ['Ctrl', 'Hold to stop snapping to walls and lines']]],
    ['Eraser', [['Drag', 'Erase colour under the brush'], ['Shift+click', 'Remove a whole markup or coloured area'], ['[ and ]', 'Smaller / larger brush'], ['Right-click', 'Remove colour in this area of the drawing']]],
    ['Painted colour (D)', [['Click an outline', 'Leave that area out, or add it back'], ['Pick button', 'Find a colour you click (greys too)'], ['Esc', 'Stop picking, or close the panel']]],
    ['Selecting and editing', [['Click', 'Select a markup'], ['Shift+click', 'Add to the selection'], ['Ctrl+click', 'Add or remove'], ['Drag right', 'Select markups fully inside the box'], ['Drag left', 'Select markups the box touches'], ['Shift+click in list', 'Select a range'], ['Arrows', 'Nudge (Shift: 10×)'], ['Double-click edge', 'Add a corner'], ['F2', 'Rename'], ['Ctrl+D', 'Duplicate'], ['Del', 'Delete']]],
    ['View and file', [['Wheel', 'Zoom at the pointer'], ['Space+drag', 'Pan (or middle mouse)'], ['Ctrl+0', 'Fit the sheet'], ['Ctrl+1', 'Real size'], ['Alt+wheel', 'Magnifier strength'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+S', 'Save'], ['Ctrl+Shift+S', 'Save as another file type'], ['Ctrl+O', 'Open (in a new tab when this one has a drawing)'], ['Ctrl+N', 'New tab, for a second drawing'], ['Ctrl+W', 'Close this tab'], ['Ctrl+Tab', 'Next tab (Ctrl+Shift+Tab: previous)']]],
  ];
  const body = h('div', null,
    h('div', { class: 'help-grid' }, ...rows.map(([t, items]) => h('section', null,
      h('h3', null, t),
      h('dl', null, ...items.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)]))))),
    h('p', { class: 'about' }, 'PlanTint 1.5.0. Built with Electron, MuPDF (AGPL), Clipper, UTIF, fflate, IBM Plex fonts (OFL) and Lucide icons (ISC). The full source is included with this copy.'));
  return modal({ title: 'Keys and mouse', body, wide: true, buttons: [{ label: 'Close', value: true, primary: true }] });
}
