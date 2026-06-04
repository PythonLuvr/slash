const { app, BaseWindow, WebContentsView, ipcMain, Menu, session, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { readSettings, writeSettings } = require('./lib/settings');
const { STREAMERS } = require('./lib/api');
const store = require('./lib/store');

app.setName('Slash');

// Chrome = tab strip + toolbar + bookmarks bar. AI panel docks on the right.
const TABSTRIP_HEIGHT = 38;
const TOOLBAR_HEIGHT = 56;
const BOOKMARKS_HEIGHT = 34;
const CHROME_HEIGHT = TABSTRIP_HEIGHT + TOOLBAR_HEIGHT + BOOKMARKS_HEIGHT;
const FIND_W = 360;
const FIND_HEIGHT = 44;
const AI_WIDTH = 400;
const CTX_WIDTH = 244;
const CTX_ROW = 34; // .pop-item height in context.css
const CTX_SEP = 11; // .pop-sep height + margins
const CTX_FRAME = 12; // body padding (5+5) + border (1+1)
const AI_CWD = path.join(__dirname, '..', '.ai-scratch');

let win;
let chromeView; // tab strip + toolbar + bookmarks (trusted)
let heroView; // shared start page, shown for any tab that has not navigated
let aiView; // docked AI panel (trusted)
let popoverView; // top-right menu / profile / downloads / history layer (trusted)
let findView; // find-in-page bar (trusted), shown on Ctrl+F
let ctxView; // right-click context menu layer (trusted)
let popKind = null; // which popover is open, or null
let findOpen = false;
let findText = '';
let ctxOpen = false;
let ctxParams = null; // params from the last 'context-menu' event

// Popover sizes (the view is sized to the card).
const POP_SIZES = {
  menu: { w: 252, h: 436 },
  profile: { w: 250, h: 132 },
  downloads: { w: 270, h: 230 },
  history: { w: 380, h: 460 },
};

// Tab model. Each tab owns a WebContentsView (untrusted web content). A tab
// with `onHero: true` shows the shared heroView instead of its own page.
let tabs = []; // { id, view, title, url, favicon, onHero, canGoBack, canGoForward, loading }
let activeTabId = null;
let tabSeq = 0;
const closedStack = [];

function activeTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

const ENGINES = {
  duckduckgo: (q) => 'https://duckduckgo.com/?q=' + encodeURIComponent(q),
  google: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q),
  wikipedia: (q) => 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(q),
};

const PROVIDERS = {
  claude: {
    label: 'Claude',
    domain: 'claude.ai',
    cli: { binary: 'claude', adapter: 'claude-code', args: ['-p', '--output-format', 'stream-json', '--verbose'] },
    api: { kind: 'anthropic' },
  },
  gemini: {
    label: 'Gemini',
    domain: 'gemini.google.com',
    cli: { binary: 'gemini', adapter: 'gemini-cli', args: ['-m', 'gemini-2.5-flash'] },
    api: { kind: 'google' },
  },
  openai: {
    label: 'ChatGPT',
    domain: 'chatgpt.com',
    cli: { binary: 'codex', adapter: 'text-stream', args: ['exec'] },
    api: { kind: 'openai' },
  },
};

const SYSTEM =
  'You are Slash, the built-in assistant inside a personal web browser. ' +
  'Answer conversationally and concisely. Do not use tools or edit files unless explicitly asked.';

let aiOpen = false;

function normalizeInput(input) {
  const text = (input || '').trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  if (/^[^\s]+\.[^\s]+$/.test(text)) return 'https://' + text;
  return 'https://www.google.com/search?q=' + encodeURIComponent(text);
}

