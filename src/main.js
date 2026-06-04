const { app, BaseWindow, WebContentsView, ipcMain, Menu, session, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { readSettings, writeSettings } = require('./lib/settings');
const { STREAMERS, runAnthropicAgent } = require('./lib/api');
const { startMcpServer } = require('./lib/mcp-server');
const { autoUpdater } = require('electron-updater');
const store = require('./lib/store');

app.setName('Slash');

// Single instance: when Slash is the default browser and a link is opened, the
// OS launches us again with the URL in argv. Reuse the running window instead
// of spawning a second app, and open the link as a tab.
function urlFromArgv(argv) {
  return (argv || []).find((a) => /^https?:\/\//i.test(a)) || null;
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = urlFromArgv(argv);
    if (win) {
      if (url) createTab({ url, activate: true });
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Chrome = tab strip + toolbar + bookmarks bar. AI panel docks on the right.
const TABSTRIP_HEIGHT = 38;
const TOOLBAR_HEIGHT = 56;
const BOOKMARKS_HEIGHT = 34;
const INFOBAR_HEIGHT = 40;
const BASE_CHROME = TABSTRIP_HEIGHT + TOOLBAR_HEIGHT + BOOKMARKS_HEIGHT;
let CHROME_HEIGHT = BASE_CHROME; // grows by INFOBAR_HEIGHT while an infobar shows
let infobarOpen = false;
const FIND_W = 360;
const FIND_HEIGHT = 44;
const AI_WIDTH = 400;
const CTX_WIDTH = 244;
const CTX_ROW = 34; // .pop-item height in context.css
const CTX_SEP = 11; // .pop-sep height + margins
const CTX_FRAME = 12; // body padding (5+5) + border (1+1)
const PERM_W = 420;
const PERM_H = 104; // permission prompt bubble

// Hardened defaults for every view. Trusted views add their own preload on
// top; the untrusted page views get exactly this and no preload.
const SECURE_PREFS = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
};
const AI_CWD = path.join(__dirname, '..', '.ai-scratch');

let win;
let chromeView; // tab strip + toolbar + bookmarks (trusted)
let heroView; // shared start page, shown for any tab that has not navigated
let aiView; // docked AI panel (trusted)
let aiPageView; // full-screen slash://ai conversation (trusted, content area)
let popoverView; // top-right menu / profile / downloads / history layer (trusted)
let findView; // find-in-page bar (trusted), shown on Ctrl+F
let ctxView; // right-click context menu layer (trusted)
let permView; // permission prompt bubble (trusted)
let interstitialView; // HTTPS-only failure interstitial (trusted, content area)
let settingsView; // full-page settings surface (trusted, content area)
let settingsOpen = false;
let popKind = null; // which popover is open, or null
let findOpen = false;
let findText = '';
let ctxOpen = false;
let ctxParams = null; // params from the last 'context-menu' event
let permActive = null; // current { origin, permission, callback }
const permQueue = []; // pending permission requests
let httpsOnly = true; // mirrors settings.httpsOnly
const upgraded = new Map(); // upgraded https url -> original http url

// Popover sizes (the view is sized to the card).
const POP_SIZES = {
  menu: { w: 252, h: 436 },
  profile: { w: 250, h: 132 },
  downloads: { w: 270, h: 230 },
  history: { w: 380, h: 460 },
  siteinfo: { w: 330, h: 264 },
  shield: { w: 268, h: 150 },
};

// Top-right cluster popovers anchor right; site-info anchors under the omnibox.
function popoverPos(kind, s, width) {
  const x = kind === 'siteinfo' ? 12 : Math.max(0, width - s.w - 10);
  return { x, y: CHROME_HEIGHT };
}

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

// The user's chosen default search engine (private DuckDuckGo by default).
function searchURL(q) {
  const eng = readSettings().searchEngine;
  return (ENGINES[eng] || ENGINES.duckduckgo)(q);
}

// DNS-over-HTTPS so lookups are not readable by the network/ISP. 'secure'
// means all DNS goes through DoH; toggle off in settings if a resolver is
// blocked on your network.
function applyDoh() {
  try {
    const on = readSettings().doh;
    session.defaultSession.configureHostResolver(
      on
        ? {
            secureDnsMode: 'secure',
            secureDnsServers: [
              'https://cloudflare-dns.com/dns-query',
              'https://dns.quad9.net/dns-query',
            ],
          }
        : { secureDnsMode: 'off' },
    );
  } catch {
    /* host resolver config unsupported on this platform */
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// --- Per-site permissions ---
// Privacy-sensitive permissions are prompted and remembered per origin;
// everything else (fullscreen, pointer lock, etc.) is allowed silently.
const PROMPTABLE = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'midiSysex']);

function permLabel(permission, details) {
  switch (permission) {
    case 'media': {
      const t = (details && details.mediaTypes) || [];
      const cam = t.includes('video');
      const mic = t.includes('audio');
      if (cam && mic) return 'use your camera and microphone';
      if (cam) return 'use your camera';
      if (mic) return 'use your microphone';
      return 'use your camera and microphone';
    }
    case 'geolocation':
      return 'know your location';
    case 'notifications':
      return 'show notifications';
    case 'clipboard-read':
      return 'read your clipboard';
    case 'midi':
    case 'midiSysex':
      return 'use your MIDI devices';
    default:
      return 'access ' + permission;
  }
}

// --- HTTPS-only ---
// Upgrade http navigations to https at the navigation layer (the network
// onBeforeRequest hook is owned by the ad/tracker blocker). If https then
// fails, the tab shows an interstitial with a per-site "continue to HTTP"
// escape hatch. Returns the URL to actually load.
function maybeUpgradeForNav(url) {
  if (!httpsOnly || !/^http:\/\//i.test(url)) return url;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  // Leave local development alone.
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')) {
    return url;
  }
  if (store.isHttpAllowed(originOf(url))) return url;
  const https = url.replace(/^http:/i, 'https:');
  upgraded.set(https, url);
  return https;
}

// --- Ad / tracker blocking (EasyList + EasyPrivacy via @ghostery/adblocker) ---
let blocker = null;

async function setupBlocker() {
  if (!readSettings().blockAds) return;
  try {
    const { ElectronBlocker } = await import('@ghostery/adblocker-electron');
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: path.join(app.getPath('userData'), 'slash-adblocker.bin'),
      read: fs.promises.readFile,
      write: fs.promises.writeFile,
    });
    blocker.enableBlockingInSession(session.defaultSession);
    blocker.on('request-blocked', onRequestBlocked);
  } catch {
    blocker = null;
  }
}

function setBlocking(on) {
  try {
    if (on) {
      if (blocker) blocker.enableBlockingInSession(session.defaultSession);
      else setupBlocker();
    } else if (blocker) {
      blocker.disableBlockingInSession(session.defaultSession);
    }
  } catch {
    /* ignore */
  }
}

function onRequestBlocked(request) {
  const id = request && request.tabId;
  if (!id) return;
  const tab = tabs.find((t) => {
    try {
      return t.view.webContents.id === id;
    } catch {
      return false;
    }
  });
  if (!tab) return;
  tab.blocked = (tab.blocked || 0) + 1;
  if (tab.id === activeTabId) sendBlocked();
}

function sendBlocked() {
  if (!chromeView) return;
  const at = activeTab();
  chromeView.webContents.send('blocked', {
    count: at ? at.blocked || 0 : 0,
    enabled: readSettings().blockAds,
  });
}

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!PROMPTABLE.has(permission)) return callback(true);
    const origin = originOf((details && details.requestingUrl) || (wc && wc.getURL()));
    if (!origin) return callback(false);
    const decided = store.getPermission(origin, permission);
    if (decided === 'allow') return callback(true);
    if (decided === 'block') return callback(false);
    enqueuePermission({ origin, permission, label: permLabel(permission, details), callback });
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (!PROMPTABLE.has(permission)) return true;
    return store.getPermission(requestingOrigin, permission) === 'allow';
  });
}

