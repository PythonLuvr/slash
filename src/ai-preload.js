const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the docked AI panel: send messages, stream replies, and
// read / write local settings (model selection + BYOK API keys).
contextBridge.exposeInMainWorld('ai', {
  send: (payload) => ipcRenderer.send('ai:send', payload),
  onDelta: (cb) => ipcRenderer.on('ai:delta', (_e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('ai:done', (_e, d) => cb(d)),
  onError: (cb) => ipcRenderer.on('ai:error', (_e, d) => cb(d)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  onPrompt: (cb) => ipcRenderer.on('ai:prompt', (_e, text) => cb(text)),
});
