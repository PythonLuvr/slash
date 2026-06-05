// Local, per-user settings store. Lives in the OS app-data directory
// (app.getPath('userData')), never in the repo. Holds the AI model selection,
// BYOK API keys, editable model ids, accent, and privacy options.
//
// API keys are encrypted at rest with Electron safeStorage (Windows DPAPI /
// macOS Keychain / Linux libsecret) when available, and never leave the
// machine except to the provider you select. If OS encryption is unavailable
// they fall back to plaintext, the same as most BYOK desktop apps.

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

function settingsPath() {
  return path.join(app.getPath('userData'), 'slash-settings.json');
}

// Pre-rename file. Read once for migration so existing keys/accent survive.
function legacySettingsPath() {
  return path.join(app.getPath('userData'), 'loom-settings.json');
}

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
  doh: true, // DNS-over-HTTPS on by default
  httpsOnly: true, // upgrade http -> https, warn on failure
  blockAds: true, // EasyList/EasyPrivacy tracker + ad blocking
  seenDefaultPrompt: false, // shown the first-run "set as default" prompt yet
  updatesEnabled: true, // check for + offer updates (user can ignore further updates)
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

function readSettings() {
  try {
    let raw;
    try {
      raw = fs.readFileSync(settingsPath(), 'utf8');
    } catch {
      // Fall back to the pre-rename file (loom-settings.json) if present.
      raw = fs.readFileSync(legacySettingsPath(), 'utf8');
    }
    const parsed = JSON.parse(raw);
    const storedKeys = { ...DEFAULTS.apiKeys, ...(parsed.apiKeys || {}) };
    return {
      selection: { ...DEFAULTS.selection, ...(parsed.selection || {}) },
      apiKeys: mapKeys(storedKeys, decryptKey), // plaintext, for the app to use
      apiModels: { ...DEFAULTS.apiModels, ...(parsed.apiModels || {}) },
      accent: parsed.accent || DEFAULTS.accent,
      searchEngine: parsed.searchEngine || DEFAULTS.searchEngine,
      heroEngines: Array.isArray(parsed.heroEngines) ? parsed.heroEngines : DEFAULTS.heroEngines,
      customEngines: Array.isArray(parsed.customEngines) ? parsed.customEngines : DEFAULTS.customEngines,
      pwBlocked: Array.isArray(parsed.pwBlocked) ? parsed.pwBlocked : DEFAULTS.pwBlocked,
      extensions: Array.isArray(parsed.extensions) ? parsed.extensions : DEFAULTS.extensions,
      doh: typeof parsed.doh === 'boolean' ? parsed.doh : DEFAULTS.doh,
      httpsOnly: typeof parsed.httpsOnly === 'boolean' ? parsed.httpsOnly : DEFAULTS.httpsOnly,
      blockAds: typeof parsed.blockAds === 'boolean' ? parsed.blockAds : DEFAULTS.blockAds,
      seenDefaultPrompt:
        typeof parsed.seenDefaultPrompt === 'boolean' ? parsed.seenDefaultPrompt : DEFAULTS.seenDefaultPrompt,
      updatesEnabled:
        typeof parsed.updatesEnabled === 'boolean' ? parsed.updatesEnabled : DEFAULTS.updatesEnabled,
    };
  } catch {
    return clone(DEFAULTS);
  }
}

function writeSettings(patch) {
  const cur = readSettings(); // plaintext keys
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
    doh: typeof patch.doh === 'boolean' ? patch.doh : cur.doh,
    httpsOnly: typeof patch.httpsOnly === 'boolean' ? patch.httpsOnly : cur.httpsOnly,
    blockAds: typeof patch.blockAds === 'boolean' ? patch.blockAds : cur.blockAds,
    seenDefaultPrompt:
      typeof patch.seenDefaultPrompt === 'boolean' ? patch.seenDefaultPrompt : cur.seenDefaultPrompt,
    updatesEnabled:
      typeof patch.updatesEnabled === 'boolean' ? patch.updatesEnabled : cur.updatesEnabled,
  };
  // Encrypt keys for disk; the returned object keeps plaintext for the app.
  const onDisk = { ...next, apiKeys: mapKeys(next.apiKeys, encryptKey) };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(onDisk, null, 2), 'utf8');
  return next;
}

module.exports = { readSettings, writeSettings, DEFAULTS, settingsPath };
