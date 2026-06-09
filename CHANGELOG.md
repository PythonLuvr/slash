# Changelog

## 1.0.0

The first public release of Slash: an AI-native, private-by-default web browser.

### Browsing
- Multiple windows (Ctrl+N), each fully independent
- Tabs with pinning, drag-to-reorder, and a right-click menu
- Session restore: your open windows and tabs come back next launch
- Private tabs (Ctrl+Shift+N): in-memory, no history, no traces
- Bookmarks bar, history, downloads, find-in-page, zoom
- A clean, unified toolbar icon set and a page-load progress bar

### Performance and memory
- A dockable memory panel (gauge button in the toolbar): live memory graph,
  CPU and network meters, and your heaviest tabs with their real RAM
- A configurable RAM limit (Opera GX style): set a cap and the least-recently-used
  background tabs sleep to hold it; "Free memory now" sleeps them on demand
- Idle background tabs are suspended automatically; sleeping tabs show a moon in
  the strip and reload instantly when clicked
- Blank "New tab" pages cost no renderer until you navigate

### Search
- Seven built-in engines (DuckDuckGo default, Startpage, Brave, Google, Bing,
  Ecosia, Wikipedia)
- One synced default across the address bar, start page, and settings
- Customizable start-page quick picks (add, remove, reorder)
- Add your own engines, plus one-click "add this site" on OpenSearch sites

### AI
- Built-in assistant: a docked panel and a full-screen page
- Claude, Gemini, or ChatGPT, via a free CLI or your own API key
- Real web tools (search, read a page, open tabs) and an MCP bridge

### Privacy and security
- No account, no telemetry, no cloud sync; Chromium background networking is off
- Ad and tracker blocking, HTTPS-only, DNS-over-HTTPS, per-site permission prompts
- API keys, saved passwords, and your local bookmarks/history are encrypted at rest
- Favicons are cached locally instead of fetched from a third-party service
- Clear browsing data (history, cache, cookies) on demand

### Move-in
- Import bookmarks, history, sessions, and passwords from another browser
  (Chrome, Edge, Brave, Opera, Opera GX, Vivaldi, Chromium, Yandex, Firefox)
- Default-browser setup (registers Slash in Windows Default Apps)
- Built-in password manager with CSV import and autofill

### Profiles
- Separate profiles (Work, School, Personal), each in its own window, with
  isolated logins/cookies, history, passwords, tabs, bookmarks, and extensions
- Theme and AI keys are shared across profiles; no sign-in, all on your device
- Create, rename, recolor, and delete profiles from the profile menu and Settings

### Extensions
- Install Chrome extensions from the Chrome Web Store, or load an unpacked folder
- Content blockers and most extensions work; extensions are per profile

### Notes on the upgrade
- On first launch your existing data is moved into a "default" profile
  automatically (with .bak backups kept), nothing is lost

### Known limitations
- DRM streaming (Netflix, Spotify, Disney+, Prime) does not play yet; it needs
  Widevine, which is on the roadmap. Regular video (YouTube, Vimeo, Twitch,
  embedded HTML5) plays fine.
- Extension popups (clicking an extension's toolbar icon) are not wired up yet;
  content blockers and background/content-script extensions work.

### Notes
- The installer is currently unsigned (see README). Windows SmartScreen will warn
  on first run; click "More info" then "Run anyway".