// --- Themeable accent: inject the user's accent into every chrome view ---
function hexToRgb(hex) {
  const m = (hex || '').replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const int = parseInt(n || 'e8232e', 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function lighten(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const L = (v) => Math.min(255, Math.round(v + (255 - v) * amt));
  return '#' + [L(r), L(g), L(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const accentKeys = new Map(); // view -> inserted-CSS key
async function applyAccent(view) {
  if (!view) return;
  const accent = readSettings().accent;
  const css = `:root{--accent:${accent} !important;--accent-hover:${lighten(accent, 0.15)} !important;--accent-soft:${rgba(accent, 0.16)} !important;}`;
  try {
    const prev = accentKeys.get(view);
    if (prev) await view.webContents.removeInsertedCSS(prev);
    accentKeys.set(view, await view.webContents.insertCSS(css));
  } catch {
    /* view not ready */
  }
}
function broadcastAccent() {
  for (const v of [chromeView, heroView, aiView, popoverView, findView, ctxView]) applyAccent(v);
}

// --- Downloads ---
const downloads = [];
let dlSeq = 0;
function sendDownloads() {
  if (!popoverView) return;
  popoverView.webContents.send(
    'downloads',
    downloads.map((d) => ({ id: d.id, name: d.name, state: d.state, received: d.received, total: d.total })),
  );
}
function setupDownloads() {
  session.defaultSession.on('will-download', (_e, item) => {
    const id = ++dlSeq;
    const d = { id, name: item.getFilename(), state: 'progressing', path: '', received: 0, total: item.getTotalBytes() };
    downloads.unshift(d);
    sendDownloads();
    item.on('updated', () => {
      d.received = item.getReceivedBytes();
      sendDownloads();
    });
    item.once('done', (_ev, state) => {
      d.state = state;
      d.path = item.getSavePath();
      sendDownloads();
    });
  });
}

// --- State to the chrome UI ---
function sendState() {
  if (!chromeView) return;
  const at = activeTab();
  const onHero = !!(at && at.onHero);
  chromeView.webContents.send('state', {
    mode: onHero ? 'hero' : 'page',
    aiOpen,
    url: at && !onHero ? at.view.webContents.getURL() : '',
    title: at ? at.title : 'Slash',
    canGoBack: at ? at.canGoBack : false,
    canGoForward: at ? at.canGoForward : false,
    loading: at ? at.loading : false,
    bookmarked: at && !onHero ? store.isBookmarked(at.view.webContents.getURL()) : false,
  });
}

function sendTabs() {
  if (!chromeView) return;
  chromeView.webContents.send(
    'tabs',
    tabs.map((t) => ({
      id: t.id,
      title: t.onHero ? 'New tab' : t.title || t.url || 'Loading',
      favicon: t.onHero ? null : t.favicon,
      active: t.id === activeTabId,
      loading: t.loading,
    })),
  );
}

// --- Layout / visibility ---
function layout() {
  const { width, height } = win.getContentBounds();
  chromeView.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT });
  const top = CHROME_HEIGHT;
  const ch = Math.max(0, height - CHROME_HEIGHT);
  const aiW = aiOpen ? Math.min(AI_WIDTH, Math.floor(width * 0.5)) : 0;
  const mainW = Math.max(0, width - aiW);
  heroView.setBounds({ x: 0, y: top, width: mainW, height: ch });
  for (const t of tabs) t.view.setBounds({ x: 0, y: top, width: mainW, height: ch });
  aiView.setBounds({ x: width - aiW, y: top, width: aiW, height: ch });
  if (popKind && popoverView) {
    const s = POP_SIZES[popKind];
    popoverView.setBounds({ x: Math.max(0, width - s.w - 10), y: CHROME_HEIGHT, width: s.w, height: s.h });
  }
  if (findOpen && findView) {
    findView.setBounds({
      x: Math.max(0, width - aiW - FIND_W - 16),
      y: CHROME_HEIGHT + 8,
      width: FIND_W,
      height: FIND_HEIGHT,
    });
  }
}

function updateContentVisibility() {
  const at = activeTab();
  heroView.setVisible(!!at && at.onHero);
  for (const t of tabs) t.view.setVisible(!!at && t.id === at.id && !at.onHero);
}

// Keep the toolbar and AI panel above all tab content. Remove-then-add so a
// re-stack can never duplicate a child view.
function raiseChrome() {
  for (const v of [aiView, chromeView, popoverView, findView, ctxView]) {
    if (!v) continue;
    win.contentView.removeChildView(v);
    win.contentView.addChildView(v);
  }
}

// --- Find-in-page ---
function showFind() {
  findOpen = true;
  layout();
  findView.setVisible(true);
  findView.webContents.focus();
}
function hideFind() {
  findOpen = false;
  if (findView) findView.setVisible(false);
  const at = activeTab();
  if (at) at.view.webContents.stopFindInPage('clearSelection');
}

// --- Right-click context menu ---
// The item list depends on what was clicked (link / image / selection /
// editable / plain page), built from the Electron `context-menu` params.
function activePageWc() {
  const at = activeTab();
  return at && !at.onHero ? at.view.webContents : null;
}

function buildContextMenu(p) {
  const items = [];
  const has = (s) => typeof s === 'string' && s.length > 0;
  const wc = activePageWc();

  if (has(p.linkURL)) {
    items.push({ id: 'open-link', label: 'Open link in new tab' });
    items.push({ id: 'copy-link', label: 'Copy link address' });
  }
  if (p.mediaType === 'image' && has(p.srcURL)) {
    if (items.length) items.push({ sep: true });
    items.push({ id: 'open-image', label: 'Open image in new tab' });
    items.push({ id: 'save-image', label: 'Save image' });
    items.push({ id: 'copy-image', label: 'Copy image' });
    items.push({ id: 'copy-image-addr', label: 'Copy image address' });
  }
  if (p.isEditable) {
    if (items.length) items.push({ sep: true });
    const f = p.editFlags || {};
    items.push({ id: 'cut', label: 'Cut', kbd: 'Ctrl+X', disabled: !f.canCut });
    items.push({ id: 'copy', label: 'Copy', kbd: 'Ctrl+C', disabled: !f.canCopy });
    items.push({ id: 'paste', label: 'Paste', kbd: 'Ctrl+V', disabled: !f.canPaste });
    items.push({ id: 'select-all', label: 'Select all', kbd: 'Ctrl+A', disabled: !f.canSelectAll });
  } else if (has(p.selectionText)) {
    if (items.length) items.push({ sep: true });
    items.push({ id: 'copy', label: 'Copy', kbd: 'Ctrl+C' });
    const q = p.selectionText.trim().replace(/\s+/g, ' ');
    const short = q.length > 24 ? q.slice(0, 24) + '…' : q;
    items.push({ id: 'search-sel', label: `Search the web for "${short}"` });
  }

  if (items.length) items.push({ sep: true });
  items.push({ id: 'back', label: 'Back', disabled: !(wc && wc.navigationHistory.canGoBack()) });
  items.push({ id: 'forward', label: 'Forward', disabled: !(wc && wc.navigationHistory.canGoForward()) });
  items.push({ id: 'reload', label: 'Reload', disabled: !wc });
  items.push({ sep: true });
  items.push({ id: 'copy-page-url', label: 'Copy page address', disabled: !wc });
  items.push({ id: 'print', label: 'Print…', disabled: !wc });
  items.push({ sep: true });
  items.push({ id: 'view-source', label: 'View page source', disabled: !wc });
  items.push({ id: 'inspect', label: 'Inspect element', disabled: !wc });
  return items;
}

function showContext(params) {
  if (!ctxView) return;
  ctxParams = params;
  const items = buildContextMenu(params);
  let h = CTX_FRAME;
  for (const it of items) h += it.sep ? CTX_SEP : CTX_ROW;
  const { width, height } = win.getContentBounds();
  // params.x/y are relative to the page view, which sits at (0, CHROME_HEIGHT).
  let x = Math.max(4, Math.min(params.x, width - CTX_WIDTH - 4));
  let y = Math.max(CHROME_HEIGHT + 4, Math.min(params.y + CHROME_HEIGHT, height - h - 4));
  ctxView.setBounds({ x, y, width: CTX_WIDTH, height: h });
  ctxView.setVisible(true);
  win.contentView.removeChildView(ctxView);
  win.contentView.addChildView(ctxView); // keep it topmost
  ctxView.webContents.send('ctx:items', items);
  ctxView.webContents.focus();
  ctxOpen = true;
}

function hideContext() {
  if (!ctxView || !ctxOpen) return;
  ctxView.setVisible(false);
  ctxOpen = false;
  ctxParams = null;
}

function runCtxAction(id) {
  const p = ctxParams || {};
  const wc = activePageWc();
  switch (id) {
    case 'back':
      if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      break;
    case 'forward':
      if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      break;
    case 'reload':
      if (wc) wc.reload();
      break;
    case 'open-link':
      if (p.linkURL) createTab({ url: p.linkURL, activate: true });
      break;
    case 'copy-link':
      if (p.linkURL) clipboard.writeText(p.linkURL);
      break;
    case 'open-image':
      if (p.srcURL) createTab({ url: p.srcURL, activate: true });
      break;
    case 'save-image':
      if (wc && p.srcURL) wc.downloadURL(p.srcURL);
      break;
    case 'copy-image':
      if (wc) wc.copyImageAt(p.x || 0, p.y || 0);
      break;
    case 'copy-image-addr':
      if (p.srcURL) clipboard.writeText(p.srcURL);
      break;
    case 'cut':
      if (wc) wc.cut();
      break;
    case 'copy':
      if (wc) wc.copy();
      break;
    case 'paste':
      if (wc) wc.paste();
      break;
    case 'select-all':
      if (wc) wc.selectAll();
      break;
    case 'search-sel':
      if (p.selectionText) createTab({ url: ENGINES.google(p.selectionText.trim()), activate: true });
      break;
    case 'copy-page-url':
      if (wc) clipboard.writeText(wc.getURL());
      break;
    case 'print':
      if (wc) wc.print();
      break;
    case 'view-source':
      if (wc) createTab({ url: 'view-source:' + wc.getURL(), activate: true });
      break;
    case 'inspect':
      if (wc) wc.inspectElement(p.x || 0, p.y || 0);
      break;
  }
  hideContext();
}

// --- Bookmarks helpers ---
function sendBookmarks() {
  if (chromeView) chromeView.webContents.send('bookmarks', store.getBookmarks());
}

// --- Top-right popovers ---
function showPopover(kind) {
  const s = POP_SIZES[kind];
  if (!s) return;
  const { width } = win.getContentBounds();
  popoverView.setBounds({ x: Math.max(0, width - s.w - 10), y: CHROME_HEIGHT, width: s.w, height: s.h });
  popoverView.setVisible(true);
  popoverView.webContents.send('pop:show', kind);
  sendDownloads();
  if (kind === 'history') popoverView.webContents.send('history', store.getHistory().slice(0, 300));
  popoverView.webContents.focus();
  popKind = kind;
}
function hidePopover() {
  if (!popoverView) return;
  popoverView.setVisible(false);
  popKind = null;
}
function togglePopover(kind) {
  if (popKind === kind) hidePopover();
  else showPopover(kind);
}

// --- Tabs ---
function createTab(opts = {}) {
  const id = ++tabSeq;
  const view = new WebContentsView();
  const tab = {
    id,
    view,
    title: 'New tab',
    url: '',
    favicon: null,
    onHero: true,
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
  const wc = view.webContents;

  const refresh = () => {
    tab.url = wc.getURL();
    const t = wc.getTitle();
    if (t) tab.title = t;
    tab.canGoBack = wc.navigationHistory.canGoBack();
    tab.canGoForward = wc.navigationHistory.canGoForward();
    tab.loading = wc.isLoading();
    if (tab.url) tab.onHero = false;
    if (id === activeTabId) sendState();
    sendTabs();
  };
  for (const ev of [
    'did-navigate',
    'did-navigate-in-page',
    'did-start-loading',
    'did-stop-loading',
    'page-title-updated',
  ]) {
    wc.on(ev, refresh);
  }
  wc.on('page-favicon-updated', (_e, favs) => {
    tab.favicon = (favs && favs[0]) || null;
    sendTabs();
  });
  // History: record on real navigations, update the title when it resolves.
  wc.on('did-navigate', () => store.addHistory({ url: wc.getURL(), title: wc.getTitle() }));
  wc.on('page-title-updated', () => store.addHistory({ url: wc.getURL(), title: wc.getTitle() }));
  // Find-in-page match counts for this tab.
  wc.on('found-in-page', (_e, result) => {
    if (findView) {
      findView.webContents.send('find:result', {
        active: result.activeMatchOrdinal,
        total: result.matches,
      });
    }
  });
  // Right-click anywhere in the page opens our custom context menu.
  wc.on('context-menu', (_e, params) => {
    hidePopover();
    showContext(params);
  });
  // Links that open a new window become new tabs.
  wc.setWindowOpenHandler(({ url }) => {
    createTab({ url, activate: true });
    return { action: 'deny' };
  });
  attachShortcuts(wc);

  win.contentView.addChildView(view);
  view.setVisible(false);
  raiseChrome();

  tabs.push(tab);

  if (opts.url) {
    tab.onHero = false;
    wc.loadURL(normalizeInput(opts.url) || opts.url);
  }
  if (opts.activate !== false) activateTab(id);
  else sendTabs();
  layout();
  return id;
}

function activateTab(id) {
  if (!tabs.find((t) => t.id === id)) return;
  activeTabId = id;
  updateContentVisibility();
  sendState();
  sendTabs();
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];
  if (tab.url) closedStack.push(tab.url);
  win.contentView.removeChildView(tab.view);
  try {
    tab.view.webContents.close();
  } catch {
    /* already gone */
  }
  tabs.splice(idx, 1);

  if (activeTabId === id) {
    const next = tabs[idx] || tabs[idx - 1];
    if (next) activateTab(next.id);
    else createTab(); // never leave zero tabs
  } else {
    sendTabs();
  }
}

function reopenClosed() {
  const url = closedStack.pop();
  if (url) createTab({ url, activate: true });
}

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeTabId);
  const next = tabs[(i + dir + tabs.length) % tabs.length];
  activateTab(next.id);
}

function jumpTab(n) {
  const target = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
  if (target) activateTab(target.id);
}

function goHome() {
  const at = activeTab();
  if (!at) return;
  at.onHero = true;
  updateContentVisibility();
  sendState();
  sendTabs();
}

// --- AI panel ---
function toggleAI(force) {
  aiOpen = typeof force === 'boolean' ? force : !aiOpen;
  aiView.setVisible(aiOpen);
  layout();
  if (aiOpen) aiView.webContents.focus();
  sendState();
}

// --- Keyboard, attached to every view ---
function attachShortcuts(wc) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (!ctrl) return;
    const key = input.key.toLowerCase();
    const stop = () => event.preventDefault();

    if (key === 'j') return (toggleAI(), stop());
    if (key === 't' && !input.shift) return (createTab(), stop());
    if (key === 'w') return (activeTabId && closeTab(activeTabId), stop());
    if (key === 't' && input.shift) return (reopenClosed(), stop());
    if (key === 'tab') return (cycleTab(input.shift ? -1 : 1), stop());
    if (/^[1-9]$/.test(input.key)) return (jumpTab(parseInt(input.key, 10)), stop());
    if (key === 'f') return (showFind(), stop());
    if (key === 'd') {
      const at = activeTab();
      if (at && !at.onHero) {
        const url = at.view.webContents.getURL();
        if (store.isBookmarked(url)) store.removeBookmark(url);
        else store.addBookmark({ url, title: at.title });
        sendBookmarks();
        sendState();
      }
      return stop();
    }
    if (key === 'l') {
      chromeView.webContents.send('focus-omnibox');
      chromeView.webContents.focus();
      return stop();
    }
  });
}

