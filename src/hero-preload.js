const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the trusted speed-dial start page.
contextBridge.exposeInMainWorld('hero', {
  search: (engine, query) => ipcRenderer.send('hero:search', { engine, query }),
  open: (url) => ipcRenderer.send('hero:open', { url }),
  openAI: () => ipcRenderer.send('open-ai'),
  askAI: (text, provider) => ipcRenderer.send('hero:ask-ai', { text, provider }),
  getProviders: () => ipcRenderer.invoke('providers:get'),
  suggest: (q) => ipcRenderer.invoke('suggest:get', q),
  favicon: (host) => ipcRenderer.invoke('favicon:get', host),
  searchGet: () => ipcRenderer.invoke('search:get'),
  setSearchEngine: (id) => ipcRenderer.send('search:set', id),
  setHeroEngines: (ids) => ipcRenderer.send('hero:engines-set', ids),
  onSearchEngine: (cb) => ipcRenderer.on('search-engine', (_e, id) => cb(id)),
  onHeroEngines: (cb) => ipcRenderer.on('hero-engines', (_e, ids) => cb(ids)),
  onAddDial: (cb) => ipcRenderer.on('hero:add-dial', (_e, d) => cb(d)),
});
