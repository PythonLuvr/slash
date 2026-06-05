# Slash Privacy and Security Roadmap

The thesis: Slash is **private and safe by default**. Not a feature list bolted
on later, the posture the browser ships with. This file is the build plan.
Each item lists what it does, where it hooks into the codebase, the effort, and
the gotchas. Order is by impact-over-effort, not by tier number.

Cross-cutting rule: every new UI surface (site-info, permission prompt, blocker
counter, clear-data, private window) follows `DESIGN.md`. Dark chrome, one
accent, borders-only, mono for machine facts.

**Landed (2026-06-04):** item 1 (DuckDuckGo default + `searchEngine` setting),
item 2 (API keys encrypted via safeStorage), item 3 (per-site permission
prompts + site-info omnibox button/popover), item 4 (HTTPS-only with fallback
interstitial), item 5 (shell hardened: sandbox/contextIsolation/nav-block/CSP
on all views), item 6 (EasyList/EasyPrivacy ad/tracker blocker via
@ghostery/adblocker-electron, with a shield button + per-page blocked count +
on/off toggle), item 8 (DoH), plus a full in-app settings surface exposing
search engine, the privacy toggles, and accent. Next up: item 7 (third-party
cookies + referrer), item 9 (clear-data + private window), item 14 (AI
send-page consent UI). The settings page now has homes for clear-data and a
private-window launcher when those land.

## Tier 1, quick wins with real impact

### 1. Private search by default (DuckDuckGo)
Flip the default engine from Google to DuckDuckGo. Make it a real setting, not
a constant.
- Hooks: `ENGINES` + `normalizeInput` in `main.js` (currently falls back to
  Google), the hero engine row default, and a new `searchEngine` field in
  `lib/settings.js`.
- Effort: small. Touches ~3 spots. Do it as "add a setting" so the choice is
  the user's.

### 2. Encrypt stored API keys (Electron safeStorage)
Stop storing BYOK keys as plaintext JSON. Use `safeStorage` (Windows DPAPI /
macOS Keychain / libsecret).
- Hooks: `lib/settings.js`. On write, `safeStorage.encryptString` then base64;
  on read, base64 -> `safeStorage.decryptString`. Guard with
  `safeStorage.isEncryptionAvailable()`. Migrate existing plaintext keys on
  first read (decrypt-or-passthrough).
- Effort: small. Highest embarrassment-to-fix ratio. Do first.

### 3. Per-site permission prompts
Camera / mic / location / notifications / clipboard are currently auto-handled
by Electron defaults. Gate them behind a prompt and a per-site decision.
- Hooks: `session.defaultSession.setPermissionRequestHandler` and
  `setPermissionCheckHandler` in `main.js`. New per-site permission store
  (extend `lib/store.js`). New prompt UI (reuse the popover layer or a small
  dedicated view) plus a site-info button in the omnibox.
- Effort: medium (needs UI + storage). Security-sensitive, do it right: deny by
  default until the user answers.

### 4. HTTPS-only mode
Upgrade `http://` to `https://`, warn (do not silently load) when a site has no
HTTPS.
- Hooks: `webRequest.onBeforeRequest` to rewrite the scheme, with a fallback
  interstitial when the upgrade fails. Per-site "continue to HTTP" escape hatch.
- Effort: medium. Gotcha: some sites genuinely lack HTTPS; the escape hatch and
  the warning page matter.

### 5. Harden the Electron shell
Close the "Electron done wrong" surface.
- `sandbox: true` on every `WebContentsView` (verify the trusted preloads stay
  sandbox-safe: they only use `contextBridge` + `ipcRenderer`, which is fine).
- Explicit `contextIsolation: true`, `nodeIntegration: false` on all views
  (defaults today, make them explicit and audited).
- Strict CSP on the chrome HTML pages (`index/hero/ai/overlay/find/context`).
- `will-navigate` deny on the trusted views so a compromised chrome page cannot
  navigate itself; keep web navigation only inside the untrusted page views.
- Confirm `webviewTag` is disabled (Electron default off, assert it).
- Effort: medium, low risk. High structural value. Pairs with a one-pass audit.

## Tier 2, the privacy features that actually defend you

### 6. Built-in tracker and ad blocking (EasyList / EasyPrivacy)
Brave's signature, and the thing that defends you on the real web.
- Hooks: `session.defaultSession` network layer. Cleanest path is
  `@ghostery/adblocker-electron` (`fromLists` + `blockingViewsFromSession`),
  which is a maintained, well-tested matcher. Adds one dependency. Ship a
  per-site toggle and a blocked-count badge in the toolbar.
- Effort: large-ish but mostly integration. The badge follows DESIGN.md.

### 7. Block third-party cookies + tighten referrer policy
- Hooks: `webRequest.onBeforeSendHeaders` / `onHeadersReceived` to drop
  cross-site `Cookie` / `Set-Cookie`, and set a strict `Referrer-Policy`
  (`strict-origin-when-cross-origin` or tighter). Electron has no single
  third-party-cookie toggle, so this is filter-based.
