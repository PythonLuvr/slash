const { app, BaseWindow, WebContentsView, ipcMain, Menu, session, shell, clipboard, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, spawn } = require('child_process');
const { readSettings, writeSettings } = require('./lib/settings');
const { STREAMERS, runAnthropicAgent } = require('./lib/api');
const { startMcpServer } = require('./lib/mcp-server');
const { autoUpdater } = require('electron-updater');
const store = require('./lib/store');
const migrate = require('./lib/migrate');
const { migrateToProfiles } = require('./lib/migrate-profiles');
const profiles = require('./lib/profiles');
const vault = require('./lib/vault');
const favicons = require('./lib/favicons');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore } = require('electron-chrome-web-store');

const extByProfile = new Map(); // one ElectronChromeExtensions per profile session

app.setName('Slash');
// Windows taskbar / notification identity (so it groups as Slash, not Electron).
if (process.platform === 'win32') app.setAppUserModelId('com.pythonluvr.slash');

// Make "doesn't phone home" true, not just intended. These switches turn off
// Chromium's background network chatter (component/variations updates, domain
// reliability, push messaging, crash upload) so the engine talks only to the
// sites you visit, your search engine, your DoH resolver, and your AI provider.
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-breakpad'); // no crash-dump upload
app.commandLine.appendSwitch(
  'disable-features',
  'OptimizationHints,OptimizationGuideModelDownloading,MediaRouter,Translate,InterestCohort,AutofillServerCommunication',
);


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
    if (S.win) {
      if (url) createTab({ url, activate: true });
      if (S.win.isMinimized()) S.win.restore();
      S.win.focus();
    }
  });
}

// Chrome = tab strip + toolbar + bookmarks bar. AI panel docks on the right.
const TABSTRIP_HEIGHT = 38;
const TOOLBAR_HEIGHT = 56;
const BOOKMARKS_HEIGHT = 34;
const INFOBAR_HEIGHT = 40;
const BASE_CHROME = TABSTRIP_HEIGHT + TOOLBAR_HEIGHT + BOOKMARKS_HEIGHT;
const FIND_W = 360;
const FIND_HEIGHT = 44;
const AI_WIDTH = 400;
const PERF_WIDTH = 304; // left performance/memory panel
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
// Scratch dir for spawned AI CLIs. Set once the app is ready, under userData
// (writable) rather than next to the app, which is read-only inside the asar.
let AI_CWD = null;

// S.win + per-window views/state live on the window context (S.win, S.chromeView,
// createBrowserWindow) and are referenced as S.chromeView, S.settingsOpen, etc.
let httpsOnly = true; // mirrors settings.httpsOnly (app-level, shared)
const upgraded = new Map(); // upgraded https url -> original http url (shared)

// Popover sizes (the view is sized to the card).
const POP_SIZES = {
  menu: { w: 252, h: 488 },
  profile: { w: 262, h: 300 },
  downloads: { w: 270, h: 230 },
  history: { w: 380, h: 460 },
  siteinfo: { w: 330, h: 264 },
  shield: { w: 268, h: 150 },
  setup: { w: 344, h: 440 },
  enginepick: { w: 216, h: 344 },
  tabmenu: { w: 188, h: 172 },
};

// Top-right cluster popovers anchor right; site-info anchors under the omnibox;
// the first-run setup picker centers under the toolbar.
function popoverPos(kind, s, width) {
  if (kind === 'setup') return { x: Math.max(10, Math.round((width - s.w) / 2)), y: S.CHROME_HEIGHT };
  // The engine picker drops under its button at the left of the omnibox.
  if (kind === 'enginepick') return { x: OMNIBOX_LEFT, y: S.CHROME_HEIGHT };
  // The tab context menu opens at the cursor (clamped to the window).
  if (kind === 'tabmenu') {
    return { x: Math.max(6, Math.min(S.tabMenuPos.x, width - s.w - 6)), y: Math.max(S.CHROME_HEIGHT - 4, S.tabMenuPos.y) };
  }
  const x = kind === 'siteinfo' ? 12 : Math.max(0, width - s.w - 10);
  return { x, y: S.CHROME_HEIGHT };
}
// Approximate x of the omnibox's left edge (after home/back/forward/reload),
// where the search-engine button sits. Tunable if the toolbar spacing changes.
const OMNIBOX_LEFT = 150;

// Tab model. Each tab owns a WebContentsView (untrusted web content). A tab
// with `onHero: true` shows the shared S.heroView instead of its own page.
// Tab model { id, view, title, url, favicon, onHero, ... }. Per-window: lives on
// the window context as S.tabs (with S.activeTabId / S.tabSeq / S.closedStack).

// Multi-window registry. During the multi-window refactor each browser window is
// represented by a context object W (see createBrowserWindow). Phase 1 still keeps
// the single-window globals above as the source of truth for window 0; later steps
// move that state onto W and thread it through the per-window functions.
const windows = [];
let focusedW = null;
// S is the active window context: the W whose per-window state the per-window
// functions read/write. Phase 1 has one window so S is always it; step 1.3 sets
// S per IPC/event so windows become independent.
let S = null;
function focusedWindow() {
  if (focusedW && windows.includes(focusedW)) return focusedW;
  return windows.find((W) => W.win && !W.win.isDestroyed() && W.win.isFocused()) || windows[0] || null;
}
// Make W the active window context AND point the per-profile stores at its
// profile, so history/passwords read and write the right profile's data.
function useWindow(W) {
  S = W;
  if (W) {
    store.setProfile(W.profileId);
    vault.setProfile(W.profileId);
  }
}
// Reflect a window's profile in its title and tell its chrome (for a badge/tint).
function applyWindowProfile(W) {
  if (!W || !W.win || W.win.isDestroyed()) return;
  const p = profiles.getProfile(W.profileId);
  const name = (p && p.name) || 'Personal';
  try {
    W.win.setTitle(W.profileId === 'default' ? 'Slash' : 'Slash (' + name + ')');
  } catch {
    /* ignore */
  }
  if (W.chromeView) {
    W.chromeView.webContents.send('profile-window', {
      id: W.profileId,
      name,
      color: (p && p.color) || '#f1cb53',
      isDefault: W.profileId === 'default',
      partition: profilePartition(W.profileId) || '', // for the extensions toolbar
    });
  }
}

function activeTab() {
  return S.tabs.find((t) => t.id === S.activeTabId) || null;
}

const ENGINES = {
  duckduckgo: (q) => 'https://duckduckgo.com/?q=' + encodeURIComponent(q),
  startpage: (q) => 'https://www.startpage.com/sp/search?query=' + encodeURIComponent(q),
  brave: (q) => 'https://search.brave.com/search?q=' + encodeURIComponent(q),
  google: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q),
  bing: (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q),
  ecosia: (q) => 'https://www.ecosia.org/search?q=' + encodeURIComponent(q),
  wikipedia: (q) => 'https://en.wikipedia.org/w/index.php?search=' + encodeURIComponent(q),
};
// Shared engine list (id/label/domain) so the omnibox picker, the start page,
// and settings all show the same set and the same one default. Privacy-leaning
// engines are listed first.
const ENGINE_META = [
  { id: 'duckduckgo', label: 'DuckDuckGo', domain: 'duckduckgo.com' },
  { id: 'startpage', label: 'Startpage', domain: 'startpage.com' },
  { id: 'brave', label: 'Brave Search', domain: 'brave.com' },
  { id: 'google', label: 'Google', domain: 'google.com' },
  { id: 'bing', label: 'Bing', domain: 'bing.com' },
  { id: 'ecosia', label: 'Ecosia', domain: 'ecosia.org' },
  { id: 'wikipedia', label: 'Wikipedia', domain: 'wikipedia.org' },
];

// Custom (user-added) engines live in settings; each has a url template with
// %s where the query goes. These helpers merge them with the built-ins.
function customEngines() {
  return (readSettings().customEngines || []).filter((c) => c && c.id && c.url);
}
function allEngineMeta() {
  return ENGINE_META.concat(
    customEngines().map((c) => ({ id: c.id, label: c.label, domain: c.domain, custom: true })),
  );
}
function engineExists(id) {
  return !!ENGINES[id] || customEngines().some((c) => c.id === id);
}
function buildSearchUrl(id, q) {
  if (ENGINES[id]) return ENGINES[id](q);
  const c = customEngines().find((x) => x.id === id);
  if (c) return c.url.replace(/%s/g, encodeURIComponent(q));
  return ENGINES.duckduckgo(q);
}

// The user's chosen default search engine (private DuckDuckGo by default).
function searchURL(q) {
  return buildSearchUrl(readSettings().searchEngine, q);
}