function enqueuePermission(req) {
  permQueue.push(req);
  if (!permActive) showNextPermission();
}

function showNextPermission() {
  permActive = permQueue.shift() || null;
  if (!permActive) {
    if (permView) permView.setVisible(false);
    return;
  }
  if (!permView) return;
  const { width } = win.getContentBounds();
  permView.setBounds({ x: 12, y: CHROME_HEIGHT + 6, width: Math.min(PERM_W, width - 24), height: PERM_H });
  permView.setVisible(true);
  win.contentView.removeChildView(permView);
  win.contentView.addChildView(permView); // topmost
  permView.webContents.send('perm:show', { origin: permActive.origin, action: permActive.label });
  permView.webContents.focus();
}

function decidePermission(allow) {
  if (!permActive) return;
  const { origin, permission, callback } = permActive;
  store.setPermission(origin, permission, allow ? 'allow' : 'block');
  try {
    callback(!!allow);
  } catch {
    /* request already gone */
  }
  permActive = null;
  showNextPermission();
}

const PROVIDERS = {
  claude: {
    label: 'Claude',
    domain: 'claude.ai',
    // Args are built per-call by cliArgsFor() so the MCP browser tools can be
    // injected once the local MCP server is up.
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
  'Answer conversationally and concisely. You can use your tools to act on the ' +
  'web and control this browser: search the web, read pages, open tabs, ' +
  'bookmark pages, and add sites to the start page. Use them when they help. ' +
  'Do not use file, terminal, or code-editing tools.';

let aiOpen = false;

function normalizeInput(input) {
  const text = (input || '').trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return maybeUpgradeForNav(text);
  if (/^[^\s]+\.[^\s]+$/.test(text)) return 'https://' + text;
  return searchURL(text);
}

// The internal address for the full-screen AI page.
function isAIAddress(input) {
  return /^\s*slash:(\/\/)?ai\/?\s*$/i.test(input || '');
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
  for (const v of [chromeView, heroView, interstitialView, settingsView, aiPageView, aiView, popoverView, findView, ctxView, permView]) applyAccent(v);
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

// Connection state for the site-info button: secure (https), insecure (http),
// or internal (the start page and file:/view-source: pages).
function securityOf(at) {
  if (!at || at.onHero) return 'internal';
  const url = at.view.webContents.getURL();
  if (/^https:/i.test(url)) return 'secure';
  if (/^http:/i.test(url)) return 'insecure';
  return 'internal';
}

// --- State to the chrome UI ---
function sendState() {
  if (!chromeView) return;
  const at = activeTab();
  const onHero = !!(at && at.onHero);
  const onAIPage = !!(at && at.onAIPage);
  const realPage = at && !onHero && !onAIPage;
  chromeView.webContents.send('state', {
    mode: onAIPage ? 'aipage' : onHero ? 'hero' : 'page',
    aiOpen,
    url: onAIPage ? 'slash://ai' : realPage ? at.view.webContents.getURL() : '',
    title: onAIPage ? 'Slash AI' : at ? at.title : 'Slash',
    canGoBack: at ? at.canGoBack : false,
    canGoForward: at ? at.canGoForward : false,
    loading: at ? at.loading : false,
    bookmarked: realPage ? store.isBookmarked(at.view.webContents.getURL()) : false,
    security: onAIPage ? 'internal' : securityOf(at),
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
  if (interstitialView) interstitialView.setBounds({ x: 0, y: top, width: mainW, height: ch });
  if (settingsView) settingsView.setBounds({ x: 0, y: top, width: mainW, height: ch });
  if (aiPageView) aiPageView.setBounds({ x: 0, y: top, width: mainW, height: ch });
  for (const t of tabs) t.view.setBounds({ x: 0, y: top, width: mainW, height: ch });
  aiView.setBounds({ x: width - aiW, y: top, width: aiW, height: ch });
  if (popKind && popoverView) {
    const s = POP_SIZES[popKind];
    const { x, y } = popoverPos(popKind, s, width);
    popoverView.setBounds({ x, y, width: s.w, height: s.h });
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
  if (settingsView) settingsView.setVisible(settingsOpen);
  const onInt = !settingsOpen && !!(at && at.failedHttp);
  if (interstitialView) {
    interstitialView.setVisible(onInt);
    if (onInt) {
      let host = '';
      try {
        host = new URL(at.failedHttp).host;
      } catch {
        /* keep blank */
      }
      interstitialView.webContents.send('interstitial', { url: at.failedHttp, host });
    }
  }
  const onAIPage = !settingsOpen && !onInt && !!(at && at.onAIPage);
  if (aiPageView) aiPageView.setVisible(onAIPage);
  const onContent = settingsOpen || onInt || onAIPage;
  heroView.setVisible(!onContent && !!at && at.onHero);
  for (const t of tabs) t.view.setVisible(!onContent && !!at && t.id === at.id && !at.onHero);
}

function goAIPage(opts = {}) {
  const at = activeTab();
  if (!at) return;
  at.onAIPage = true;
  at.onHero = false;
  settingsOpen = false;
  updateContentVisibility();
  sendState();
  sendTabs();
  if (opts.prompt) aiPageView.webContents.send('ai:prompt', opts.prompt);
  if (opts.load) aiPageView.webContents.send('ai:load', opts.load);
  aiPageView.webContents.focus();
}

function openSettingsPage() {
  settingsOpen = true;
  if (settingsView) settingsView.webContents.send('settings:show');
  updateContentVisibility();
  if (settingsView) settingsView.webContents.focus();
}

function closeSettingsPage() {
  if (!settingsOpen) return;
  settingsOpen = false;
  updateContentVisibility();
}

// Keep the toolbar and AI panel above all tab content. Remove-then-add so a
// re-stack can never duplicate a child view.
function raiseChrome() {
  for (const v of [aiView, chromeView, popoverView, findView, ctxView, permView]) {
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
      if (p.selectionText) createTab({ url: searchURL(p.selectionText.trim()), activate: true });
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
function sendSiteinfo() {
  const at = activeTab();
  const url = at && !at.onHero ? at.view.webContents.getURL() : '';
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    /* internal page */
  }
  const origin = originOf(url);
  const perms = origin ? store.getSitePermissions(origin) : {};
  popoverView.webContents.send('siteinfo', {
    secure: securityOf(at),
    host,
    origin: origin || '',
    permissions: Object.entries(perms).map(([perm, decision]) => ({ perm, decision })),
  });
}

function showPopover(kind) {
  const s = POP_SIZES[kind];
  if (!s) return;
  const { width } = win.getContentBounds();
  const { x, y } = popoverPos(kind, s, width);
  popoverView.setBounds({ x, y, width: s.w, height: s.h });
  popoverView.setVisible(true);
  popoverView.webContents.send('pop:show', kind);
  sendDownloads();
  if (kind === 'history') popoverView.webContents.send('history', store.getHistory().slice(0, 300));
  if (kind === 'siteinfo') sendSiteinfo();
  if (kind === 'shield') sendShield();
  popoverView.webContents.focus();
  popKind = kind;
}

function sendShield() {
  const at = activeTab();
  popoverView.webContents.send('shield', {
    count: at ? at.blocked || 0 : 0,
    enabled: readSettings().blockAds,
  });
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
  const view = new WebContentsView({ webPreferences: { ...SECURE_PREFS } });
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
    failedHttp: null, // set when an https upgrade fails (HTTPS-only)
    blocked: 0, // ads/trackers blocked on the current page
    onAIPage: false, // showing the full-screen slash://ai page
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
  wc.on('did-navigate', () => {
    upgraded.delete(wc.getURL());
    store.addHistory({ url: wc.getURL(), title: wc.getTitle() });
  });
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
  // HTTPS-only: a failed upgrade shows the interstitial; any fresh load clears it.
  wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED
    const httpUrl = upgraded.get(validatedURL);
    if (httpUrl) {
      upgraded.delete(validatedURL);
      tab.failedHttp = httpUrl;
      tab.onHero = false;
      if (id === activeTabId) {
        updateContentVisibility();
        sendState();
      }
    }
  });
  wc.on('did-start-loading', () => {
    tab.blocked = 0;
    if (tab.failedHttp) {
      tab.failedHttp = null;
      if (id === activeTabId) updateContentVisibility();
    }
    if (id === activeTabId) sendBlocked();
  });
  // HTTPS-only: upgrade http link navigations before they load.
  wc.on('will-navigate', (e, url) => {
    const up = maybeUpgradeForNav(url);
    if (up !== url) {
      e.preventDefault();
      wc.loadURL(up);
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
  settingsOpen = false;
  updateContentVisibility();
  sendState();
  sendTabs();
  sendBlocked();
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
  at.onAIPage = false;
  settingsOpen = false;
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
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'hero-preload.js') },
  });
  win.contentView.addChildView(heroView);
  heroView.webContents.loadFile(path.join(__dirname, 'hero.html'));
  heroView.setVisible(false);

  interstitialView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'interstitial-preload.js') },
  });
  win.contentView.addChildView(interstitialView);
  interstitialView.webContents.loadFile(path.join(__dirname, 'interstitial.html'));
  interstitialView.setVisible(false);

  settingsView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'settings-preload.js') },
  });
  win.contentView.addChildView(settingsView);
  settingsView.webContents.loadFile(path.join(__dirname, 'settings.html'));
  settingsView.setVisible(false);

  aiPageView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'ai-preload.js') },
  });
  win.contentView.addChildView(aiPageView);
  aiPageView.webContents.loadFile(path.join(__dirname, 'ai-page.html'));
  aiPageView.setVisible(false);

  aiView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'ai-preload.js') },
  });
  win.contentView.addChildView(aiView);
  aiView.webContents.loadFile(path.join(__dirname, 'ai.html'));
  aiView.setVisible(false);

  chromeView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'preload.js') },
  });
  win.contentView.addChildView(chromeView);
  chromeView.webContents.loadFile(path.join(__dirname, 'index.html'));

  popoverView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'overlay-preload.js') },
  });
  win.contentView.addChildView(popoverView);
  popoverView.webContents.loadFile(path.join(__dirname, 'overlay.html'));
  popoverView.setVisible(false);
  popoverView.webContents.on('blur', hidePopover); // close on click-away

  findView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'find-preload.js') },
  });
  win.contentView.addChildView(findView);
  findView.webContents.loadFile(path.join(__dirname, 'find.html'));
  findView.setVisible(false);

  ctxView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'context-preload.js') },
  });
  win.contentView.addChildView(ctxView);
  ctxView.webContents.loadFile(path.join(__dirname, 'context.html'));
  ctxView.setVisible(false);
  ctxView.webContents.on('blur', hideContext); // close on click-away

  permView = new WebContentsView({
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'permission-preload.js') },
  });
  win.contentView.addChildView(permView);
  permView.webContents.loadFile(path.join(__dirname, 'permission.html'));
  permView.setVisible(false);

  for (const v of [heroView, interstitialView, settingsView, aiPageView, aiView, chromeView, popoverView, findView, ctxView, permView]) {
    attachShortcuts(v.webContents);
    v.webContents.on('did-finish-load', () => applyAccent(v));
    // Trusted chrome must never navigate itself or spawn windows. Real web
    // navigation only happens inside the untrusted per-tab page views.
    v.webContents.on('will-navigate', (e) => e.preventDefault());
    v.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  win.on('resize', () => {
    hideContext();
    layout();
  });
  layout();

  createTab(); // opens on the hero
  // If launched as the default browser with a URL (e.g. clicked link), open it.
  const startUrl = urlFromArgv(process.argv);
  if (startUrl) createTab({ url: startUrl, activate: true });
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

// --- Agentic web tools (Anthropic API path) ---
const AGENT_SYSTEM =
  'You are Slash, the AI built into a web browser. You can act on the web and ' +
  'control the browser through tools: search the web, read pages, open tabs, ' +
  'bookmark pages, and add sites to the start page. Use tools when they help ' +
  'answer or carry out the request; otherwise answer directly. After using ' +
  'tools, give a clear, concise answer. Do not invent page contents, read them.';

const TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web and get back result titles and URLs.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
  },
  {
    name: 'read_url',
    description: 'Load a URL in the background and return the readable text of the page.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The full URL to read' } },
      required: ['url'],
    },
  },
  {
    name: 'read_current_page',
    description: "Return the readable text of the page in the user's active browser tab.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'open_tab',
    description: 'Open a URL in a new visible browser tab for the user to see.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'bookmark_page',
    description: 'Bookmark a page. Uses the active tab if no url is given.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' }, title: { type: 'string' } },
    },
  },
  {
    name: 'add_to_homepage',
    description: 'Add a site as a shortcut tile on the start page.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' }, name: { type: 'string' } },
      required: ['url'],
    },
  },
];

