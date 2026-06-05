// Migration engine: read another browser's profile on this machine and bring
// the data into Slash. Same mechanism every "Import from Chrome" feature uses,
// user-initiated, same OS user, same device. Nothing leaves the machine.
//
// What this reads, per Chromium-family browser:
//   - Bookmarks: plain JSON (no decryption).
//   - History:   the `History` SQLite DB (urls table).
//   - Cookies:   the `Cookies` SQLite DB, values AES-256-GCM encrypted under a
//                key sealed with Windows DPAPI. We unseal the key (same user,
//                so DPAPI succeeds) and decrypt. Chrome's newer app-bound
//                ('v20') cookies cannot be read by design; we skip and count
//                them so the user is told honestly.
//
// SQLite is read with sql.js (pure WASM) so there is no native build step and
// anyone who clones this repo gets a working importer on any OS.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// --- sql.js (WASM SQLite), loaded once and cached ---
let _SQL = null;
async function getSQL() {
  if (_SQL) return _SQL;
  const initSqlJs = require('sql.js');
  const dist = path.dirname(require.resolve('sql.js'));
  _SQL = await initSqlJs({ locateFile: (f) => path.join(dist, f) });
  return _SQL;
}

// Read a file even if the source browser holds it open. Chromium usually opens
// its DBs with a read share, but when it doesn't (e.g. a running Edge) a plain
// copy through the OS often still succeeds, so fall back to a temp copy.
function readLockTolerant(file) {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
    const tmp = path.join(os.tmpdir(), 'slash-mig-' + crypto.randomBytes(6).toString('hex'));
    try {
      fs.copyFileSync(file, tmp);
      return fs.readFileSync(tmp);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
}

// Read a SQLite file into a sql.js database.
async function openDb(file) {
  const SQL = await getSQL();
  return new SQL.Database(readLockTolerant(file));
}

function rows(db, sql) {
  const out = [];
  const stmt = db.prepare(sql);
  try {
    while (stmt.step()) out.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return out;
}

// Chromium timestamps are microseconds since 1601-01-01. Convert to unix ms.
const WIN_EPOCH_DELTA_SEC = 11644473600;
function chromeTimeToMs(micros) {
  if (!micros) return 0;
  return Math.round(micros / 1000 - WIN_EPOCH_DELTA_SEC * 1000);
}
function chromeTimeToUnixSec(micros) {
  if (!micros) return 0;
  return Math.round(micros / 1e6 - WIN_EPOCH_DELTA_SEC);
}

// --- Source discovery ---
// Each source is one (browser, profile) pair. userDataDir holds `Local State`
// (the cookie key lives there); profileDir holds Bookmarks / History / Cookies.
function browserRoots() {
  const LA = process.env.LOCALAPPDATA || '';
  const AD = process.env.APPDATA || '';
  return [
    { id: 'chrome', name: 'Google Chrome', userDataDir: path.join(LA, 'Google/Chrome/User Data') },
    { id: 'edge', name: 'Microsoft Edge', userDataDir: path.join(LA, 'Microsoft/Edge/User Data') },
    { id: 'brave', name: 'Brave', userDataDir: path.join(LA, 'BraveSoftware/Brave-Browser/User Data') },
    { id: 'vivaldi', name: 'Vivaldi', userDataDir: path.join(LA, 'Vivaldi/User Data') },
    { id: 'opera', name: 'Opera', userDataDir: path.join(AD, 'Opera Software/Opera Stable') },
    { id: 'operagx', name: 'Opera GX', userDataDir: path.join(AD, 'Opera Software/Opera GX Stable') },
    { id: 'chromium', name: 'Chromium', userDataDir: path.join(LA, 'Chromium/User Data') },
    { id: 'yandex', name: 'Yandex', userDataDir: path.join(LA, 'Yandex/YandexBrowser/User Data') },
  ];
}

function profileDisplayNames(userDataDir) {
  // Local State -> profile.info_cache maps dir name -> friendly name.
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8'));
    return (ls.profile && ls.profile.info_cache) || {};
  } catch {
    return {};
  }
}

function listProfiles(userDataDir) {
  // Opera Stable is itself the profile dir (no Default subfolder).
  const candidates = [];
  const names = profileDisplayNames(userDataDir);
  const tryDir = (dir) => {
    const full = path.join(userDataDir, dir);
    if (!fs.existsSync(full)) return;
    const hasData =
      fs.existsSync(path.join(full, 'Bookmarks')) ||
      fs.existsSync(path.join(full, 'History')) ||
      fs.existsSync(path.join(full, 'Default'));
    if (hasData) candidates.push(dir);
  };
  // Opera: data sits directly in userDataDir.
  if (fs.existsSync(path.join(userDataDir, 'Bookmarks')) && !fs.existsSync(path.join(userDataDir, 'Default'))) {
    candidates.push('.');
  }
  tryDir('Default');
  try {
    for (const entry of fs.readdirSync(userDataDir)) {
      if (/^Profile \d+$/.test(entry)) tryDir(entry);
    }
  } catch {
    /* ignore */
  }
  return [...new Set(candidates)].map((dir) => ({
    dir,
    label: dir === '.' || dir === 'Default' ? null : names[dir] && names[dir].name ? names[dir].name : dir,
  }));
}

// Firefox stores bookmarks + history in places.sqlite. Cookies/passwords use
// NSS (key4.db), which we don't decrypt, so Firefox sources offer the first two.
function firefoxSources() {
  const AD = process.env.APPDATA || '';
  const root = path.join(AD, 'Mozilla', 'Firefox', 'Profiles');
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return out;
  }
  for (const dir of entries) {
    const profileDir = path.join(root, dir);
    if (!fs.existsSync(path.join(profileDir, 'places.sqlite'))) continue;
    // Profile dirs look like "xxxxxxxx.default-release"; show the readable part.
    const label = dir.includes('.') ? dir.split('.').slice(1).join('.') : dir;
    out.push({
      id: `firefox|${dir}`,
      browser: 'firefox',
      kind: 'firefox',
      name: label && label !== 'default' ? `Firefox (${label})` : 'Firefox',
      profileDir,
    });
  }
  return out;
}

