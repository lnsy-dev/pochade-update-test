/**
 * WebdriverIO Configuration
 *
 * End-to-end test configuration for the Pochade-Electron template.
 *
 * For LLMs: these tests drive the REAL Electron app — the same binary
 * `npm run electron` launches — via the official Electron service
 * (@wdio/electron-service):
 *
 *   - The service detects the Electron binary in node_modules and the
 *     app entry point (package.json "main"), launches the app with the
 *     correct arguments, and manages a matching Chromedriver. Do NOT
 *     hand-roll a `goog:chromeOptions` launch here: modern Chromedriver
 *     mangles positional app paths into switches, and Electron then
 *     boots its default app instead of this project (the tests would
 *     silently run against the wrong app).
 *   - The app detects the webpack dev server started below and loads
 *     it, mirroring `npm run electron` development mode.
 *
 * They exercise the full stack: webpack bundling, the dev server,
 * Electron's main process and window, custom elements, WebAssembly,
 * and the node:sqlite database in the main process.
 *
 * Displays: on a desktop the Electron window simply opens while tests
 * run. On headless Linux CI, WebdriverIO's built-in `autoXvfb` wraps
 * the workers with `xvfb-run` automatically when no DISPLAY is set —
 * just make sure `xvfb-run` is installed (or set `xvfbAutoInstall`).
 * Alternatively, expose a display from a podman container:
 *
 *   podman run -d --name xvfb -p 127.0.0.1:6099:6099 <xvfb-image>
 *   DISPLAY=127.0.0.1:99 npm test
 *
 * The File System Access pickers are NATIVE dialogs — no automation
 * tool can click them. The e2e suite therefore stubs
 * window.showSaveFilePicker / window.showOpenFilePicker via
 * browser.addInitScript() and asserts how our code drives the dialog
 * API (see tests/e2e/file-storage-component.spec.js).
 *
 * A WebdriverIO session is REUSED across tests in a spec file (and
 * the database file persists between navigations — it lives in the
 * session data directory of the launched profile). Specs that touch
 * the database must clean up leftover entries in beforeEach — see
 * clearExistingEntries() in tests/helpers/e2e-utils.js. Each spec
 * file gets its own Electron instance with a fresh profile, so state
 * never leaks between spec files.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the project-specific dev server port so WebdriverIO uses the same
// URL as `npm start` and `npm run electron`.
dotenv.config();

const port = process.env.PORT || 3000;
const baseURL = `http://localhost:${port}`;

/**
 * The app directory itself (its package.json "main" points at
 * electron/main.js). Given to the Electron service as the app to
 * launch — equivalent to `electron .`.
 */
const appRoot = path.resolve(__dirname);

/** @type {import('node:child_process').ChildProcess|null} */
let devServer = null;

/**
 * Whether we spawned the dev server ourselves (and thus must stop it).
 * If something is already listening on the port we reuse it, so the
 * suite can also run against a dev server you started manually.
 */
let ownsDevServer = false;

/**
 * Poll the dev server until it answers (or time out).
 */
async function waitForServer(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Dev server at ${url} did not start within ${timeoutMs}ms`);
}

export const config = {
  //
  // ====================
  // Runner Configuration
  // ====================
  //
  runner: 'local',

  /**
   * Directory containing test files. Vitest owns tests/unit/, so only
   * tests/e2e/ is matched here.
   */
  specs: ['./tests/e2e/**/*.spec.js'],

  /**
   * One Electron instance at a time keeps the shared webpack dev
   * server and console noise predictable.
   */
  maxInstances: 1,

  /**
   * Capabilities: launch the real Electron app through its own
   * version-locked ChromeDriver.
   *
   * - `wdio:chromedriverOptions.binary` tells WebdriverIO to use the
   *   electron-chromedriver binary instead of downloading one.
   * - `goog:chromeOptions.binary` points ChromeDriver at the Electron
   *   binary; ChromeDriver then starts the app and drives it over the
   *   WebDriver protocol. A fresh temporary user-data-dir is injected
   *   automatically, so every run starts with a clean profile.
   * - The trailing positional argument is the app directory
   *   (equivalent to `electron .`).
   * - `--no-sandbox`/`--disable-gpu`/`--disable-dev-shm-usage` keep
   *   the app happy in CI containers and under virtual displays.
   */
  /**
   * Launch the app through @wdio/electron-service, which knows how to
   * pass the app path to Electron correctly and picks a matching
   * Chromedriver automatically.
   *
   * `--no-sandbox`/`--disable-gpu`/`--disable-dev-shm-usage` keep the
   * app happy in CI containers and under virtual displays.
   */
  services: ['electron'],

  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        // Unpackaged app: point the service at the main-process entry
        // point (the package.json also carries an electron-builder
        // config, which would otherwise send the service looking for a
        // compiled binary in release/).
        appEntryPoint: path.join(appRoot, 'electron', 'main.js'),
        appArgs: [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      },
    },
  ],

  //
  // ==================
  // Services & Options
  // ==================
  //

  logLevel: 'warn',

  baseUrl: baseURL,

  /**
   * Default timeout for waitFor* commands and implicit waits.
   */
  waitforTimeout: 10000,

  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  //
  // ==================
  // Framework Settings
  // ==================
  //

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  reporters: ['spec'],

  /**
   * Start the webpack dev server before the Electron sessions launch
   * and shut it down when everything is done. The app's main process
   * detects this server and loads it, exactly like `npm run electron`
   * does in development.
   */
  async onPrepare() {
    // Reuse an already-running dev server instead of failing with
    // EADDRINUSE (set CI=1 to always require a fresh server).
    try {
      await fetch(baseURL, { signal: AbortSignal.timeout(2000) });
      console.log(`Reusing dev server already running at ${baseURL}`);
      return;
    } catch {
      // nothing listening — spawn one below
    }

    ownsDevServer = true;
    devServer = spawn('npm', ['start'], {
      detached: true,
      stdio: 'inherit',
    });
    await waitForServer(baseURL);
  },

  onComplete() {
    if (ownsDevServer && devServer && devServer.pid) {
      try {
        process.kill(-devServer.pid);
      } catch {
        // already gone
      }
    }
  },
};
