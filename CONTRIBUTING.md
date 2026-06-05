# Contributing to Slash

Thanks for being here. Slash is open source because the app that sees everything
should be one anyone can read, audit, and improve. Contributions of all sizes
are welcome.

## Ways to help

- **Report a bug:** open an [issue](https://github.com/PythonLuvr/slash/issues/new/choose)
  with the bug report form. Detail makes it fixable.
- **Request a feature:** use the feature request form. Tell us the problem, not
  just the solution.
- **Ask or share:** questions, setups, and ideas go in
  [Discussions](https://github.com/PythonLuvr/slash/discussions).
- **Send a pull request:** fixes, features, docs, all good.

## Run it locally

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/PythonLuvr/slash.git
cd slash
npm install
npm start
```

To build an installer: `npm run dist` (local only). See
[RELEASING.md](RELEASING.md) for the release process.

## Project layout

- `src/main.js` is the Electron main process: windows, tabs, views, IPC, and the
  privacy/security wiring.
- `src/lib/` holds the focused modules: `settings`, `store`, `migrate`, `vault`,
  `favicons`, `api`, `mcp-server`.
- Each UI surface is an HTML/CSS/JS trio plus a sandboxed preload that exposes a
  narrow IPC bridge (`hero.*`, `ai.*`, `settings.*`, `overlay.*`, ...).
- `DESIGN.md` is the visual system, `PRIVACY.md` is the security model and
  roadmap, `mockups/` holds the HTML used for the README art.

## Principles to keep

These are what make Slash *Slash*. PRs that hold to them merge faster:

- **Private by default, local-first.** No telemetry, no account, no cloud sync.
  New data stays on the user's machine; secrets are encrypted at rest with the
  OS keystore (`safeStorage`).
- **Nothing hardcoded to one person or machine.** No keys, no personal paths.
  AI is bring-your-own-key or a local CLI.
- **Keep the shell hardened.** Web content stays sandboxed and context-isolated
  with no Node access. Trusted UI views never navigate themselves.
- **Be honest in the UI and docs.** If something is best-effort or has limits,
  say so plainly (see the README's "What Slash does not do").

## Pull requests

1. Branch from `main`.
2. Keep changes focused; match the style of the surrounding code.
3. Run `npm start` and confirm the app still launches and your change works.
4. Describe what changed and why. Link the issue it closes.

By contributing you agree your work is licensed under the project's
[MIT License](LICENSE).
