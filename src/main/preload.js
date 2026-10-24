'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('plantint', {
  openDialog: (opts) => ipcRenderer.invoke('dlg:open', opts),
  readFile: (p) => ipcRenderer.invoke('fs:read', p),
  openPhoto: () => ipcRenderer.invoke('dlg:photo'),
  saveDialog: (opts) => ipcRenderer.invoke('dlg:save', opts),
  writeFile: (p, bytes) => ipcRenderer.invoke('fs:write', p, bytes),
  startupFile: () => ipcRenderer.invoke('app:startup-file'),
  info: () => ipcRenderer.invoke('app:info'),
  setTitle: (info) => ipcRenderer.send('app:set-title', info),
  showInFolder: (p) => ipcRenderer.send('shell:show', p),
  closeAck: () => ipcRenderer.send('app:close-ack'),
  quit: () => ipcRenderer.send('app:quit'),
  onCloseRequest: (cb) => ipcRenderer.on('app:close-request', () => cb()),
  closeCancel: () => ipcRenderer.send('app:close-cancel'),
  // tabs (the main process handles Ctrl+N, Ctrl+W and Ctrl+Tab itself): the strip, and a drawing beside this one
  newTab: () => ipcRenderer.send('tabs:new'),
  tabKey: (k, shift) => ipcRenderer.send('tabs:key', k, shift),
  openInNewTab: (p) => ipcRenderer.send('tabs:open', p),
  tabsReady: () => ipcRenderer.send('tabs:ready'),
  activateTab: (id) => ipcRenderer.send('tabs:activate', id),
  closeTabById: (id) => ipcRenderer.send('tabs:close', id),
  onTabs: (cb) => ipcRenderer.on('tabs:update', (_e, list) => cb(list)),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  recoveryWrite: (bytes, meta) => ipcRenderer.invoke('recovery:write', bytes, meta),
  recoveryRead: () => ipcRenderer.invoke('recovery:read'),
  recoveryClear: () => ipcRenderer.invoke('recovery:clear'),
  markupsCover: () => ipcRenderer.invoke('markups:cover'),
});
