# Changelog

## 1.0.0

The first public release of Slash: an AI-native, private-by-default web browser.

### Browsing
- Tabs with pinning, drag-to-reorder, and a right-click menu
- Idle background tabs are suspended to save memory; a memory readout in the menu
- Session restore: your open tabs come back next launch
- Private tabs (Ctrl+Shift+N): in-memory, no history, no traces
- Bookmarks bar, history, downloads, find-in-page, zoom

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
- Firefox bookmarks and history; default-browser setup
- Built-in password manager with CSV import and autofill

### Profile
- Your profile is just your computer account (no sign-in)

### Notes
- The installer is currently unsigned (see README). Windows SmartScreen will warn
  on first run; click "More info" then "Run anyway".
