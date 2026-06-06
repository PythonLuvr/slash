const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the left performance panel: read live memory stats, set the cap.
contextBridge.exposeInMainWorld('perf', {
  stats: () => ipcRenderer.invoke('app:stats'),
  setRamLimit: (mb) => ipcRenderer.send('ram:set-limit', mb),
});
