/**
 * BrowserWindow Options
 *
 * Shared window configuration for the Electron main process.
 *
 * A hidden title bar makes the menu/title bar area transparent on macOS
 * so the app content extends up to the window chrome. The renderer adds
 * top padding to keep text clear of the traffic-light buttons.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('electron').BrowserWindowConstructorOptions} */
export const WINDOW_OPTIONS = {
  width: 1024,
  height: 768,
  titleBarStyle: 'hidden',
  webPreferences: {
    // Secure defaults: the renderer is plain web code, no Node access.
    contextIsolation: true,
    nodeIntegration: false,
    // Small preload bridge for the optional memory profiler overlay.
    preload: path.resolve(__dirname, 'preload.js'),
  },
};
