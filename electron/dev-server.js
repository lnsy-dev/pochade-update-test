/**
 * Dev Server Detection
 *
 * Decides whether Electron should load the webpack dev server or fall
 * back to the production build served over the custom app:// protocol.
 *
 * The probe looks for a custom response header emitted by the project's
 * webpack configuration. This prevents Electron from loading an unrelated
 * service that happens to be listening on the same port.
 */

import { net } from 'electron';

/** Header emitted by the webpack dev server to identify itself. */
export const DEV_SERVER_HEADER = 'X-Pochade-Dev-Server';

/** Expected value of the dev server identity header. */
export const DEV_SERVER_HEADER_VALUE = 'pochade';

/** Timeout (ms) to wait for the dev server probe to respond. */
export const DEV_SERVER_PROBE_TIMEOUT = 1500;

/**
 * Probe a URL to see if it is this project's webpack dev server.
 *
 * A response is only accepted when it is OK and carries the custom
 * X-Pochade-Dev-Server header. Any other listener on the same port is
 * ignored so Electron never accidentally loads a foreign application.
 *
 * @param {string} url - Dev server URL to probe
 * @returns {Promise<boolean>} True when the dev server is detected
 */
export async function isDevServerRunning(url) {
  try {
    const response = await Promise.race([
      net.fetch(url, { method: 'HEAD' }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), DEV_SERVER_PROBE_TIMEOUT);
      }),
    ]);
    return (
      response.ok &&
      response.headers.get(DEV_SERVER_HEADER) === DEV_SERVER_HEADER_VALUE
    );
  } catch {
    return false;
  }
}

/**
 * Decide what the window should load.
 *
 * Pings the webpack dev server; if it answers with the expected identity
 * header, load it (development with hot reload). Otherwise load the
 * production build over app://.
 *
 * @param {string} devServerUrl - Dev server URL to probe
 * @returns {Promise<string>} The URL to load in the main window
 */
export async function resolveStartUrl(devServerUrl) {
  if (await isDevServerRunning(devServerUrl)) {
    console.log(`[electron] Dev server detected at ${devServerUrl} — loading with hot reload`);
    return devServerUrl;
  }
  console.log('[electron] Loading production build from dist/ via app://');
  return 'app://./index.html';
}