function buildAgentMessages(transcript) {
  return (transcript || []).map((m) => ({ role: m.role, content: m.text }));
}

// A reusable offscreen view that renders a page so tools can read JS-rendered
// content. Calls are serialized through fetcherChain.
let fetcherView = null;
let fetcherChain = Promise.resolve();
function ensureFetcher() {
  if (fetcherView || !win) return fetcherView;
  fetcherView = new WebContentsView({ webPreferences: { ...SECURE_PREFS } });
  win.contentView.addChildView(fetcherView);
  fetcherView.setBounds({ x: 0, y: 0, width: 1024, height: 768 });
  fetcherView.setVisible(false);
  return fetcherView;
}
function fetchPageText(url) {
  const job = () => doFetchPageText(url);
  fetcherChain = fetcherChain.then(job, job);
  return fetcherChain;
}
async function doFetchPageText(url) {
  const v = ensureFetcher();
  if (!v) return { title: '', text: '' };
  const wc = v.webContents;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(to);
      wc.off('did-finish-load', finish);
      wc.off('did-fail-load', finish);
      resolve();
    };
    const to = setTimeout(finish, 15000);
    wc.on('did-finish-load', finish);
    wc.on('did-fail-load', finish);
    wc.loadURL(url).catch(finish);
  });
  try {
    const raw = await wc.executeJavaScript(
      'JSON.stringify({title:document.title||"",text:document.body?document.body.innerText:""})',
    );
    return JSON.parse(raw);
  } catch {
    return { title: '', text: '' };
  }
}

