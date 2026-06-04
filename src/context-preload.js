const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the right-click context-menu layer. Main builds the item list
// (it depends on what was clicked) and sends it in; the renderer just draws
// it and reports which item fired.
contextBridge.exposeInMainWorld('ctx', {
  invoke: (id) => ipcRenderer.send('ctx:invoke', id),
  close: () => ipcRenderer.send('ctx:close'),
  onItems: (cb) => ipcRenderer.on('ctx:items', (_e, items) => cb(items)),
});
