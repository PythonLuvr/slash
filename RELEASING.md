# Releasing Slash

Slash packages with [electron-builder](https://www.electron.build/) and
auto-updates with [electron-updater](https://www.electron.build/auto-update),
pointed at GitHub Releases on `PythonLuvr/slash`.

## App identity

- **Name:** `productName: "Slash"` in `package.json` (the built app is
  `Slash.exe`, not `slash`).
- **Icon:** generated from `src/icon.png` (the yellow `/` tile). Run
  `npm run icon` to regenerate `build/icon.ico` + `build/icon.png` after the
  logo changes. electron-builder picks them up automatically.

## Build

```
npm run icon     # regenerate icons (only after the logo changes)
npm run pack     # unpacked app in dist/win-unpacked/ (quick sanity build)
npm run dist     # the real NSIS installer in dist/ (+ latest.yml for updates)
```

`npm run dist` produces `Slash Setup <version>.exe` and `latest.yml`. The
`.yml` is what installed copies read to discover updates.

## Publish a new version

1. Bump `version` in `package.json`.
2. Write the **release notes** (these are what users see as "what changed").
3. Build + publish to GitHub Releases. Either:
   - set `GH_TOKEN` and run `npx electron-builder --publish always`, or
   - run `npm run dist` and upload `Slash Setup <version>.exe` + `latest.yml`
     to a GitHub release tagged `v<version>`.

## How updates reach users

- On launch, an installed Slash checks GitHub Releases for a newer version.
- If one exists, a **non-blocking infobar** appears: `Slash X.Y is available`
  with **Update**, **What changed** (opens the release notes), and **Later**.
- Updates are **optional**: nothing downloads or installs until the user
  clicks Update, and nothing is forced. So every release needs clear notes.
- Dev runs (unpackaged `npm start`) skip the updater entirely.

## Notes

- Installers are currently **unsigned**, so Windows SmartScreen will warn on
  first install. Add a code-signing certificate to `build.win` when available.
- `dist/` is gitignored; `build/` icons are committed as build resources.