// Public: every importable (browser, profile) pair present on this machine.
function discoverSources() {
  const out = [];
  for (const b of browserRoots()) {
    if (!b.userDataDir || !fs.existsSync(b.userDataDir)) continue;
    for (const p of listProfiles(b.userDataDir)) {
      const profileDir = p.dir === '.' ? b.userDataDir : path.join(b.userDataDir, p.dir);
      out.push({
        id: `${b.id}|${p.dir}`,
        browser: b.id,
        kind: 'chromium',
        name: p.label ? `${b.name} (${p.label})` : b.name,
        userDataDir: b.userDataDir,
        profileDir,
      });
    }
  }
  return out.concat(firefoxSources());
}

function sourceById(id) {
  return discoverSources().find((s) => s.id === id) || null;
}

// --- Bookmarks ---
async function readFirefoxBookmarks(src) {
  const file = path.join(src.profileDir, 'places.sqlite');
  if (!fs.existsSync(file)) return [];
  const db = await openDb(file);
  try {
    return rows(
      db,
      `SELECT p.url AS url, COALESCE(b.title, p.title) AS title
       FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id
       WHERE b.type = 1 AND p.url LIKE 'http%'`,
    ).map((x) => ({ url: x.url, title: x.title || x.url }));
  } finally {
    db.close();
  }
}
// Chromium bookmarks are plain JSON; Firefox needs the SQLite read above.
// Always async so both kinds can be awaited the same way.
async function readBookmarks(src) {
  if (src.kind === 'firefox') return readFirefoxBookmarks(src);
  const file = path.join(src.profileDir, 'Bookmarks');
  if (!fs.existsSync(file)) return [];
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

// --- History (SQLite) ---
// Firefox: places.sqlite, last_visit_date is microseconds since the unix epoch.
async function readFirefoxHistory(src, limit) {
  const file = path.join(src.profileDir, 'places.sqlite');
  if (!fs.existsSync(file)) return [];
  const db = await openDb(file);
  try {
    return rows(
      db,
      `SELECT url, title, last_visit_date FROM moz_places
       WHERE last_visit_date IS NOT NULL AND url LIKE 'http%'
       ORDER BY last_visit_date DESC LIMIT ${Number(limit) | 0}`,
    ).map((x) => ({ url: x.url, title: x.title || x.url, time: Math.round((x.last_visit_date || 0) / 1000) }));
  } finally {
    db.close();
  }
}
async function readHistory(src, limit = 5000) {
  if (src.kind === 'firefox') return readFirefoxHistory(src, limit);
  const file = path.join(src.profileDir, 'History');
  if (!fs.existsSync(file)) return [];
  const db = await openDb(file);
  try {
    const r = rows(
      db,
      `SELECT url, title, last_visit_time FROM urls
       WHERE url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT ${Number(limit) | 0}`,
    );
    return r.map((x) => ({ url: x.url, title: x.title || x.url, time: chromeTimeToMs(x.last_visit_time) }));
  } finally {
    db.close();
  }
}

// --- Cookie key (Windows DPAPI) ---
function dpapiUnprotect(buf) {
  const script =
    'Add-Type -AssemblyName System.Security; ' +
    '$e=[Convert]::FromBase64String($env:SLASH_DPAPI_IN); ' +
    "$d=[System.Security.Cryptography.ProtectedData]::Unprotect($e,$null,'CurrentUser'); " +
    '[Convert]::ToBase64String($d)';
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: { ...process.env, SLASH_DPAPI_IN: buf.toString('base64') },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1 << 20,
    },
  );
  if (r.status !== 0 || !r.stdout) throw new Error('DPAPI unprotect failed');
  return Buffer.from(r.stdout.trim(), 'base64');
}

