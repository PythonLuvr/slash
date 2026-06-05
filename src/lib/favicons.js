// Local favicon cache. The UI used to load icons from a third party
// (icons.duckduckgo.com), which leaked every domain you bookmark or visit to
// DuckDuckGo. That contradicts "nothing leaves your machine," so instead we
// cache favicons on disk as data URLs. The only network calls are first-party
// to the actual site (the one you already visit), and they happen once: after
// that the icon is served from disk forever.

const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');

// Built-in icons for brands whose /favicon.ico does not serve a usable image
// (e.g. Gemini 404s it and references its icon via a page <link>). Served
// locally and instantly, no network, no third-party aggregator. Gemini's mark
// is a gradient sparkle, drawn here as a small inline SVG.
const GEMINI_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">' +
  '<stop offset="0" stop-color="#4285F4"/><stop offset="0.5" stop-color="#9B72CB"/>' +
  '<stop offset="1" stop-color="#D96570"/></linearGradient></defs>' +
  '<path fill="url(#g)" d="M12 0C12 7 17 12 24 12C17 12 12 17 12 24C12 17 7 12 0 12C7 12 12 7 12 0Z"/></svg>';
const BUILTIN = {
  'gemini.google.com': 'data:image/svg+xml;base64,' + Buffer.from(GEMINI_SVG).toString('base64'),
};

const CAP = 600; // max cached hosts; oldest evicted past this
const MAX_BYTES = 256 * 1024; // ignore oversized "favicons"
const FETCH_TIMEOUT = 6000;

function cachePath() {
  return path.join(app.getPath('userData'), 'slash-favicons.json');
}

let mem = null;
function load() {
  if (mem) return mem;
  try {
    mem = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) || {};
  } catch {
    mem = {};
  }
  return mem;
}
let writeTimer = null;
function save() {
  // Debounce: favicon updates can arrive in bursts as tabs load.
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
      fs.writeFileSync(cachePath(), JSON.stringify(load()), 'utf8');
    } catch {
      /* best effort */
    }
  }, 1500);
}

function normHost(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/^www\./, '');
}
function hostOf(url) {
  try {
    return normHost(new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).hostname);
  } catch {
    return '';
  }
}

function get(hostOrUrl) {
  const host = hostOf(hostOrUrl) || normHost(hostOrUrl);
  if (BUILTIN[host]) return BUILTIN[host];
  const e = load()[host];
  return e ? e.d : '';
}
function has(hostOrUrl) {
  const host = hostOf(hostOrUrl) || normHost(hostOrUrl);
  return !!BUILTIN[host] || !!load()[host];
}

function put(host, dataUrl) {
  const m = load();
  m[host] = { d: dataUrl, t: Date.now() };
  const keys = Object.keys(m);
  if (keys.length > CAP) {
    // Evict the oldest entries.
    keys
      .sort((a, b) => (m[a].t || 0) - (m[b].t || 0))
      .slice(0, keys.length - CAP)
      .forEach((k) => delete m[k]);
  }
  save();
}

// Fetch a favicon URL (first-party to the site) and cache it as a data URL.
// Skips the network entirely if we already have this host.
const inflight = new Set();
function remember(faviconUrl, hostHint) {
  const host = hostHint ? normHost(hostHint) : hostOf(faviconUrl);
  if (!host || !faviconUrl || has(host) || inflight.has(host)) return;
  if (!/^https?:\/\//i.test(faviconUrl)) return;
  inflight.add(host);
  let done = false;
  const finish = () => {
    done = true;
    inflight.delete(host);
  };
  try {
    const req = net.request(faviconUrl);
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => {
      try {
        req.abort();
      } catch {
        /* ignore */
      }
    }, FETCH_TIMEOUT);
    req.on('response', (res) => {
      const type = String((res.headers['content-type'] || res.headers['Content-Type'] || '')).split(';')[0];
      if (res.statusCode >= 400 || (type && !/^image\//.test(type))) {
        clearTimeout(timer);
        res.resume();
        finish();
        return;
      }
      res.on('data', (d) => {
        bytes += d.length;
        if (bytes > MAX_BYTES) {
          try {
            req.abort();
          } catch {
            /* ignore */
          }
          return;
        }
        chunks.push(d);
      });
      res.on('end', () => {
        clearTimeout(timer);
        if (done) return;
        if (bytes && bytes <= MAX_BYTES) {
          const buf = Buffer.concat(chunks);
          const mime = type || 'image/x-icon';
          put(host, `data:${mime};base64,${buf.toString('base64')}`);
        }
        finish();
      });
    });
    req.on('error', () => {
      clearTimeout(timer);
      finish();
    });
    req.on('abort', () => {
      clearTimeout(timer);
      finish();
    });
    req.end();
  } catch {
    finish();
  }
}

// Called when a tab reports its favicon (the real one, from the page itself).
function rememberFromPage(pageUrl, faviconUrl) {
  if (!faviconUrl) return;
  remember(faviconUrl, hostOf(pageUrl));
}

// Pre-fill the fixed brand icons (search engines + AI providers) once, so their
// chips render without ever touching a third-party favicon service.
function seedBrands() {
  const brands = [
    { host: 'duckduckgo.com', url: 'https://duckduckgo.com/favicon.ico' },
    { host: 'startpage.com', url: 'https://www.startpage.com/favicon.ico' },
    { host: 'brave.com', url: 'https://brave.com/favicon.ico' },
    { host: 'google.com', url: 'https://www.google.com/favicon.ico' },
    { host: 'bing.com', url: 'https://www.bing.com/favicon.ico' },
    { host: 'ecosia.org', url: 'https://www.ecosia.org/favicon.ico' },
    { host: 'wikipedia.org', url: 'https://en.wikipedia.org/favicon.ico' },
    { host: 'claude.ai', url: 'https://claude.ai/favicon.ico' },
    { host: 'gemini.google.com', url: 'https://gemini.google.com/favicon.ico' },
    { host: 'chatgpt.com', url: 'https://chatgpt.com/favicon.ico' },
  ];
  for (const b of brands) if (!has(b.host)) remember(b.url, b.host);
}

module.exports = { get, has, remember, rememberFromPage, seedBrands };
