'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('plantint', {
  openDialog: () => ipcRenderer.invoke('dlg:open'),
  readFile: (p) => ipcRenderer.invoke('fs:read', p),
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
  // tabs: a new drawing, closing the shown one, switching, and the tab strip
  newTab: () => ipcRenderer.send('tabs:new'),
  closeTab: () => ipcRenderer.send('tabs:close-current'),
  switchTab: (dir) => ipcRenderer.send('tabs:switch', dir),
  tabsReady: () => ipcRenderer.send('tabs:ready'),
  activateTab: (id) => ipcRenderer.send('tabs:activate', id),
  closeTabById: (id) => ipcRenderer.send('tabs:close', id),
  onTabs: (cb) => ipcRenderer.on('tabs:update', (_e, list) => cb(list)),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  recoveryWrite: (bytes, meta) => ipcRenderer.invoke('recovery:write', bytes, meta),
  recoveryRead: () => ipcRenderer.invoke('recovery:read'),
  recoveryClear: () => ipcRenderer.invoke('recovery:clear'),
});