// DNS-over-HTTPS so lookups are not readable by the network/ISP. 'secure'
// means all DNS goes through DoH; toggle off in settings if a resolver is
// blocked on your network.
function applyDoh(ses = session.defaultSession) {
  try {
    const on = readSettings().doh;
    ses.configureHostResolver(
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
  const tab = S.tabs.find((t) => {
    try {
      return t.view.webContents.id === id;
    } catch {
      return false;
    }
  });
  if (!tab) return;
  tab.blocked = (tab.blocked || 0) + 1;
  if (tab.id === S.activeTabId) sendBlocked();
}

function sendBlocked() {
  if (!S.chromeView) return;
  const at = activeTab();
  S.chromeView.webContents.send('blocked', {
    count: at ? at.blocked || 0 : 0,
    enabled: readSettings().blockAds,
  });
}

function setupPermissions(ses = session.defaultSession) {
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

// --- Private S.tabs ---
// Private S.tabs share one in-memory session (no `persist:` prefix), so they keep
// no cookies/cache/storage on disk and record no history. Closing the last one
// wipes the session. The same hardening (permissions, DoH, blocker) is applied.
const PRIVATE_PARTITION = 'slash-private';
let privateReady = false;
function privateSession() {
  return session.fromPartition(PRIVATE_PARTITION);
}
function ensurePrivateSession() {
  if (privateReady) return;
  const ps = privateSession();
  try {
    setupPermissions(ps);
    applyDoh(ps);
    if (readSettings().blockAds && blocker) blocker.enableBlockingInSession(ps);
  } catch {
    /* best effort */
  }
  privateReady = true;
}
// Per-profile sessions. The default profile keeps session.defaultSession (so its
// existing logins/cookies survive); every other profile gets its own persistent
// partition, isolated cookies/storage/cache. Each profile session is hardened
// (permissions, DoH, ad/tracker blocking) the first time it is used.
const profileReady = new Set();
function profilePartition(profileId) {
  return profileId === 'default' ? null : 'persist:profile-' + profileId;
}
function profileSession(profileId) {
  const part = profilePartition(profileId);
  return part ? session.fromPartition(part) : session.defaultSession;
}
function ensureProfileSession(profileId) {
  if (profileId === 'default' || profileReady.has(profileId)) return;
  const ps = profileSession(profileId);
  try {
    setupPermissions(ps);
    applyDoh(ps);
    if (readSettings().blockAds && blocker) blocker.enableBlockingInSession(ps);
  } catch {
    /* best effort */
  }
  profileReady.add(profileId);
}

// One Chrome-extension API layer per profile session (content blockers, the Web
// Store, etc.). Created on first use; tabs of that profile register with it so
// chrome.tabs works. Extensions installed in one profile don't appear in others.
function ensureExtensions(profileId) {
  if (extByProfile.has(profileId)) return extByProfile.get(profileId);
  const ses = profileSession(profileId);
  const winOf = () =>
    windows.find((x) => x.profileId === profileId && x.win && !x.win.isDestroyed()) || focusedWindow();
  const tabOf = (wc) => {
    for (const W of windows) {
      if (W.profileId !== profileId) continue;
      const t = W.tabs.find((x) => x.view && x.view.webContents === wc);
      if (t) return { W, t };
    }
    return null;
  };
  let inst = null;
  try {
    ElectronChromeExtensions.handleCRXProtocol(ses);
    inst = new ElectronChromeExtensions({
      license: 'GPL-3.0',
      session: ses,
      createTab: (details) => {
        const W = winOf();
        useWindow(W);
        const id = createTab({ url: details.url, activate: details.active !== false });
        const t = W.tabs.find((x) => x.id === id);
        ensureTabView(t); // extensions expect a real webContents back
        return Promise.resolve([t.view.webContents, W.win]);
      },
      selectTab: (wc) => {
        const hit = tabOf(wc);
        if (hit) {
          useWindow(hit.W);
          activateTab(hit.t.id);
        }
      },
      removeTab: (wc) => {
        const hit = tabOf(wc);
        if (hit) {
          useWindow(hit.W);
          closeTab(hit.t.id);
        }
      },
      createWindow: () => Promise.resolve(createBrowserWindow({ profileId }).win),
      removeWindow: (bw) => {
        try {
          if (bw && !bw.isDestroyed()) bw.destroy();
        } catch {
          /* ignore */
        }
      },
    });
  } catch {
    inst = null;
  }
  extByProfile.set(profileId, inst);
  // Load this profile's saved unpacked extensions and enable Web Store installs.
  try {
    loadSavedExtensions(profileId);
    installChromeWebStore({ session: ses }).catch(() => {});
  } catch {
    /* best effort */
  }
  return inst;
}

function hasPrivateTabs() {
  return S.tabs.some((t) => t.private);
}
function clearPrivateSession() {
  try {
    privateSession()
      .clearStorageData()
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

function enqueuePermission(req) {
  S.permQueue.push(req);
  if (!S.permActive) showNextPermission();
}

function showNextPermission() {
  S.permActive = S.permQueue.shift() || null;
  if (!S.permActive) {
    if (S.permView) S.permView.setVisible(false);
    return;
  }
  ensureView('permView');
  const { width } = S.win.getContentBounds();
  S.permView.setBounds({ x: 12, y: S.CHROME_HEIGHT + 6, width: Math.min(PERM_W, width - 24), height: PERM_H });
  S.permView.setVisible(true);
  S.win.contentView.removeChildView(S.permView);
  S.win.contentView.addChildView(S.permView); // topmost
  viewSend(S.permView, 'perm:show', { origin: S.permActive.origin, action: S.permActive.label });
  S.permView.webContents.focus();
}

function decidePermission(allow) {
  if (!S.permActive) return;
  const { origin, permission, callback } = S.permActive;
  store.setPermission(origin, permission, allow ? 'allow' : 'block');
  try {
    callback(!!allow);
  } catch {
    /* request already gone */
  }
  S.permActive = null;
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

// S.aiOpen now lives on the window context S.

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
  for (const W of windows) {
    for (const key of Object.keys(VIEW_DEFS)) if (W[key]) applyAccent(W[key]);
  }
}

// --- Downloads ---
const downloads = [];
let dlSeq = 0;
function sendDownloads() {
  if (!S.popoverView) return;
  S.popoverView.webContents.send(
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
  if (!S.chromeView) return;
  const at = activeTab();
  const onHero = !!(at && at.onHero);
  const onAIPage = !!(at && at.onAIPage);
  const realPage = at && !onHero && !onAIPage;
  S.chromeView.webContents.send('state', {
    perfOpen: S.perfOpen,
    mode: onAIPage ? 'aipage' : onHero ? 'hero' : 'page',
    aiOpen: S.aiOpen,
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
  if (!S.chromeView) return;
  S.chromeView.webContents.send(
    'tabs',
    S.tabs.map((t) => ({
      id: t.id,
      title: t.onHero ? 'New tab' : t.title || t.url || 'Loading',
      favicon: t.onHero ? null : t.favicon,
      active: t.id === S.activeTabId,
      loading: t.loading,
      suspended: !!t.suspended,
      pinned: !!t.pinned,
      private: !!t.private,
    })),
  );
  scheduleSessionSave(); // persist the open-tab set for next launch
}

// Pinned S.tabs sort to the front; a stable sort preserves order within groups.
function reorderPinned() {
  S.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}
function setPinned(id, pinned) {
  const tab = S.tabs.find((t) => t.id === id);
  if (!tab || tab.pinned === pinned) return;
  tab.pinned = pinned;
  reorderPinned();
  sendTabs();
}
function closeOtherTabs(id) {
  // Close every non-pinned tab except the target.
  for (const t of S.tabs.slice()) {
    if (t.id !== id && !t.pinned) closeTab(t.id);
  }
}

// --- Layout / visibility ---
function layout() {
  const { width, height } = S.win.getContentBounds();
  S.chromeView.setBounds({ x: 0, y: 0, width, height: S.CHROME_HEIGHT });
  const top = S.CHROME_HEIGHT;
  const ch = Math.max(0, height - S.CHROME_HEIGHT);
  const perfW = S.perfOpen ? Math.min(PERF_WIDTH, Math.floor(width * 0.5)) : 0;
  const aiW = S.aiOpen ? Math.min(AI_WIDTH, Math.floor((width - perfW) * 0.5)) : 0;
  const mainX = perfW; // content starts to the right of the left panel
  const mainW = Math.max(0, width - aiW - perfW);
  S.heroView.setBounds({ x: mainX, y: top, width: mainW, height: ch });
  if (S.interstitialView) S.interstitialView.setBounds({ x: mainX, y: top, width: mainW, height: ch });
  if (S.settingsView) S.settingsView.setBounds({ x: mainX, y: top, width: mainW, height: ch });
  if (S.aiPageView) S.aiPageView.setBounds({ x: mainX, y: top, width: mainW, height: ch });
  for (const t of S.tabs) if (t.view) t.view.setBounds({ x: mainX, y: top, width: mainW, height: ch });
  if (S.aiView) S.aiView.setBounds({ x: width - aiW, y: top, width: aiW, height: ch });
  if (S.perfView) S.perfView.setBounds({ x: 0, y: top, width: perfW, height: ch });
  if (S.popKind && S.popoverView) {
    const s = POP_SIZES[S.popKind];
    const { x, y } = popoverPos(S.popKind, s, width);
    S.popoverView.setBounds({ x, y, width: s.w, height: s.h });
  }
  if (S.findOpen && S.findView) {
    S.findView.setBounds({
      x: Math.max(0, width - aiW - FIND_W - 16),
      y: S.CHROME_HEIGHT + 8,
      width: FIND_W,
      height: FIND_HEIGHT,
    });
  }
}

function updateContentVisibility() {
  const at = activeTab();
  if (S.settingsView) S.settingsView.setVisible(S.settingsOpen);
  const onInt = !S.settingsOpen && !!(at && at.failedHttp);
  if (onInt) ensureView('interstitialView');
  if (S.interstitialView) {
    S.interstitialView.setVisible(onInt);
    if (onInt) {
      let host = '';
      try {
        host = new URL(at.failedHttp).host;
      } catch {
        /* keep blank */
      }
      S.interstitialView.webContents.send('interstitial', { url: at.failedHttp, host });
    }
  }
  const onAIPage = !S.settingsOpen && !onInt && !!(at && at.onAIPage);
  if (S.aiPageView) S.aiPageView.setVisible(onAIPage);
  const onContent = S.settingsOpen || onInt || onAIPage;
  S.heroView.setVisible(!onContent && !!at && at.onHero);
  for (const t of S.tabs) if (t.view) t.view.setVisible(!onContent && !!at && t.id === at.id && !at.onHero);
}

function goAIPage(opts = {}) {
  const at = activeTab();
  if (!at) return;
  ensureView('aiPageView');
  at.onAIPage = true;
  at.onHero = false;
  S.settingsOpen = false;
  updateContentVisibility();
  sendState();
  sendTabs();
  if (opts.prompt) viewSend(S.aiPageView, 'ai:prompt', opts.prompt);
  if (opts.load) viewSend(S.aiPageView, 'ai:load', opts.load);
  S.aiPageView.webContents.focus();
}

function openSettingsPage(section) {
  ensureView('settingsView');
  S.settingsOpen = true;
  viewSend(S.settingsView, 'settings:show', typeof section === 'string' ? section : null);
  updateContentVisibility();
  S.settingsView.webContents.focus();
}

function closeSettingsPage() {
  if (!S.settingsOpen) return;
  S.settingsOpen = false;
  updateContentVisibility();
}

// Keep the toolbar and AI panel above all tab content. Remove-then-add so a
// re-stack can never duplicate a child view.
function raiseChrome() {
  for (const v of [S.aiView, S.perfView, S.chromeView, S.popoverView, S.findView, S.ctxView, S.permView]) {
    if (!v) continue;
    S.win.contentView.removeChildView(v);
    S.win.contentView.addChildView(v);
  }
}

// --- Find-in-page ---
function showFind() {
  ensureView('findView');
  S.findOpen = true;
  layout();
  S.findView.setVisible(true);
  S.findView.webContents.focus();
}
function hideFind() {
  S.findOpen = false;
  if (S.findView) S.findView.setVisible(false);
  const at = activeTab();
  if (at && at.view) at.view.webContents.stopFindInPage('clearSelection');
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
  items.push({ id: 'back', label: 'Back', disabled: !(wc && wc.navigationHistory?.canGoBack()) });
  items.push({ id: 'forward', label: 'Forward', disabled: !(wc && wc.navigationHistory?.canGoForward()) });
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
  ensureView('ctxView');
  S.ctxParams = params;
  const items = buildContextMenu(params);
  let h = CTX_FRAME;
  for (const it of items) h += it.sep ? CTX_SEP : CTX_ROW;
  const { width, height } = S.win.getContentBounds();
  // params.x/y are relative to the page view, which sits at (0, S.CHROME_HEIGHT).
  let x = Math.max(4, Math.min(params.x, width - CTX_WIDTH - 4));
  let y = Math.max(S.CHROME_HEIGHT + 4, Math.min(params.y + S.CHROME_HEIGHT, height - h - 4));
  S.ctxView.setBounds({ x, y, width: CTX_WIDTH, height: h });
  S.ctxView.setVisible(true);
  S.win.contentView.removeChildView(S.ctxView);
  S.win.contentView.addChildView(S.ctxView); // keep it topmost
  viewSend(S.ctxView, 'ctx:items', items);
  S.ctxView.webContents.focus();
  S.ctxOpen = true;
}

function hideContext() {
  if (!S.ctxView || !S.ctxOpen) return;
  S.ctxView.setVisible(false);
  S.ctxOpen = false;
  S.ctxParams = null;
}

function runCtxAction(id) {
  const p = S.ctxParams || {};
  const wc = activePageWc();
  switch (id) {
    case 'back':
      if (wc && wc.navigationHistory?.canGoBack()) wc.navigationHistory.goBack();
      break;
    case 'forward':
      if (wc && wc.navigationHistory?.canGoForward()) wc.navigationHistory.goForward();
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
  if (S.chromeView) S.chromeView.webContents.send('bookmarks', store.getBookmarks());
}

// --- Top-right popovers ---
function sendSiteinfo() {
  if (!S.popoverView) return;
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
  S.popoverView.webContents.send('siteinfo', {
    secure: securityOf(at),
    host,
    origin: origin || '',
    permissions: Object.entries(perms).map(([perm, decision]) => ({ perm, decision })),
  });
}

function showPopover(kind) {
  const s = POP_SIZES[kind];
  if (!s) return;
  const v = ensureView('popoverView');
  S.popKind = kind;
  const { width } = S.win.getContentBounds();
  const { x, y } = popoverPos(kind, s, width);
  v.setBounds({ x, y, width: s.w, height: s.h });
  v.setVisible(true);
  // Populate once the overlay renderer is ready (it may have just been created).
  const populate = () => {
    if (S.popKind !== kind) return;
    v.webContents.send('pop:show', kind);
    sendDownloads();
    if (kind === 'history') v.webContents.send('history', store.getHistory().slice(0, 300));
    if (kind === 'siteinfo') sendSiteinfo();
    if (kind === 'shield') sendShield();
    if (kind === 'setup') sendSetup();
    if (kind === 'enginepick') v.webContents.send('enginepick', { current: readSettings().searchEngine, list: allEngineMeta() });
    if (kind === 'tabmenu') {
      const t = S.tabs.find((x) => x.id === S.tabMenuTarget);
      v.webContents.send('tabmenu', { pinned: !!(t && t.pinned) });
    }
  };
  if (v.ready) populate();
  else v.webContents.once('did-finish-load', populate);
  v.webContents.focus();
}

// One default search engine, reflected in the omnibox button and the start page.
function broadcastSearchEngine() {
  const cur = readSettings().searchEngine;
  if (S.chromeView) S.chromeView.webContents.send('search-engine', cur);
  if (S.heroView) S.heroView.webContents.send('search-engine', cur);
}
// The full engine set changed (custom engine added/removed): refresh the views
// that hold a copy of the list so they can render new entries.
function broadcastEngineList() {
  const list = allEngineMeta();
  if (S.chromeView) S.chromeView.webContents.send('search-list', list);
  if (S.heroView) S.heroView.webContents.send('search-list', list);
}

// First-run setup picker: current default-browser status + importable sources.
function sendSetup() {
  S.popoverView.webContents.send('setup:default', app.isDefaultProtocolClient('http'));
  migrateSourceList()
    .then((list) => S.popoverView.webContents.send('setup:sources', list))
    .catch(() => S.popoverView.webContents.send('setup:sources', []));
}

function sendShield() {
  if (!S.popoverView) return;
  const at = activeTab();
  S.popoverView.webContents.send('shield', {
    count: at ? at.blocked || 0 : 0,
    enabled: readSettings().blockAds,
  });
}
function hidePopover() {
  if (!S.popoverView) return;
  S.popoverView.setVisible(false);
  S.popKind = null;
}
function togglePopover(kind) {
  if (S.popKind === kind) hidePopover();
  else showPopover(kind);
}

// --- Tabs ---
// Build (or rebuild) a tab's WebContentsView and wire all its handlers. Split
// out of createTab so a suspended tab can be re-created on demand. Tab content
// stays untrusted (sandboxed, isolated); the only addition is a minimal
// autofill preload that fills saved logins and never exposes them.
function attachTabView(tab) {
  const id = tab.id;
  const myW = S; // the window this tab belongs to; async events re-select it
  tab.W = myW;
  const webPreferences = { ...SECURE_PREFS, preload: path.join(__dirname, 'tab-preload.js') };
  if (tab.private) {
    webPreferences.partition = PRIVATE_PARTITION; // in-memory, no traces
  } else if (myW.profileId && myW.profileId !== 'default') {
    ensureProfileSession(myW.profileId); // isolated cookies/logins per profile
    webPreferences.partition = profilePartition(myW.profileId);
  }
  const view = new WebContentsView({ webPreferences });
  tab.view = view;
  const wc = view.webContents;
  // Track this tab for its profile's Chrome-extension APIs (private tabs stay out).
  if (!tab.private) {
    const ext = extByProfile.get(myW.profileId);
    if (ext) {
      try {
        ext.addTab(wc, myW.win);
      } catch {
        /* ignore */
      }
    }
  }

  const refresh = () => {
    if (!wc || wc.isDestroyed()) return;
    useWindow(myW); // events can fire for a background window; act on the tab's window
    tab.url = wc.getURL();
    const t = wc.getTitle();
    if (t) tab.title = t;
    const nh = wc.navigationHistory;
    tab.canGoBack = nh ? nh.canGoBack() : false;
    tab.canGoForward = nh ? nh.canGoForward() : false;
    tab.loading = wc.isLoading();
    if (tab.url) tab.onHero = false;
    if (id === S.activeTabId) sendState();
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
    useWindow(myW);
    tab.favicon = (favs && favs[0]) || null;
    // Cache the real favicon locally so the start page / bookmarks can show it
    // without calling a third-party favicon service.
    if (tab.favicon) favicons.rememberFromPage(wc.getURL(), tab.favicon);
    sendTabs();
  });
  // History: record on real navigations, update the title when it resolves.
  // Private S.tabs leave no history.
  wc.on('did-navigate', () => {
    upgraded.delete(wc.getURL());
    if (!tab.private) store.addHistory({ url: wc.getURL(), title: wc.getTitle() });
  });
  wc.on('page-title-updated', () => {
    if (!tab.private) store.addHistory({ url: wc.getURL(), title: wc.getTitle() });
  });
  // Find-in-page match counts for this tab.
  wc.on('found-in-page', (_e, result) => {
    useWindow(myW);
    if (S.findView) {
      S.findView.webContents.send('find:result', {
        active: result.activeMatchOrdinal,
        total: result.matches,
      });
    }
  });
  // HTTPS-only: a failed upgrade shows the interstitial; any fresh load clears it.
  wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED
    useWindow(myW);
    const httpUrl = upgraded.get(validatedURL);
    if (httpUrl) {
      upgraded.delete(validatedURL);
      tab.failedHttp = httpUrl;
      tab.onHero = false;
      if (id === S.activeTabId) {
        updateContentVisibility();
        sendState();
      }
    }
  });
  wc.on('did-start-loading', () => {
    useWindow(myW);
    tab.blocked = 0;
    // New page: forget any "add this site" offer until it re-declares one.
    tab.pendingEngine = null;
    tab.pendingEngineHref = null;
    if (id === S.activeTabId) sendAddEngine();
    if (tab.failedHttp) {
      tab.failedHttp = null;
      if (id === S.activeTabId) updateContentVisibility();
    }
    if (id === S.activeTabId) sendBlocked();
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
    useWindow(myW);
    hidePopover();
    showContext(params);
  });
  // Links that open a new window become new tabs (private stays private).
  wc.setWindowOpenHandler(({ url }) => {
    useWindow(myW);
    createTab({ url, activate: true, private: tab.private });
    return { action: 'deny' };
  });
  attachShortcuts(wc);

  S.win.contentView.addChildView(view);
  view.setVisible(false);
  raiseChrome();
  return view;
}

function createTab(opts = {}) {
  const id = ++S.tabSeq;
  if (opts.private) ensurePrivateSession(); // harden the in-memory session first
  const tab = {
    id,
    view: null,
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
    lastActive: Date.now(), // for idle-based suspension
    suspended: false, // renderer freed; url/title/favicon kept
    pinned: false, // pinned S.tabs sit first, compact, and survive "close others"
    private: !!opts.private, // in-memory session, no history, no traces
  };
  S.tabs.push(tab);

  if (opts.url) {
    // Navigating immediately: give it a renderer now.
    tab.onHero = false;
    attachTabView(tab);
    tab.view.webContents.loadURL(normalizeInput(opts.url) || opts.url);
  }
  // A blank start-page tab stays viewless until it navigates (see ensureTabView).
  if (opts.activate !== false) activateTab(id);
  else sendTabs();
  layout();
  return id;
}

function activateTab(id) {
  const tab = S.tabs.find((t) => t.id === id);
  if (!tab) return;
  // Mark the tab we are leaving as idle-from-now.
  const prev = S.tabs.find((t) => t.id === S.activeTabId);
  if (prev && prev.id !== id) prev.lastActive = Date.now();
  if (tab.suspended) wakeTab(tab); // bring a discarded tab back before showing it
  tab.lastActive = Date.now();
  S.activeTabId = id;
  S.settingsOpen = false;
  const ext = extByProfile.get(S.profileId);
  if (ext && tab.view) {
    try {
      ext.selectTab(tab.view.webContents);
    } catch {
      /* ignore */
    }
  }
  updateContentVisibility();
  sendState();
  sendTabs();
  sendBlocked();
  sendAddEngine();
}

// --- Tab suspension (discarding) ---
// Free a background tab's renderer once it has been idle, keeping its
// url/title/favicon so it reopens instantly when clicked. This is the real
// memory win: a Chromium renderer is tens to hundreds of MB.
const SUSPEND_MS = 15 * 60 * 1000;

function suspendTab(tab) {
  if (!tab || tab.suspended || !tab.view || tab.id === S.activeTabId || tab.onHero) return;
  tab.url = tab.view.webContents.getURL() || tab.url; // remember where it was
  S.win.contentView.removeChildView(tab.view);
  try {
    tab.view.webContents.close();
  } catch {
    /* already gone */
  }
  tab.view = null;
  tab.suspended = true;
  tab.loading = false;
  sendTabs();
}

function wakeTab(tab) {
  if (!tab || !tab.suspended) return;
  attachTabView(tab);
  tab.suspended = false;
  if (tab.url) {
    tab.onHero = false;
    tab.view.webContents.loadURL(tab.url);
  }
  layout();
}

// A blank (start-page) tab has no renderer until it actually goes somewhere.
// Create its view on demand so an idle "New tab" costs nothing.
function ensureTabView(tab) {
  if (tab && !tab.view) {
    attachTabView(tab);
    layout();
  }
  return tab && tab.view;
}

function maybeSuspendIdleTabs() {
  const now = Date.now();
  const prev = S;
  for (const W of windows) {
    useWindow(W);
    for (const t of W.tabs) {
      if (t.id === W.activeTabId || t.suspended || !t.view || t.onHero) continue;
      if (now - (t.lastActive || 0) > SUSPEND_MS) suspendTab(t);
    }
  }
  if (prev) useWindow(prev);
}

// Total app memory across every process, in MB.
function totalMemoryMB() {
  try {
    return Math.round(app.getAppMetrics().reduce((s, m) => s + (m.memory ? m.memory.workingSetSize : 0), 0) / 1024);
  } catch {
    return 0;
  }
}

// RAM limiter (Opera GX style): when total memory is over the user's cap,
// discard the least-recently-used background tabs until it's back under, or
// there are none left to discard. The active tab is never touched.
function enforceRamLimit() {
  const cap = readSettings().ramLimitMB;
  if (!cap) return; // 0 = unlimited
  let overage = totalMemoryMB() - cap;
  if (overage <= 0) return;
  const metrics = app.getAppMetrics();
  const memByPid = new Map(metrics.map((m) => [m.pid, m.memory ? Math.round(m.memory.workingSetSize / 1024) : 0]));
  const candidates = [];
  for (const W of windows) {
    for (const t of W.tabs) {
      if (t.id === W.activeTabId || t.suspended || !t.view || t.onHero || t.private) continue;
      candidates.push({ W, t });
    }
  }
  candidates.sort((a, b) => (a.t.lastActive || 0) - (b.t.lastActive || 0)); // LRU first
  const prev = S;
  for (const { W, t } of candidates) {
    if (overage <= 0) break;
    let freed = 150; // fallback estimate if we can't read the renderer's footprint
    try {
      freed = memByPid.get(t.view.webContents.getOSProcessId()) || freed;
    } catch {
      /* use estimate */
    }
    useWindow(W);
    suspendTab(t);
    overage -= freed; // estimate; the next tick rechecks actual memory and converges
  }
  if (prev) useWindow(prev);
}

function closeTab(id) {
  const idx = S.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = S.tabs[idx];
  // Private S.tabs never go on the reopen stack (no traces).
  if (tab.url && !tab.private) S.closedStack.push(tab.url);
  if (tab.view) {
    S.win.contentView.removeChildView(tab.view);
    try {
      tab.view.webContents.close();
    } catch {
      /* already gone */
    }
  }
  S.tabs.splice(idx, 1);
  // Wipe the private session once the last private tab is gone.
  if (tab.private && !hasPrivateTabs()) clearPrivateSession();

  if (S.activeTabId === id) {
    const next = S.tabs[idx] || S.tabs[idx - 1];
    if (next) activateTab(next.id);
    else createTab(); // never leave zero S.tabs
  } else {
    sendTabs();
  }
}

function reopenClosed() {
  const url = S.closedStack.pop();
  if (url) createTab({ url, activate: true });
}

function cycleTab(dir) {
  if (S.tabs.length < 2) return;
  const i = S.tabs.findIndex((t) => t.id === S.activeTabId);
  const next = S.tabs[(i + dir + S.tabs.length) % S.tabs.length];
  activateTab(next.id);
}

function jumpTab(n) {
  const target = n === 9 ? S.tabs[S.tabs.length - 1] : S.tabs[n - 1];
  if (target) activateTab(target.id);
}

function goHome() {
  const at = activeTab();
  if (!at) return;
  at.onHero = true;
  at.onAIPage = false;
  S.settingsOpen = false;
  updateContentVisibility();
  sendState();
  sendTabs();
}

// --- AI panel ---
function toggleAI(force) {
  S.aiOpen = typeof force === 'boolean' ? force : !S.aiOpen;
  if (S.aiOpen) ensureView('aiView');
  if (S.aiView) S.aiView.setVisible(S.aiOpen);
  layout();
  if (S.aiOpen && S.aiView) S.aiView.webContents.focus();
  sendState();
}

// Left memory/performance panel (Opera GX style).
function togglePerf(force) {
  S.perfOpen = typeof force === 'boolean' ? force : !S.perfOpen;
  if (S.perfOpen) ensureView('perfView');
  if (S.perfView) S.perfView.setVisible(S.perfOpen);
  layout();
  if (S.perfOpen && S.perfView) S.perfView.webContents.focus();
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
    if (key === 'n' && !input.shift) return (createBrowserWindow(), stop());
    if (key === 'n' && input.shift) return (createTab({ private: true, activate: true }), stop());
    if (key === 'w') return (S.activeTabId && closeTab(S.activeTabId), stop());
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
      S.chromeView.webContents.send('focus-omnibox');
      S.chromeView.webContents.focus();
      return stop();
    }
  });
}

// Per-window UI views. Only the toolbar (chrome) and start page (hero) are built
// up front; the rest (AI panel + page, settings, find bar, the menu/context/
// permission overlays, HTTPS interstitial) are created the first time they are
// shown. This avoids paying ~8 extra Chromium renderer processes of memory per
// window for views you may never open.
const VIEW_DEFS = {
  heroView: ['hero-preload.js', 'hero.html'],
  chromeView: ['preload.js', 'index.html'],
  aiView: ['ai-preload.js', 'ai.html'],
  perfView: ['perf-preload.js', 'perf.html'],
  aiPageView: ['ai-preload.js', 'ai-page.html'],
  settingsView: ['settings-preload.js', 'settings.html'],
  interstitialView: ['interstitial-preload.js', 'interstitial.html'],
  popoverView: ['overlay-preload.js', 'overlay.html'],
  findView: ['find-preload.js', 'find.html'],
  ctxView: ['context-preload.js', 'context.html'],
  permView: ['permission-preload.js', 'permission.html'],
};
function makeView(key, visible) {
  const [preload, html] = VIEW_DEFS[key];
  const v = new WebContentsView({ webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, preload) } });
  S[key] = v;
  S.win.contentView.addChildView(v);
  try { v.setBackgroundColor('#1c1c1f'); } catch { /* older electron */ } // no white flash while loading
  v.webContents.loadFile(path.join(__dirname, html));
  v.setVisible(!!visible);
  v.ready = false;
  attachShortcuts(v.webContents);
  v.webContents.on('did-finish-load', () => {
    v.ready = true;
    applyAccent(v);
  });
  v.webContents.on('will-navigate', (e) => e.preventDefault());
  v.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (key === 'popoverView') {
    v.webContents.on('blur', () => {
      if (S.popKind !== 'setup') hidePopover();
    });
  }
  if (key === 'ctxView') v.webContents.on('blur', hideContext);
  return v;
}
// Lazily create a view the first time it's needed, keeping chrome/overlays on top.
function ensureView(key) {
  if (S[key]) return S[key];
  const v = makeView(key, false);
  raiseChrome(); // the new view was added on top; restore z-order
  return v;
}
// Send to a view, waiting for it to finish loading if it was just created (so the
// initial message isn't lost before the renderer's listeners are registered).
function viewSend(v, channel, ...args) {
  if (!v) return;
  const wc = v.webContents;
  if (v.ready) {
    try {
      wc.send(channel, ...args);
    } catch {
      /* gone */
    }
  } else {
    wc.once('did-finish-load', () => {
      try {
        wc.send(channel, ...args);
      } catch {
        /* gone */
      }
    });
  }
}

function createBrowserWindow(opts = {}) {
  // Per-window state lives on W; S points at the window currently being operated
  // on. Views are created lazily (see makeView/ensureView); only chrome + hero
  // are built up front.
  const W = {};
  W.profileId = opts.profileId || 'default';
  windows.push(W);
  focusedW = W;
  useWindow(W);
  W.tabs = [];
  W.activeTabId = null;
  W.tabSeq = 0;
  W.closedStack = [];
  W.settingsOpen = false;
  W.popKind = null;
  W.findOpen = false;
  W.findText = '';
  W.ctxOpen = false;
  W.ctxParams = null;
  W.permActive = null;
  W.permQueue = [];
  W.aiOpen = false;
  W.perfOpen = false;
  W.infobarOpen = false;
  W.CHROME_HEIGHT = BASE_CHROME;
  W.tabMenuTarget = null;
  W.tabMenuPos = { x: 0, y: 0 };

  S.win = new BaseWindow({
    width: 1280,
    height: 860,
    title: 'Slash',
    backgroundColor: '#1c1c1f',
    icon: path.join(__dirname, 'icon.png'),
  });

  // Chrome-extension API support for this window's profile (created once per
  // profile; many windows of a profile share it).
  ensureExtensions(W.profileId);

  // Start page (below) and the toolbar (on top). Everything else is lazy.
  makeView('heroView', false);
  makeView('chromeView', true);

  S.win.on('focus', () => {
    focusedW = W;
    useWindow(W);
  });

  S.win.on('closed', () => {
    // Capture this window's tabs first (so the last window restores next launch),
    // flushing any pending debounced save.
    if (sessionSaveTimer) {
      clearTimeout(sessionSaveTimer);
      sessionSaveTimer = null;
    }
    saveSession();
    const i = windows.indexOf(W);
    if (i !== -1) windows.splice(i, 1);
    for (const t of W.tabs) {
      try {
        if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.destroy();
      } catch {
        /* ignore */
      }
    }
    saveSession(); // persist the remaining open windows (no-op if none, see guard)
    if (focusedW === W) focusedW = windows[0] || null;
    if (S === W) useWindow(focusedW);
  });

  S.win.on('resize', () => {
    useWindow(W);
    hideContext();
    layout();
  });
  layout();

  // A restored window gets its saved tabs (background tabs come back suspended/
  // lazy); a window opened later (Ctrl+N) starts with a fresh hero tab.
  if (opts.session) restoreSessionInto(opts.session);
  if (!S.tabs.length) createTab(); // nothing restored / fresh window: a hero tab
  applyWindowProfile(W); // window title (+ chrome badge) for its profile
  return W;
}

// --- Session restore: reopen the S.tabs you had open last time ---
function sessionPath() {
  return path.join(app.getPath('userData'), 'slash-session.json');
}
// One window's restorable tabs (private tabs are ephemeral and never saved).
function sessionForWindow(W) {
  const open = W.tabs.filter((t) => !t.onHero && !t.private && (t.url || t.suspended));
  const list = open.map((t) => ({ url: t.url, title: t.title, pinned: !!t.pinned }));
  const active = Math.max(0, open.findIndex((t) => t.id === W.activeTabId));
  return { profileId: W.profileId || 'default', tabs: list, active };
}
function saveSession() {
  try {
    const list = windows.map(sessionForWindow).filter((w) => w.tabs.length);
    // Never clobber a good session with nothing: closing the last window removes
    // it from windows[] before before-quit fires, so an empty save here would
    // erase what you had open. Keep the last non-empty snapshot instead.
    if (!list.length) return;
    fs.writeFileSync(sessionPath(), JSON.stringify({ windows: list }), 'utf8');
  } catch {
    /* best effort */
  }
}
let sessionSaveTimer = null;
function scheduleSessionSave() {
  if (sessionSaveTimer) return;
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    saveSession();
  }, 1500);
}
// Restore one window's tabs into the current window (S). Operates on S because
// it runs inside createBrowserWindow for the window being built.
function restoreSessionInto(sess) {
  if (!sess || !Array.isArray(sess.tabs) || !sess.tabs.length) return;
  for (const t of sess.tabs) {
    if (!t || !t.url || !/^https?:\/\//i.test(t.url)) continue;
    // Create as a suspended (lazy) tab; it loads when activated/clicked.
    const id = ++S.tabSeq;
    S.tabs.push({
      id,
      view: null,
      title: t.title || t.url,
      url: t.url,
      favicon: null,
      onHero: false,
      canGoBack: false,
      canGoForward: false,
      loading: false,
      failedHttp: null,
      blocked: 0,
      onAIPage: false,
      lastActive: Date.now(),
      suspended: true,
      pinned: !!t.pinned,
    });
  }
  if (!S.tabs.length) return;
  const idx = Math.min(Math.max(0, sess.active | 0), S.tabs.length - 1);
  activateTab(S.tabs[idx].id); // wakes + loads just the active one
  layout();
}

// At startup, recreate every window that was open last time (each with its own
// tabs). Back-compatible with the old single-window { tabs, active } shape.
function restoreWindows() {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(sessionPath(), 'utf8'));
  } catch {
    /* no session */
  }
  let wins = [];
  if (saved && Array.isArray(saved.windows)) wins = saved.windows.filter((w) => w && Array.isArray(w.tabs) && w.tabs.length);
  else if (saved && Array.isArray(saved.tabs) && saved.tabs.length) wins = [saved]; // legacy
  const startUrl = urlFromArgv(process.argv);
  if (!wins.length) {
    createBrowserWindow();
    if (startUrl) createTab({ url: startUrl, activate: true });
    return;
  }
  wins.forEach((wsess, i) => {
    // Skip windows whose profile was deleted; fall back to default.
    const pid = wsess.profileId && profiles.getProfile(wsess.profileId) ? wsess.profileId : 'default';
    createBrowserWindow({ profileId: pid, session: wsess });
    if (i === 0 && startUrl) createTab({ url: startUrl, activate: true });
  });
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
  if (fetcherView || !S.win) return fetcherView;
  fetcherView = new WebContentsView({ webPreferences: { ...SECURE_PREFS } });
  S.win.contentView.addChildView(fetcherView);
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
      if (S.heroView) S.heroView.webContents.send('hero:add-dial', { name: input.name || '', url });
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
  // One-time: move existing single-profile data into profiles/default/ before
  // anything reads it. Idempotent; keeps .bak copies.
  try {
    migrateToProfiles(app.getPath('userData'));
  } catch {
    /* non-fatal */
  }
  AI_CWD = path.join(app.getPath('userData'), 'ai-scratch');
  try {
    fs.mkdirSync(AI_CWD, { recursive: true });
  } catch {
    /* non-fatal: AI CLI scratch dir */
  }
  httpsOnly = readSettings().httpsOnly;
  applyDoh();
  setupPermissions();
  setupDownloads();
  restoreWindows();
  setupBlocker();
  registerAsBrowser(); // make Slash selectable in Windows Default Apps (packaged)
  // Per-profile extensions (load + Web Store) are set up by ensureExtensions when
  // each profile's first window opens.
  favicons.seedBrands(); // pre-cache the fixed brand icons locally (no 3rd party)
  setInterval(maybeSuspendIdleTabs, 60 * 1000); // free long-idle background tabs
  setInterval(enforceRamLimit, 12 * 1000); // keep total memory under the user's cap

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
    if (BaseWindow.getAllWindows().length === 0) createBrowserWindow();
  });
});

