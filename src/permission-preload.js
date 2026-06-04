const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the permission prompt bubble. Main sends the request; the
// renderer reports the user's Allow / Block decision.
contextBridge.exposeInMainWorld('perm', {
  decide: (allow) => ipcRenderer.send('perm:decide', allow),
  onShow: (cb) => ipcRenderer.on('perm:show', (_e, req) => cb(req)),
});
