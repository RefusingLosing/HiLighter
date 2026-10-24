'use strict';
// PlanTint — Electron main process.
// One window holds the drawings as tabs. Each tab is its own page with its own marking, scale,
// measurements, unsaved-work question and crash-recovery copy. The strip across the top of the
// window (tabs.html) lists the tabs, switches between them and opens new ones. Opening a drawing
// from a tab that already has one puts it in a new tab. The tab keys are handled here.

const { app, BrowserWindow, WebContentsView, ipcMain, dialog, protocol, shell, screen, Menu } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const RENDERER_DIR = path.join(__dirname, 'renderer');
const OPENABLE = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif', '.webp', '.plantint'];
const STRIP_H = 44; // the tab strip is the row of the window buttons (at interface size 100%)

// Interface size (Preferences): every page of the app is zoomed by it (they share an origin, so one zoom
// reaches them all), and the tab strip grows with it.
let uiZoom = 1;
const uiStateFile = () => path.join(app.getPath('userData'), 'ui.json');
const stripH = () => Math.round(STRIP_H * uiZoom);
function loadUiZoom() {
  try { const z = Number(JSON.parse(fs.readFileSync(uiStateFile(), 'utf8')).zoom); if (z >= 0.8 && z <= 1.5) uiZoom = z; } catch { /* 100% */ }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

// Large drawings are rendered into big pixel buffers; give the JS heap head-room.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// Windows, keyed by window id: { win, tabs (in strip order), active (the shown tab), closing }.
const wins = new Map();
// Tabs, keyed by the id of their page: { win (its window record), view, key (recovery copy),
// name, title, unsaved, attached (shown in the window), closeTimer, startupPath }.
const tabs = new Map();

const tabOf = (e) => tabs.get(e.sender.id) || null;
const winOf = (e) => {
  const t = tabOf(e);
  if (t) return t.win;
  const w = BrowserWindow.fromWebContents(e.sender);
  return (w && wins.get(w.id)) || null;
};
const focusedWindow = () => {
  const w = BrowserWindow.getFocusedWindow();
  return (w && wins.get(w.id)) || null;
};
const isOpenable = (p) => OPENABLE.includes(path.extname(p).toLowerCase());

function fileFromArgv(argv) {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    try {
      const p = path.resolve(a);
      if (OPENABLE.includes(path.extname(p).toLowerCase()) && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch { /* ignore */ }
  }
  return null;
}

function readForRenderer(p) {
  const data = fs.readFileSync(p);
  return { path: p, name: path.basename(p), bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // A second launch (a drawing opened from Windows Explorer) opens its file as a new tab.
  app.on('second-instance', (_e, argv) => {
    app.whenReady().then(() => {
      const f = fileFromArgv(argv);
      const rec = focusedWindow() || wins.values().next().value;
      if (!rec) { createWindow(f); return; }
      if (rec.win.isMinimized()) rec.win.restore();
      rec.win.focus();
      if (f) addTab(rec, f);
    });
  });
}

function createWindow(startupPath = null) {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1600, wa.width),
    height: Math.min(1000, wa.height),
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#F3F4F1',
    title: 'PlanTint',
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#F3F4F1', symbolColor: '#2B302D', height: stripH() },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  const winId = win.id;
  const rec = { win, tabs: [], active: null, closing: false, allowClose: false };
  wins.set(winId, rec);

  win.once('ready-to-show', () => {
    if (wa.width <= 1920) win.maximize();
    win.show();
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // the shown tab fills the window under the strip: place it again whenever the window's size or state changes
  for (const ev of ['resize', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen', 'show']) win.on(ev, () => layout(rec));
  // back in the window (Alt+Tab, a closed dialog): the keys go to the shown drawing, not to the strip
  win.on('focus', () => focusTab(rec.active));
  win.webContents.on('before-input-event', (e, input) => tabKeys(rec, e, input));
  win.on('close', (e) => {
    if (rec.allowClose) return;
    e.preventDefault();
    closeWindow(rec);
  });
  win.on('closed', () => {
    for (const t of rec.tabs) {
      clearTimeout(t.closeTimer);
      tabs.delete(t.view.webContents.id);
      if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    }
    wins.delete(winId);
  });
  win.webContents.on('did-finish-load', () => { if (uiZoom !== 1) applyUiZoom(rec); });
  win.loadURL('app://bundle/tabs.html');
  addTab(rec, startupPath);
  return win;
}

/** Opens a drawing page in a new tab of the window and shows it. */
function addTab(rec, startupPath = null) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor('#F3F4F1');
  const t = { win: rec, view, key: 'w-' + crypto.randomUUID(), name: '', title: 'PlanTint', unsaved: false, attached: false, closeTimer: null, startupPath };
  const wc = view.webContents;
  tabs.set(wc.id, t);
  rec.tabs.push(t);
  wc.on('will-navigate', (e) => e.preventDefault());
  // the drawing's markups window: an empty page the drawing fills in and keeps up to date itself. It
  // sits above PlanTint's window (so a click on the drawing does not hide it) and opens beside the
  // drawing, or where it was last left, at the size it was last given.
  wc.setWindowOpenHandler(({ url, frameName }) => (url === 'about:blank' && frameName === 'plantint-markups' ? {
    action: 'allow',
    overrideBrowserWindowOptions: {
      ...markupsWindowBounds(rec), minWidth: 420, minHeight: 300,
      parent: rec.win, resizable: true, maximizable: true, minimizable: false, fullscreenable: false,
      backgroundColor: '#FFFFFF', title: 'Markups', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    },
  } : { action: 'deny' }));
  wc.on('did-create-window', (child) => {
    t.markupsWin = child;
    // where it is, kept as it moves: a window that closes itself is gone before 'closed' can ask
    let last = child.getBounds();
    const keep = () => { if (!child.isDestroyed()) last = child.isMaximized() ? child.getNormalBounds() : child.getBounds(); };
    for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'close']) child.on(ev, keep);
    child.on('closed', () => {
      saveMarkupsWindowBounds(last);
      if (t.markupsWin === child) t.markupsWin = null;
    });
  });
  wc.on('before-input-event', (e, input) => tabKeys(rec, e, input));
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    activate(t);
    const r = dialog.showMessageBoxSync(rec.win, {
      type: 'error',
      buttons: ['Restart PlanTint', 'Close this drawing'],
      defaultId: 0,
      title: 'PlanTint',
      message: 'PlanTint stopped unexpectedly.',
      detail: 'Your last copy of unsaved work will be offered when it restarts.',
    });
    if (r === 0) { if (!wc.isDestroyed()) wc.reload(); } else removeTab(t);
  });
  wc.on('did-finish-load', () => { if (uiZoom !== 1 && !wc.isDestroyed()) wc.setZoomFactor(uiZoom); });
  wc.loadURL('app://bundle/index.html');
  activate(t);
  return t;
}

/** Shows one tab in the window (the others are taken out of the window, but stay alive). */
function activate(t) {
  const rec = t.win;
  if (rec.win.isDestroyed()) return;
  for (const o of rec.tabs) {
    if (o !== t && o.attached) { rec.win.contentView.removeChildView(o.view); o.attached = false; }
  }
  if (!t.attached) { rec.win.contentView.addChildView(t.view); t.attached = true; }
  rec.active = t;
  layout(rec);
  rec.win.setTitle(t.title);
  sendStrip(rec);
  // a markups window shows only with its own drawing
  for (const o of rec.tabs) {
    const w = o.markupsWin;
    if (!w || w.isDestroyed()) continue;
    if (o === t) { if (!w.isVisible()) w.showInactive(); } else if (w.isVisible()) w.hide();
  }
  focusTab(t);
}

// ------------------------------------------------------------------ the markups window's place

const markupsStateFile = () => path.join(app.getPath('userData'), 'markups-window.json');

/** Where the markups window opens: where it was left, if that is still on a screen; else beside the drawing. */
function markupsWindowBounds(rec) {
  try {
    const b = JSON.parse(fs.readFileSync(markupsStateFile(), 'utf8'));
    if ([b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 300 && b.height >= 200) {
      const wa = screen.getDisplayMatching(b).workArea;
      const ix = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
      const iy = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
      // most of it on a screen, and its title bar too
      if (ix > 0 && iy > 0 && ix * iy >= 0.5 * b.width * b.height && b.y >= wa.y - 8 && b.y < wa.y + wa.height - 40) {
        return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(Math.min(b.width, wa.width)), height: Math.round(Math.min(b.height, wa.height)) };
      }
    }
  } catch { /* none kept yet */ }
  // beside the drawing: over the right part of PlanTint's window, leaving most of the sheet in view
  const w = rec.win.getBounds();
  const wa = screen.getDisplayMatching(w).workArea;
  const width = Math.round(Math.min(720, Math.max(480, w.width * 0.36), wa.width));
  const height = Math.round(Math.min(wa.height, Math.max(380, w.height - 150)));
  const x = Math.round(Math.max(wa.x, Math.min(w.x + w.width - width - 14, wa.x + wa.width - width)));
  const y = Math.round(Math.max(wa.y, Math.min(w.y + 104, wa.y + wa.height - height)));
  return { x, y, width, height };
}

function saveMarkupsWindowBounds(b) {
  try {
    if (b && [b.x, b.y, b.width, b.height].every(Number.isFinite)) fs.writeFileSync(markupsStateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }));
  } catch { /* not kept: it opens beside the drawing next time */ }
}