app.on('before-quit', () => saveSession()); // flush the session before exiting
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Resolve which window an IPC event came from (its chrome views or one of its
// tab views) so the per-window functions act on that window. Falls back to the
// focused window.
function windowFromEvent(e) {
  const wc = e && e.sender;
  if (wc) {
    for (const W of windows) {
      const views = [
        W.chromeView, W.heroView, W.aiView, W.perfView, W.aiPageView, W.popoverView,
        W.findView, W.ctxView, W.permView, W.interstitialView, W.settingsView,
      ];
      if (views.some((v) => v && v.webContents === wc)) return W;
      if (W.tabs.some((t) => t.view && t.view.webContents === wc)) return W;
    }
  }
  return focusedWindow();
}
// Wrap ipcMain so every handler first points S at the sending window. Bracket
// notation keeps these two calls out of the on/handle -> onWin/handleWin rewrite.
function onWin(channel, fn) {
  ipcMain['on'](channel, (e, ...args) => {
    const W = windowFromEvent(e);
    if (W) useWindow(W);
    return fn(e, ...args);
  });
}
function handleWin(channel, fn) {
  return ipcMain['handle'](channel, (e, ...args) => {
    const W = windowFromEvent(e);
    if (W) useWindow(W);
    return fn(e, ...args);
  });
}

// --- IPC: navigation (acts on the active tab) ---
handleWin('navigate', (_e, input) => {
  if (isAIAddress(input)) {
    goAIPage();
    return 'slash://ai';
  }
  const url = normalizeInput(input);
  const at = activeTab();
  if (url && at) {
    at.onHero = false;
    at.onAIPage = false;
    S.settingsOpen = false;
    ensureTabView(at); // blank tabs have no renderer until now
    at.view.webContents.loadURL(url);
    updateContentVisibility();
  }
  return url;
});
onWin('back', () => {
  const at = activeTab();
  if (at && at.view && at.view.webContents.navigationHistory?.canGoBack()) at.view.webContents.navigationHistory.goBack();
});
onWin('forward', () => {
  const at = activeTab();
  if (at && at.view && at.view.webContents.navigationHistory?.canGoForward())
    at.view.webContents.navigationHistory.goForward();
});
onWin('reload', () => {
  const at = activeTab();
  if (at && !at.onHero) at.view.webContents.reload();
});
onWin('stop', () => {
  const at = activeTab();
  if (at && at.view) at.view.webContents.stop();
});
onWin('go-home', goHome);
onWin('ready', () => {
  sendState();
  sendTabs();
  sendDownloads();
  sendBookmarks();
  sendBlocked();
  maybeShowFirstRun();
});
onWin('zoom', (_e, dir) => {
  const at = activeTab();
  if (!at || !at.view) return;
  const wc = at.view.webContents;
  if (dir === 'reset') wc.setZoomLevel(0);
  else wc.setZoomLevel(wc.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5));
});
onWin('open-settings', () => {
  toggleAI(true);
  S.aiView.webContents.send('open-settings');
});
onWin('settings:open', (_e, section) => openSettingsPage(section));
onWin('settings:close', closeSettingsPage);
onWin('settings:open-ai', () => {
  closeSettingsPage();
  toggleAI(true);
  S.aiView.webContents.send('open-settings');
});
onWin('download:open', (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d && d.path) shell.openPath(d.path);
});
onWin('download:show', (_e, id) => {
  const d = downloads.find((x) => x.id === id);
  if (d && d.path) shell.showItemInFolder(d.path);
});
onWin('pop:toggle', (_e, kind) => togglePopover(kind));
onWin('pop:close', hidePopover);
onWin('pop:setup', () => showPopover('setup')); // open the import picker from the profile menu

