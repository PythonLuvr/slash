const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the left icon rail.
contextBridge.exposeInMainWorld('rail', {
  home: () => ipcRenderer.send('go-home'),
  newTab: () => ipcRenderer.send('tab:new'),
  toggleAI: () => ipcRenderer.send('toggle-ai'),
  onAiOpen: (cb) => ipcRenderer.on('ai-open', (_e, v) => cb(v)),
});