/** Puts the shown tab under the strip, filling the rest of the window. */
function layout(rec) {
  if (!rec.active || rec.win.isDestroyed() || rec.win.isMinimized()) return;
  const [w, h] = rec.win.getContentSize();
  rec.active.view.setBounds({ x: 0, y: stripH(), width: w, height: Math.max(0, h - stripH()) });
}

/** Tells the strip which tabs there are and which one is shown. */
function sendStrip(rec) {
  if (rec.win.isDestroyed() || rec.win.webContents.isDestroyed()) return;
  rec.win.webContents.send('tabs:update', rec.tabs.map((t) => ({
    id: t.view.webContents.id, name: t.name, unsaved: t.unsaved, active: t === rec.active,
  })));
}

/** Asks a tab to close: it shows its unsaved-work question, then answers app:quit or app:close-cancel. */
function askClose(t) {
  if (t.view.webContents.isDestroyed()) return;
  activate(t);
  t.view.webContents.send('app:close-request');
  // If the page never answers (hung), fall back to a native question so the user can always leave.
  clearTimeout(t.closeTimer);
  t.closeTimer = setTimeout(() => {
    const r = dialog.showMessageBoxSync(t.win.win, {
      type: 'warning',
      buttons: ['Close without saving', 'Keep waiting'],
      defaultId: 1,
      cancelId: 1,
      title: 'PlanTint',
      message: 'PlanTint is not responding.',
      detail: 'Close this drawing anyway? Unsaved marking will be lost.',
    });
    if (r === 0) removeTab(t);
  }, 5000);
}

