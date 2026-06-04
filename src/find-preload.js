const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the find-in-page bar.
contextBridge.exposeInMainWorld('find', {
  query: (text, forward) => ipcRenderer.send('find:query', { text, forward }),
  next: (forward) => ipcRenderer.send('find:next', forward),
  close: () => ipcRenderer.send('find:close'),
  onResult: (cb) => ipcRenderer.on('find:result', (_e, r) => cb(r)),
});