function createWindow() {
  win = new BaseWindow({
    width: 1280,
    height: 860,
    title: 'Slash',
    backgroundColor: '#1c1c1f',
    icon: path.join(__dirname, 'icon.png'),
  });

  heroView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'hero-preload.js') },
  });
  win.contentView.addChildView(heroView);
  heroView.webContents.loadFile(path.join(__dirname, 'hero.html'));
  heroView.setVisible(false);

  aiView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'ai-preload.js') },
  });
  win.contentView.addChildView(aiView);
  aiView.webContents.loadFile(path.join(__dirname, 'ai.html'));
  aiView.setVisible(false);

  chromeView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.contentView.addChildView(chromeView);
  chromeView.webContents.loadFile(path.join(__dirname, 'index.html'));

  popoverView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js') },
  });
  win.contentView.addChildView(popoverView);
  popoverView.webContents.loadFile(path.join(__dirname, 'overlay.html'));
  popoverView.setVisible(false);
  popoverView.webContents.on('blur', hidePopover); // close on click-away

  findView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'find-preload.js') },
  });
  win.contentView.addChildView(findView);
  findView.webContents.loadFile(path.join(__dirname, 'find.html'));
  findView.setVisible(false);

  ctxView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'context-preload.js') },
  });
  win.contentView.addChildView(ctxView);
  ctxView.webContents.loadFile(path.join(__dirname, 'context.html'));
  ctxView.setVisible(false);
  ctxView.webContents.on('blur', hideContext); // close on click-away

  for (const v of [heroView, aiView, chromeView, popoverView, findView, ctxView]) {
    attachShortcuts(v.webContents);
    v.webContents.on('did-finish-load', () => applyAccent(v));
  }

  win.on('resize', () => {
    hideContext();
    layout();
  });
  layout();

  createTab(); // opens on the hero
}