/** Closes one tab: the last tab closes the window. */
function requestCloseTab(t) {
  if (t.win.tabs.length === 1) { closeWindow(t.win); return; }
  askClose(t);
}

/** Gives the keys to a tab's drawing. */
function focusTab(t) {
  if (t && !t.view.webContents.isDestroyed()) t.view.webContents.focus();
}

/** Shows the next tab (dir 1) or the previous one (dir -1), going round. */
function switchTab(rec, dir) {
  if (rec.tabs.length < 2) return;
  const i = rec.tabs.indexOf(rec.active);
  activate(rec.tabs[(i + (dir < 0 ? -1 : 1) + rec.tabs.length) % rec.tabs.length]);
}

/** A tab key: 'n' (Ctrl+N, a new tab), 'w' (Ctrl+W, close the shown tab) or 'Tab' (Ctrl+Tab, next; with Shift, previous). */
function tabKey(rec, k, shift, repeat = false) {
  if (k === 'Tab') { switchTab(rec, shift ? -1 : 1); return true; }
  if (k === 'n' && !shift) { if (!repeat) addTab(rec); return true; }
  if (k === 'w' && !shift) { if (!repeat && rec.active) requestCloseTab(rec.active); return true; }
  return false;
}

/**
 * The tab keys act wherever they are pressed: in a drawing, in one of its text boxes, or in the strip,
 * as in a browser. They are taken here, before the page sees them.
 */
