const { contextBridge, ipcRenderer } = require('electron');

// Make the <browser-action> element available so the extensions dropdown can
// render per-extension action buttons (and open their popups) in this popover
// layer. Best-effort; needs this preload to run unsandboxed (see makeView).
try {
  require('electron-chrome-extensions/browser-action').injectBrowserAction();
} catch {
  /* extensions unavailable */
}

// Bridge for the top-right popover layer (menu / profile / downloads).
contextBridge.exposeInMainWorld('overlay', {
  newTab: () => ipcRenderer.send('tab:new'),
  newPrivateTab: () => ipcRenderer.send('tab:new-private'),
  reopenTab: () => ipcRenderer.send('tab:reopen'),
  zoom: (dir) => ipcRenderer.send('zoom', dir),
  toggleAI: () => ipcRenderer.send('toggle-ai'),
  openSettings: () => ipcRenderer.send('open-settings'),
  openSettingsPage: (section) => ipcRenderer.send('settings:open', section),
  openDownload: (id) => ipcRenderer.send('download:open', id),
  openHistory: () => ipcRenderer.send('pop:history'),
  openFind: () => ipcRenderer.send('find:show'),
  openUrl: (url) => ipcRenderer.send('hero:open', { url }),
  clearHistory: () => ipcRenderer.send('history:clear'),
  close: () => ipcRenderer.send('pop:close'),
  clearPermission: (origin, perm) => ipcRenderer.send('perm:clear', { origin, perm }),
  toggleBlocker: () => ipcRenderer.send('blocker:toggle'),
  stats: () => ipcRenderer.invoke('app:stats'),
  setRamLimit: (mb) => ipcRenderer.send('ram:set-limit', mb),
  profile: () => ipcRenderer.invoke('profile:get'),
  profilesList: () => ipcRenderer.invoke('profiles:list'),
  openProfileWindow: (id) => ipcRenderer.send('profile:open-window', id),
  createProfile: (name, color) => ipcRenderer.invoke('profiles:create', { name, color }),
  openSetup: () => ipcRenderer.send('pop:setup'),
  setSearchEngine: (id) => ipcRenderer.send('search:set', id),
  onEnginepick: (cb) => ipcRenderer.on('enginepick', (_e, data) => cb(data)),
  onTabmenu: (cb) => ipcRenderer.on('tabmenu', (_e, data) => cb(data)),
  tabAction: (action) => ipcRenderer.send('tab:action', action),
  favicon: (host) => ipcRenderer.invoke('favicon:get', host),
  // First-run setup picker (make default + import from another browser).
  setDefault: () => ipcRenderer.invoke('default:set'),
  migrateRun: (id, types) => ipcRenderer.invoke('migrate:run', { id, types }),
  onSetupDefault: (cb) => ipcRenderer.on('setup:default', (_e, isDef) => cb(isDef)),
  onSetupSources: (cb) => ipcRenderer.on('setup:sources', (_e, list) => cb(list)),
  // Extensions menu (puzzle dropdown): list + pinned set, and pin/unpin.
  extMenu: () => ipcRenderer.invoke('extensions:menu'),
  extSetPinned: (ids) => ipcRenderer.send('extensions:set-pinned', ids),
  onShow: (cb) => ipcRenderer.on('pop:show', (_e, kind) => cb(kind)),
  onDownloads: (cb) => ipcRenderer.on('downloads', (_e, list) => cb(list)),
  onHistory: (cb) => ipcRenderer.on('history', (_e, list) => cb(list)),
  onSiteinfo: (cb) => ipcRenderer.on('siteinfo', (_e, data) => cb(data)),
  onShield: (cb) => ipcRenderer.on('shield', (_e, data) => cb(data)),
});
