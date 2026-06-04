# Research

Deep-research documents EJ supplied while building Slash. Reference material
for the engine, UI, and accessibility decisions. The actionable conclusions
are already distilled into `../../DESIGN.md` and `../../BROWSER-UI.md`.

- **classic-browser-ui-blueprint.md**: legacy browser UI structure (Netscape
  / IE rebar, omnibox, status bar, security indicators, viewport sizing,
  keyboard shortcuts, five rules for a custom browser).
- **building-a-custom-desktop-browser.md**: modern browser internals.
  Multi-process architecture, engine embedding options (CEF / Electron / Tauri
  / WebView2 / Servo), chrome components, SQLite schemas, networking, security,
  rendering pipeline, extensions (MV3), CDP, real-world case studies.
- **browser-uiux-and-accessibility.md**: UI layout heuristics (three layout
  paradigms, type scale, button vocabulary, status colors), WebExtensions,
  UAAG 2.0 accessibility conformance, SQLite history/download schemas, session
  restore (MOZLZ4).

Most of the engine-level content is handled for us by Electron/Chromium since
Slash is a shell, not a from-scratch engine. The UI, accessibility, and
storage sections are the parts we actually build against.