function tabKeys(rec, e, input) {
  if (input.type !== 'keyDown' || input.alt || !(input.control || input.meta)) return;
  // the letter as typed, or the key's place when the keyboard is set to another script (Arabic, ...)
  const letter = /^[a-z]$/i.test(input.key) ? input.key.toLowerCase() : /^Key[A-Z]$/.test(input.code) ? input.code.slice(3).toLowerCase() : '';
  if (tabKey(rec, input.key === 'Tab' ? 'Tab' : letter, input.shift, input.isAutoRepeat)) e.preventDefault();
}

/** Closes the window: each tab is asked in turn, and the window goes when none is left. */
function closeWindow(rec) {
  if (rec.closing) return;
  rec.closing = true;
  closeNext(rec);
}

function closeNext(rec) {
  const t = rec.tabs[0];
  if (!t) { closeWindowNow(rec); return; }
  askClose(t);
}

function closeWindowNow(rec) {
  rec.closing = false;
  rec.allowClose = true;
  if (!rec.win.isDestroyed()) rec.win.close();
}

/** Takes a tab out of its window and frees its page. */
function removeTab(t) {
  const rec = t.win;
  clearTimeout(t.closeTimer);
  const i = rec.tabs.indexOf(t);
  if (i >= 0) rec.tabs.splice(i, 1);
  tabs.delete(t.view.webContents.id);
  if (t.attached && !rec.win.isDestroyed()) rec.win.contentView.removeChildView(t.view);
  t.attached = false;
  if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
  if (rec.closing) { closeNext(rec); return; }
  if (!rec.tabs.length) { closeWindowNow(rec); return; }
  if (rec.active === t) activate(rec.tabs[Math.min(Math.max(i, 0), rec.tabs.length - 1)]);
  else sendStrip(rec);
}