function cookieAesKey(userDataDir) {
  const ls = JSON.parse(fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8'));
  const b64 = ls.os_crypt && ls.os_crypt.encrypted_key;
  if (!b64) throw new Error('no os_crypt key');
  let raw = Buffer.from(b64, 'base64');
  if (raw.slice(0, 5).toString('latin1') === 'DPAPI') raw = raw.slice(5);
  return dpapiUnprotect(raw); // 32-byte AES key
}

// Cookie values are usually plain ASCII. Newer Chromium prepends a 32-byte
// domain-hash to the plaintext; strip it when the leading bytes are not the
// real value.
function pickCookieValue(buf) {
  const printable = (b) => /^[\x20-\x7E]*$/.test(b.toString('latin1'));
  if (printable(buf)) return buf.toString('latin1');
  if (buf.length > 32) {
    const stripped = buf.slice(32);
    if (printable(stripped)) return stripped.toString('latin1');
  }
  return buf.toString('latin1');
}

// Decrypt one Chromium-encrypted blob (cookie value or password). Returns
// { appBound: true } for Chrome's newer app-bound 'v20' (unreadable by design),
// otherwise { buf } with the plaintext bytes. Shared by cookies and passwords.
function decryptBlob(enc, aesKey) {
  if (!enc || !enc.length) return { buf: Buffer.alloc(0) };
  const tag3 = enc.slice(0, 3).toString('latin1');
  if (tag3 === 'v20') return { appBound: true };
  if (tag3 === 'v10' || tag3 === 'v11') {
    const nonce = enc.slice(3, 15);
    const tag = enc.slice(enc.length - 16);
    const body = enc.slice(15, enc.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
    d.setAuthTag(tag);
    return { buf: Buffer.concat([d.update(body), d.final()]) };
  }
  // Legacy: the whole value is DPAPI-protected.
  return { buf: dpapiUnprotect(enc) };
}

function decryptCookie(enc, aesKey) {
  const r = decryptBlob(enc, aesKey);
  if (r.appBound) return { appBound: true };
  // Cookies (unlike passwords) can carry a 32-byte domain-hash prefix.
  return { value: pickCookieValue(r.buf) };
}

const SAMESITE = { 0: 'no_restriction', 1: 'lax', 2: 'strict' };

// Read + decrypt cookies into objects shaped for Electron session.cookies.set.
// Returns { cookies, appBound, failed }.
async function readCookies(src) {
  if (src.kind === 'firefox') return { cookies: [], appBound: 0, failed: 0 }; // NSS, not supported
  const dbFile = [path.join(src.profileDir, 'Network', 'Cookies'), path.join(src.profileDir, 'Cookies')].find((f) =>
    fs.existsSync(f),
  );
  if (!dbFile) return { cookies: [], appBound: 0, failed: 0 };
  const aesKey = cookieAesKey(src.userDataDir);
  const db = await openDb(dbFile);
  let appBound = 0;
  let failed = 0;
  const cookies = [];
  try {
    const r = rows(
      db,
      `SELECT host_key, name, encrypted_value, path, is_secure, is_httponly, expires_utc, samesite
       FROM cookies`,
    );
    for (const c of r) {
      try {
        const enc = c.encrypted_value;
        const buf = enc && enc.length !== undefined ? Buffer.from(enc) : Buffer.alloc(0);
        const dec = decryptCookie(buf, aesKey);
        if (dec.appBound) {
          appBound++;
          continue;
        }
        if (!dec.value) continue;
        const host = String(c.host_key || '');
        const hostNoDot = host.replace(/^\./, '');
        if (!hostNoDot) continue;
        const secure = !!c.is_secure;
        const o = {
          url: (secure ? 'https://' : 'http://') + hostNoDot + (c.path || '/'),
          name: c.name,
          value: dec.value,
          domain: host,
          path: c.path || '/',
          secure,
          httpOnly: !!c.is_httponly,
          sameSite: SAMESITE[c.samesite] || 'unspecified',
        };
        // no_restriction requires Secure in Electron; downgrade if not.
        if (o.sameSite === 'no_restriction' && !o.secure) o.sameSite = 'unspecified';
        if (c.expires_utc && c.expires_utc > 0) {
          o.expirationDate = chromeTimeToUnixSec(c.expires_utc);
        }
        cookies.push(o);
      } catch {
        failed++;
      }
    }
  } finally {
    db.close();
  }
  return { cookies, appBound, failed };
}

// --- Passwords (SQLite `Login Data`, same encryption as cookies) ---
// Returns { logins:[{url,username,password}], appBound, failed } ready for the
// vault. Chrome's app-bound ('v20') passwords are skipped and counted.
async function readPasswords(src) {
  if (src.kind === 'firefox') return { logins: [], appBound: 0, failed: 0 }; // NSS, not supported
  const dbFile = path.join(src.profileDir, 'Login Data');
  if (!fs.existsSync(dbFile)) return { logins: [], appBound: 0, failed: 0 };
  const aesKey = cookieAesKey(src.userDataDir);
  const db = await openDb(dbFile);
  let appBound = 0;
  let failed = 0;
  const logins = [];
  try {
    const r = rows(db, 'SELECT origin_url, username_value, password_value FROM logins');
    for (const row of r) {
      try {
        const enc = row.password_value;
        const buf = enc && enc.length !== undefined ? Buffer.from(enc) : Buffer.alloc(0);
        const dec = decryptBlob(buf, aesKey);
        if (dec.appBound) {
          appBound++;
          continue;
        }
        const password = dec.buf.toString('utf8');
        if (!password) continue; // blacklisted ("never save") rows have no value
        logins.push({ url: row.origin_url || '', username: row.username_value || '', password });
      } catch {
        failed++;
      }
    }
  } finally {
    db.close();
  }
  return { logins, appBound, failed };
}

// Cheap presence/size info for the picker, without decrypting anything.
async function describe(src) {
  const info = { bookmarks: 0, history: 0, cookies: false, passwords: 0 };
  try {
    info.bookmarks = (await readBookmarks(src)).length;
  } catch {
    /* ignore */
  }

  // Firefox: bookmarks + history only (cookies/passwords use NSS, unsupported).
  if (src.kind === 'firefox') {
    try {
      const f = path.join(src.profileDir, 'places.sqlite');
      if (fs.existsSync(f)) {
        const db = await openDb(f);
        try {
          const r = rows(db, "SELECT COUNT(*) AS n FROM moz_places WHERE last_visit_date IS NOT NULL AND url LIKE 'http%'");
          info.history = (r[0] && r[0].n) || 0;
        } finally {
          db.close();
        }
      }
    } catch {
      /* ignore */
    }
    return info;
  }

  try {
    const f = path.join(src.profileDir, 'History');
    if (fs.existsSync(f)) {
      const db = await openDb(f);
      try {
        const r = rows(db, "SELECT COUNT(*) AS n FROM urls WHERE url LIKE 'http%'");
        info.history = (r[0] && r[0].n) || 0;
      } finally {
        db.close();
      }
    }
  } catch {
    /* ignore */
  }
  info.cookies =
    fs.existsSync(path.join(src.profileDir, 'Network', 'Cookies')) ||
    fs.existsSync(path.join(src.profileDir, 'Cookies'));
  try {
    const f = path.join(src.profileDir, 'Login Data');
    if (fs.existsSync(f)) {
      const db = await openDb(f);
      try {
        const r = rows(db, 'SELECT COUNT(*) AS n FROM logins');
        info.passwords = (r[0] && r[0].n) || 0;
      } finally {
        db.close();
      }
    }
  } catch {
    /* ignore */
  }
  return info;
}

module.exports = {
  discoverSources,
  sourceById,
  describe,
  readBookmarks,
  readHistory,
  readPasswords,
  readCookies,
};