// --- IPC: default search engine (omnibox picker + start page share one value) ---
// list = the full engine set (omnibox dropdown). favorites = the ordered subset
// shown as quick-pick chips on the start page (user-customizable).
handleWin('search:get', () => {
  const fav = (readSettings().heroEngines || []).filter((id) => engineExists(id));
  return { current: readSettings().searchEngine, list: allEngineMeta(), favorites: fav };
});
onWin('search:set', (_e, id) => {
  if (!engineExists(id)) return;
  writeSettings({ searchEngine: id });
  broadcastSearchEngine();
  hidePopover();
});
// The start page (or settings) saves the quick-pick chips (add/remove/reorder).
onWin('hero:engines-set', (_e, ids) => {
  if (!Array.isArray(ids)) return;
  writeSettings({ heroEngines: ids.filter((id) => engineExists(id)) });
  if (S.heroView) {
    S.heroView.webContents.send('hero-engines', (readSettings().heroEngines || []).filter((id) => engineExists(id)));
  }
});

// Add a custom engine (name + url template with %s). Returns { ok, engine } or
// { error }. The new engine then appears in the picker, settings, and the +.
function addEngineInternal(label, url) {
  label = String(label || '').trim();
  url = String(url || '').trim().replace(/\{searchTerms\}|\{q\}/gi, '%s');
  if (!label || !/^https?:\/\//i.test(url) || !/%s/.test(url)) {
    return { error: 'Add a name and a URL with %s where the search term goes.' };
  }
  let domain = '';
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return { error: 'That URL is not valid.' };
  }
  const existing = customEngines();
  const base = 'custom-' + (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'engine');
  let id = base;
  let n = 2;
  while (ENGINES[id] || existing.some((c) => c.id === id)) id = base + '-' + n++;
  const engine = { id, label, domain, url };
  writeSettings({ customEngines: existing.concat([engine]) });
  try {
    favicons.remember('https://' + domain + '/favicon.ico', domain);
  } catch {
    /* best effort */
  }
  broadcastEngineList();
  return { ok: true, engine: { id, label, domain, custom: true } };
}
handleWin('engine:add', (_e, { label, url } = {}) => addEngineInternal(label, url));

