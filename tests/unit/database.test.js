/**
 * Database Client Unit Tests
 *
 * Unit tests for src/lib/database.js — the main-thread client that
 * forwards database actions to the Electron main process through the
 * `window.electronDb` preload bridge.
 *
 * The bridge global is replaced with a fake that captures outgoing
 * (action, params) pairs and answers them with scripted responses.
 * These tests pin down:
 *   - the exact action names and SQL each helper sends
 *   - bound parameters (never string interpolation)
 *   - error propagation (bridge errors, and the no-bridge case in
 *     plain web browsers)
 *   - that no Worker is constructed anymore (node:sqlite replaced
 *     the old sqlite-wasm worker)
 *
 * For LLMs: when adding a helper to src/lib/database.js, add the
 * matching test here asserting the exact action + SQL + params.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Fake electronDb preload bridge. Records every call it receives and
 * answers with the scripted handler (default: `null`).
 */
const fakeBridge = {
  calls: [],
  handler: null,

  /**
   * Bridge entry point (mirrors window.electronDb.call).
   *
   * @param {string} action - Action name
   * @param {object} params - Action parameters
   * @returns {Promise<any>} The scripted result
   */
  call(action, params) {
    this.calls.push({ action, params });
    const handler = this.handler || (() => null);
    // ipcRenderer.invoke rejects when the main-process handler throws —
    // mirror that contract here.
    return new Promise((resolve, reject) => {
      try {
        resolve(handler(action, params));
      } catch (error) {
        reject(error);
      }
    });
  },
};

/** @returns {Promise<object>} The freshly imported database module */
async function importDatabaseModule() {
  return await import('../../src/lib/database.js');
}

describe('database client', () => {
  beforeEach(() => {
    vi.resetModules();
    fakeBridge.calls = [];
    fakeBridge.handler = null;
    vi.stubGlobal('window', { electronDb: fakeBridge });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the electronDb preload bridge (no Worker anywhere)', async () => {
    const db = await importDatabaseModule();
    await db.getStatus();

    expect(fakeBridge.calls).toHaveLength(1);
    // The old sqlite-wasm worker must not come back
    expect(globalThis.Worker).toBeUndefined();
  });

  it('getStatus sends the status action and resolves its result', async () => {
    const status = {
      persistent: true,
      filename: '/session/app.sqlite3',
      sqliteVersion: '3.53.4',
    };
    fakeBridge.handler = (action) => (action === 'status' ? status : null);

    const db = await importDatabaseModule();
    const result = await db.getStatus();

    expect(fakeBridge.calls[0].action).toBe('status');
    expect(result).toEqual(status);
  });

  it('initSchema creates the notes table', async () => {
    const db = await importDatabaseModule();
    await db.initSchema();

    const call = fakeBridge.calls[0];
    expect(call.action).toBe('exec');
    expect(call.params.sql).toContain('CREATE TABLE IF NOT EXISTS notes');
    expect(call.params.sql).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(call.params.sql).toContain('content TEXT NOT NULL');
    expect(call.params.sql).toContain('created_at TEXT NOT NULL');
  });

  it('addNote inserts with bound parameters and returns the new id', async () => {
    fakeBridge.handler = (action) => {
      if (action === 'query') {
        return [{ id: 7 }];
      }
      return null;
    };

    const db = await importDatabaseModule();
    const id = await db.addNote('hello world');

    const [insert, idQuery] = fakeBridge.calls;
    expect(insert.action).toBe('exec');
    expect(insert.params.sql).toBe('INSERT INTO notes (content, created_at) VALUES (?, ?)');
    // First bound parameter is the content; second is an ISO timestamp
    expect(insert.params.params[0]).toBe('hello world');
    expect(insert.params.params[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    expect(idQuery.action).toBe('query');
    expect(idQuery.params.sql).toBe('SELECT last_insert_rowid() AS id');
    expect(id).toBe(7);
  });

  it('listNotes selects all notes newest first', async () => {
    const rows = [
      { id: 2, content: 'b', created_at: 't2' },
      { id: 1, content: 'a', created_at: 't1' },
    ];
    fakeBridge.handler = (action) => (action === 'query' ? rows : null);

    const db = await importDatabaseModule();
    const result = await db.listNotes();

    const call = fakeBridge.calls[0];
    expect(call.action).toBe('query');
    expect(call.params.sql).toBe('SELECT id, content, created_at FROM notes ORDER BY id DESC');
    expect(result).toEqual(rows);
  });

  it('deleteNote deletes by bound id', async () => {
    const db = await importDatabaseModule();
    await db.deleteNote(42);

    const call = fakeBridge.calls[0];
    expect(call.action).toBe('exec');
    expect(call.params.sql).toBe('DELETE FROM notes WHERE id = ?');
    expect(call.params.params).toEqual([42]);
  });

  it('createNotesIndex generates the created_at index idempotently', async () => {
    const db = await importDatabaseModule();
    await db.createNotesIndex();

    const call = fakeBridge.calls[0];
    expect(call.action).toBe('exec');
    expect(call.params.sql).toBe(
      'CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)'
    );
  });

  it('listIndexes queries sqlite_master for user indexes', async () => {
    const rows = [{ name: 'idx_notes_created_at', tbl_name: 'notes' }];
    fakeBridge.handler = (action) => (action === 'query' ? rows : null);

    const db = await importDatabaseModule();
    const result = await db.listIndexes();

    const call = fakeBridge.calls[0];
    expect(call.action).toBe('query');
    expect(call.params.sql).toContain('FROM sqlite_master');
    expect(call.params.sql).toContain("type = 'index'");
    expect(call.params.sql).toContain("name NOT LIKE 'sqlite_%'");
    expect(result).toEqual(rows);
  });

  it('exportDatabase resolves the serialized bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    fakeBridge.handler = (action) => (action === 'export' ? bytes : null);

    const db = await importDatabaseModule();
    const result = await db.exportDatabase();

    expect(fakeBridge.calls[0].action).toBe('export');
    expect(result).toBe(bytes);
  });

  it('importDatabase sends the bytes to the import action', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const db = await importDatabaseModule();
    await db.importDatabase(bytes);

    const call = fakeBridge.calls[0];
    expect(call.action).toBe('import');
    expect(call.params.bytes).toBe(bytes);
  });

  it('propagates bridge errors (SQL failures in the main process)', async () => {
    fakeBridge.handler = () => {
      throw new Error('SQL syntax error');
    };

    const db = await importDatabaseModule();
    await expect(db.listNotes()).rejects.toThrow('SQL syntax error');
  });

  describe('without the Electron bridge (plain web browser)', () => {
    beforeEach(() => {
      vi.stubGlobal('window', {});
    });

    it('rejects getStatus with a descriptive error', async () => {
      const db = await importDatabaseModule();
      await expect(db.getStatus()).rejects.toThrow(/node:sqlite in the Electron main process/);
    });

    it('rejects every helper, including writes', async () => {
      const db = await importDatabaseModule();
      await expect(db.initSchema()).rejects.toThrow(/npm run electron/);
      await expect(db.addNote('x')).rejects.toThrow(/npm run electron/);
      await expect(db.exportDatabase()).rejects.toThrow(/npm run electron/);
      expect(fakeBridge.calls).toHaveLength(0);
    });

    it('rejects when window itself is absent (SSR-style environment)', async () => {
      vi.stubGlobal('window', undefined);
      const db = await importDatabaseModule();
      await expect(db.listNotes()).rejects.toThrow(/node:sqlite in the Electron main process/);
    });
  });
});
