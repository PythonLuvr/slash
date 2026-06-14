// Local, per-user settings store. App-level prefs (AI selection, BYOK keys,
// editable model ids, accent, privacy defaults) live in slash-settings.json and
// are shared across profiles. Profile-level prefs (search engine, hero engines,
// custom engines, blocked-password hosts, loaded extensions) live per profile in
// userData/profiles/<id>/settings.json.
//
// API keys are encrypted at rest with Electron safeStorage (Windows DPAPI /
// macOS Keychain / Linux libsecret) when available, and never leave the machine
// except to the provider you select. If OS encryption is unavailable they fall
// back to plaintext, the same as most BYOK desktop apps.
//
// The readSettings()/writeSettings() signatures are unchanged and default to the
// "default" profile; a later step threads the active profile id through.

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_PROFILE = 'default';

function settingsPath() {
  return path.join(app.getPath('userData'), 'slash-settings.json');
}
// Pre-rename file. Read once for migration so existing keys/accent survive.
function legacySettingsPath() {
  return path.join(app.getPath('userData'), 'loom-settings.json');
}
function profileSettingsPath(profileId) {
  return path.join(app.getPath('userData'), 'profiles', profileId || DEFAULT_PROFILE, 'settings.json');
}

// Which keys are shared app-wide vs stored per profile.
const PROFILE_KEYS = ['searchEngine', 'heroEngines', 'customEngines', 'pwBlocked', 'extensions', 'pinnedExtensions'];
const APP_KEYS = ['selection', 'apiKeys', 'apiModels', 'accent', 'doh', 'httpsOnly', 'blockAds', 'seenDefaultPrompt', 'updatesEnabled', 'ramLimitMB', 'chatStarters'];

// Sensible, editable defaults. Nothing here is secret or user-specific.
const DEFAULTS = {
  selection: { provider: 'claude', variant: 'cli' },
  apiKeys: { anthropic: '', google: '', openai: '' },
  apiModels: {
    anthropic: 'claude-3-5-sonnet-latest',
    google: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
  },
  accent: '#f1cb53', // themeable UI accent (soft yellow default)
  searchEngine: 'duckduckgo', // private search by default
  heroEngines: ['duckduckgo', 'startpage', 'brave'], // start-page quick picks (ordered)
  customEngines: [], // user-added engines: { id, label, domain, url(with %s) }
  pwBlocked: [], // hosts where the user chose "Never" save a password
  extensions: [], // loaded Chrome extension folder paths (reloaded on launch)
  pinnedExtensions: [], // extension ids pinned to the toolbar (rest live in the menu)
  doh: true, // DNS-over-HTTPS on by default
  httpsOnly: true, // upgrade http -> https, warn on failure
  blockAds: true, // EasyList/EasyPrivacy tracker + ad blocking
  seenDefaultPrompt: false, // shown the first-run "set as default" prompt yet
  updatesEnabled: true, // check for + offer updates (user can ignore further updates)
  ramLimitMB: 500, // RAM cap; over it, idle background tabs are discarded. 0 = unlimited
  // AI conversation starters shown in the empty/landing state (sidebar + full page).
  // Editable by the user; defaults lean page-aware (Claude CLI reads the active tab).
  chatStarters: ['Summarize this page', 'Explain the selected text', 'Find the key takeaways'],
};

const ENC_PREFIX = 'enc:v1:';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

// Encrypt a key for disk. Empty stays empty; if OS encryption is unavailable
// we store plaintext rather than lose the key.
function encryptKey(plain) {
  if (!plain) return '';
  if (!canEncrypt()) return plain;
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    return plain;
  }
}