// --- AI prompt building + routing (unchanged behavior) ---
function buildCliPrompt(transcript) {
  const lines = (transcript || []).map(
    (m) => (m.role === 'user' ? 'User: ' : 'Assistant: ') + m.text,
  );
  return SYSTEM + '\n\n' + lines.join('\n') + '\nAssistant:';
}

function buildApiMessages(transcript) {
  const msgs = (transcript || []).map((m) => ({ role: m.role, content: m.text }));
  if (msgs.length && msgs[0].role === 'user') {
    msgs[0] = { role: 'user', content: SYSTEM + '\n\n' + msgs[0].content };
  }
  return msgs;
}

function runAI(payload, sender) {
  if (payload.variant === 'api') return runApiAI(payload, sender);
  return runCliAI(payload, sender);
}

async function runCliAI({ conversationId, provider, transcript }, sender) {
  const cfg = (PROVIDERS[provider] || PROVIDERS.claude).cli;
  let Squire;
  try {
    ({ Squire } = await import('@pythonluvr/squire'));
  } catch (err) {
    sender.send('ai:error', { conversationId, message: 'Squire failed to load: ' + err.message });
    sender.send('ai:done', { conversationId, code: 1 });
    return;
  }
  const squire = new Squire({
    binary: cfg.binary,
    args: cfg.args,
    adapter: cfg.adapter,
    cwd: AI_CWD,
    timeoutMs: 90000,
  });
  squire.on('event', (ev) => {
    if (ev.type === 'text_delta') sender.send('ai:delta', { conversationId, delta: ev.delta });
    else if (ev.type === 'error')
      sender.send('ai:error', { conversationId, message: ev.error?.message || 'AI error' });
  });
  squire.on('exit', (code) => sender.send('ai:done', { conversationId, code }));
  try {
    await squire.start(buildCliPrompt(transcript));
  } catch (err) {
    sender.send('ai:error', { conversationId, message: err.message });
    sender.send('ai:done', { conversationId, code: 1 });
  }
}

