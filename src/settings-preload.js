const { contextBridge, ipcRenderer } = require('electron');

// Bridge for the full-page settings surface.
contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  close: () => ipcRenderer.send('settings:close'),
  openAI: () => ipcRenderer.send('settings:open-ai'),
  onShow: (cb) => ipcRenderer.on('settings:show', (_e, section) => cb(section)),
  defaultStatus: () => ipcRenderer.invoke('default:status'),
  setDefault: () => ipcRenderer.invoke('default:set'),
  favicon: (host) => ipcRenderer.invoke('favicon:get', host),
  searchGet: () => ipcRenderer.invoke('search:get'),
  setHeroEngines: (ids) => ipcRenderer.send('hero:engines-set', ids),
  addEngine: (label, url) => ipcRenderer.invoke('engine:add', { label, url }),
  removeEngine: (id) => ipcRenderer.invoke('engine:remove', id),
  clearData: (opts) => ipcRenderer.invoke('data:clear', opts),
  extLoad: () => ipcRenderer.invoke('extensions:load'),
  extList: () => ipcRenderer.invoke('extensions:list'),
  extRemove: (id) => ipcRenderer.invoke('extensions:remove', id),
  extStore: () => ipcRenderer.invoke('extensions:store'),
  profilesList: () => ipcRenderer.invoke('profiles:list'),
  profilesCreate: (name, color) => ipcRenderer.invoke('profiles:create', { name, color }),
  profilesRename: (id, name) => ipcRenderer.invoke('profiles:rename', { id, name }),
  profilesRecolor: (id, color) => ipcRenderer.invoke('profiles:recolor', { id, color }),
  profilesDelete: (id) => ipcRenderer.invoke('profiles:delete', id),
  openProfileWindow: (id) => ipcRenderer.send('profile:open-window', id),
  // Migration (bookmarks / history / cookies) from another browser.
  migrateSources: () => ipcRenderer.invoke('migrate:sources'),
  migrateRun: (id, types) => ipcRenderer.invoke('migrate:run', { id, types }),
  // Password vault.
  vaultList: () => ipcRenderer.invoke('vault:list'),
  vaultCount: () => ipcRenderer.invoke('vault:count'),
  vaultRemove: (host, username) => ipcRenderer.invoke('vault:remove', { host, username }),
  vaultImportCsv: () => ipcRenderer.invoke('vault:importCsv'),
});