// Decrypt a stored key back to plaintext for the app to use. Values without
// the prefix are legacy plaintext, migrated to encrypted on the next write.
function decryptKey(stored) {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  if (!canEncrypt()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}

function mapKeys(obj, fn) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = fn(obj[k]);
  return out;
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readSettings(profileId = DEFAULT_PROFILE) {
  // App-level file (with legacy loom fallback).
  const appRaw = readJson(settingsPath()) || readJson(legacySettingsPath()) || {};
  // Profile-level file; if missing, fall back to legacy values still in the
  // app-level file (pre-split installs), then defaults.
  const profRaw = readJson(profileSettingsPath(profileId)) || {};
  const pick = (k) => (k in profRaw ? profRaw[k] : appRaw[k]);

  const storedKeys = { ...DEFAULTS.apiKeys, ...(appRaw.apiKeys || {}) };
  const arr = (v, d) => (Array.isArray(v) ? v : d);
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  return {
    selection: { ...DEFAULTS.selection, ...(appRaw.selection || {}) },
    apiKeys: mapKeys(storedKeys, decryptKey), // plaintext, for the app to use
    apiModels: { ...DEFAULTS.apiModels, ...(appRaw.apiModels || {}) },
    accent: appRaw.accent || DEFAULTS.accent,
    searchEngine: pick('searchEngine') || DEFAULTS.searchEngine,
    heroEngines: arr(pick('heroEngines'), DEFAULTS.heroEngines),
    customEngines: arr(pick('customEngines'), DEFAULTS.customEngines),
    pwBlocked: arr(pick('pwBlocked'), DEFAULTS.pwBlocked),
    extensions: arr(pick('extensions'), DEFAULTS.extensions),
    pinnedExtensions: arr(pick('pinnedExtensions'), DEFAULTS.pinnedExtensions),
    chatStarters: arr(appRaw.chatStarters, DEFAULTS.chatStarters),
    doh: bool(appRaw.doh, DEFAULTS.doh),
    httpsOnly: bool(appRaw.httpsOnly, DEFAULTS.httpsOnly),
    blockAds: bool(appRaw.blockAds, DEFAULTS.blockAds),
    seenDefaultPrompt: bool(appRaw.seenDefaultPrompt, DEFAULTS.seenDefaultPrompt),
    updatesEnabled: bool(appRaw.updatesEnabled, DEFAULTS.updatesEnabled),
    ramLimitMB: typeof appRaw.ramLimitMB === 'number' ? appRaw.ramLimitMB : DEFAULTS.ramLimitMB,
  };
}

function writeSettings(patch, profileId = DEFAULT_PROFILE) {
  const cur = readSettings(profileId); // plaintext keys
  const next = {
    selection: { ...cur.selection, ...(patch.selection || {}) },
    apiKeys: { ...cur.apiKeys, ...(patch.apiKeys || {}) },
    apiModels: { ...cur.apiModels, ...(patch.apiModels || {}) },
    accent: patch.accent || cur.accent,
    searchEngine: patch.searchEngine || cur.searchEngine,
    heroEngines: Array.isArray(patch.heroEngines) ? patch.heroEngines : cur.heroEngines,
    customEngines: Array.isArray(patch.customEngines) ? patch.customEngines : cur.customEngines,
    pwBlocked: Array.isArray(patch.pwBlocked) ? patch.pwBlocked : cur.pwBlocked,
    extensions: Array.isArray(patch.extensions) ? patch.extensions : cur.extensions,
    pinnedExtensions: Array.isArray(patch.pinnedExtensions) ? patch.pinnedExtensions : cur.pinnedExtensions,
    chatStarters: Array.isArray(patch.chatStarters) ? patch.chatStarters : cur.chatStarters,
    doh: typeof patch.doh === 'boolean' ? patch.doh : cur.doh,
    httpsOnly: typeof patch.httpsOnly === 'boolean' ? patch.httpsOnly : cur.httpsOnly,
    blockAds: typeof patch.blockAds === 'boolean' ? patch.blockAds : cur.blockAds,
    seenDefaultPrompt:
      typeof patch.seenDefaultPrompt === 'boolean' ? patch.seenDefaultPrompt : cur.seenDefaultPrompt,
    updatesEnabled:
      typeof patch.updatesEnabled === 'boolean' ? patch.updatesEnabled : cur.updatesEnabled,
    ramLimitMB: typeof patch.ramLimitMB === 'number' ? patch.ramLimitMB : cur.ramLimitMB,
  };

  // App-level subset (keys encrypted for disk).
  const appObj = {};
  for (const k of APP_KEYS) appObj[k] = next[k];
  appObj.apiKeys = mapKeys(next.apiKeys, encryptKey);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(appObj, null, 2), 'utf8');

  // Profile-level subset.
  const profObj = {};
  for (const k of PROFILE_KEYS) profObj[k] = next[k];
  const pp = profileSettingsPath(profileId);
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  fs.writeFileSync(pp, JSON.stringify(profObj, null, 2), 'utf8');

  return next; // plaintext for the app
}

module.exports = { readSettings, writeSettings, DEFAULTS, settingsPath, PROFILE_KEYS, APP_KEYS };
