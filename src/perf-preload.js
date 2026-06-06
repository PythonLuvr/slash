const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the left performance panel: read live stats, set the cap, act on tabs.
contextBridge.exposeInMainWorld('perf', {
  stats: () => ipcRenderer.invoke('app:stats'),
  setRamLimit: (mb) => ipcRenderer.send('ram:set-limit', mb),
  freeNow: () => ipcRenderer.send('ram:free-now'),
  sleepTab: (id) => ipcRenderer.send('ram:sleep-tab', id),
  activateTab: (id) => ipcRenderer.send('tab:activate', id),
});
