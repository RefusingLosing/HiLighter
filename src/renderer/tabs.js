// PlanTint — the tab strip. One tab per open drawing. Clicks are sent to the main process, which owns
// the drawings and handles the tab keys; it sends back the list whenever it changes.
'use strict';

const list = document.getElementById('tabs');
const newBtn = document.getElementById('new');

const PLUS = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const CROSS = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

newBtn.innerHTML = PLUS;
newBtn.addEventListener('click', () => window.plantint.newTab());

function tabElement(t) {
  const el = document.createElement('div');
  el.className = 'tab' + (t.active ? ' active' : '');
  el.setAttribute('role', 'tab');
  el.setAttribute('aria-selected', String(t.active));
  el.title = t.name || 'New drawing';
  if (t.unsaved) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.title = 'Not saved';
    el.append(dot);
  }
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = t.name || 'New drawing';
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.title = 'Close (Ctrl+W)';
  close.setAttribute('aria-label', 'Close ' + (t.name || 'drawing'));
  close.innerHTML = CROSS;
  close.addEventListener('click', (e) => { e.stopPropagation(); window.plantint.closeTabById(t.id); });
  el.append(name, close);
  el.addEventListener('click', () => window.plantint.activateTab(t.id));
  el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); window.plantint.closeTabById(t.id); } });
  return el;
}

function render(tabs) {
  list.replaceChildren(...tabs.map(tabElement));
  const active = list.querySelector('.tab.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

window.plantint.onTabs(render);
window.plantint.tabsReady();