// Remove a custom engine and clean up any references to it.
handleWin('engine:remove', (_e, id) => {
  const existing = customEngines();
  if (!existing.some((c) => c.id === id)) return { error: 'not a custom engine' };
  const s = readSettings();
  const patch = { customEngines: existing.filter((c) => c.id !== id) };
  if (s.searchEngine === id) patch.searchEngine = 'duckduckgo';
  if ((s.heroEngines || []).includes(id)) patch.heroEngines = s.heroEngines.filter((x) => x !== id);
  writeSettings(patch);
  broadcastSearchEngine();
  broadcastEngineList();
  if (S.heroView) {
    S.heroView.webContents.send('hero-engines', (readSettings().heroEngines || []).filter((x) => engineExists(x)));
  }
  return { ok: true };
});

// --- OpenSearch auto-detect: "add this site's search" from the URL bar ---
// When a page declares an OpenSearch descriptor, we fetch it, parse the name +
// HTML search template, and offer a one-click add in the toolbar.
function fetchText(url, cap = 256 * 1024) {
  return new Promise((resolve) => {
    try {
      const req = net.request(url);
      const chunks = [];
      let bytes = 0;
      const to = setTimeout(() => {
        try {
          req.abort();
        } catch {
          /* ignore */
        }
        resolve('');
      }, 6000);
      req.on('response', (res) => {
        if (res.statusCode >= 400) {
          clearTimeout(to);
          res.resume();
          return resolve('');
        }
        res.on('data', (d) => {
          bytes += d.length;
          if (bytes > cap) {
            try {
              req.abort();
            } catch {
              /* ignore */
            }
          } else chunks.push(d);
        });
        res.on('end', () => {
          clearTimeout(to);
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      });
      req.on('error', () => {
        clearTimeout(to);
        resolve('');
      });
      req.on('abort', () => {
        clearTimeout(to);
        resolve('');
      });
      req.end();
    } catch {
      resolve('');
    }
  });
}
function parseOpenSearch(xml) {
  if (!xml) return null;
  const name = (xml.match(/<ShortName>\s*([^<]+?)\s*<\/ShortName>/i) || [])[1] || '';
  const tags = xml.match(/<Url\b[^>]*>/gi) || [];
  let template = '';
  for (const tag of tags) {
    if (!/type\s*=\s*["']text\/html["']/i.test(tag)) continue;
    const t = (tag.match(/template\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (t && /\{searchTerms\}/i.test(t)) {
      template = t;
      break;
    }
  }
  if (!template) return null;
  // Drop optional OpenSearch params, keep the query placeholder.
  template = template.replace(/\{searchTerms\}/gi, '%s').replace(/\{[^}]*\}/g, '');
  if (!/^https?:\/\//i.test(template) || !/%s/.test(template)) return null;
  return { name: name.trim(), template };
}

function tabByContents(wc) {
  return S.tabs.find((t) => t.view && t.view.webContents === wc) || null;
}
// Push the active tab's "add this site" state to the toolbar.
function sendAddEngine() {
  const at = activeTab();
  const pe = at && at.pendingEngine ? at.pendingEngine : null;
  if (S.chromeView) S.chromeView.webContents.send('add-engine', pe ? { name: pe.name } : null);
}
onWin('opensearch:found', async (e, { href } = {}) => {
  const tab = tabByContents(e.sender);
  if (!tab || !href || tab.pendingEngineHref === href) return;
  tab.pendingEngineHref = href;
  try {
    const meta = parseOpenSearch(await fetchText(href));
    if (!meta) return;
    let domain = '';
    try {
      domain = new URL(meta.template).hostname.replace(/^www\./, '');
    } catch {
      return;
    }
    // Don't offer one we already have (built-in or custom) for this domain.
    if (allEngineMeta().some((m) => m.domain === domain)) return;
    tab.pendingEngine = { name: meta.name || domain, template: meta.template, domain };
    if (tab.id === S.activeTabId) sendAddEngine();
  } catch {
    /* ignore */
  }
});
handleWin('engine:add-current', () => {
  const at = activeTab();
  if (!at || !at.pendingEngine) return { error: 'nothing to add' };
  const r = addEngineInternal(at.pendingEngine.name, at.pendingEngine.template);
  if (r.ok) {
    at.pendingEngine = null;
    sendAddEngine();
  }
  return r;
});

// --- IPC: bookmarks ---
onWin('bookmark:toggle', () => {
  const at = activeTab();
  if (!at || at.onHero) return;
  const url = at.view.webContents.getURL();
  if (store.isBookmarked(url)) store.removeBookmark(url);
  else store.addBookmark({ url, title: at.title });
  sendBookmarks();
  sendState();
});
onWin('bookmark:remove', (_e, url) => {
  store.removeBookmark(url);
  sendBookmarks();
  sendState();
});

// --- IPC: find-in-page ---
onWin('find:query', (_e, { text, forward }) => {
  const at = activeTab();
  if (!at || !at.view) return;
  S.findText = text || '';
  if (!S.findText) {
    at.view.webContents.stopFindInPage('clearSelection');
    return;
  }
  at.view.webContents.findInPage(S.findText, { forward: forward !== false, findNext: false });
});
onWin('find:next', (_e, forward) => {
  const at = activeTab();
  if (at && at.view && S.findText) at.view.webContents.findInPage(S.findText, { forward, findNext: true });
});
onWin('find:close', hideFind);
onWin('find:show', showFind);

// --- IPC: context menu ---
onWin('ctx:invoke', (_e, id) => runCtxAction(id));
onWin('ctx:close', hideContext);

// --- IPC: permission prompt ---
onWin('perm:decide', (_e, allow) => decidePermission(allow));

// --- IPC: ad/tracker blocker toggle (from the shield popover) ---
onWin('blocker:toggle', () => {
  const next = !readSettings().blockAds;
  writeSettings({ blockAds: next });
  setBlocking(next);
  if (S.popKind === 'shield') sendShield();
  sendBlocked();
});

// --- IPC: site-info popover (clear a remembered per-site permission) ---
onWin('perm:clear', (_e, { origin, perm }) => {
  store.clearPermission(origin, perm);
  if (S.popKind === 'siteinfo') sendSiteinfo();
});

// --- IPC: HTTPS-only interstitial ---
onWin('interstitial:continue', () => {
  const at = activeTab();
  if (!at || !at.failedHttp) return;
  const httpUrl = at.failedHttp;
  store.allowHttp(originOf(httpUrl));
  at.failedHttp = null;
  at.onHero = false;
  at.view.webContents.loadURL(httpUrl);
  updateContentVisibility();
});
onWin('interstitial:back', () => {
  const at = activeTab();
  if (!at) return;
  at.failedHttp = null;
  if (at.view.webContents.navigationHistory?.canGoBack()) at.view.webContents.navigationHistory.goBack();
  else goHome();
  updateContentVisibility();
});

// --- IPC: history ---
onWin('pop:history', () => showPopover('history'));
onWin('history:clear', () => {
  store.clearHistory();
  if (S.popKind === 'history' && S.popoverView) S.popoverView.webContents.send('history', []);
});

// --- IPC: hero AI model providers (drives the hero pills + panel) ---
handleWin('providers:get', () =>
  Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, domain: p.domain })),
);

// --- IPC: search suggestions (fetched in main to dodge CORS) ---
handleWin('suggest:get', async (_e, query) => {
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

// --- IPC: S.tabs ---
onWin('tab:new', () => createTab());
onWin('tab:new-private', () => createTab({ private: true, activate: true }));
onWin('window:new', () => createBrowserWindow());
onWin('tab:close', (_e, id) => closeTab(id));
onWin('tab:activate', (_e, id) => activateTab(id));
onWin('tab:reopen', () => reopenClosed());
onWin('tab:menu', (_e, { id, x, y }) => {
  S.tabMenuTarget = id;
  S.tabMenuPos = { x: x | 0, y: y | 0 };
  showPopover('tabmenu');
});
onWin('tab:action', (_e, action) => {
  const id = S.tabMenuTarget;
  hidePopover();
  if (!id) return;
  const tab = S.tabs.find((t) => t.id === id);
  if (action === 'pin') setPinned(id, true);
  else if (action === 'unpin') setPinned(id, false);
  else if (action === 'close') closeTab(id);
  else if (action === 'close-others') closeOtherTabs(id);
  else if (action === 'newtab') createTab();
  else if (action === 'reopen') reopenClosed();
  else if (action === 'duplicate' && tab && tab.url) createTab({ url: tab.url, activate: true });
});

// --- IPC: AI panel ---
onWin('toggle-ai', () => toggleAI());
onWin('toggle-perf', () => togglePerf());
onWin('open-ai', () => toggleAI(true));
onWin('ai:send', (e, payload) => runAI(payload, e.sender));

// Handoff between the docked sidebar and the full-screen slash://ai page.
onWin('ai:to-page', (_e, data) => {
  toggleAI(false); // close the docked sidebar
  goAIPage({ load: data });
});
onWin('ai:open-web', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) createTab({ url, activate: true });
});
onWin('ai:to-sidebar', (_e, data) => {
  const at = activeTab();
  if (at) {
    at.onAIPage = false;
    if (!at.view || !at.view.webContents.getURL()) at.onHero = true;
  }
  updateContentVisibility();
  sendState();
  sendTabs();
  toggleAI(true);
  S.aiView.webContents.send('ai:load', data);
});

// --- Infobar: a non-blocking strip in the chrome, shared by the first-run
// default-browser prompt and update notifications. ---
function showInfobar(payload) {
  S.infobarOpen = true;
  S.CHROME_HEIGHT = BASE_CHROME + INFOBAR_HEIGHT;
  if (S.chromeView) S.chromeView.webContents.send('infobar:show', payload);
  layout();
}
function hideInfobar() {
  S.infobarOpen = false;
  S.CHROME_HEIGHT = BASE_CHROME;
  if (S.chromeView) S.chromeView.webContents.send('infobar:hide');
  layout();
}
function maybeShowFirstRun() {
  const s = readSettings();
  if (s.seenDefaultPrompt || S.infobarOpen) return;
  // Shown once per fresh profile. We no longer skip it when already the default
  // browser: the welcome also offers to import your data, which is useful
  // regardless. The picker itself reflects current default status.
  showInfobar({
    id: 'firstrun',
    text: 'Welcome to Slash. Make it your default browser and bring your stuff over?',
    actions: [
      { key: 'setup', label: 'Set up', primary: true },
      { key: 'close', label: 'Not now', close: true },
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

onWin('infobar:action', (_e, { id, key }) => {
  if (id === 'firstrun') {
    writeSettings({ seenDefaultPrompt: true }); // engaged or dismissed: don't nag again
    hideInfobar();
    if (key === 'setup') showPopover('setup'); // open the default + import picker
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
  } else if (id === 'savepw') {
    if (key === 'save' && pendingSave) {
      vault.upsert(pendingSave);
    } else if (key === 'never' && pendingSave && pendingSave.host) {
      // Remember not to ask for this site again.
      const blocked = readSettings().pwBlocked || [];
      if (!blocked.includes(pendingSave.host)) writeSettings({ pwBlocked: blocked.concat([pendingSave.host]) });
    }
    pendingSave = null;
    hideInfobar();
  }
});

// --- IPC: default browser ---
handleWin('default:status', () => app.isDefaultProtocolClient('http'));
// Register Slash as a web browser in Windows so it shows up in Default Apps.
// electron-builder's installer registers a protocol handler but not the full
// browser capability, so we write the StartMenuInternet keys (HKCU, no admin).
// Packaged only: in dev the exe is electron.exe, not Slash.
function registerAsBrowser() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const ps = [
    '$exe=$env:SLASH_EXE',
    "$cmd='\"'+$exe+'\" \"%1\"'",
    "$icon=$exe+',0'",
    "function RegDef($p,$v){if(-not(Test-Path $p)){New-Item $p -Force|Out-Null};Set-ItemProperty $p '(default)' $v}",
    "function RegVal($p,$n,$v){if(-not(Test-Path $p)){New-Item $p -Force|Out-Null};Set-ItemProperty $p $n $v}",
    "$b='HKCU:\\Software\\Clients\\StartMenuInternet\\Slash'",
    "RegDef $b 'Slash'",
    'RegDef "$b\\DefaultIcon" $icon',
    'RegDef "$b\\shell\\open\\command" $cmd',
    '$c="$b\\Capabilities"',
    "RegVal $c 'ApplicationName' 'Slash'",
    'RegVal $c \'ApplicationIcon\' $icon',
    "RegVal $c 'ApplicationDescription' 'An AI-native, private-by-default web browser.'",
    'RegVal "$c\\StartMenu" \'StartMenuInternet\' \'Slash\'',
    'RegVal "$c\\URLAssociations" \'http\' \'SlashHTM\'',
    'RegVal "$c\\URLAssociations" \'https\' \'SlashHTM\'',
    "RegVal 'HKCU:\\Software\\RegisteredApplications' 'Slash' 'Software\\Clients\\StartMenuInternet\\Slash\\Capabilities'",
    "RegDef 'HKCU:\\Software\\Classes\\SlashHTM' 'Slash HTML Document'",
    "RegDef 'HKCU:\\Software\\Classes\\SlashHTM\\DefaultIcon' $icon",
    "RegDef 'HKCU:\\Software\\Classes\\SlashHTM\\shell\\open\\command' $cmd",
  ].join('; ');
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, detached: true, stdio: 'ignore', env: { ...process.env, SLASH_EXE: process.execPath } },
    );
    child.unref();
  } catch {
    /* best effort */
  }
}

handleWin('default:set', () => {
  registerAsBrowser();
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
  // Windows can't be forced; open the Default Apps page so the user can pick.
  if (process.platform === 'win32') shell.openExternal('ms-settings:defaultapps').catch(() => {});
  return app.isDefaultProtocolClient('http');
});

// --- IPC: migrate data from another browser on this machine ---
// One entry per (browser, profile), with cheap counts so the user can pick
// what to bring over. Bookmarks/history are plaintext reads; cookies are
// decrypted with the OS key only when the user asks for them.
async function migrateSourceList() {
  const out = [];
  for (const s of migrate.discoverSources()) {
    let info = { bookmarks: 0, history: 0, cookies: false };
    try {
      info = await migrate.describe(s);
    } catch {
      /* unreadable */
    }
    out.push({ id: s.id, name: s.name, ...info });
  }
  return out;
}
handleWin('migrate:sources', () => migrateSourceList());

handleWin('migrate:run', async (_e, { id, types }) => {
  const s = migrate.sourceById(id);
  if (!s) return { error: 'source not found' };
  const want = new Set(Array.isArray(types) ? types : []);
  const result = {};
  if (want.has('bookmarks')) {
    let added = 0;
    try {
      for (const b of await migrate.readBookmarks(s)) {
        if (!store.isBookmarked(b.url)) {
          store.addBookmark(b);
          added++;
        }
      }
    } catch (e) {
      result.bookmarksError = String(e.message || e);
    }
    result.bookmarks = added;
    sendBookmarks();
  }
  if (want.has('history')) {
    try {
      result.history = store.importHistory(await migrate.readHistory(s));
    } catch (e) {
      result.historyError = String(e.message || e);
    }
  }
  if (want.has('cookies')) {
    try {
      const { cookies, appBound, failed } = await migrate.readCookies(s);
      let imported = 0;
      for (const c of cookies) {
        try {
          await session.defaultSession.cookies.set(c);
          imported++;
        } catch {
          /* a single bad cookie should not stop the rest */
        }
      }
      result.cookies = { imported, appBound, failed };
    } catch (e) {
      result.cookiesError = String(e.message || e);
    }
  }
  if (want.has('passwords')) {
    try {
      const { logins, appBound, failed } = await migrate.readPasswords(s);
      let imported = 0;
      for (const l of logins) {
        if (vault.upsert(l).changed) imported++;
      }
      result.passwords = { imported, appBound, failed };
    } catch (e) {
      result.passwordsError = String(e.message || e);
    }
  }
  return result;
});

// --- IPC: password vault ---
handleWin('vault:list', () => vault.list());
handleWin('vault:count', () => vault.count());
handleWin('vault:remove', (_e, { host, username }) => vault.remove(host, username));
handleWin('vault:importCsv', async () => {
  const r = await dialog.showOpenDialog(S.win, {
    title: 'Import passwords from CSV',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
  try {
    const text = fs.readFileSync(r.filePaths[0], 'utf8');
    return vault.importCsv(text);
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

// --- IPC: autofill (used by the per-tab preload) ---
handleWin('autofill:get', (_e, origin) => {
  try {
    return vault.forOrigin(origin);
  } catch {
    return [];
  }
});
let pendingSave = null;
onWin('autofill:capture', (_e, { origin, username, password }) => {
  if (!password) return;
  // Already saved with the same password? Nothing to offer.
  const existing = vault.forOrigin(origin).find((l) => l.username === (username || ''));
  if (existing && existing.password === password) return;
  let host = origin;
  try {
    host = new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    /* keep origin */
  }
  // The user chose "Never" for this site before: respect it.
  if ((readSettings().pwBlocked || []).includes(host)) return;
  pendingSave = { origin, username, password, host };
  showInfobar({
    id: 'savepw',
    text: existing ? `Update the saved password for ${host}?` : `Save password for ${host}?`,
    actions: [
      { key: 'save', label: existing ? 'Update' : 'Save', primary: true },
      { key: 'never', label: 'Never' },
      { key: 'close', label: 'Not now', close: true },
    ],
  });
});

// --- IPC: profile (the local OS account, no sign-in, nothing leaves the box) ---
// The "profile" is just your computer account: short username, friendly display
// name, and the Windows account picture if you have one. Read locally, cached.
let cachedProfile = null;
function getProfile() {
  if (cachedProfile) return cachedProfile;
  let username = '';
  try {
    username = os.userInfo().username;
  } catch {
    /* ignore */
  }
  if (!username) username = process.env.USERNAME || process.env.USER || 'You';
  let name = username;
  let picture = '';
  if (process.platform === 'win32') {
    try {
      const ps =
        "$u=$env:USERNAME;" +
        "$fn=(Get-CimInstance Win32_UserAccount -Filter \"Name='$u'\" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName);" +
        '$sid=([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value);' +
        '$img=(Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AccountPicture\\Users\\$sid" -ErrorAction SilentlyContinue).Image448;' +
        'Write-Output $fn; Write-Output "----"; Write-Output $img';
      const r = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { encoding: 'utf8', windowsHide: true, timeout: 6000 },
      );
      const lines = (r.stdout || '').split(/\r?\n/);
      const sep = lines.indexOf('----');
      const fn = (sep > 0 ? lines.slice(0, sep).join(' ') : lines[0] || '').trim();
      const imgPath = (sep >= 0 ? lines.slice(sep + 1).join('') : '').trim();
      if (fn) name = fn;
      if (imgPath && fs.existsSync(imgPath)) {
        const buf = fs.readFileSync(imgPath);
        const ext = path.extname(imgPath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.bmp' ? 'image/bmp' : 'image/jpeg';
        picture = `data:${mime};base64,` + buf.toString('base64');
      }
    } catch {
      /* fall back to the bare username */
    }
  }
  cachedProfile = { name, username, picture };
  return cachedProfile;
}
handleWin('profile:get', () => {
  try {
    return getProfile();
  } catch {
    return { name: 'You', username: '', picture: '' };
  }
});

// --- IPC: user profiles (Work / School / ...): create, switch, manage ---
handleWin('profiles:list', () => profiles.listProfiles());
handleWin('profiles:current', () => profiles.getProfile(S.profileId) || { id: S.profileId, name: 'Personal' });
function broadcastProfiles() {
  const list = profiles.listProfiles();
  for (const W of windows) {
    if (W.popoverView) W.popoverView.webContents.send('profiles', { list, current: W.profileId });
    if (W.settingsView) W.settingsView.webContents.send('profiles', { list, current: W.profileId });
  }
}
// Open a window running the given profile (creating a fresh window for it).
onWin('profile:open-window', (_e, id) => {
  if (!profiles.getProfile(id)) return;
  createBrowserWindow({ profileId: id });
});
handleWin('profiles:create', (_e, { name, color } = {}) => {
  const p = profiles.createProfile({ name, color });
  createBrowserWindow({ profileId: p.id }); // open it right away
  broadcastProfiles();
  return p;
});
handleWin('profiles:rename', (_e, { id, name } = {}) => {
  const p = profiles.renameProfile(id, name);
  windows.filter((W) => W.profileId === id).forEach((W) => applyWindowProfile(W));
  broadcastProfiles();
  return p;
});
handleWin('profiles:recolor', (_e, { id, color } = {}) => {
  const p = profiles.recolorProfile(id, color);
  windows.filter((W) => W.profileId === id).forEach((W) => applyWindowProfile(W));
  broadcastProfiles();
  return p;
});
handleWin('profiles:delete', (_e, id) => {
  // Close any windows running this profile first, then drop its data.
  for (const W of [...windows]) {
    if (W.profileId === id) {
      try {
        W.win.close();
      } catch {
        /* ignore */
      }
    }
  }
  const r = profiles.deleteProfile(id);
  broadcastProfiles();
  return r;
});

// --- IPC: favicons (served from the local cache, never a 3rd-party service) ---
// Returns a data URL or '' so the renderer can fall back to a monogram.
handleWin('favicon:get', (_e, host) => {
  try {
    const d = favicons.get(host);
    if (!d) {
      // Not cached yet: try to fetch it first-party in the background for next
      // time, then the renderer shows its monogram fallback for now.
      const h = String(host || '').replace(/^www\./, '');
      if (h) favicons.remember('https://' + h + '/favicon.ico', h);
    }
    return d;
  } catch {
    return '';
  }
});

// --- IPC: app stats (memory + tab counts) for the menu readout ---
// --- Network throughput sampling (best-effort: sums Content-Length seen) ---
let netBytes = 0;
let netLastBytes = 0;
let netLastT = Date.now();
let netHooked = false;
function ensureNetCounter() {
  if (netHooked) return;
  netHooked = true;
  try {
    session.defaultSession.webRequest.onCompleted((details) => {
      const h = details.responseHeaders || {};
      for (const k of Object.keys(h)) {
        if (k.toLowerCase() === 'content-length') {
          netBytes += parseInt(Array.isArray(h[k]) ? h[k][0] : h[k], 10) || 0;
          break;
        }
      }
    });
  } catch {
    /* webRequest unavailable */
  }
}
function netRate() {
  const now = Date.now();
  const dt = Math.max(0.25, (now - netLastT) / 1000);
  const rate = Math.max(0, (netBytes - netLastBytes) / dt);
  netLastBytes = netBytes;
  netLastT = now;
  return Math.round(rate); // bytes/sec
}
function tabHost(t) {
  let u = t.url || '';
  try {
    if (t.view) u = t.view.webContents.getURL() || u;
  } catch {
    /* gone */
  }
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return t.onHero ? 'New tab' : t.title || 'Tab';
  }
}

handleWin('app:stats', () => {
  ensureNetCounter();
  let kb = 0;
  let cpu = 0;
  const memByPid = new Map();
  try {
    for (const m of app.getAppMetrics()) {
      const wk = (m.memory && m.memory.workingSetSize) || 0;
      kb += wk;
      cpu += (m.cpu && m.cpu.percentCPUUsage) || 0;
      memByPid.set(m.pid, Math.round(wk / 1024));
    }
  } catch {
    /* ignore */
  }
  const asleep = S.tabs.filter((t) => t.suspended).length;
  const tabList = S.tabs
    .filter((t) => t.view || t.suspended) // skip blank start-page tabs (no renderer to show or free)
    .map((t) => {
      let mb = 0;
      try {
        if (t.view) mb = memByPid.get(t.view.webContents.getOSProcessId()) || 0;
      } catch {
        /* gone */
      }
      return { id: t.id, title: t.title || 'New tab', host: tabHost(t), mb, suspended: !!t.suspended, active: t.id === S.activeTabId };
    })
    .sort((a, b) => b.mb - a.mb);
  return {
    memMB: Math.round(kb / 1024),
    cpu: Math.round(cpu),
    net: netRate(),
    tabs: S.tabs.length,
    asleep,
    ramLimitMB: readSettings().ramLimitMB,
    tabList,
  };
});

// Quick RAM cap change from the menu / panel (mirrors Settings -> Performance).
onWin('ram:set-limit', (_e, mb) => {
  writeSettings({ ramLimitMB: typeof mb === 'number' ? mb : 0 });
  enforceRamLimit();
});

// Sleep every idle background tab in this window right now.
onWin('ram:free-now', () => {
  for (const t of [...S.tabs]) {
    if (t.id === S.activeTabId || t.suspended || !t.view || t.onHero) continue;
    suspendTab(t);
  }
});

// Sleep one specific tab from the panel's heaviest-tabs list.
onWin('ram:sleep-tab', (_e, id) => {
  const t = S.tabs.find((x) => x.id === id);
  if (t && t.id !== S.activeTabId) suspendTab(t);
});

// --- IPC: clear browsing data ---
handleWin('data:clear', async (_e, opts = {}) => {
  const done = {};
  if (opts.history) {
    store.clearHistory();
    done.history = true;
    if (S.popKind === 'history' && S.popoverView) S.popoverView.webContents.send('history', []);
  }
  if (opts.cookies) {
    try {
      await session.defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
      });
      done.cookies = true;
    } catch {
      /* ignore */
    }
  }
  if (opts.cache) {
    try {
      await session.defaultSession.clearCache();
      done.cache = true;
    } catch {
      /* ignore */
    }
  }
  return done;
});

// --- IPC: Chrome extensions (Web Store / load unpacked / list / remove) ---
// Electron 35+ moved the extension methods under session.extensions; fall back
// to the (deprecated) session methods on older versions.
function extApi(ses) {
  const s = ses || session.defaultSession;
  return s.extensions || s;
}
function loadSavedExtensions(profileId = 'default') {
  const ses = profileSession(profileId);
  for (const dir of readSettings(profileId).extensions || []) {
    try {
      if (fs.existsSync(dir)) {
        extApi(ses).loadExtension(dir, { allowFileAccess: true }).catch(() => {});
      }
    } catch {
      /* ignore a bad path */
    }
  }
}
handleWin('extensions:load', async () => {
  const pid = S.profileId;
  const r = await dialog.showOpenDialog(S.win, {
    title: 'Load an unpacked extension (the folder with its manifest.json)',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
  const dir = r.filePaths[0];
  try {
    const ext = await extApi(profileSession(pid)).loadExtension(dir, { allowFileAccess: true });
    const list = readSettings(pid).extensions || [];
    if (!list.includes(dir)) writeSettings({ extensions: list.concat([dir]) }, pid);
    return { ok: true, ext: { id: ext.id, name: ext.name, version: ext.version } };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});
handleWin('extensions:store', () => {
  createTab({ url: 'https://chromewebstore.google.com/', activate: true });
  return { ok: true };
});
handleWin('extensions:list', () => {
  try {
    return extApi(profileSession(S.profileId))
      .getAllExtensions()
      .map((e) => ({ id: e.id, name: e.name, version: e.version, path: e.path }));
  } catch {
    return [];
  }
});
handleWin('extensions:remove', (_e, id) => {
  const pid = S.profileId;
  try {
    const api = extApi(profileSession(pid));
    const ext = api.getAllExtensions().find((x) => x.id === id);
    api.removeExtension(id);
    if (ext) writeSettings({ extensions: (readSettings(pid).extensions || []).filter((p) => p !== ext.path) }, pid);
    return { ok: true };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

// --- IPC: settings ---
handleWin('settings:get', () => readSettings());
handleWin('settings:set', (_e, patch) => {
  const next = writeSettings(patch);
  if (patch.accent) broadcastAccent();
  if (typeof patch.doh === 'boolean') applyDoh();
  if (typeof patch.httpsOnly === 'boolean') httpsOnly = next.httpsOnly;
  if (typeof patch.blockAds === 'boolean') setBlocking(next.blockAds);
  if (patch.searchEngine) broadcastSearchEngine(); // keep omnibox + start page in sync
  return next;
});

// --- IPC: hero search + direct open (load into the active tab) ---
onWin('hero:search', (_e, { engine, query }) => {
  const at = activeTab();
  if (query && query.trim() && at) {
    at.onHero = false;
    at.onAIPage = false;
    S.settingsOpen = false;
    ensureTabView(at);
    at.view.webContents.loadURL(buildSearchUrl(engine, query.trim()));
    updateContentVisibility();
  }
});
onWin('hero:open', (_e, { url }) => {
  const at = activeTab();
  const target = normalizeInput(url);
  if (target && at) {
    at.onHero = false;
    at.onAIPage = false;
    S.settingsOpen = false;
    ensureTabView(at);
    at.view.webContents.loadURL(target);
    updateContentVisibility();
  }
});
// From the hero's "Ask AI" mode: open the panel, set the chosen model, and
// send the prompt into it.
onWin('hero:ask-ai', (_e, { text, provider }) => {
  const t = (text || '').trim();
  goAIPage(t ? { prompt: { text: t, provider } } : {});
});
