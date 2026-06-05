// One-time, first-run migration that moves the app's existing single-profile data
// into a "default" profile under userData/profiles/default/. Idempotent and
// guarded by a sentinel. Originals are kept as .bak so nothing can be lost.
//
// Distinct from lib/migrate.js, which imports data from OTHER browsers.

const path = require('path');
const fs = require('fs');

const SENTINEL = '.migrated';
// Settings keys that become per-profile. Everything else in slash-settings.json
// (apiKeys, apiModels, selection, accent, doh, httpsOnly, blockAds,
// seenDefaultPrompt, updatesEnabled) stays app-level and shared.
const PROFILE_KEYS = ['searchEngine', 'heroEngines', 'customEngines', 'pwBlocked', 'extensions'];

function migrateToProfiles(userDataDir) {
  const profilesRoot = path.join(userDataDir, 'profiles');
  const sentinel = path.join(profilesRoot, SENTINEL);
  if (fs.existsSync(sentinel)) return { skipped: true };

  const defDir = path.join(profilesRoot, 'default');
  fs.mkdirSync(defDir, { recursive: true });
  const moved = [];

  // 1. Copy data/vault/session into the default profile; keep originals as .bak.
  const files = [
    ['slash-data.json', 'data.json'],
    ['slash-vault.json', 'vault.json'],
    ['slash-session.json', 'session.json'],
  ];
  for (const [src, dst] of files) {
    const s = path.join(userDataDir, src);
    const d = path.join(defDir, dst);
    if (fs.existsSync(s) && !fs.existsSync(d)) {
      fs.copyFileSync(s, d);
      try {
        fs.copyFileSync(s, s + '.bak');
      } catch {
        /* best effort backup */
      }
      moved.push(dst);
    }
  }

  // 2. Split settings: copy the profile-level keys into default/settings.json.
  // slash-settings.json is left fully intact (app-level keys read from it; the
  // leftover profile keys there are simply ignored going forward).
  const setPath = path.join(userDataDir, 'slash-settings.json');
  const defSettings = path.join(defDir, 'settings.json');
  let accent = '#f1cb53';
  if (fs.existsSync(setPath) && !fs.existsSync(defSettings)) {
    try {
      const all = JSON.parse(fs.readFileSync(setPath, 'utf8'));
      if (all.accent) accent = all.accent;
      const profileSettings = {};
      for (const k of PROFILE_KEYS) if (k in all) profileSettings[k] = all[k];
      fs.writeFileSync(defSettings, JSON.stringify(profileSettings, null, 2), 'utf8');
      moved.push('settings.json');
    } catch {
      /* leave defaults */
    }
  }

  // 3. Write the registry with the default profile (color = the user's accent).
  const regPath = path.join(userDataDir, 'slash-profiles.json');
  if (!fs.existsSync(regPath)) {
    const reg = { version: 1, profiles: [{ id: 'default', name: 'Personal', color: accent }] };
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2), 'utf8');
  }

  // 4. Sentinel so this never runs again.
  fs.writeFileSync(sentinel, 'migrated-to-profiles', 'utf8');
  return { migrated: moved };
}

module.exports = { migrateToProfiles, PROFILE_KEYS };
