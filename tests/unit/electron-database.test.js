/**
 * Electron Database Service Unit Tests
 *
 * Unit tests for electron/database.js — the main-process SQLite
 * service backed by Node's built-in `node:sqlite` module, exercised
 * against a REAL SQLite database file on disk.
 *
 * Covered here:
 *   - the action protocol (status/exec/query/export/import)
 *   - bound parameters (never string interpolation)
 *   - error propagation (malformed SQL, bad import payloads,
 *     unknown actions)
 *   - export producing a valid SQLite file image and round-tripping
 *     through import
 *
 * The OPFS/web-worker history of these tests is gone: node:sqlite
 * runs natively in Node, so no wasm aliasing, worker globals, or
 * special loading is required.
 *
 * For LLMs: when adding an action to the service, test it here by
 * calling handle() and asserting on real SQL results — not on mocks.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabaseService } from '../../electron/database.js';

/** Directory for the throwaway database files created by these tests. */
const tmpDirs = [];

/**
 * Create a service (and its temp directory) for one test.
 *
 * @returns {ReturnType<typeof createDatabaseService>} A fresh service
 */
function makeService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pochade-db-'));
  tmpDirs.push(dir);
  return createDatabaseService({ filePath: path.join(dir, 'app.sqlite3') });
}

afterAll(() => {
  tmpDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('electron/database service', () => {
  it('reports status with a sqlite version and the database file path', () => {
    const service = makeService();
    service.handle('exec', {
      sql: 'CREATE TABLE t (id INTEGER)',
    });

    const status = service.handle('status');
    expect(status.persistent).toBe(true);
    expect(status.filename).toMatch(/app\.sqlite3$/);
    expect(status.sqliteVersion).toMatch(/^3\./);
  });

  it('creates the database file on disk', () => {
    const service = makeService();
    service.handle('exec', { sql: 'CREATE TABLE t (id INTEGER)' });

    expect(fs.existsSync(service.handle('status').filename)).toBe(true);
    service.close();
  });

  it('executes DDL and bound-parameter writes, then queries rows as plain objects', () => {
    const service = makeService();

    service.handle('exec', {
      sql: `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    });

    service.handle('exec', {
      sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
      params: ['first note', '2026-01-01T00:00:00.000Z'],
    });
    service.handle('exec', {
      sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
      params: ['second note', '2026-01-02T00:00:00.000Z'],
    });

    const rows = service.handle('query', {
      sql: 'SELECT id, content, created_at FROM notes ORDER BY id DESC',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].content).toBe('second note');
    expect(rows[1].content).toBe('first note');
    expect(rows[0].id).toBeGreaterThan(rows[1].id);
    // Rows must be plain objects (structured-clone-safe over IPC)
    rows.forEach((row) => {
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    });
    service.close();
  });

  it('binds parameters literally (no SQL interpolation)', () => {
    const service = makeService();
    service.handle('exec', {
      sql: `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    });
    service.handle('exec', {
      sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
      params: ["'); DROP TABLE notes; --", '2026-01-03T00:00:00.000Z'],
    });

    // The table must still exist and contain the hostile string as data
    const rows = service.handle('query', {
      sql: 'SELECT content FROM notes WHERE content = ?',
      params: ["'); DROP TABLE notes; --"],
    });
    expect(rows).toHaveLength(1);
    service.close();
  });

  it('creates an index visible in sqlite_master', () => {
    const service = makeService();
    service.handle('exec', { sql: 'CREATE TABLE notes (id INTEGER, created_at TEXT)' });
    service.handle('exec', {
      sql: 'CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)',
    });

    const indexes = service.handle('query', {
      sql: `SELECT name, tbl_name FROM sqlite_master
        WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    });

    expect(indexes).toEqual([{ name: 'idx_notes_created_at', tbl_name: 'notes' }]);
    service.close();
  });

  it('exports a valid SQLite file image', () => {
    const service = makeService();
    service.handle('exec', { sql: 'CREATE TABLE notes (id INTEGER)' });

    const bytes = service.handle('export');

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);

    // Every SQLite database file starts with this magic header
    const header = new TextDecoder().decode(bytes.slice(0, 16));
    expect(header).toBe('SQLite format 3\0');
    service.close();
  });

  it('round-trips the database through export and import', () => {
    const service = makeService();
    service.handle('exec', {
      sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL)',
    });
    service.handle('exec', {
      sql: "INSERT INTO notes (content) VALUES ('first note')",
    });

    const exported = service.handle('export');

    // Destroy the current state
    service.handle('exec', { sql: 'DROP TABLE notes' });
    expect(() => service.handle('query', { sql: 'SELECT * FROM notes' })).toThrow();

    // Import the exported image — the data must be back
    service.handle('import', { bytes: exported });
    const rows = service.handle('query', { sql: 'SELECT content FROM notes' });
    expect(rows.map((r) => r.content)).toContain('first note');
    service.close();
  });

  it('rejects an import that is not a Uint8Array', () => {
    const service = makeService();
    expect(() => service.handle('import', { bytes: 'not-bytes' })).toThrow(
      'import expects a Uint8Array'
    );
    service.close();
  });

  it('rejects an import that is not a SQLite file image', () => {
    const service = makeService();
    const notSqlite = new Uint8Array([1, 2, 3, 4]);
    expect(() => service.handle('import', { bytes: notSqlite })).toThrow(
      'import expects a SQLite database file (bad header)'
    );
    service.close();
  });

  it('rejects unknown actions with a descriptive error', () => {
    const service = makeService();
    expect(() => service.handle('definitely-not-an-action')).toThrow(
      'Unknown database action: definitely-not-an-action'
    );
    service.close();
  });

  it('rejects malformed SQL with the SQLite error message', () => {
    const service = makeService();
    expect(() => service.handle('exec', { sql: 'THIS IS NOT SQL' })).toThrow();
    service.close();
  });
});
