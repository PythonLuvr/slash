const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the top-right popover layer (menu / profile / downloads).
contextBridge.exposeInMainWorld('overlay', {
  newTab: () => ipcRenderer.send('tab:new'),
  reopenTab: () => ipcRenderer.send('tab:reopen'),
  zoom: (dir) => ipcRenderer.send('zoom', dir),
  toggleAI: () => ipcRenderer.send('toggle-ai'),
  openSettings: () => ipcRenderer.send('open-settings'),
  openDownload: (id) => ipcRenderer.send('download:open', id),
  openHistory: () => ipcRenderer.send('pop:history'),
  openFind: () => ipcRenderer.send('find:show'),
  openUrl: (url) => ipcRenderer.send('hero:open', { url }),
  clearHistory: () => ipcRenderer.send('history:clear'),
  close: () => ipcRenderer.send('pop:close'),
  onShow: (cb) => ipcRenderer.on('pop:show', (_e, kind) => cb(kind)),
  onDownloads: (cb) => ipcRenderer.on('downloads', (_e, list) => cb(list)),
  onHistory: (cb) => ipcRenderer.on('history', (_e, list) => cb(list)),
});
