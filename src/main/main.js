'use strict';
// PlanTint — Electron main process.
// Owns the window, native file dialogs, file IO and the close/save handshake with the renderer.

const { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen, Menu } = require('electron');
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

let win = null;
let allowClose = false;
let closeFallbackTimer = null;
let pendingOpenPath = null;

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
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('app:open-file', f);
    }
  });
}

function createWindow() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
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

  win.once('ready-to-show', () => {
    if (wa.width <= 1920) win.maximize();
    win.show();
  });

  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('app:close-request');
    // If the page never answers (hung), fall back to a native question so the user can always leave.
    clearTimeout(closeFallbackTimer);
    closeFallbackTimer = setTimeout(() => {
      const r = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Close without saving', 'Keep waiting'],
        defaultId: 1,
        cancelId: 1,
        title: 'PlanTint',
        message: 'PlanTint is not responding.',
        detail: 'Close the window anyway? Unsaved marking will be lost.',
      });
      if (r === 0) { allowClose = true; win.close(); }
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
    if (r === 0) win.reload(); else { allowClose = true; win.close(); }
  });

  win.on('closed', () => { win = null; });
  win.loadURL('app://bundle/index.html');
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
  pendingOpenPath = fileFromArgv(process.argv);
  createWindow();
});

app.on('window-all-closed', () => app.quit());

// ---------------------------------------------------------------- IPC

ipcMain.handle('dlg:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open a drawing or project',
    properties: ['openFile'],
    filters: [
      { name: 'Drawings and PlanTint projects', extensions: OPENABLE.map((e) => e.slice(1)) },
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
};
const KNOWN_EXT = ['.plantint', '.pdf', '.png', '.jpg', '.jpeg'];

/** Asks where to save one kind of file. The kind is chosen in the app before this. */
ipcMain.handle('dlg:save', async (_e, opts) => {
  const f = SAVE_FILTERS[opts.type] || SAVE_FILTERS.plantint;
  const r = await dialog.showSaveDialog(win, {
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

ipcMain.handle('app:startup-file', async () => {
  if (!pendingOpenPath) return null;
  const p = pendingOpenPath;
  pendingOpenPath = null;
  try { return readForRenderer(p); } catch { return null; }
});

ipcMain.on('app:close-ack', () => { clearTimeout(closeFallbackTimer); });
ipcMain.on('app:quit', () => {
  clearTimeout(closeFallbackTimer);
  allowClose = true;
  if (win) win.close();
});
ipcMain.on('app:set-title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.on('shell:show', (_e, p) => { try { shell.showItemInFolder(p); } catch { /* ignore */ } });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

// ---- crash recovery: a copy of the open project kept in the user data folder
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
ipcMain.handle('recovery:write', async (_e, bytes, meta) => {
  const d = recoveryDir();
  await fs.promises.mkdir(d, { recursive: true });
  await fs.promises.writeFile(path.join(d, 'session.plantint.part'), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  await fs.promises.rename(path.join(d, 'session.plantint.part'), path.join(d, 'session.plantint'));
  await fs.promises.writeFile(path.join(d, 'session.json'), JSON.stringify(meta));
  return true;
});
ipcMain.handle('recovery:read', async () => {
  try {
    const d = recoveryDir();
    const meta = JSON.parse(await fs.promises.readFile(path.join(d, 'session.json'), 'utf8'));
    const data = await fs.promises.readFile(path.join(d, 'session.plantint'));
    return { meta, bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch { return null; }
});
ipcMain.handle('recovery:clear', async () => {
  try { await fs.promises.rm(recoveryDir(), { recursive: true, force: true }); } catch { /* ignore */ }
  return true;
});
