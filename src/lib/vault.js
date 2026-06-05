// Password vault. Saved logins live in the OS app-data directory, encrypted at
// rest with the same Electron safeStorage (Windows DPAPI / macOS Keychain /
// Linux libsecret) used for API keys. The plaintext only exists in memory while
// Slash is running, and only autofills back into the origin it was saved for.
//
// The vault is filled two ways: CSV import (the ecosystem-standard migration
// path that every browser and password manager supports) and capture-on-login.

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const ENC_PREFIX = 'enc:v1:';

// Saved logins are per profile; the app sets the active profile when the
// operated window changes.
let currentProfile = 'default';
function setProfile(id) {
  currentProfile = id || 'default';
}
function vaultPath() {
  return path.join(app.getPath('userData'), 'profiles', currentProfile, 'vault.json');
}
function legacyVaultPath() {
  return path.join(app.getPath('userData'), 'slash-vault.json');
}

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

// entries: [{ origin, host, username, password, updated }]
function read() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(vaultPath(), 'utf8'));
  } catch {
    try {
      if (currentProfile !== 'default') return [];
      raw = JSON.parse(fs.readFileSync(legacyVaultPath(), 'utf8')); // pre-migration
    } catch {
      return [];
    }
  }
  try {
    if (raw && typeof raw.enc === 'string' && raw.enc.startsWith(ENC_PREFIX)) {
      if (!canEncrypt()) return [];
      const json = safeStorage.decryptString(Buffer.from(raw.enc.slice(ENC_PREFIX.length), 'base64'));
      const arr = JSON.parse(json);
      return Array.isArray(arr) ? arr : [];
    }
    if (raw && Array.isArray(raw.plain)) return raw.plain; // no-encryption fallback
  } catch {
    return [];
  }
  return [];
}

function write(entries) {
  const json = JSON.stringify(entries);
  let onDisk;
  if (canEncrypt()) {
    try {
      onDisk = { enc: ENC_PREFIX + safeStorage.encryptString(json).toString('base64') };
    } catch {
      onDisk = { plain: entries };
    }
  } else {
    onDisk = { plain: entries };
  }
  fs.mkdirSync(path.dirname(vaultPath()), { recursive: true });
  fs.writeFileSync(vaultPath(), JSON.stringify(onDisk, null, 2), 'utf8');
}

function hostOf(url) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, '');
  } catch {
    return String(url || '')
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')[0]
      .replace(/^www\./, '');
  }
}
function originOf(url) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).origin;
  } catch {
    return 'https://' + hostOf(url);
  }
}

// Add or update one login (dedupe by host + username).
function upsert({ url, origin, username, password }) {
  if (!password) return { changed: false };
  const o = origin || originOf(url || '');
  const host = hostOf(o);
  if (!host) return { changed: false };
  const entries = read();
  const i = entries.findIndex((e) => e.host === host && e.username === username);
  const now = Date.now();
  if (i >= 0) {
    if (entries[i].password === password) return { changed: false };
    entries[i].password = password;
    entries[i].updated = now;
    write(entries);
    return { changed: true, updated: true };
  }
  entries.push({ origin: o, host, username: username || '', password, updated: now });
  write(entries);
  return { changed: true, added: true };
}

// Logins for an origin/host, newest first. Used by autofill.
function forOrigin(url) {
  const host = hostOf(url);
  if (!host) return [];
  return read()
    .filter((e) => e.host === host)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .map((e) => ({ username: e.username, password: e.password }));
}

// Listing for settings UI: never returns passwords.
function list() {
  return read()
    .slice()
    .sort((a, b) => (a.host || '').localeCompare(b.host || ''))
    .map((e) => ({ host: e.host, origin: e.origin, username: e.username }));
}

function remove(host, username) {
  const entries = read().filter((e) => !(e.host === host && e.username === username));
  write(entries);
  return entries.length;
}

function count() {
  return read().length;
}

// --- CSV import (Chrome / Edge / Brave / Firefox / Bitwarden exports) ---
// Minimal RFC4180 parser: quoted fields, escaped "" quotes, CRLF tolerant.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      /* skip */
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, updated: 0, skipped: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...names) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const urlI = find('url', 'uri', 'website', 'login_uri');
  const userI = find('username', 'user', 'login', 'login_username', 'email');
  const passI = find('password', 'pass', 'login_password');
  if (passI < 0) return { added: 0, updated: 0, skipped: 0, error: 'no password column' };
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const password = (row[passI] || '').trim();
    const url = urlI >= 0 ? (row[urlI] || '').trim() : '';
    const username = userI >= 0 ? (row[userI] || '').trim() : '';
    if (!password || (!url && !username)) {
      skipped++;
      continue;
    }
    const res = upsert({ url: url || 'https://' + (username.includes('@') ? username.split('@')[1] : ''), username, password });
    if (res.added) added++;
    else if (res.updated) updated++;
    else skipped++;
  }
  return { added, updated, skipped };
}

module.exports = { setProfile, upsert, forOrigin, list, remove, count, importCsv };
