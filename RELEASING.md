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
npm run dist     # the real NSIS installer in dist/ (never publishes)
npm run release  # build AND publish to GitHub Releases (needs GH_TOKEN)
```

`npm run dist` produces `Slash Setup <version>.exe` and `latest.yml`, locally
only (`--publish never`). The `.yml` is what installed copies read to discover
updates. `npm run release` is the only command that uploads anything.

## Code signing (the SmartScreen fix)

Unsigned installers make Windows SmartScreen show a blue "unrecognized app"
warning on first run. For a browser whose whole pitch is trust, sign it.

1. Get a **code-signing certificate** from a CA (Sectigo, DigiCert, etc.):
   - **OV** (cheaper): works, but SmartScreen still warns until the cert builds
     reputation over time/downloads.
   - **EV** (pricier, hardware token or cloud HSM): clears the SmartScreen
     warning immediately. Worth it if you are distributing widely.
2. electron-builder signs automatically from environment variables, no config
   in the repo (keep the cert and password out of git):
   ```powershell
   $env:CSC_LINK = "C:\path\to\cert.pfx"   # or a base64 string of the .pfx
   $env:CSC_KEY_PASSWORD = "<pfx password>"
   npm run release      # or npm run dist for a signed local build
   ```
   For a token/cloud-HSM EV cert, follow the CA's signtool setup; electron-builder
   honors a custom `signtoolOptions` / `sign` hook in `build.win` when needed.
3. Verify: right-click the built `Slash Setup <version>.exe` -> Properties ->
   Digital Signatures should list your publisher.

Until a cert is added, the build is unsigned and the README/first-run should be
honest that SmartScreen will warn (it is expected for an unsigned open-source
build, and users can click "More info" -> "Run anyway").

## Publish a new version

1. Bump `version` in `package.json`.
2. Write the **release notes** (these are what users see as "what changed").
3. Tag and publish to GitHub Releases:
   - set `GH_TOKEN` (a GitHub token with repo scope), and the signing env vars
     above if you have a cert, then run `npm run release`, **or**
   - run `npm run dist` and manually upload `Slash Setup <version>.exe` +
     `latest.yml` to a GitHub release tagged `v<version>`.
4. The tag must be `v<version>` matching `package.json`, or electron-updater
   will not match it.

## Testing auto-update end to end

1. Publish version A (e.g. `0.1.0`) to GitHub Releases and install it.
2. Bump to version B (e.g. `0.1.1`), write notes, `npm run release`.
3. Launch the installed version A. Within a few seconds the update infobar
   should appear ("Slash 0.1.1 is available"). Click **What changed** to confirm
   the notes open, then **Update** to confirm it downloads and restarts in place.
4. Dev runs (`npm start`) never check for updates, so test with the installed
   build only.

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
