# Browser UI Inventory and Roadmap

A functional inventory of what a complete desktop browser UI provides, drawn
from the engines on this machine: Chromium (Brave, Chrome, Edge, Opera GX)
and Gecko (LibreWolf). Each item lists what real browsers offer, Loom's
current status, and a build priority.

Status: DONE = built · PART = partial · GAP = missing
Priority: P1 = core browsing · P2 = expected daily · P3 = power/extra

## 1. Tab strip

Real browsers: new-tab (+), per-tab close (x), title + favicon + loading
spinner, drag-reorder, overflow scroll, a tab-list/search dropdown, hover
preview, mute indicator, pinned tabs, tab groups, and a context menu (close,
close others, close to the right, pin, mute, duplicate, move to new window,
reopen closed). Modern browsers also offer vertical tabs (Edge, Opera).

- Loom: GAP. There is exactly one implicit tab.
- Build: tab model (Map of WebContentsView), strip UI, new/close/switch,
  drag-reorder, overflow, reopen-closed. **P1.**

## 2. Navigation toolbar

Real browsers: back (long-press = history menu), forward, reload/stop, home
(optional), omnibox, then a right cluster: extensions puzzle, downloads
button, profile/avatar, and the main menu. Page-action icons live inside or
beside the omnibox (bookmark star, reader, translate, share, zoom).

- Loom: PART. Back, forward, reload/stop, home (wordmark), AI toggle. Missing
  the right cluster (downloads, menu, profile) and page actions.
- Build: main-menu button + downloads button + bookmark star. **P1/P2.**

## 3. Omnibox (address + search)

Real browsers: one field for URLs and searches, security state at the left,
an autocomplete/suggestions dropdown (history, bookmarks, search), search-
engine keywords/shortcuts, and Ctrl+Up/Down to cycle engines. Page actions
sit at the right edge. Ctrl+L / Alt+D focuses it.

- Loom: PART. Plain field, URL-vs-search detection, no suggestions, no
  security state, no page actions, no keyword engines.
- Build: suggestions dropdown, security/site button, engine keywords. **P2.**

## 4. Page context menu and find-in-page

Real browsers: right-click menu (back/forward/reload, save-as, print, cast,
translate, view-source, inspect; on selection: copy, search-for, print; on
link: open in new tab/window, copy link; on image: open/save/copy; spell-
check suggestions; editable-field cut/copy/paste). Find-in-page bar (Ctrl+F)
with match count, next/prev, highlight-all, match-case.

- Loom: GAP. Default Chromium context menu is not even wired; no find bar.
- Build: context menu (via `context-menu` event), find-in-page bar. **P1/P2.**

## 5. Side panels

Real browsers: collapsible right/left panels for bookmarks, history, reading
list, downloads, and (Edge/Chrome) an AI/copilot panel. One at a time,
toggleable, remembered.

- Loom: PART. The AI panel is exactly this pattern. History/bookmarks/
  downloads panels not built.
- Build: generalize the panel system to host more than AI. **P2.**

## 6. Main menu

Real browsers: new tab / new window / new private window, history, downloads,
bookmarks, zoom controls, print, find, cast, more-tools (extensions, task
manager, dev tools, clear browsing data), edit (cut/copy/paste), settings,
help, exit.

- Loom: GAP. The native menu was removed; nothing replaced it.
- Build: a Loom main menu (popover) with the core entries. **P1.**

## 7. Downloads

Real browsers: a downloads button + popover list with progress, pause/resume/
cancel, open, show-in-folder, and a full downloads page. A shelf or bubble on
new download.

- Loom: GAP. Downloads are unhandled (the `will-download` event is not wired).
- Build: download handling + a downloads panel/bubble. **P2.**

## 8. Bookmarks

Real browsers: star-to-add in the omnibox, an optional bookmarks bar, a
bookmark manager (folders, search, edit), import/export.

- Loom: GAP.
- Build: bookmark store (local), star action, a bookmarks panel + optional
  bar. **P2.**

## 9. History

Real browsers: a full history page/panel (search, by day), recently-closed
tabs, and the back/forward long-press menu.

