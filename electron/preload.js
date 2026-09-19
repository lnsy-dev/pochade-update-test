/**
 * Memory Profiler & Database Preload Script
 *
 * Exposes two minimal IPC bridges to the renderer:
 *
 *   window.electronProfiler — memory-profiler metrics (read-only)
 *   window.electronDb       — the SQLite database service
 *
 * contextIsolation is enabled, so the renderer sees only the objects
 * explicitly exposed here. The database bridge deliberately accepts a
 * single (action, params) pair — the renderer has no access to Node,
 * Electron, or the file system; all SQL runs in the main process
 * (see electron/database.js).
 *
 * IMPORTANT: this file MUST stay CommonJS. Electron renderers are
 * sandboxed by default, and sandboxed preload scripts do not support
 * ES modules — an `import` statement here fails with
 * "Cannot use import statement outside a module" and the bridge
 * silently disappears from the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** IPC channel of the database service (must match electron/main.js). */
const DB_CHANNEL = 'pochade-db';

contextBridge.exposeInMainWorld('electronDb', {
  /**
   * Send a database action to the main process and await its result.
   *
   * @param {string} action - Action name (status|exec|query|export|import)
   * @param {object} [params={}] - Action parameters
   * @returns {Promise<any>} The action result (rejects on error)
   */
  call: (action, params = {}) => ipcRenderer.invoke(DB_CHANNEL, { action, params }),
});

contextBridge.exposeInMainWorld('electronProfiler', {
  /**
   * Register a callback invoked when the main process enables the profiler.
   *
   * @param {() => void} callback
   */
  onEnabled: (callback) => ipcRenderer.on('profiler-enabled', () => callback()),

  /**
   * Register a callback invoked on each metrics tick from the main process.
   *
   * @param {(metrics: object) => void} callback
   */
  onMetrics: (callback) => ipcRenderer.on('profiler-metrics', (_event, metrics) => callback(metrics)),
});

