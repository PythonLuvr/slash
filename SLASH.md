# Slash, project context (start here)

Canonical context for **Slash**, EJ's personal AI-native browser. Read this
first when starting a session on this project. Pair with `DESIGN.md` (visual
system), `BROWSER-UI.md` (feature roadmap), and `docs/research/` (the deep
research EJ supplied).

## What it is

A personal, local, open-source, modifiable, low-usage **web browser** with a
built-in AI panel. Built as a **custom Electron shell over Chromium** (route
"A": own the UI, rent the engine). NOT a Firefox/Chromium fork. The folder is
`Desktop\slash` (codename was "Loom"); the product is named **Slash**.

## Identity (locked, do not relitigate)

- **Name: Slash.** Wordmark `/slash` (leading yellow slash) in **Space
  Grotesk**. The `/` is the mark AND a real feature (the slash-command key).
  On the hero it is a **blinking yellow cursor**.
- **Color: soft yellow `#f1cb53`**, themeable at runtime (settings), dark text
  on the accent. Default lives in `lib/settings.js`.
- **Look:** near-black chrome (`#1c1c1f` / titlebar `#141416`), **system font**
  for UI (Segoe UI), conventional Chrome/GX layout. No left rail.
- **App icon:** yellow rounded tile + dark `/` (`src/icon.png`, regenerated
  from `mockups/icon.html`).
- Rejected directions (do not revisit): Catppuccin dark, warm-clay light,
  warm-neutral "Claude" light, GX-red with a left sidebar. EJ has strong,
  specific taste; match real references, do not generate looks from adjectives.

## How to run

```
cd Desktop\slash
npm start          # uses launch.js to strip ELECTRON_RUN_AS_NODE (see below)
```

**Critical gotcha:** `ELECTRON_RUN_AS_NODE=1` is set globally on EJ's PC, which
makes the Electron binary run as plain Node (`app` is undefined,
`electron --version` prints the Node version). `launch.js` strips it. Always
launch via `npm start`, never `electron .` directly.

## Mockup-first workflow (how the design got built)

NO AI image generation for UI (EJ rejected it). Mockups are **HTML/CSS in
`mockups/`, rendered to PNG with headless Edge**, then opened for EJ:

```
& msedge --headless=new --disable-gpu --hide-scrollbars --window-size=1280,840 \
  --screenshot="out.png" "file:///.../mockups/mockup.html"
```

`mockups/mockup.html` is the approved full-browser reference. The real app
chrome matches it.

## Architecture

Electron `BaseWindow` holding stacked `WebContentsView`s (main.js):
- **chromeView** (`index.html` / `chrome.js` / `styles.css`): tab strip +
  toolbar + bookmarks bar. Trusted, `preload.js` -> `window.loom`.
- **heroView** (`hero.*`): the `/slash` speed-dial start page. Shown for any
  tab that has not navigated. Trusted, `hero-preload.js` -> `window.hero`.
- **per-tab pageViews**: live web content, untrusted, no preload. Tab model in
  main.js (Map of tabId -> view; only active visible).
- **aiView** (`ai.*`): docked right AI panel. Trusted, `ai-preload.js`.
- **popoverView** (`overlay.*`): top-right menu / profile / downloads /
  history layer (avoids clipping; sized per kind). Trusted, `overlay-preload`.
- **findView** (`find.*`): find-in-page bar. Trusted, `find-preload.js`.

Runtime accent theming: main injects the user's accent into every chrome view
via `webContents.insertCSS` (`applyAccent` / `broadcastAccent`).

## AI integration

- AI runs through **Squire** (`@pythonluvr/squire`, npm) which spawns the
  provider CLI as a subprocess on the user's subscription (no API cost), OR a
  direct **BYOK API** call (`lib/api.js`, SSE streaming).
- Providers in `main.js` `PROVIDERS`: Claude (default), Gemini, ChatGPT. Each
  has a CLI variant and an API variant. CLI uses default permission mode (no
  bypass) so it answers conversationally with no autonomous tool powers.
- Verified: Squire -> `claude` CLI streams. `claude`, `gemini`, `codex` CLIs
  all present on EJ's PC.
- Hero "Ask AI" mode sends the prompt + chosen model into the panel
  (`hero:ask-ai` -> `ai:prompt`).

## Data + settings (local, never in repo)

- `lib/settings.js` -> `userData/loom-settings.json`: AI selection, BYOK API
  keys, model ids, **accent**.
- `lib/store.js` -> `userData/slash-data.json`: bookmarks + history.

## Feature status

Done: tabs (model, strip, keyboard Ctrl+T/W/Shift+T/Tab/1-9), omnibox, hero
speed-dial (engines one-click row, Google default, search suggestions via
`suggest:get`, `/` slash-command flips to AI, AI model pills from
`providers:get`), AI panel (CLI+API, themeable accent picker in settings),
downloads (tracked), zoom, top-right cluster (menu/profile/downloads/history),
bookmarks bar + star (Ctrl+D), find-in-page (Ctrl+F), history popover.
Accessibility baseline (aria-labels, focus-visible, reduced-motion).

Not done / next (see BROWSER-UI.md): SQLite for history/bookmarks (currently
JSON), session restore, omnibox security/site-info icon, real extensions,
context menus, tab groups, the OSS repo rename `loom` -> `slash` + publish.

## OSS discipline

Authored as public OSS: nothing hardcoded (no keys/paths/personal data), BYOK
only, depends on the published `@pythonluvr/squire` from npm (not a local
`file:` path). Has `README.md` + `.gitignore`. Fonts bundled (IBM Plex +
Space Grotesk, OFL). Eventual repo: `PythonLuvr/slash`, MIT.

## EJ working preferences that bit this project

- No AI image gen for UI/mockups (HTML/CSS/SVG only).
- No em dashes anywhere (a write hook enforces it).
- Match real references; do not invent looks from adjectives.
- Show pixels, iterate fast; he reacts to renders, not descriptions.