async function runApiAI({ conversationId, provider, transcript }, sender) {
  const prov = PROVIDERS[provider] || PROVIDERS.claude;
  const kind = prov.api.kind;
  const settings = readSettings();
  const apiKey = settings.apiKeys[kind];
  const model = settings.apiModels[kind];
  if (!apiKey) {
    sender.send('ai:error', {
      conversationId,
      message: `No ${kind} API key set. Add one in Settings (the gear icon).`,
    });
    sender.send('ai:done', { conversationId, code: 1 });
    return;
  }
  try {
    await STREAMERS[kind]({
      apiKey,
      model,
      messages: buildApiMessages(transcript),
      onDelta: (delta) => sender.send('ai:delta', { conversationId, delta }),
    });
    sender.send('ai:done', { conversationId, code: 0 });
  } catch (err) {
    sender.send('ai:error', { conversationId, message: err.message });
    sender.send('ai:done', { conversationId, code: 1 });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  fs.mkdirSync(AI_CWD, { recursive: true });
  setupDownloads();
  createWindow();
  app.on('activate', () => {
    if (BaseWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC: navigation (acts on the active tab) ---
ipcMain.handle('navigate', (_e, input) => {
  const url = normalizeInput(input);
  const at = activeTab();
  if (url && at) {
    at.onHero = false;
    at.view.webContents.loadURL(url);
    updateContentVisibility();
  }
  return url;
});
ipcMain.on('back', () => {
  const at = activeTab();
  if (at && at.view.webContents.navigationHistory.canGoBack()) at.view.webContents.navigationHistory.goBack();
});
ipcMain.on('forward', () => {
  const at = activeTab();
  if (at && at.view.webContents.navigationHistory.canGoForward())
    at.view.webContents.navigationHistory.goForward();
});
ipcMain.on('reload', () => {
  const at = activeTab();
  if (at && !at.onHero) at.view.webContents.reload();
});
ipcMain.on('stop', () => {
  const at = activeTab();
  if (at) at.view.webContents.stop();
});
ipcMain.on('go-home', goHome);
ipcMain.on('ready', () => {
  sendState();
  sendTabs();
  sendDownloads();
  sendBookmarks();
});
ipcMain.on('zoom', (_e, dir) => {
  const at = activeTab();
  if (!at) return;
  const wc = at.view.webContents;
  if (dir === 'reset') wc.setZoomLevel(0);
  else wc.setZoomLevel(wc.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5));
});
ipcMain.on('open-settings', () => {
  toggleAI(true);
  aiView.webContents.send('open-settings');
});
ipcMain.on('download:open', (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d && d.path) shell.openPath(d.path);
});
ipcMain.on('download:show', (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d && d.path) shell.showItemInFolder(d.path);
});
ipcMain.on('pop:toggle', (_e, kind) => togglePopover(kind));
ipcMain.on('pop:close', hidePopover);

// --- IPC: bookmarks ---
ipcMain.on('bookmark:toggle', () => {
  const at = activeTab();
  if (!at || at.onHero) return;
  const url = at.view.webContents.getURL();
  if (store.isBookmarked(url)) store.removeBookmark(url);
  else store.addBookmark({ url, title: at.title });
  sendBookmarks();
  sendState();
});
ipcMain.on('bookmark:remove', (_e, url) => {
  store.removeBookmark(url);
  sendBookmarks();
  sendState();
});

// --- IPC: find-in-page ---
ipcMain.on('find:query', (_e, { text, forward }) => {
  const at = activeTab();
  if (!at) return;
  findText = text || '';
  if (!findText) {
    at.view.webContents.stopFindInPage('clearSelection');
    return;
  }
  at.view.webContents.findInPage(findText, { forward: forward !== false, findNext: false });
});
ipcMain.on('find:next', (_e, forward) => {
  const at = activeTab();
  if (at && findText) at.view.webContents.findInPage(findText, { forward, findNext: true });
});
ipcMain.on('find:close', hideFind);
ipcMain.on('find:show', showFind);

// --- IPC: context menu ---
ipcMain.on('ctx:invoke', (_e, id) => runCtxAction(id));
ipcMain.on('ctx:close', hideContext);

// --- IPC: history ---
ipcMain.on('pop:history', () => showPopover('history'));
ipcMain.on('history:clear', () => {
  store.clearHistory();
  if (popKind === 'history' && popoverView) popoverView.webContents.send('history', []);
});

// --- IPC: hero AI model providers (drives the hero pills + panel) ---
ipcMain.handle('providers:get', () =>
  Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, domain: p.domain })),
);

