/**
 * Database Client Library
 *
 * Promise-based main-thread client for the application database.
 * All database access in the app should go through this module —
 * components never talk to Electron IPC directly.
 *
 * The database itself is SQLite via Node's built-in `node:sqlite`
 * module, running in the Electron MAIN process (electron/database.js).
 * This file is a thin transport: every helper forwards an
 * `{ action, params }` message through the `window.electronDb` bridge
 * that electron/preload.js exposes, so the renderer (which has
 * contextIsolation enabled and no nodeIntegration) never touches
 * Node or the file system.
 *
 * Plain web browsers have no `node:sqlite` and no preload bridge —
 * there the helpers reject with a descriptive error instead of
 * silently failing.
 *
 * For LLMs: when adding a new table or query, add a helper here that
 * composes `callDatabase('exec', ...)` / `callDatabase('query', ...)`.
 * Always use bound parameters (?) for user input — never string
 * interpolation into SQL.
 */

/**
 * Forward a database action to the main process and await its result.
 *
 * @param {string} action - Action name (see electron/database.js)
 * @param {object} [params={}] - Action parameters
 * @returns {Promise<any>} The action result
 * @throws {Error} Outside the Electron app (no preload bridge) or on SQL errors
 */
function callDatabase(action, params = {}) {
  if (typeof window === 'undefined' || !window.electronDb) {
    return Promise.reject(
      new Error(
        'The SQLite database runs via node:sqlite in the Electron main process. ' +
        'Run the app with `npm run electron` — plain web browsers have no node:sqlite.'
      )
    );
  }
  return window.electronDb.call(action, params);
}

/**
 * Report whether the database is persistent (always true under
 * Electron — a file on disk) along with its path and SQLite version.
 *
 * @returns {Promise<{persistent: boolean, filename: string, sqliteVersion: string}>}
 */
export function getStatus() {
  return callDatabase('status');
}

/**
 * Create the notes table if it does not exist yet.
 * Safe to call on every app start.
 *
 * @returns {Promise<void>}
 */
export async function initSchema() {
  await callDatabase('exec', {
    sql: `CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  });
}

/**
 * Insert a note and return its new row id.
 *
 * @param {string} content - The note text
 * @returns {Promise<number>} The id of the inserted row
 */
export async function addNote(content) {
  await callDatabase('exec', {
    sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
    params: [content, new Date().toISOString()],
  });
  const rows = await callDatabase('query', { sql: 'SELECT last_insert_rowid() AS id' });
  return rows[0].id;
}

/**
 * List all notes, newest first.
 *
 * @returns {Promise<Array<{id: number, content: string, created_at: string}>>}
 */
export function listNotes() {
  return callDatabase('query', {
    sql: 'SELECT id, content, created_at FROM notes ORDER BY id DESC',
  });
}

/**
 * Delete a note by id.
 *
 * @param {number} id - The note id
 * @returns {Promise<void>}
 */
export async function deleteNote(id) {
  await callDatabase('exec', {
    sql: 'DELETE FROM notes WHERE id = ?',
    params: [id],
  });
}

/**
 * Generate an index on the notes table (created_at column).
 * Idempotent: uses CREATE INDEX IF NOT EXISTS.
 *
 * @returns {Promise<void>}
 */
export async function createNotesIndex() {
  await callDatabase('exec', {
    sql: 'CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)',
  });
}

/**
 * List the user-created indexes currently in the database.
 *
 * @returns {Promise<Array<{name: string, tbl_name: string}>>}
 */
export function listIndexes() {
  return callDatabase('query', {
    sql: `SELECT name, tbl_name FROM sqlite_master
      WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  });
}

/**
 * Serialize the whole database to bytes (SQLite file format).
 * Pair with the File System Access API to save it to disk.
 *
 * @returns {Promise<Uint8Array>} The database file image
 */
export function exportDatabase() {
  return callDatabase('export');
}

/**
 * Replace the current database contents with a database file image
 * previously produced by exportDatabase() (or any SQLite file).
 *
 * @param {Uint8Array} bytes - The database file image
 * @returns {Promise<void>}
 */
export async function importDatabase(bytes) {
  await callDatabase('import', { bytes });
}