app.whenReady().then(() => {
  loadUiZoom();
  // no menu bar: also removes Ctrl+R / F5 reload and Ctrl+W, which would throw away unsaved marking
  Menu.setApplicationMenu(null);
  protocol.handle('app', async (req) => {
    try {
      const url = new URL(req.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const full = path.normalize(path.join(RENDERER_DIR, rel));
      if (!full.startsWith(RENDERER_DIR)) return new Response('Forbidden', { status: 403 });
      const data = await fs.promises.readFile(full);
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  createWindow(fileFromArgv(process.argv));
});

app.on('window-all-closed', () => app.quit());

// ---------------------------------------------------------------- IPC: the tab strip and new tabs

ipcMain.on('tabs:ready', (e) => { const rec = winOf(e); if (rec) sendStrip(rec); });
ipcMain.on('tabs:new', (e) => { const rec = winOf(e); if (rec) addTab(rec); });
ipcMain.on('tabs:activate', (e, id) => {
  const rec = winOf(e);
  const t = tabs.get(id);
  if (rec && t && t.win === rec) activate(t);
});
ipcMain.on('tabs:close', (_e, id) => { const t = tabs.get(id); if (t) requestCloseTab(t); });
// tab keys that did not pass through before-input-event (keys sent by automation, as in the tests) come from the page
ipcMain.on('tabs:key', (e, k, shift) => { const rec = winOf(e); if (rec && typeof k === 'string') tabKey(rec, k, !!shift); });
// a drawing dropped on a tab that already has one opens in a new tab beside it
ipcMain.on('tabs:open', (e, p) => {
  const rec = winOf(e);
  if (rec && typeof p === 'string' && isOpenable(p)) addTab(rec, p);
});

// ---------------------------------------------------------------- IPC: a tab's page

ipcMain.handle('dlg:open', async (e, opts) => {
  const rec = winOf(e);
  if (!rec) return null;
  const r = await dialog.showOpenDialog(rec.win, {
    title: 'Open a drawing or project',
    properties: ['openFile'],
    filters: [
      { name: 'Drawings and PlanTint projects', extensions: OPENABLE.map((ext) => ext.slice(1)) },
      { name: 'PDF drawings', extensions: ['pdf'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'gif', 'webp'] },
      { name: 'PlanTint projects', extensions: ['plantint'] },
    ],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  // a tab that already has a drawing keeps it: the chosen one opens in a new tab beside it
  if (opts && opts.newTab && isOpenable(p)) { addTab(rec, p); return null; }
  return readForRenderer(p);
});

ipcMain.handle('fs:read', async (_e, p) => readForRenderer(p));

/** A photo for a snag pin. */
ipcMain.handle('dlg:photo', async (e) => {
  const rec = winOf(e);
  if (!rec) return null;
  const r = await dialog.showOpenDialog(rec.win, {
    title: 'Add a photo to the snag',
    properties: ['openFile'],
    filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return readForRenderer(r.filePaths[0]);
});

const SAVE_FILTERS = {
  plantint: { name: 'PlanTint project', extensions: ['plantint'] },
  pdf: { name: 'PDF document', extensions: ['pdf'] },
  pdfflat: { name: 'PDF document (flattened)', extensions: ['pdf'] },
  png: { name: 'PNG picture', extensions: ['png'] },
  jpg: { name: 'JPEG picture', extensions: ['jpg', 'jpeg'] },
  xlsx: { name: 'Excel workbook', extensions: ['xlsx'] },
  progress: { name: 'Excel workbook', extensions: ['xlsx'] },
  snags: { name: 'Excel workbook', extensions: ['xlsx'] },
  csv: { name: 'CSV (comma separated)', extensions: ['csv'] },
};
const KNOWN_EXT = ['.plantint', '.pdf', '.png', '.jpg', '.jpeg', '.xlsx', '.csv'];

/** Asks where to save one kind of file. The kind is chosen in the app before this. */
ipcMain.handle('dlg:save', async (e, opts) => {
  const rec = winOf(e);
  if (!rec) return null;
  const f = SAVE_FILTERS[opts.type] || SAVE_FILTERS.plantint;
  const r = await dialog.showSaveDialog(rec.win, {
    title: opts.title || 'Save',
    defaultPath: opts.defaultPath,
    filters: [f],
    properties: ['showOverwriteConfirmation'],
  });
  if (r.canceled || !r.filePath) return null;
  let p = r.filePath;
  const ext = path.extname(p).toLowerCase();
  if (!f.extensions.includes(ext.slice(1))) {
    // keep the kind the user chose: replace another known extension, or add the right one
    if (KNOWN_EXT.includes(ext)) p = p.slice(0, -ext.length);
    p += '.' + f.extensions[0];
  }
  return { path: p, name: path.basename(p) };
});

ipcMain.handle('fs:write', async (_e, p, bytes) => {
  const tmp = p + '.part';
  try {
    await fs.promises.writeFile(tmp, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    await fs.promises.rename(tmp, p);
  } catch (err) {
    try { await fs.promises.rm(tmp, { force: true }); } catch { /* ignore */ }
    if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
      throw new Error(`${path.basename(p)} is open in another program or the folder is read-only. Close it, or save under another name.`);
    }
    if (err.code === 'ENOSPC') throw new Error('The disk is full.');
    throw err;
  }
  return true;
});

ipcMain.handle('app:startup-file', async (e) => {
  const t = tabOf(e);
  if (!t || !t.startupPath) return null;
  const p = t.startupPath;
  t.startupPath = null;
  try { return readForRenderer(p); } catch { return null; }
});

ipcMain.on('app:close-ack', (e) => { const t = tabOf(e); if (t) clearTimeout(t.closeTimer); });
ipcMain.on('app:close-cancel', (e) => {
  const t = tabOf(e);
  if (!t) return;
  clearTimeout(t.closeTimer);
  t.win.closing = false;
});
ipcMain.on('app:quit', (e) => { const t = tabOf(e); if (t) removeTab(t); });
ipcMain.on('app:set-title', (e, info) => {
  const t = tabOf(e);
  if (!t) return;
  t.title = info.text;
  t.name = info.name || '';
  t.unsaved = !!info.unsaved;
  if (t.win.active === t && !t.win.win.isDestroyed()) t.win.win.setTitle(t.title);
  sendStrip(t.win);
});
ipcMain.on('shell:show', (_e, p) => { try { shell.showItemInFolder(p); } catch { /* ignore */ } });
// Preferences: interface size for every window (kept for the next start)
function applyUiZoom(rec) {
  if (rec.win.isDestroyed()) return;
  if (!rec.win.webContents.isDestroyed()) rec.win.webContents.setZoomFactor(uiZoom);
  for (const t of rec.tabs) if (!t.view.webContents.isDestroyed()) t.view.webContents.setZoomFactor(uiZoom);
  try { rec.win.setTitleBarOverlay({ color: '#F3F4F1', symbolColor: '#2B302D', height: stripH() }); } catch { /* not on this system */ }
  layout(rec);
}
ipcMain.on('ui:zoom', (_e, z) => {
  z = Number(z);
  if (!(z >= 0.8 && z <= 1.5) || z === uiZoom) return;
  uiZoom = z;
  try { fs.writeFileSync(uiStateFile(), JSON.stringify({ zoom: z })); } catch { /* this session only */ }
  for (const rec of wins.values()) applyUiZoom(rec);
});
ipcMain.handle('ui:zoom-get', () => uiZoom);
// the part of a drawing's page that its markups window covers (page pixels), so the drawing can show a
// markup beside the window rather than under it; null when the window is not open or not in front of it
ipcMain.handle('markups:cover', (e) => {
  const t = tabOf(e);
  const w = t && t.markupsWin;
  if (!w || w.isDestroyed() || !w.isVisible() || t.win.win.isDestroyed()) return null;
  const cb = t.win.win.getContentBounds(), vb = t.view.getBounds(), pb = w.getBounds();
  return { x: pb.x - cb.x - vb.x, y: pb.y - cb.y - vb.y, width: pb.width, height: pb.height };
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

// ---- crash recovery: each tab keeps a copy of its project in the user data folder
// <key>.plantint is the project, <key>.json says its name and time. A copy whose tab is no longer
// open (the app closed or crashed) is offered to the next drawing that starts.
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
const keyOf = (e) => { const t = tabOf(e); return t ? t.key : null; };

ipcMain.handle('recovery:write', async (e, bytes, meta) => {
  const key = keyOf(e);
  if (!key) return false;
  const d = recoveryDir();
  await fs.promises.mkdir(d, { recursive: true });
  const file = path.join(d, key + '.plantint');
  await fs.promises.writeFile(file + '.part', Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  await fs.promises.rename(file + '.part', file);
  await fs.promises.writeFile(path.join(d, key + '.json'), JSON.stringify(meta));
  return true;
});

ipcMain.handle('recovery:read', async (e) => {
  const key = keyOf(e);
  if (!key) return null;
  try {
    const d = recoveryDir();
    // copies of tabs that are still open belong to them; this tab's own copy is restored after a reload
    const live = new Set([...tabs.values()].map((t) => t.key));
    let best = null;
    for (const n of await fs.promises.readdir(d)) {
      if (!n.endsWith('.json')) continue;
      const id = n.slice(0, -'.json'.length);
      if (live.has(id) && id !== key) continue;
      try { await fs.promises.access(path.join(d, id + '.plantint')); } catch { continue; }
      let meta;
      try { meta = JSON.parse(await fs.promises.readFile(path.join(d, n), 'utf8')); } catch { continue; }
      if (!best || String(meta.time) > String(best.meta.time)) best = { id, meta };
    }
    if (!best) return null;
    if (best.id !== key) {
      // take the copy over, so it belongs to this tab and is cleared when this tab saves or closes
      await fs.promises.rename(path.join(d, best.id + '.plantint'), path.join(d, key + '.plantint'));
      await fs.promises.rename(path.join(d, best.id + '.json'), path.join(d, key + '.json'));
    }
    const data = await fs.promises.readFile(path.join(d, key + '.plantint'));
    return { meta: best.meta, bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch { return null; }
});

ipcMain.handle('recovery:clear', async (e) => {
  const key = keyOf(e);
  if (!key) return true;
  for (const n of [key + '.plantint', key + '.plantint.part', key + '.json']) {
    try { await fs.promises.rm(path.join(recoveryDir(), n), { force: true }); } catch { /* ignore */ }
  }
  return true;
});
