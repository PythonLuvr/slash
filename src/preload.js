const { contextBridge, ipcRenderer } = require('electron');

// The only surface our chrome UI (tab strip + toolbar) can touch in main.
contextBridge.exposeInMainWorld('slash', {
  // navigation
  navigate: (input) => ipcRenderer.invoke('navigate', input),
  back: () => ipcRenderer.send('back'),
  forward: () => ipcRenderer.send('forward'),
  reload: () => ipcRenderer.send('reload'),
  stop: () => ipcRenderer.send('stop'),
  goHome: () => ipcRenderer.send('go-home'),
  toggleAI: () => ipcRenderer.send('toggle-ai'),
  togglePerf: () => ipcRenderer.send('toggle-perf'),
  openSettings: () => ipcRenderer.send('open-settings'),
  zoom: (dir) => ipcRenderer.send('zoom', dir),
  ready: () => ipcRenderer.send('ready'),
  // tabs
  newTab: () => ipcRenderer.send('tab:new'),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  activateTab: (id) => ipcRenderer.send('tab:activate', id),
  reopenTab: () => ipcRenderer.send('tab:reopen'),
  // top-right cluster popovers (rendered in the popover layer)
  togglePop: (kind) => ipcRenderer.send('pop:toggle', kind),
  // bookmarks
  toggleBookmark: () => ipcRenderer.send('bookmark:toggle'),
  removeBookmark: (url) => ipcRenderer.send('bookmark:remove', url),
  openUrl: (url) => ipcRenderer.send('hero:open', { url }),
  // events
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onProfileWindow: (cb) => ipcRenderer.on('profile-window', (_e, p) => cb(p)),
  onTabs: (cb) => ipcRenderer.on('tabs', (_e, list) => cb(list)),
  onBookmarks: (cb) => ipcRenderer.on('bookmarks', (_e, list) => cb(list)),
  onFocusOmnibox: (cb) => ipcRenderer.on('focus-omnibox', () => cb()),
  onBlocked: (cb) => ipcRenderer.on('blocked', (_e, d) => cb(d)),
  // Generic infobar strip (first-run default prompt, update notices, ...)
  onInfobar: (cb) => ipcRenderer.on('infobar:show', (_e, p) => cb(p)),
  onInfobarHide: (cb) => ipcRenderer.on('infobar:hide', () => cb()),
  infobarAction: (id, key) => ipcRenderer.send('infobar:action', { id, key }),
  favicon: (host) => ipcRenderer.invoke('favicon:get', host),
  profile: () => ipcRenderer.invoke('profile:get'),
  searchGet: () => ipcRenderer.invoke('search:get'),
  onSearchEngine: (cb) => ipcRenderer.on('search-engine', (_e, id) => cb(id)),
  onSearchList: (cb) => ipcRenderer.on('search-list', (_e, list) => cb(list)),
  onAddEngine: (cb) => ipcRenderer.on('add-engine', (_e, info) => cb(info)),
  addCurrentEngine: () => ipcRenderer.invoke('engine:add-current'),
  tabMenu: (id, x, y) => ipcRenderer.send('tab:menu', { id, x, y }),
});