- Loom: GAP (per-tab nav history exists internally, no UI).
- Build: visited-history store + a history panel, recently-closed. **P2.**

## 10. Permissions and security

Real browsers: a site-info button (the modern neutral "tune" icon, not a
trust-implying padlock) opening connection/cert details and per-site
permissions (camera, mic, location, notifications, popups, autoplay). Plus
permission prompts when a page requests access, and "Not Secure" on HTTP.

- Loom: GAP. Permission requests are auto-handled by Electron defaults;
  nothing surfaced to the user; no site-info UI.
- Build: a site-info popover, a `setPermissionRequestHandler` with prompts,
  HTTP "Not Secure" state. **P2** (security-sensitive, do it right).

## 11. Settings

Real browsers: a full settings surface (default search engine, home/startup,
appearance, privacy/clear-data, downloads location, languages, accessibility,
content/site settings).

- Loom: PART. Only AI keys/models in the panel gear.
- Build: a real settings surface (search engine, startup, downloads dir,
  appearance, a11y, clear-data). **P2/P3.**

## 12. Status and feedback

Real browsers: a hover status strip (bottom-left) showing a link's target
URL, a loading/progress indicator, and infobars/notifications for events
(downloads, blocked popups, update available).

- Loom: GAP. No link-hover URL preview, no progress beyond the reload glyph.
- Build: hover-URL status strip, load progress. **P2.**

## 13. Window controls

Real browsers: minimize/maximize/close, fullscreen (F11), and on custom-chrome
browsers a draggable region. Loom uses the OS title bar today.

- Loom: PART. Standard OS frame; no F11 fullscreen toggle, no custom drag.
- Build: F11 fullscreen at least. **P3** (custom title bar is optional).

## 14. Accessibility (cross-cutting, build into every component)

Real browsers: full keyboard operability of all chrome; visible focus
(`:focus-visible`); ARIA roles/labels on every icon button and the tab strip
(`role="tab"`/`tablist`), omnibox as a `combobox`; screen-reader support;
forced-colors / high-contrast support; page zoom (Ctrl +/-/0); caret browsing
(F7); `prefers-reduced-motion` respected; minimum 24px-ish hit targets.

- Loom: PART/GAP. Icon buttons use `title` only (no `aria-label`); no
  `:focus-visible` styling on buttons; no forced-colors handling; transitions
  not gated on reduced-motion; tab strip a11y will be needed once tabs exist;
  no page zoom shortcuts.
- Build (do alongside each component, plus one audit pass):
  - `aria-label` on every icon-only button; `role` on tab strip + omnibox.
  - `:focus-visible` outline using the accent, on all interactive elements.
  - `@media (forced-colors: active)` and `(prefers-reduced-motion: reduce)`.
  - Page zoom (Ctrl +/-/0) via `webContents.setZoomLevel`.
  - Keyboard: ensure every action has a shortcut and is reachable by Tab.
  **P1 woven through, plus a P2 audit pass.**

## 15. Keyboard map (target)

Tabs: Ctrl+T new, Ctrl+W close, Ctrl+Shift+T reopen, Ctrl+Tab / Ctrl+Shift+Tab
cycle, Ctrl+1..8 jump, Ctrl+9 last. Nav: Alt+Left/Right, Ctrl+R reload,
Ctrl+L / Alt+D focus omnibox, Esc stop. Find: Ctrl+F, Esc close. Zoom:
Ctrl +/-/0. Window: F11 fullscreen, Ctrl+N new window. Panels: Ctrl+J AI
(current), Ctrl+H history, Ctrl+Shift+B bookmarks bar, Ctrl+Shift+J downloads.

- Loom: PART. Only Ctrl+J (AI). The rest arrive with their features.

## Proposed build order

1. **P1 core browsing:** tabs (1) + main menu (6) + page context menu and
   find-in-page (4), with a11y baked in (14).
2. **P2 expected daily:** downloads (7), history (9), bookmarks (8), omnibox
   suggestions + security/site button (3, 10), hover-URL status (12).
3. **P3 extras:** full settings (11), fullscreen + window polish (13),
   tab groups / vertical tabs, the a11y audit pass.

Tabs is the keystone: most P2 items assume a tab model. It goes first.
