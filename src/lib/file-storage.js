/**
 * File Storage Library (File System Access API)
 *
 * Thin wrappers around Google Chrome's File System Access API
 * (showSaveFilePicker / showOpenFilePicker). These work in Chrome,
 * Edge, and Electron's Chromium renderer. In other browsers the API
 * is absent — call isFileSystemAccessSupported() first and degrade
 * gracefully.
 *
 * Used together with src/lib/database.js to export the SQLite database
 * to a real file on disk and to import one back.
 *
 * For LLMs: these functions must be called from a user gesture
 * (e.g. a click handler) or the pickers will be rejected.
 */

/**
 * Check whether the File System Access API is available.
 *
 * Uses typeof-based detection: overriding the globals with `undefined`
 * (as test mocks do) is correctly reported as unsupported.
 *
 * @returns {boolean} True if save/open pickers exist
 */
export function isFileSystemAccessSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.showSaveFilePicker === 'function' &&
    typeof window.showOpenFilePicker === 'function'
  );
}

/**
 * Check whether an error is the user cancelling a picker dialog.
 * Cancellation is normal flow, not a failure.
 *
 * @param {Error} error - The caught error
 * @returns {boolean} True if the user aborted the picker
 */
export function isUserCancellation(error) {
  return !!error && error.name === 'AbortError';
}

/**
 * Save bytes to a file on disk via the native save dialog.
 *
 * @param {string} suggestedName - Default file name in the dialog
 * @param {Uint8Array} bytes - File contents
 * @returns {Promise<string>} The name of the saved file
 */
export async function saveBytesToDisk(suggestedName, bytes) {
  const handle = await window.showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: 'SQLite database',
        accept: { 'application/x-sqlite3': ['.sqlite3', '.db'] },
      },
    ],
  });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
  return handle.name;
}

/**
 * Open a file from disk via the native open dialog.
 *
 * @returns {Promise<{name: string, bytes: Uint8Array}>} File name and contents
 */
export async function pickFileFromDisk() {
  const [handle] = await window.showOpenFilePicker({
    types: [
      {
        description: 'SQLite database',
        accept: { 'application/x-sqlite3': ['.sqlite3', '.db'] },
      },
    ],
    multiple: false,
  });
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, bytes };
}