async function toolWebSearch(query) {
  const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Slash' },
  });
  const html = await res.text();
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    let url = m[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    else if (url.startsWith('//')) url = 'https:' + url;
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (title && /^https?:/i.test(url)) out.push({ title, url });
  }
  if (!out.length) return 'No results found.';
  return out.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join('\n');
}

async function executeTool(name, input) {
  input = input || {};
  switch (name) {
    case 'web_search':
      return toolWebSearch(String(input.query || ''));
    case 'read_url': {
      let url = String(input.url || '');
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const p = await fetchPageText(url);
      return `# ${p.title}\n${url}\n\n${(p.text || '').slice(0, 6000)}`;
    }
    case 'read_current_page': {
      const at = activeTab();
      if (!at || at.onHero) return 'No web page is open in the active tab.';
      const raw = await at.view.webContents.executeJavaScript(
        'JSON.stringify({title:document.title||"",text:document.body?document.body.innerText:""})',
      );
      const p = JSON.parse(raw);
      return `# ${p.title}\n${at.view.webContents.getURL()}\n\n${(p.text || '').slice(0, 6000)}`;
    }
    case 'open_tab': {
      let url = String(input.url || '');
      if (!url) return 'No URL given.';
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      createTab({ url, activate: true });
      return 'Opened ' + url + ' in a new tab.';
    }
    case 'bookmark_page': {
      let url = String(input.url || '');
      if (!url) {
        const at = activeTab();
        url = at && !at.onHero ? at.view.webContents.getURL() : '';
      }
      if (!url) return 'No URL to bookmark.';
      store.addBookmark({ url, title: input.title || url });
      sendBookmarks();
      return 'Bookmarked ' + url;
    }
    case 'add_to_homepage': {
      let url = String(input.url || '');
      if (!url) return 'No URL given.';
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (heroView) heroView.webContents.send('hero:add-dial', { name: input.name || '', url });
      return 'Added ' + url + ' to the start page.';
    }
    default:
      return 'Unknown tool: ' + name;
  }
}

