/**
 * SQLite Database Service (Main Process)
 *
 * The application database, backed by Node's built-in `node:sqlite`
 * module (DatabaseSync) — no WebAssembly, no OPFS, just a real SQLite
 * file on disk. This module owns the DatabaseSync instance; it never
 * touches Electron or IPC APIs, so it can be unit-tested in plain Node.
 *
 * The renderer talks to this service over IPC (see electron/main.js
 * and electron/preload.js) using the same action protocol the old
 * sqlite-wasm worker used:
 *
 *   status  -> { persistent, filename, sqliteVersion }
 *   exec    -> runs SQL without returning rows (DDL/INSERT/UPDATE/DELETE)
 *   query   -> runs SQL and returns rows as an array of plain objects
 *   export  -> serializes the database to a Uint8Array (SQLite file image)
 *   import  -> replaces the database contents with a SQLite file image
 *
 * Where the file lives: `sessionData` is used instead of `userData` so
 * the database follows the browser profile — it persists across
 * reloads, yet every test run (fresh `--user-data-dir`) starts from a
 * clean slate. In normal use `sessionData` defaults to `userData`, so
 * the notes live with the rest of the app's data.
 *
 * For LLMs: keep this file free of Electron imports. Handlers must
 * return structured-clone-safe values (plain objects, Uint8Array).
 * Always use bound parameters (?) for user input — never interpolate
 * strings into SQL.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/** Magic header every SQLite 3 database file starts with. */
const SQLITE_MAGIC = 'SQLite format 3\0';

/**
 * A database service bound to one SQLite file.
 *
 * @typedef {object} DatabaseService
 * @property {(action: string, params?: object) => any} handle Dispatch an action
 * @property {() => void} close Close the underlying connection
 */

/**
 * Create a database service backed by the file at `filePath`.
 * The database file and its schema are created on demand.
 *
 * @param {{filePath: string}} options - Absolute path of the SQLite file
 * @returns {DatabaseService} The service instance
 */
export function createDatabaseService({ filePath }) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new DatabaseSync(filePath);

  /**
   * Report storage status and version info.
   *
   * @returns {{persistent: boolean, filename: string, sqliteVersion: string}}
   */
  function status() {
    const { v } = db.prepare('SELECT sqlite_version() AS v').get();
    return {
      persistent: true,
      filename: filePath,
      sqliteVersion: v,
    };
  }

  /**
   * Execute SQL without returning rows (DDL, INSERT, UPDATE, DELETE).
   * Statements with bound parameters go through prepare().run(); plain
   * SQL (which may contain multiple statements) goes through exec().
   *
   * @param {{sql: string, params?: Array}} params - SQL text and optional bind parameters
   * @returns {null}
   */
  function exec({ sql, params = [] }) {
    if (params.length > 0) {
      db.prepare(sql).run(...params);
    } else {
      db.exec(sql);
    }
    return null;
  }

  /**
   * Execute SQL and return the result rows as an array of plain objects
   * keyed by column name. node:sqlite returns null-prototype objects,
   * which do not survive some structured-clone consumers — spread into
   * ordinary objects.
   *
   * @param {{sql: string, params?: Array}} params - SQL text and optional bind parameters
   * @returns {Array<object>} Result rows
   */
  function query({ sql, params = [] }) {
    return db.prepare(sql).all(...params).map((row) => ({ ...row }));
  }

  /**
   * Serialize the whole database to bytes (SQLite file format), ready
   * to be saved to disk via the File System Access API in the renderer.
   *
   * @returns {Uint8Array} The database file image
   */
  function exportDatabase() {
    return db.serialize();
  }

  /**
   * Replace the current database contents with a database file image
   * previously produced by exportDatabase() (or any SQLite file).
   *
   * @param {{bytes: Uint8Array}} params - The database image to load
   * @returns {null}
   */
  function importDatabase({ bytes }) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('import expects a Uint8Array');
    }
    const header = Buffer.from(bytes.subarray(0, SQLITE_MAGIC.length)).toString('latin1');
    if (header !== SQLITE_MAGIC) {
      throw new Error('import expects a SQLite database file (bad header)');
    }
    db.deserialize(bytes);
    return null;
  }

  /** Action dispatch table — mirrors the old sqlite worker protocol. */
  const actions = { status, exec, query, export: exportDatabase, import: importDatabase };

  return {
    /**
     * Dispatch an action to the service.
     *
     * @param {string} action - Action name (see the table above)
     * @param {object} [params={}] - Action parameters
     * @returns {any} The action result
     */
    handle(action, params = {}) {
      if (typeof actions[action] !== 'function') {
        throw new Error(`Unknown database action: ${action}`);
      }
      return actions[action](params);
    },

    /** Close the underlying database connection. */
    close() {
      db.close();
    },
  };
}
