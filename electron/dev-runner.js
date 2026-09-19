/**
 * Development Runner
 *
 * Orchestrates `npm run electron` so that a single command starts the
 * webpack dev server, waits for it to become ready, and then launches
 * Electron against it. Both processes share the terminal, and the runner
 * shuts the other one down when either exits or when the user hits Ctrl+C.
 *
 * The renderer loads the dev server URL, so changes to `src/`, `styles/`,
 * `index.js`, etc. are rebuilt by webpack and reloaded automatically in the
 * Electron window. Main-process files under `electron/` are not hot-reloaded;
 * restart `npm run electron` after editing them.
 *
 * @module electron/dev-runner
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import spawn from 'cross-spawn';

// Load project-specific environment variables (PORT, ELECTRON_DEV_URL, etc.)
// so the runner probes the same URL the webpack dev server will bind to.
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Header emitted by the webpack dev server to identify itself. */
export const DEV_SERVER_HEADER = 'X-Pochade-Dev-Server';

/** Expected value of the dev server identity header. */
export const DEV_SERVER_HEADER_VALUE = 'pochade';

/** How long (ms) to keep polling the dev server before giving up. */
export const DEV_SERVER_WAIT_TIMEOUT = 30_000;

/** How long (ms) to wait between probe attempts. */
export const DEV_SERVER_WAIT_INTERVAL = 500;

const DEV_SERVER_URL = process.env.ELECTRON_DEV_URL || 'http://localhost:3000';

/**
 * Pause for the given number of milliseconds.
 *
 * @param {number} ms - Sleep duration
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Poll the webpack dev server until it responds with the expected identity
 * header, confirming it is this project's dev server and not an unrelated
 * service on the same port.
 *
 * @param {string} url - Dev server URL to probe
 * @param {number} [timeoutMs=DEV_SERVER_WAIT_TIMEOUT] - Maximum time to wait
 * @param {number} [intervalMs=DEV_SERVER_WAIT_INTERVAL] - Poll interval
 * @returns {Promise<void>}
 * @throws {Error} When the dev server does not become ready in time
 */
export async function waitForDevServer(
  url,
  timeoutMs = DEV_SERVER_WAIT_TIMEOUT,
  intervalMs = DEV_SERVER_WAIT_INTERVAL
) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (
        response.ok &&
        response.headers.get(DEV_SERVER_HEADER) === DEV_SERVER_HEADER_VALUE
      ) {
        return;
      }
    } catch {
      // Server not up yet — keep polling.
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Dev server did not become ready at ${url} within ${timeoutMs}ms`
  );
}

/**
 * Start the dev server, wait for it to be ready, then launch Electron.
 *
 * Any extra command-line arguments are forwarded to Electron (for example,
 * `npm run electron -- --memory-profiler`).
 *
 * @param {string[]} [electronArgs=[]] - Arguments to pass through to Electron
 * @returns {Promise<void>}
 */
export async function runDev(electronArgs = []) {
  console.log(`[electron] Starting webpack dev server (${DEV_SERVER_URL})...`);

  const webpack = spawn('webpack', ['serve'], {
    stdio: 'inherit',
  });

  let electron;

  /**
   * Terminate both child processes and exit the runner.
   *
   * @param {number} [code=0] - Exit code
   */
  function shutdown(code = 0) {
    if (electron && !electron.killed) {
      electron.kill();
    }
    if (webpack && !webpack.killed) {
      webpack.kill();
    }
    process.exit(code);
  }

  webpack.on('error', (error) => {
    console.error('[electron] Failed to start webpack dev server:', error);
    shutdown(1);
  });

  webpack.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      shutdown(code);
    }
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  try {
    await waitForDevServer(DEV_SERVER_URL);
    console.log('[electron] Dev server ready — launching Electron...');

    electron = spawn('electron', ['.', ...electronArgs], {
      stdio: 'inherit',
    });

    electron.on('error', (error) => {
      console.error('[electron] Failed to start Electron:', error);
      shutdown(1);
    });

    electron.on('exit', (code) => {
      shutdown(code ?? 0);
    });
  } catch (error) {
    console.error(`[electron] ${error.message}`);
    shutdown(1);
  }
}

// Run the dev workflow when this module is executed directly.
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await runDev(process.argv.slice(2));
}
