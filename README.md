# Pochade-Electron Project

A vanilla JS, CSS and HTML project that runs both as an **Electron desktop app** and as a **static front-end-only web app**, with SQLite local persistence (sqlite-wasm), Chrome file APIs, Custom HTML Elements, and optional C++/Rust WebAssembly.

## Getting Started

Install dependencies:

```bash
npm install
```

## Running the Project (Web)

```bash
npm start
```

Starts a development server on a project-specific port written to `.env` (default: 3000). Open the URL shown in your terminal in Chrome.

## Running the Project (Electron)

```bash
npm run electron
```

Starts the webpack dev server and launches Electron against it. Changes to `src/`, `styles/`, `index.js`, etc. are rebuilt and reloaded automatically in the Electron window.

Changes to main-process files under `electron/` still require a manual restart of `npm run electron`.

### Memory Profiler

Launch Electron with the `--memory-profiler` flag to show a fixed overlay in the upper-left corner that reports live memory and CPU usage for each application process:

```bash
npm run electron -- --memory-profiler
```

The overlay is hidden by default and only appears when the flag is provided. It streams metrics from the Electron main process through a small, secure preload script.

## Building the Web App

```bash
npm run build
```

Creates a `dist` folder with the bundled and optimized files — a static site you can deploy to any web host. No special HTTP headers are required: the SQLite database persists in OPFS via sqlite-wasm's "opfs-sahpool" VFS, which works in any modern browser without cross-origin isolation.

## Packaging the Desktop App

```bash
npm run electron:build
```

Builds the web app and packages it with electron-builder into `release/` (macOS DMG + zip, Windows Squirrel installer, Linux AppImage). Packaging identity (`appId`, `productName`) lives in the `build` field of `package.json`.

Windows uses the Squirrel.Windows target (not NSIS) because the built-in Electron auto-updater can only apply updates to apps installed via Squirrel.

## Releases & Auto-Updates

