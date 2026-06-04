// Local, per-user settings store. Lives in the OS app-data directory
// (app.getPath('userData')), never in the repo. Holds the AI model
// selection plus BYOK API keys and editable model ids.
//
// API keys are stored in plaintext on the user's own machine, the same
// way most bring-your-own-key desktop apps do. They are never sent
// anywhere except directly to the provider you select.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function settingsPath() {
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
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return {
      selection: { ...DEFAULTS.selection, ...(parsed.selection || {}) },
      apiKeys: { ...DEFAULTS.apiKeys, ...(parsed.apiKeys || {}) },
      apiModels: { ...DEFAULTS.apiModels, ...(parsed.apiModels || {}) },
      accent: parsed.accent || DEFAULTS.accent,
    };
  } catch {
    return clone(DEFAULTS);
  }
}

function writeSettings(patch) {
  const cur = readSettings();
  const next = {
    selection: { ...cur.selection, ...(patch.selection || {}) },
    apiKeys: { ...cur.apiKeys, ...(patch.apiKeys || {}) },
    apiModels: { ...cur.apiModels, ...(patch.apiModels || {}) },
    accent: patch.accent || cur.accent,
  };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { readSettings, writeSettings, DEFAULTS, settingsPath };
