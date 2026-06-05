// User profile registry. A profile is a named, color-tagged browsing identity
// ("Personal", "Work", "School") that isolates logins/cookies, history, tabs,
// bookmarks, and extensions. App-level prefs (theme, AI keys, privacy defaults)
// stay shared in slash-settings.json; per-profile data lives under
// userData/profiles/<id>/.
//
// This module is the registry only (the list of profiles + their metadata). The
// per-profile data files are managed by store.js / vault.js / settings.js, each
// keyed by profile id. The "default" profile is special: it keeps the app's
// original session.defaultSession so existing logins survive the move.

const path = require('path');
const fs = require('fs');

const DEFAULT_ACCENT = '#f1cb53';
const DEFAULT_ID = 'default';

// userData is resolved lazily so this module can be unit-tested without Electron
// by calling setBaseDir() first.
let baseDirOverride = null;
function setBaseDir(dir) {
  baseDirOverride = dir;
}
function userData() {
  if (baseDirOverride) return baseDirOverride;
  return require('electron').app.getPath('userData');
}

function registryPath() {
  return path.join(userData(), 'slash-profiles.json');
}
function profilesRoot() {
  return path.join(userData(), 'profiles');
}
function profileDir(id) {
  return path.join(profilesRoot(), id);
}

function defaultRegistry() {
  return { version: 1, profiles: [{ id: DEFAULT_ID, name: 'Personal', color: DEFAULT_ACCENT }] };
}

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
    if (!parsed || !Array.isArray(parsed.profiles) || !parsed.profiles.length) return defaultRegistry();
    // Always guarantee a "default" profile exists and is first.
    if (!parsed.profiles.some((p) => p.id === DEFAULT_ID)) {
      parsed.profiles.unshift({ id: DEFAULT_ID, name: 'Personal', color: DEFAULT_ACCENT });
    }
    return { version: parsed.version || 1, profiles: parsed.profiles.map(sanitize) };
  } catch {
    return defaultRegistry();
  }
}

function sanitize(p) {
  return {
    id: String(p.id || '').trim() || DEFAULT_ID,
    name: String(p.name || 'Profile').slice(0, 40),
    color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : DEFAULT_ACCENT,
  };
}

function write(reg) {
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2), 'utf8');
  return reg;
}

// A short, filesystem-safe id. The first profile is always "default".
function newId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return 'p_' + rand;
}

function listProfiles() {
  return read().profiles;
}

function getProfile(id) {
  return read().profiles.find((p) => p.id === id) || null;
}

function createProfile({ name, color } = {}) {
  const reg = read();
  let id = newId();
  while (reg.profiles.some((p) => p.id === id)) id = newId();
  const profile = sanitize({ id, name: name || 'New profile', color });
  reg.profiles.push(profile);
  write(reg);
  fs.mkdirSync(profileDir(id), { recursive: true });
  return profile;
}

function renameProfile(id, name) {
  const reg = read();
  const p = reg.profiles.find((x) => x.id === id);
  if (!p) return null;
  p.name = String(name || p.name).slice(0, 40);
  write(reg);
  return p;
}

function recolorProfile(id, color) {
  const reg = read();
  const p = reg.profiles.find((x) => x.id === id);
  if (!p) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(color || '')) p.color = color;
  write(reg);
  return p;
}

// Remove a profile and its data. Never deletes the default or the last profile;
// the caller is responsible for closing any open windows for it first.
function deleteProfile(id) {
  if (id === DEFAULT_ID) return { error: 'The default profile cannot be deleted.' };
  const reg = read();
  if (reg.profiles.length <= 1) return { error: 'At least one profile must remain.' };
  const idx = reg.profiles.findIndex((p) => p.id === id);
  if (idx === -1) return { error: 'No such profile.' };
  reg.profiles.splice(idx, 1);
  write(reg);
  try {
    fs.rmSync(profileDir(id), { recursive: true, force: true });
  } catch {
    /* best effort: data dir cleanup */
  }
  return { ok: true };
}

module.exports = {
  DEFAULT_ID,
  DEFAULT_ACCENT,
  setBaseDir,
  registryPath,
  profilesRoot,
  profileDir,
  listProfiles,
  getProfile,
  createProfile,
  renameProfile,
  recolorProfile,
  deleteProfile,
};
