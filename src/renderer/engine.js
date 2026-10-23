// Promise-based client for the engine worker.

let worker = null;
let seq = 0;
const pending = new Map();
const tileHandlers = new Set();
let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });

export function startEngine() {
  worker = new Worker('engine.worker.js', { type: 'module' });
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'ready') { readyResolve(); return; }
    if (m.type === 'tiles' || m.type === 'tiles-done') { for (const h of tileHandlers) h(m); return; }
    const p = pending.get(m.id);
    if (!p) return;
    if ('progress' in m) { if (p.onProgress) p.onProgress(m.progress, m.msg); return; }
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
  };
  worker.onerror = (e) => {
    console.error('engine error', e.message);
    for (const [, p] of pending) p.reject(new Error('The drawing engine stopped unexpectedly: ' + (e.message || 'unknown error')));
    pending.clear();
  };
}

export function onTiles(fn) { tileHandlers.add(fn); return () => tileHandlers.delete(fn); }

export async function call(cmd, args = {}, opts = {}) {
  await ready;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress: opts.onProgress });
    worker.postMessage({ id, cmd, args }, opts.transfer || []);
  });
}
