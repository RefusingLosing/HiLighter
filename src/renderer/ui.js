// Small DOM toolkit: element builder, icons, tooltips, toasts, menus, modals, busy overlay.

import { ICONS } from './icons.gen.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function icon(name, size = 18, sw = 1.75) {
  const body = ICONS[name] || '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function iconEl(name, size, sw) {
  const s = document.createElement('span');
  s.className = 'ico-wrap';
  s.innerHTML = icon(name, size, sw);
  return s;
}

export const layer = () => document.getElementById('layer');

// ------------------------------------------------------------------ tooltips

let tipEl = null, tipTimer = 0, tipTarget = null;
export function initTooltips() {
  tipEl = h('div', { class: 'tooltip', role: 'tooltip' });
  layer().append(tipEl);
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t === tipTarget) return;
    hideTip();
    if (!t) return;
    tipTarget = t;
    tipTimer = setTimeout(() => showTip(t), 420);
  });
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('keydown', hideTip, true);
}
function showTip(t) {
  if (!t.isConnected) return;
  const key = t.getAttribute('data-key');
  tipEl.innerHTML = '';
  tipEl.append(h('span', null, t.getAttribute('data-tip')));
  if (key) tipEl.append(h('kbd', null, key));
  tipEl.classList.add('show');
  const r = t.getBoundingClientRect();
  const side = t.getAttribute('data-tip-side') || (t.closest('#rail') ? 'right' : 'bottom');
  const tr = tipEl.getBoundingClientRect();
  let x, y;
  if (side === 'right') { x = r.right + 10; y = r.top + r.height / 2 - tr.height / 2; }
  else if (side === 'top') { x = r.left + r.width / 2 - tr.width / 2; y = r.top - tr.height - 8; }
  else { x = r.left + r.width / 2 - tr.width / 2; y = r.bottom + 8; }
  x = Math.max(6, Math.min(window.innerWidth - tr.width - 6, x));
  y = Math.max(6, Math.min(window.innerHeight - tr.height - 6, y));
  tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
export function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = null;
  if (tipEl) tipEl.classList.remove('show');
}

// ------------------------------------------------------------------ toasts

let toastBox = null;
export function toast(message, opts = {}) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts' }); layer().append(toastBox); }
  for (const t of toastBox.children) {
    if (t._msg === message && !t.classList.contains('out')) {
      clearTimeout(t._timer);
      t._timer = setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, opts.timeout || 3200);
      return t;
    }
  }
  const el = h('div', { class: 'toast' + (opts.kind ? ' ' + opts.kind : '') }, h('span', { class: 'toast-msg' }, message));
  el._msg = message;
  if (opts.action) {
    el.append(h('button', { class: 'toast-act', onclick: () => { opts.onAction && opts.onAction(); el.remove(); } }, opts.action));
  }
  toastBox.append(el);
  while (toastBox.children.length > 3) toastBox.firstChild.remove();
  el._timer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, opts.timeout || 3200);
  return el;
}

// ------------------------------------------------------------------ context menu

let menuEl = null;
export function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
export function showMenu(x, y, items) {
  closeMenu();
  menuEl = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === 'sep') { menuEl.append(h('div', { class: 'menu-sep' })); continue; }
    const b = h('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem', disabled: it.disabled,
      onclick: () => { closeMenu(); it.onClick && it.onClick(); },
    });
    b.innerHTML = (it.icon ? icon(it.icon, 16) : '<span class="ico-sp"></span>');
    b.append(h('span', { class: 'menu-label' }, it.label));
    if (it.key) b.append(h('kbd', null, it.key));
    menuEl.append(b);
  }
  layer().append(menuEl);
  const r = menuEl.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 6), py = Math.min(y, window.innerHeight - r.height - 6);
  menuEl.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
  setTimeout(() => {
    const off = (e) => { if (menuEl && !menuEl.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  });
}

// ------------------------------------------------------------------ modal

let modalStack = 0;
export const modalOpen = () => modalStack > 0;

/**
 * Shows a modal. buttons: [{ label, value, primary, danger }]. Resolves with the clicked value
 * (or `cancelValue` on Esc / backdrop when dismissible).
 */
export function modal({ title, body, buttons = [], dismissible = true, cancelValue = null, wide = false, onMount }) {
  return new Promise((resolve) => {
    modalStack++;
    const back = h('div', { class: 'modal-back' });
    const card = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    if (title) card.append(h('h2', { class: 'modal-title' }, title));
    if (body) card.append(typeof body === 'string' ? h('p', { class: 'modal-text' }, body) : body);
    const foot = h('div', { class: 'modal-foot' });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      modalStack--;
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      resolve(v);
    };
    for (const b of buttons) {
      const btn = h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => finish(typeof b.value === 'function' ? b.value() : b.value) }, b.label);
      if (b.id) btn.id = b.id;
      foot.append(btn);
    }
    if (buttons.length) card.append(foot);
    back.append(card);
    layer().append(back);
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) { e.preventDefault(); e.stopPropagation(); finish(cancelValue); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
        const p = buttons.find((b) => b.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); finish(typeof p.value === 'function' ? p.value() : p.value); }
      }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    if (dismissible) back.addEventListener('pointerdown', (e) => { if (e.target === back) finish(cancelValue); });
    const prim = foot.querySelector('.btn.primary');
    if (prim) setTimeout(() => prim.focus(), 30);
    if (onMount) onMount(card, finish);
  });
}

// ------------------------------------------------------------------ busy overlay

let busyEl = null;
export const busy = {
  show(msg, progress) {
    if (!busyEl) {
      busyEl = h('div', { class: 'busy' },
        h('div', { class: 'busy-card' },
          h('div', { class: 'busy-msg' }),
          h('div', { class: 'busy-bar' }, h('div', { class: 'busy-fill' }))));
      document.getElementById('canvas-wrap').append(busyEl);
    }
    busyEl.hidden = false;
    this.update(msg, progress);
  },
  update(msg, progress) {
    if (!busyEl) return;
    if (msg) busyEl.querySelector('.busy-msg').textContent = msg;
    const fill = busyEl.querySelector('.busy-fill');
    if (progress === undefined || progress === null) fill.parentElement.classList.add('indet');
    else { fill.parentElement.classList.remove('indet'); fill.style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%'; }
  },
  hide() { if (busyEl) busyEl.hidden = true; },
};

/** Segmented control: items [[value, label, tip, key]]. */
export function seg(items, current, onPick, cls = '') {
  return h('div', { class: 'segs ' + cls }, ...items.map(([val, label, tip, key]) => {
    const b = h('button', { class: 'seg' + (val === current ? ' on' : ''), 'data-tip': tip, 'data-key': key, 'data-tip-side': 'top', onclick: () => onPick(val) });
    if (typeof label === 'string') b.textContent = label; else b.append(label);
    return b;
  }));
}