- Effort: medium. Gotcha: do not break first-party logins; scope to cross-site
  only.

### 8. DNS-over-HTTPS (DoH)
Your DNS lookups stop being readable by the network/ISP.
- Hooks: `session.defaultSession.configureHostResolver({ secureDnsMode:
  'secure', secureDnsServers: [...] })`. One call, plus a settings entry for the
  resolver.
- Effort: small. Easy, high win. Good Tier-1-adjacent.

### 9. Clear browsing data + private/ephemeral window
- Clear-data: time-ranged clear of history / cookies / cache. History and
  bookmarks are our JSON store (`lib/store.js`); cookies/cache via
  `session.clearStorageData` / `clearData`. New settings surface.
- Private window: a second `BaseWindow` on an in-memory partition
  (`session.fromPartition('slash-private', { cache: false })`) that writes
  nothing to `store.js` and is dropped on close.
- Effort: medium. The private window is the marquee piece.

## Tier 3, deeper and harder

### 10. Encrypt the local data store at rest
Apply the safeStorage pattern from item 2 to the history/bookmarks blob in
`lib/store.js`. Small once item 2 exists.

### 11. Fingerprint resistance
Reduce canvas / WebGL / font entropy. Hard and partial. Tension with the design:
page views deliberately have no preload, so spoofing navigator/canvas props
needs either a per-page injection or a session-level shim. Partial wins only.
Defer until Tier 1 and 2 land.

### 12. Auto-update Electron / Chromium
A browser that lags on Chromium is the real long-term risk. This is release
process, not runtime: `electron-updater` / `update-electron-app` for the
packaged build, plus a discipline of bumping the `electron` dep on security
releases. Set up when Slash starts shipping packaged builds.

### 13. Optional proxy / VPN / Tor toggle
- Proxy: `session.setProxy({ proxyRules })`, easy.
- Tor: needs a bundled or external Tor SOCKS endpoint to point the proxy at.
  Hard. Proxy first, Tor maybe never.

## AI boundary (cross-cutting, non-negotiable)

### 14. The assistant stays leashed and transparent
- Never send page content to the AI without an explicit user action. Today the
  panel only sends the chat transcript, which is correct; keep it that way.
- Any future "send this page / selection to AI" action must show exactly what is
  included before it sends, and require a click.
- CLI variants already run in default permission mode (no bypass, no autonomous
  tools). Do not loosen that.

## Migration and passwords (landed 2026-06-05)

Moving in from another browser, without sending anything off the machine.

### Import from another browser (`lib/migrate.js`)
- Reads installed Chromium-family browsers (Chrome, Edge, Brave, Vivaldi, Opera),
  one entry per profile, from the local profile directory. Nothing is uploaded.
- **Bookmarks / history:** plaintext JSON and the `History` SQLite DB, read with
  `sql.js` (pure WASM, no native build, so every clone of the repo works). History
  merges by URL keeping each entry's own visit time (`store.importHistory`).
- **Cookies (stay signed in):** the `Cookies` SQLite DB. Values are AES-256-GCM
  encrypted under a key sealed with Windows DPAPI. Same OS user, so we unseal the
  key (`CryptUnprotectData` via PowerShell, no native dep) and decrypt, then inject
  with `session.cookies.set`. Honest limits, surfaced in the UI:
  - Chrome's newer **app-bound** (`v20`) cookies cannot be read by design; they are
    skipped and counted ("N protected"). Verified live: current Chrome returns 100%
    app-bound, Brave decrypts cleanly.
  - A running browser can lock the DB; we fall back to a temp copy, and tell the
    user to close it if that still fails.
- Gotcha: nothing here ever leaves the device, and it only runs on an explicit
  per-source "Import" click with the data types the user ticked.

### Password vault (`lib/vault.js`)
- Encrypted at rest with the same `safeStorage` (DPAPI/Keychain/libsecret) as the
  API keys (item 2). Plaintext only in memory while running.
- Filled by **CSV import** (the ecosystem-standard path every browser and password
  manager supports, and the only robust one now that app-bound encryption blocks
  direct password reads), plus capture-on-login.
- **Autofill** (`tab-preload.js`): a minimal sandboxed, context-isolated preload on
  page views. It fills saved logins only into visible fields on the matching origin,
  on a real focus gesture, and **never exposes passwords to page scripts** (nothing
  on `window`; the vault data stays in the isolated world). Offers to save/update on
  submit via the non-blocking infobar.
- Related: item 10 (encrypt the local data store) now has a working pattern to copy.

## Suggested first sweep

Cheapest high-impact set to land first, mostly main-process and settings, little
new UI: **2 (encrypt keys), 5 (harden shell), 8 (DoH), 1 (DDG default).** Then
3 (permissions) and 4 (HTTPS-only) once the site-info UI exists, then 6 (the
blocker) as the signature feature.
