const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the HTTPS-only failure interstitial.
contextBridge.exposeInMainWorld('interstitial', {
  proceed: () => ipcRenderer.send('interstitial:continue'),
  back: () => ipcRenderer.send('interstitial:back'),
  onShow: (cb) => ipcRenderer.on('interstitial', (_e, data) => cb(data)),
});
