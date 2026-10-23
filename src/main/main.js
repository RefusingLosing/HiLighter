'use strict';
// PlanTint — Electron main process.
// Owns the windows, native file dialogs, file IO and the close/save handshake with each window.
// Every window is an independent drawing: its own page, marking, scale and crash-recovery copy.

const { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen, Menu } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const RENDERER_DIR = path.join(__dirname, 'renderer');
const OPENABLE = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif', '.webp', '.plantint'];

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

// Per-window state, keyed by the window's id.
//   key: names this window's crash-recovery copy; allowClose: set once the window may close;
//   closeTimer: the "not responding" fallback; startupPath: a file to open when the window starts.
const state = new Map();
const windowOf = (e) => BrowserWindow.fromWebContents(e.sender);
const stateOf = (e) => {
  const w = windowOf(e);
  return w ? state.get(w.id) || null : null;
};

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
  // A second launch (for example a double-click on a drawing) opens its file in a window of its own.
  // Without a file it brings the most recent window forward.
  app.on('second-instance', (_e, argv) => {
    app.whenReady().then(() => {
      const f = fileFromArgv(argv);
      if (f) { createWindow(f); return; }
      const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!w) { createWindow(); return; }
      if (w.isMinimized()) w.restore();
      w.focus();
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
    titleBarOverlay: { color: '#F3F4F1', symbolColor: '#2B302D', height: 44 },
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
  const id = win.id;
  const st = { key: 'w-' + crypto.randomUUID(), allowClose: false, closeTimer: null, startupPath };
  state.set(id, st);

  win.once('ready-to-show', () => {
    if (wa.width <= 1920) win.maximize();
    win.show();
  });

  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', (e) => {
    if (st.allowClose) return;
    e.preventDefault();
    win.webContents.send('app:close-request');
    // If the page never answers (hung), fall back to a native question so the user can always leave.
    clearTimeout(st.closeTimer);
    st.closeTimer = setTimeout(() => {
      const r = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Close without saving', 'Keep waiting'],
        defaultId: 1,
        cancelId: 1,
        title: 'PlanTint',
        message: 'PlanTint is not responding.',
        detail: 'Close the window anyway? Unsaved marking will be lost.',
      });
      if (r === 0) { st.allowClose = true; win.close(); }
    }, 5000);
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'error',
      buttons: ['Restart PlanTint', 'Close'],
      defaultId: 0,
      title: 'PlanTint',
      message: 'PlanTint stopped unexpectedly.',
      detail: 'Your last copy of unsaved work will be offered when it restarts.',
    });
    if (r === 0) win.reload(); else { st.allowClose = true; win.close(); }
  });

  win.on('closed', () => {
    clearTimeout(st.closeTimer);
    state.delete(id);
  });
  win.loadURL('app://bundle/index.html');
  return win;
}

app.whenReady().then(() => {
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

// ---------------------------------------------------------------- IPC

ipcMain.on('window:new', () => createWindow());

ipcMain.handle('dlg:open', async (e) => {
  const r = await dialog.showOpenDialog(windowOf(e), {
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
  return readForRenderer(r.filePaths[0]);
});

ipcMain.handle('fs:read', async (_e, p) => readForRenderer(p));

const SAVE_FILTERS = {
  plantint: { name: 'PlanTint project', extensions: ['plantint'] },
  pdf: { name: 'PDF document', extensions: ['pdf'] },
  pdfflat: { name: 'PDF document (flattened)', extensions: ['pdf'] },
  png: { name: 'PNG picture', extensions: ['png'] },
  jpg: { name: 'JPEG picture', extensions: ['jpg', 'jpeg'] },
  xlsx: { name: 'Excel workbook', extensions: ['xlsx'] },
  csv: { name: 'CSV (comma separated)', extensions: ['csv'] },
};
const KNOWN_EXT = ['.plantint', '.pdf', '.png', '.jpg', '.jpeg', '.xlsx', '.csv'];

/** Asks where to save one kind of file. The kind is chosen in the app before this. */
ipcMain.handle('dlg:save', async (e, opts) => {
  const f = SAVE_FILTERS[opts.type] || SAVE_FILTERS.plantint;
  const r = await dialog.showSaveDialog(windowOf(e), {
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
  const st = stateOf(e);
  if (!st || !st.startupPath) return null;
  const p = st.startupPath;
  st.startupPath = null;
  try { return readForRenderer(p); } catch { return null; }
});

ipcMain.on('app:close-ack', (e) => {
  const st = stateOf(e);
  if (st) clearTimeout(st.closeTimer);
});
ipcMain.on('app:quit', (e) => {
  const w = windowOf(e);
  const st = w && state.get(w.id);
  if (!w || !st) return;
  clearTimeout(st.closeTimer);
  st.allowClose = true;
  w.close();
});
ipcMain.on('app:set-title', (e, t) => { const w = windowOf(e); if (w) w.setTitle(t); });
ipcMain.on('shell:show', (_e, p) => { try { shell.showItemInFolder(p); } catch { /* ignore */ } });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

// ---- crash recovery: each window keeps a copy of its project in the user data folder
// <key>.plantint is the project, <key>.json says its name and time. A copy whose window is no
// longer open (the app closed or crashed) is offered to the next window that starts.
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
const recoveryKey = (e) => { const st = stateOf(e); return st ? st.key : null; };

ipcMain.handle('recovery:write', async (e, bytes, meta) => {
  const key = recoveryKey(e);
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
  const key = recoveryKey(e);
  if (!key) return null;
  try {
    const d = recoveryDir();
    // copies of windows that are still open belong to them; this window's own copy is restored after a reload
    const live = new Set([...state.values()].map((s) => s.key));
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
      // take the copy over, so it belongs to this window and is cleared when this window saves or closes
      await fs.promises.rename(path.join(d, best.id + '.plantint'), path.join(d, key + '.plantint'));
      await fs.promises.rename(path.join(d, best.id + '.json'), path.join(d, key + '.json'));
    }
    const data = await fs.promises.readFile(path.join(d, key + '.plantint'));
    return { meta: best.meta, bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch { return null; }
});

ipcMain.handle('recovery:clear', async (e) => {
  const key = recoveryKey(e);
  if (!key) return true;
  for (const n of [key + '.plantint', key + '.plantint.part', key + '.json']) {
    try { await fs.promises.rm(path.join(recoveryDir(), n), { force: true }); } catch { /* ignore */ }
  }
  return true;
});
