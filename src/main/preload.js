'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('plantint', {
  openDialog: () => ipcRenderer.invoke('dlg:open'),
  readFile: (p) => ipcRenderer.invoke('fs:read', p),
  saveDialog: (opts) => ipcRenderer.invoke('dlg:save', opts),
  writeFile: (p, bytes) => ipcRenderer.invoke('fs:write', p, bytes),
  startupFile: () => ipcRenderer.invoke('app:startup-file'),
  info: () => ipcRenderer.invoke('app:info'),
  setTitle: (t) => ipcRenderer.send('app:set-title', t),
  showInFolder: (p) => ipcRenderer.send('shell:show', p),
  closeAck: () => ipcRenderer.send('app:close-ack'),
  quit: () => ipcRenderer.send('app:quit'),
  onCloseRequest: (cb) => ipcRenderer.on('app:close-request', () => cb()),
  onOpenFile: (cb) => ipcRenderer.on('app:open-file', (_e, p) => cb(p)),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  recoveryWrite: (bytes, meta) => ipcRenderer.invoke('recovery:write', bytes, meta),
  recoveryRead: () => ipcRenderer.invoke('recovery:read'),
  recoveryClear: () => ipcRenderer.invoke('recovery:clear'),
});