Packaged apps keep themselves up to date via [update.electronjs.org](https://www.electronjs.org/docs/latest/tutorial/updates) — Electron's free, official update service for apps with a public GitHub repository. `electron/main.js` starts the updater (through the [`update-electron-app`](https://github.com/electron/update-electron-app) module) when a **packaged** app launches and re-checks every ten minutes; development (`npm run electron`) never contacts the feed.

When an update is found it is downloaded in the background and the user is offered a **Restart / Later** dialog.

### How to ship an update

1. Bump `version` in `package.json` (the updater compares versions semantically, so every release needs a new one) and commit.
2. Tag the commit and push it:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. GitHub Actions (`.github/workflows/release.yml`) builds the app for macOS, Windows, and Linux and publishes a GitHub Release with the installers.
4. Installed clients pick the new version up on their next check (at startup or within ten minutes).

### Requirements

- The `repository` field of `package.json` must point at the app's **public** GitHub repository — the updater resolves the feed URL (`https://update.electronjs.org/<owner>/<repo>/<platform>-<arch>/<version>`) from it. Keep the repo name in sync with what you enter at `npx pochade-electron` scaffolding time.
- **macOS builds must be code-signed** for installed macOS clients to accept updates. Add `MAC_CERTS` (a base64-encoded Developer ID `.p12`) and `MAC_CERTS_PASSWORD` repository secrets to sign automatically in CI (the workflow documents the exact `CSC_LINK` / `CSC_KEY_PASSWORD` wiring). Windows and Linux releases work unsigned.
- Releases must be **published** (not drafts) — the release workflow publishes the draft automatically after all platform builds finish.
- Development builds (`npm run electron`) never check for updates; only `npm run electron:build` output does.

## Testing

End-to-end tests (WebdriverIO) drive the real Electron app — the same binary `npm run electron` launches — through `electron-chromedriver`, which is version-locked to Electron's bundled Chromium (no system Chrome involved). They cover database reads/writes, OPFS persistence across reloads, the WASM demos, and the File System Access dialog flows (the native pickers are stubbed via `browser.addInitScript`, since automation cannot click OS dialogs):

```bash
npm test
```

On a desktop the app window simply opens while tests run. On headless Linux CI, install xvfb (`apt install xvfb` / `dnf install xorg-x11-server-Xvfb`) — WebdriverIO's built-in `autoXvfb` wraps the tests with `xvfb-run` automatically when no display is present.

Unit tests (Vitest) cover the libraries in `src/lib/` and the sqlite worker's message protocol against a real in-memory SQLite:

```bash
npm run test:unit
```

The e2e suite starts and stops the webpack dev server automatically (`onPrepare`/`onComplete` hooks in `wdio.conf.js`), and the Electron main process loads that dev server exactly like `npm run electron` does.

## Local Storage Architecture

- `src/sqlite-worker.js` runs SQLite (compiled to WebAssembly) in a module web worker. It persists the database in OPFS (Origin Private File System) via sqlite-wasm's "opfs-sahpool" VFS, which works in any modern browser without special HTTP headers; if OPFS is unavailable it falls back to a transient in-memory database.
- `src/lib/database.js` is the main-thread API: `initSchema()`, `addNote()`, `listNotes()`, `deleteNote()`, `createNotesIndex()`, `listIndexes()`, `exportDatabase()`, `importDatabase()`, `getStatus()`. All SQL goes through here — always use bound parameters (`?`) for user input.
- `src/lib/file-storage.js` wraps the File System Access API: `saveBytesToDisk()` and `pickFileFromDisk()` implement database export/import to real files on disk.
- `src/db-component.js` and `src/file-storage-component.js` are the demo UIs built on these libraries.

## Customizing the Build

Create a `.env` file in the project root (see `.env.example`). The starter sets a random available port when the project is created; keep `PORT` and `ELECTRON_DEV_URL` in sync:

```
OUTPUT_FILE_NAME=my-custom-filename.js       # default: main.min.js
PORT=8080                                     # default: 3000
ELECTRON_DEV_URL=http://localhost:8080        # must match PORT
SEPARATE_CSS=true                             # default: false
```

## Project Structure

- `src/` - JavaScript source files and custom elements
- `src/lib/` - Framework-free libraries (database client, file storage)
- `src/sqlite-worker.js` - The sqlite-wasm web worker
- `src/wasm/` - WebAssembly source files (C++ and Rust), if selected at scaffolding time
- `electron/` - Electron main process
- `styles/` - CSS files
- `tests/` - Test files (`tests/e2e/` WebdriverIO, `tests/unit/` Vitest)
- `scripts/` - Build scripts (including classic Web Worker transformation)
- `assets/` - Static files (images, fonts, etc.)
- `index.html` - Main HTML file
- `index.js` - Main JavaScript entry point
- `index.css` - Main CSS file
- `webpack.config.js` - Webpack configuration
- `wdio.conf.js` - WebdriverIO e2e configuration
- `vitest.config.js` - Vitest unit test configuration

## WebAssembly

If you selected C++ and/or Rust support when scaffolding, the template includes pre-built WebAssembly examples:

- **C++ (Emscripten)**: `src/wasm/cpp/fibonacci.cpp` compiled to `fibonacci.js` + `fibonacci.wasm`
- **Rust (wasm-pack)**: `src/wasm/rust/fibonacci/src/lib.rs` compiled to `pkg/fibonacci.js` + `fibonacci_bg.wasm`

To rebuild them (requires Emscripten SDK / wasm-pack):

```bash
npm run build:wasm:cpp
npm run build:wasm:rust
```

See `src/wasm-cpp-component.js` and `src/wasm-rust-component.js` for how to load wasm modules in dataroom-js components.

## Technologies

- **Electron** - Desktop app runtime and packaging (electron-builder)
- **update-electron-app** - Auto-updates via update.electronjs.org on every release
- **sqlite-wasm** - SQLite compiled to WebAssembly, with OPFS persistence
- **File System Access API** - Chrome's API for reading/writing local files
- **Webpack** - Bundler for development and production
- **dataroom-js** - Custom HTML elements framework
- **WebAssembly** - High-performance compute (C++ and Rust)
- **PostCSS / SWC** - CSS processing and fast JS transpilation

## Publishing to npm

This project is configured for publishing to npm (`npm pack --dry-run` to preview, `npm publish` to publish). Development files are excluded via `.npmignore`.
