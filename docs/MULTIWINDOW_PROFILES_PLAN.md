# Multi-Window + Profiles refactor plan

Branch: `multi-window-profiles`. Each step leaves the app launchable; commit after each.
Chosen model: **each window belongs to a profile** (Chrome-style). Default profile stays
on `session.defaultSession` so existing logins survive (no Partitions migration).

App-level (shared) settings: `apiKeys`, `apiModels`, `selection`, `accent`, `doh`,
`httpsOnly`, `blockAds`, `seenDefaultPrompt`, `updatesEnabled`.
Profile-level settings: `searchEngine`, `heroEngines`, `customEngines`, `pwBlocked`, `extensions`.

On-disk layout target:
```
userData/
  slash-settings.json      (app-level shared)
  slash-profiles.json      (registry)
  slash-favicons.json      (shared cache)
  slash-adblocker.bin      (shared filter list)
  profiles/
    default/  settings.json  data.json  vault.json  session.json  Partitions/...
```

## Phase 1: Multi-window foundation (one shared profile)
- [ ] 1.1 `createBrowserWindow()` factory returns a `W` context object holding every
      per-window global (win, all chrome views, tabs/activeTabId/tabSeq/closedStack,
      settingsOpen, popKind, findOpen, ctxOpen, permQueue, chromeHeight, etc.).
      Add `windows[]` registry + `focusedWindow()`. No behavior change.
- [ ] 1.2 Thread `W` through every per-window function: layout, updateContentVisibility,
      raiseChrome, attachTabView, createTab, activateTab, closeTab, suspend, wake, sendState,
      sendTabs, popovers, find, ctx, permissions, etc. Replace bare globals with `W.*`.
      Watch closures in attachTabView (setWindowOpenHandler) + before-input-event shortcuts.
- [ ] 1.3 `windowFromEvent(e)` helper; rescope the ~90 IPC handlers to the sending window
      (fallback `focusedWindow()` keeps partial rollout safe). Roll out in batches.
- [ ] 1.4 Window lifecycle: `window:new` IPC + Ctrl+N; 'closed' splices from registry +
      saves session; second-instance/activate/window-all-closed/before-quit iterate windows.
- [ ] 1.5 Per-window session restore: `{ windows: [ {tabs,active} ] }`; back-compat with
      old flat shape. Phase 1 ship point.

## Phase 2: Profile data layer + migration (default profile only)
- [ ] 2.1 `lib/profiles.js` registry (`slash-profiles.json`). Split settings.js into
      app-level vs profile-level; `readSettings(profileId)`/`writeSettings(profileId,patch)`.
      `store.js`/`vault.js` path fns take `profileId` (default 'default').
- [ ] 2.2 `lib/migrate-profiles.js`: first-run move of slash-data/vault/session into
      `profiles/default/`, split settings, write registry, sentinel. Keep `.bak` originals.
      HIGH RISK. Test on a copied userData, never live.
- [ ] 2.3 `createBrowserWindow({profileId='default'})`; route every store/vault/settings call
      through `W.profileId`. Phase 2 ship point (no UX change).

## Phase 3: Real profiles + per-profile sessions/extensions + UI
- [ ] 3.1 `profileSession(id)` returns `persist:profile-<id>` (default special-cased to
      defaultSession). Tabs use the profile partition. HIGH RISK: isolation guarantee.
- [ ] 3.2 Per-session hardening keyed by profile: applyDoh/setupPermissions(ses,profileId);
      blocker enabled in every profile session; permissions read/write per-profile data.json.
- [ ] 3.3 One `ElectronChromeExtensions` per profile session (`extByProfile` map);
      createTab/selectTab/removeTab/createWindow route to that profile's windows.
      loadSavedExtensions(profileId)+installChromeWebStore per profile. HIGH RISK.
- [ ] 3.4 UI: profile popover (list + open-window-for-profile + manage); Settings "Profiles"
      section (create/rename/recolor/delete, gated); window title/tint per profile.
- [ ] 3.5 Per-profile session restore across launch; before-quit saves per profile.

## Riskiest steps
1. 2.2 data migration (only step that can lose data: test on a copy, keep .bak).
2. 3.1 per-profile partitions (isolation; keep default on defaultSession).
3. 3.3 extensions per profile (most complex integration).
4. 1.3 IPC rescoping (highest edit volume; focusedWindow() fallback is the safety net).
5. 1.2 threading W (largest mechanical churn; z-ordering + closures).
