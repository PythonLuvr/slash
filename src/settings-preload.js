const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the full-page settings surface.
contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  close: () => ipcRenderer.send('settings:close'),
  openAI: () => ipcRenderer.send('settings:open-ai'),
  onShow: (cb) => ipcRenderer.on('settings:show', () => cb()),
});