// --- IPC: search suggestions (fetched in main to dodge CORS) ---
ipcMain.handle('suggest:get', async (_e, query) => {
  const q = (query || '').trim();
  if (!q) return [];
  try {
    const res = await fetch(
      'https://suggestqueries.google.com/complete/search?client=firefox&q=' + encodeURIComponent(q),
    );
    const data = await res.json();
    return Array.isArray(data) && Array.isArray(data[1]) ? data[1].slice(0, 8) : [];
  } catch {
    return [];
  }
});

// --- IPC: tabs ---
ipcMain.on('tab:new', () => createTab());
ipcMain.on('tab:close', (_e, id) => closeTab(id));
ipcMain.on('tab:activate', (_e, id) => activateTab(id));
ipcMain.on('tab:reopen', () => reopenClosed());

// --- IPC: AI panel ---
ipcMain.on('toggle-ai', () => toggleAI());
ipcMain.on('open-ai', () => toggleAI(true));
ipcMain.on('ai:send', (e, payload) => runAI(payload, e.sender));

// --- IPC: settings ---
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const next = writeSettings(patch);
  if (patch.accent) broadcastAccent();
  return next;
});

// --- IPC: hero search + direct open (load into the active tab) ---
ipcMain.on('hero:search', (_e, { engine, query }) => {
  const make = ENGINES[engine] || ENGINES.duckduckgo;
  const at = activeTab();
  if (query && query.trim() && at) {
    at.onHero = false;
    at.view.webContents.loadURL(make(query.trim()));
    updateContentVisibility();
  }
});
ipcMain.on('hero:open', (_e, { url }) => {
  const at = activeTab();
  const target = normalizeInput(url);
  if (target && at) {
    at.onHero = false;
    at.view.webContents.loadURL(target);
    updateContentVisibility();
  }
});
// From the hero's "Ask AI" mode: open the panel, set the chosen model, and
// send the prompt into it.
ipcMain.on('hero:ask-ai', (_e, { text, provider }) => {
  toggleAI(true);
  if (text && text.trim()) {
    aiView.webContents.send('ai:prompt', { text: text.trim(), provider });
  }
});
