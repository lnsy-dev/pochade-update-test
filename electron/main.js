/**
 * Electron Main Process
 *
 * Launches the app as an Electron desktop application.
 *
 * Two load modes:
 *   1. Development: if the webpack dev server answers at ELECTRON_DEV_URL
 *      (read from .env or defaulting to http://localhost:3000, started
 *      with `npm start`), and identifies itself with the custom
 *      X-Pochade-Dev-Server header, the window loads that URL for
 *      hot-reload development.
 *   2. Production: the bundled dist/ directory is served over a custom
 *      privileged `app://` protocol registered below.
 *
 * Why a custom protocol instead of loadFile()? The app relies on web
 * platform features that need a real origin: module web workers and
 * fetching .wasm binaries for the C++/Rust WebAssembly demos. Serving
 * dist/ over a standard, secure scheme makes all of them behave exactly
 * like they do on the web — no special Electron-only code paths.
 *
 * The SQLite database (node:sqlite DatabaseSync) lives in this process,
 * behind an ipcMain.handle channel the preload script exposes to the
 * renderer. The renderer keeps contextIsolation enabled and no
 * nodeIntegration — it only ever sees the small bridge.
 *
 * For LLMs: this file runs in Node.js (Electron main), NOT in a browser.
 * Renderer code lives in src/ and index.js. Keep Node/Electron APIs here
 * and web APIs there.
 */

import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { updateElectronApp } from 'update-electron-app';
import electronSquirrelStartup from 'electron-squirrel-startup';
import { WINDOW_OPTIONS } from './window-options.js';
import { isProfilerEnabled, collectMetrics } from './profiler.js';
import { resolveStartUrl } from './dev-server.js';
import { createDatabaseService } from './database.js';

/** IPC channel the renderer uses to reach the database service. */
const DB_CHANNEL = 'pochade-db';

// Squirrel.Windows (the Windows installer format required for auto-updates)
// launches the app executable with special flags while it installs, updates,
// or uninstalls. Without this guard the window would pop open mid-update and
// Windows Start Menu shortcuts would never be created. It is a no-op on
// macOS and Linux.
if (electronSquirrelStartup) {
  app.quit();
}

// Load project-specific environment variables (PORT, ELECTRON_DEV_URL, etc.)
// so the dev server URL matches the one generated when the project was created.
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DEV_SERVER_URL = process.env.ELECTRON_DEV_URL || 'http://localhost:3000';

/** Minimal MIME table for the static files webpack emits into dist/. */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Register `app://` as a privileged scheme.
 * Must run before the app is ready. `standard` + `secure` make the
 * scheme behave like https: for URL parsing and web platform features
 * (workers, OPFS, File System Access API).
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

/**
 * Serve files from dist/ over the app:// protocol.
 *
 * @param {Request} request - The incoming protocol request
 * @returns {Promise<Response>} The file contents or an error response
 */
async function handleAppRequest(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (!pathname || pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = path.normalize(path.join(DIST_DIR, pathname));

  // Guard against path traversal outside dist/
  if (!filePath.startsWith(DIST_DIR)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const data = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, {
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

/**
 * Start streaming memory/CPU metrics to the renderer.
 *
 * Sends an initial enable signal after the page loads, then posts a
 * metrics payload every second until the window is destroyed.
 *
 * @param {BrowserWindow} win - The target renderer window
 */
function attachMemoryProfiler(win) {
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('profiler-enabled');

    const interval = setInterval(() => {
      if (win.isDestroyed()) {
        clearInterval(interval);
        return;
      }
      win.webContents.send('profiler-metrics', collectMetrics());
    }, 1000);
  });
}

/**
 * Open the database service and expose it to the renderer over IPC.
 *
 * The database file lives in `sessionData`, so it persists across
 * reloads and app restarts, while automated test runs (which pass a
 * fresh `--user-data-dir`) start from a clean slate.
 */
function startDatabaseService() {
  const filePath = path.join(app.getPath('sessionData'), 'app.sqlite3');
  const service = createDatabaseService({ filePath });

  ipcMain.handle(DB_CHANNEL, (_event, { action, params }) => {
    return service.handle(action, params);
  });

  // Flush SQLite's state before the process exits
  app.on('will-quit', () => {
    service.close();
  });
}

/**
 * Create the main application window.
 *
 * @returns {Promise<void>}
 */
async function createWindow() {
  const win = new BrowserWindow(WINDOW_OPTIONS);

  if (isProfilerEnabled()) {
    attachMemoryProfiler(win);
  }

  const startUrl = await resolveStartUrl(DEV_SERVER_URL);
  win.loadURL(startUrl);
}

/**
 * Check update.electronjs.org for a newer packaged release and keep checking
 * every ten minutes. When an update is found it downloads in the background
 * and the user is offered a "Restart / Later" dialog.
 *
 * Only meaningful in packaged builds: update.electronjs.org serves releases
 * from the public GitHub repository configured in package.json (`repository`
 * must point at https://github.com/<owner>/<repo>). Guarded with
 * app.isPackaged so development never touches the network feed. See
 * README.md → "Releases & Auto-Updates".
 */
function startAutoUpdater() {
  if (!app.isPackaged) {
    return;
  }
  try {
    updateElectronApp();
  } catch (error) {
    console.error('Auto-updater could not start:', error);
  }
}

app.whenReady().then(() => {
  protocol.handle('app', handleAppRequest);
  startDatabaseService();
  createWindow();
  startAutoUpdater();

  // macOS: re-create the window when the dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