function runAI(payload, sender) {
  if (payload.variant === 'api') return runApiAI(payload, sender);
  return runCliAI(payload, sender);
}

// --- MCP bridge: lets the free CLIs drive the browser via the local server ---
let mcpServer = null;
let mcpConfigPath = null;
const MCP_SERVER_NAME = 'slash';

// Build CLI args for a provider, injecting the MCP browser tools (and free web
// search) for Claude once the local MCP server is running.
function cliArgsFor(provider) {
  if (provider === 'claude') {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', 'WebSearch,WebFetch'];
    const allowed = ['WebSearch', 'WebFetch'];
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
      for (const t of TOOLS) allowed.push(`mcp__${MCP_SERVER_NAME}__${t.name}`);
    }
    args.push('--allowedTools', allowed.join(','));
    return args;
  }
  return (PROVIDERS[provider] || PROVIDERS.claude).cli.args;
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
    args: cliArgsFor(provider),
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
    if (kind === 'anthropic') {
      // Agentic path: Claude can call browser/web tools and loop on results.
      await runAnthropicAgent({
        apiKey,
        model,
        system: AGENT_SYSTEM,
        messages: buildAgentMessages(transcript),
        tools: TOOLS,
        onDelta: (delta) => sender.send('ai:delta', { conversationId, delta }),
        onTool: (ev) => sender.send('ai:tool', { conversationId, ...ev }),
        executeTool,
      });
    } else {
      await STREAMERS[kind]({
        apiKey,
        model,
        messages: buildApiMessages(transcript),
        onDelta: (delta) => sender.send('ai:delta', { conversationId, delta }),
      });
    }
    sender.send('ai:done', { conversationId, code: 0 });
  } catch (err) {
    sender.send('ai:error', { conversationId, message: err.message });
    sender.send('ai:done', { conversationId, code: 1 });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  fs.mkdirSync(AI_CWD, { recursive: true });
  httpsOnly = readSettings().httpsOnly;
  applyDoh();
  setupPermissions();
  setupDownloads();
  createWindow();
  setupBlocker();

  // Local MCP server exposing the browser tools, so the free CLIs can drive
  // the browser. The config (with a per-session token + the chosen port) is
  // written to userData and referenced by the Claude CLI args.
  startMcpServer({ name: MCP_SERVER_NAME, tools: TOOLS, executeTool })
    .then((mcp) => {
      mcpServer = mcp;
      const cfg = {
        mcpServers: {
          [mcp.name]: { type: 'http', url: mcp.url, headers: { Authorization: 'Bearer ' + mcp.token } },
        },
      };
      const p = path.join(app.getPath('userData'), 'slash-mcp.json');
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
      mcpConfigPath = p;
    })
    .catch(() => {
      mcpConfigPath = null;
    });

  setupUpdater();
  app.on('activate', () => {
    if (BaseWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC: navigation (acts on the active tab) ---
ipcMain.handle('navigate', (_e, input) => {
  if (isAIAddress(input)) {
    goAIPage();
    return 'slash://ai';
  }
  const url = normalizeInput(input);
  const at = activeTab();
  if (url && at) {
    at.onHero = false;
    at.onAIPage = false;
    settingsOpen = false;
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
  sendBlocked();
  maybeShowFirstRun();
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
ipcMain.on('settings:open', openSettingsPage);
ipcMain.on('settings:close', closeSettingsPage);
ipcMain.on('settings:open-ai', () => {
  closeSettingsPage();
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

// --- IPC: permission prompt ---
ipcMain.on('perm:decide', (_e, allow) => decidePermission(allow));

// --- IPC: ad/tracker blocker toggle (from the shield popover) ---
ipcMain.on('blocker:toggle', () => {
  const next = !readSettings().blockAds;
  writeSettings({ blockAds: next });
  setBlocking(next);
  if (popKind === 'shield') sendShield();
  sendBlocked();
});

// --- IPC: site-info popover (clear a remembered per-site permission) ---
ipcMain.on('perm:clear', (_e, { origin, perm }) => {
  store.clearPermission(origin, perm);
  if (popKind === 'siteinfo') sendSiteinfo();
});

// --- IPC: HTTPS-only interstitial ---
ipcMain.on('interstitial:continue', () => {
  const at = activeTab();
  if (!at || !at.failedHttp) return;
  const httpUrl = at.failedHttp;
  store.allowHttp(originOf(httpUrl));
  at.failedHttp = null;
  at.onHero = false;
  at.view.webContents.loadURL(httpUrl);
  updateContentVisibility();
});
ipcMain.on('interstitial:back', () => {
  const at = activeTab();
  if (!at) return;
  at.failedHttp = null;
  if (at.view.webContents.navigationHistory.canGoBack()) at.view.webContents.navigationHistory.goBack();
  else goHome();
  updateContentVisibility();
});

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

// Handoff between the docked sidebar and the full-screen slash://ai page.
ipcMain.on('ai:to-page', (_e, data) => {
  toggleAI(false); // close the docked sidebar
  goAIPage({ load: data });
});
ipcMain.on('ai:open-web', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) createTab({ url, activate: true });
});
ipcMain.on('ai:to-sidebar', (_e, data) => {
  const at = activeTab();
  if (at) {
    at.onAIPage = false;
    if (!at.view.webContents.getURL()) at.onHero = true;
  }
  updateContentVisibility();
  sendState();
  sendTabs();
  toggleAI(true);
  aiView.webContents.send('ai:load', data);
});

// --- Infobar: a non-blocking strip in the chrome, shared by the first-run
// default-browser prompt and update notifications. ---
function showInfobar(payload) {
  infobarOpen = true;
  CHROME_HEIGHT = BASE_CHROME + INFOBAR_HEIGHT;
  if (chromeView) chromeView.webContents.send('infobar:show', payload);
  layout();
}
function hideInfobar() {
  infobarOpen = false;
  CHROME_HEIGHT = BASE_CHROME;
  if (chromeView) chromeView.webContents.send('infobar:hide');
  layout();
}
function maybeShowFirstRun() {
  const s = readSettings();
  if (s.seenDefaultPrompt || infobarOpen) return;
  if (app.isDefaultProtocolClient('http')) {
    writeSettings({ seenDefaultPrompt: true });
    return;
  }
  showInfobar({
    id: 'firstrun',
    text: 'Make Slash your default browser?',
    actions: [
      { key: 'set', label: 'Set as default', primary: true },
      { key: 'later', label: 'Not now' },
      { key: 'close', label: 'Dismiss', close: true },
    ],
  });
}

// --- Optional auto-update (packaged builds only). Never auto-installs: the
// user chooses to update (downloads in place and restarts, no separate exe),
// to ignore this one, or to stop further update prompts. ---
let pendingUpdate = null;
function setupUpdater() {
  if (!app.isPackaged || !readSettings().updatesEnabled) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', (info) => {
    pendingUpdate = info;
    showInfobar({
      id: 'update',
      text: `Slash ${info.version} is available.`,
      actions: [
        { key: 'update', label: 'Update', primary: true },
        { key: 'notes', label: 'What changed' },
        { key: 'ignore', label: 'Ignore updates' },
        { key: 'close', label: 'Dismiss', close: true },
      ],
    });
  });
  // The user already chose to update, so apply it in place and relaunch.
  autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
  autoUpdater.on('error', () => {
    /* offline / no release yet: stay quiet */
  });
  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.on('infobar:action', (_e, { id, key }) => {
  if (id === 'firstrun') {
    if (key === 'set') {
      app.setAsDefaultProtocolClient('http');
      app.setAsDefaultProtocolClient('https');
      if (process.platform === 'win32') shell.openExternal('ms-settings:defaultapps').catch(() => {});
    }
    writeSettings({ seenDefaultPrompt: true });
    hideInfobar();
  } else if (id === 'update') {
    if (key === 'update') {
      // Download in the background; update-downloaded then restarts in place.
      try {
        autoUpdater.downloadUpdate();
      } catch {
        /* ignore */
      }
      showInfobar({
        id: 'updating',
        text: `Downloading Slash ${pendingUpdate ? pendingUpdate.version : ''}… it will restart when ready.`,
        actions: [{ key: 'close', label: 'Dismiss', close: true }],
      });
    } else if (key === 'notes') {
      const tag = pendingUpdate ? 'tag/v' + pendingUpdate.version : '';
      createTab({ url: 'https://github.com/PythonLuvr/slash/releases' + (tag ? '/' + tag : ''), activate: true });
    } else if (key === 'ignore') {
      writeSettings({ updatesEnabled: false }); // stop offering further updates
      hideInfobar();
    } else {
      hideInfobar(); // dismiss: ask again next launch
    }
  } else if (id === 'updating') {
    hideInfobar();
  }
});

// --- IPC: default browser ---
ipcMain.handle('default:status', () => app.isDefaultProtocolClient('http'));
ipcMain.handle('default:set', () => {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  // Windows can't be forced; open the Default Apps page so the user can pick.
  if (process.platform === 'win32') shell.openExternal('ms-settings:defaultapps').catch(() => {});
  return app.isDefaultProtocolClient('http');
});

// --- IPC: import bookmarks from another browser (Chromium family) ---
function importSources() {
  const LA = process.env.LOCALAPPDATA || '';
  const AD = process.env.APPDATA || '';
  const sources = [
    { id: 'chrome', name: 'Google Chrome', path: path.join(LA, 'Google/Chrome/User Data/Default/Bookmarks') },
    { id: 'edge', name: 'Microsoft Edge', path: path.join(LA, 'Microsoft/Edge/User Data/Default/Bookmarks') },
    { id: 'brave', name: 'Brave', path: path.join(LA, 'BraveSoftware/Brave-Browser/User Data/Default/Bookmarks') },
    { id: 'vivaldi', name: 'Vivaldi', path: path.join(LA, 'Vivaldi/User Data/Default/Bookmarks') },
    { id: 'opera', name: 'Opera', path: path.join(AD, 'Opera Software/Opera Stable/Bookmarks') },
  ];
  return sources.filter((s) => {
    try {
      return s.path && fs.existsSync(s.path);
    } catch {
      return false;
    }
  });
}
function readChromiumBookmarks(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'url' && node.url && /^https?:/i.test(node.url)) {
      out.push({ url: node.url, title: node.name || node.url });
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  const roots = data.roots || {};
  for (const k of Object.keys(roots)) walk(roots[k]);
  return out;
}
ipcMain.handle('import:list', () =>
  importSources().map((s) => {
    let count = 0;
    try {
      count = readChromiumBookmarks(s.path).length;
    } catch {
      /* unreadable */
    }
    return { id: s.id, name: s.name, count };
  }),
);
ipcMain.handle('import:run', (_e, id) => {
  const s = importSources().find((x) => x.id === id);
  if (!s) return { imported: 0 };
  let imported = 0;
  try {
    for (const b of readChromiumBookmarks(s.path)) {
      if (!store.isBookmarked(b.url)) {
        store.addBookmark(b);
        imported++;
      }
    }
  } catch {
    /* ignore */
  }
  sendBookmarks();
  return { imported };
});

// --- IPC: settings ---
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  const next = writeSettings(patch);
  if (patch.accent) broadcastAccent();
  if (typeof patch.doh === 'boolean') applyDoh();
  if (typeof patch.httpsOnly === 'boolean') httpsOnly = next.httpsOnly;
  if (typeof patch.blockAds === 'boolean') setBlocking(next.blockAds);
  return next;
});

// --- IPC: hero search + direct open (load into the active tab) ---
ipcMain.on('hero:search', (_e, { engine, query }) => {
  const make = ENGINES[engine] || ENGINES.duckduckgo;
  const at = activeTab();
  if (query && query.trim() && at) {
    at.onHero = false;
    at.onAIPage = false;
    settingsOpen = false;
    at.view.webContents.loadURL(make(query.trim()));
    updateContentVisibility();
  }
});
ipcMain.on('hero:open', (_e, { url }) => {
  const at = activeTab();
  const target = normalizeInput(url);
  if (target && at) {
    at.onHero = false;
    at.onAIPage = false;
    settingsOpen = false;
    at.view.webContents.loadURL(target);
    updateContentVisibility();
  }
});
// From the hero's "Ask AI" mode: open the panel, set the chosen model, and
// send the prompt into it.
ipcMain.on('hero:ask-ai', (_e, { text, provider }) => {
  const t = (text || '').trim();
  goAIPage(t ? { prompt: { text: t, provider } } : {});
});
