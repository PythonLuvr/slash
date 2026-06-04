# Loom

A small, hackable, AI-native web browser. Loom is a custom shell over
Chromium (via Electron) with your own UI wrapped around it, and a built-in
AI panel that talks to Claude, Gemini, or ChatGPT through either their
CLIs (on your existing subscription) or their APIs (bring your own key).

Personal, local, open source. Nothing is hardcoded and nothing phones home.

## Features

- **Real browser.** Chromium engine, your own chrome: omnibox, back/forward,
  reload, a clean start page.
- **Built-in AI panel.** A collapsible, docked side panel (toggle with
  `Ctrl+J`). Streaming replies, multi-turn.
- **Pick your model and how it runs.** Claude, Gemini, or ChatGPT, each as
  either:
  - **CLI**: spawned via [Squire](https://github.com/PythonLuvr/squire) on
    your existing subscription. No API key, no per-token cost.
  - **API**: a direct call using an API key you add in Settings (BYOK).
- **Bring your own keys.** Stored locally on your machine in the OS app-data
  directory, never in this repo, never sent anywhere but the provider you
  pick. Model ids are editable defaults, not baked in.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer.
- For **CLI** AI variants, install the CLI(s) you want and sign in:
  - Claude: [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) (`claude`)
  - Gemini: [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`gemini`)
  - ChatGPT: [Codex CLI](https://github.com/openai/codex) (`codex`)
- For **API** variants, just paste a key in Settings. No CLI needed.

## Run

```bash
npm install
npm start
```

## Configure AI

- Toggle the panel with the spark icon in the toolbar or `Ctrl+J`.
- Use the picker to choose a provider and switch between **CLI** and **API**.
- Click the gear to add API keys and set model ids. CLI variants need no key.

## How it is built

- **Electron** with `BaseWindow` + `WebContentsView`: one view for the chrome
  (toolbar), one for the live page, one for the start page, one for the AI
  panel. The page view is sandboxed with no preload; trusted UI views get a
  narrow IPC bridge.
- **CLI AI** runs through Squire, which spawns the CLI as a subprocess and
  streams typed events.
- **API AI** streams Server-Sent Events directly from each provider.

## License

MIT.
