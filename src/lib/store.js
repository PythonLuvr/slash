// Local data store for bookmarks and history. Lives in the OS app-data
// directory (never the repo). Plain JSON, no external deps.

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const HISTORY_CAP = 2000;
const ENC_PREFIX = 'enc:v1:';

function storePath() {
  return path.join(app.getPath('userData'), 'slash-data.json');
}

function emptyData() {
  return { bookmarks: [], history: [], permissions: {}, httpAllow: [] };
}

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

// Bookmarks/history/permissions are encrypted at rest with the OS keystore
// (same as API keys and the password vault). Legacy plaintext files are read
// once and re-encrypted on the next write.
function read() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return emptyData();
  }
  let obj = raw;
  try {
    if (raw && typeof raw.enc === 'string' && raw.enc.startsWith(ENC_PREFIX)) {
      if (!canEncrypt()) return emptyData();
      obj = JSON.parse(safeStorage.decryptString(Buffer.from(raw.enc.slice(ENC_PREFIX.length), 'base64')));
    } else if (raw && raw.plain && typeof raw.plain === 'object') {
      obj = raw.plain;
    }
    // otherwise raw is a legacy plaintext object, used as-is
  } catch {
    return emptyData();
  }
  return {
    bookmarks: Array.isArray(obj.bookmarks) ? obj.bookmarks : [],
    history: Array.isArray(obj.history) ? obj.history : [],
    permissions: obj.permissions && typeof obj.permissions === 'object' ? obj.permissions : {},
    httpAllow: Array.isArray(obj.httpAllow) ? obj.httpAllow : [],
  };
}

function write(data) {
  const json = JSON.stringify(data);
  let onDisk;
  if (canEncrypt()) {
    try {
      onDisk = { enc: ENC_PREFIX + safeStorage.encryptString(json).toString('base64') };
    } catch {
      onDisk = { plain: data };
    }
  } else {
    onDisk = { plain: data };
  }
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(onDisk), 'utf8');
}

// --- Bookmarks ---
function getBookmarks() {
  return read().bookmarks;
}
function isBookmarked(url) {
  return read().bookmarks.some((b) => b.url === url);
}
function addBookmark({ url, title }) {
  const data = read();
  if (!url || data.bookmarks.some((b) => b.url === url)) return data.bookmarks;
  data.bookmarks.push({ url, title: title || url });
  write(data);
  return data.bookmarks;
}
function removeBookmark(url) {
  const data = read();
  data.bookmarks = data.bookmarks.filter((b) => b.url !== url);
  write(data);
  return data.bookmarks;
}

// --- History ---
function getHistory() {
  return read().history;
}
function addHistory({ url, title }) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  const data = read();
  // Drop an immediately-preceding duplicate so reloads do not stack.
  if (data.history[0] && data.history[0].url === url) {
    data.history[0].title = title || data.history[0].title;
  } else {
    data.history.unshift({ url, title: title || url, time: Date.now() });
  }
  if (data.history.length > HISTORY_CAP) data.history.length = HISTORY_CAP;
  write(data);
}
function clearHistory() {
  const data = read();
  data.history = [];
  write(data);
}
// Bulk import (from another browser). Merges by url, keeps each entry's own
// visit time, newest first, capped. Returns how many new urls were added.
function importHistory(entries) {
  if (!Array.isArray(entries) || !entries.length) return 0;
  const data = read();
  const seen = new Set(data.history.map((h) => h.url));
  let added = 0;
  for (const e of entries) {
    if (!e || !e.url || !/^https?:\/\//i.test(e.url) || seen.has(e.url)) continue;
    seen.add(e.url);
    data.history.push({ url: e.url, title: e.title || e.url, time: e.time || Date.now() });
    added++;
  }
  data.history.sort((a, b) => (b.time || 0) - (a.time || 0));
  if (data.history.length > HISTORY_CAP) data.history.length = HISTORY_CAP;
  write(data);
  return added;
}

// --- Per-site permissions ---
// permissions: { [origin]: { [permission]: 'allow' | 'block' } }
function getPermission(origin, perm) {
  if (!origin) return undefined;
  const site = read().permissions[origin];
  return site ? site[perm] : undefined;
}
function setPermission(origin, perm, decision) {
  if (!origin) return;
  const data = read();
  data.permissions[origin] = data.permissions[origin] || {};
  data.permissions[origin][perm] = decision; // 'allow' | 'block'
  write(data);
}
function getSitePermissions(origin) {
  if (!origin) return {};
  return read().permissions[origin] || {};
}
function clearPermission(origin, perm) {
  const data = read();
  if (data.permissions[origin]) {
    delete data.permissions[origin][perm];
    if (!Object.keys(data.permissions[origin]).length) delete data.permissions[origin];
    write(data);
  }
}

// --- HTTPS-only escape hatch: origins the user chose to load over HTTP ---
function isHttpAllowed(origin) {
  return !!origin && read().httpAllow.includes(origin);
}
function allowHttp(origin) {
  if (!origin) return;
  const data = read();
  if (!data.httpAllow.includes(origin)) {
    data.httpAllow.push(origin);
    write(data);
  }
}

module.exports = {
  getBookmarks,
  isBookmarked,
  addBookmark,
  removeBookmark,
  getHistory,
  addHistory,
  clearHistory,
  importHistory,
  getPermission,
  setPermission,
  getSitePermissions,
  clearPermission,
  isHttpAllowed,
  allowHttp,
};
