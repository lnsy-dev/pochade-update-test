/**
 * Database Component
 *
 * Interactive demo of the node:sqlite database layer. Shows how to:
 *   - Initialize the schema on startup
 *   - Write entries (INSERT) and read them back (SELECT)
 *   - Delete entries
 *   - Generate an index (CREATE INDEX) and list existing indexes
 *   - Report where the database file lives
 *
 * All SQL lives in src/lib/database.js — this component only renders
 * state and forwards user intent.
 *
 * Events emitted (dataroom-js this.event):
 *   DB-ENTRY-ADDED    { id, content }
 *   DB-ENTRY-DELETED  { id }
 *   DB-INDEX-CREATED  { indexes }
 *   DB-ERROR          { error }
 */

import DataroomElement from 'dataroom-js';
import {
  getStatus,
  initSchema,
  addNote,
  listNotes,
  deleteNote,
  createNotesIndex,
  listIndexes,
} from './lib/database.js';

/**
 * DbComponent
 *
 * A custom HTML element providing a small note-taking UI backed by
 * node:sqlite (DatabaseSync) running in the Electron main process.
 *
 * @extends DataroomElement
 */
class DbComponent extends DataroomElement {
  /**
   * Initialize the component.
   *
   * Renders the UI, opens the database, ensures the schema exists,
   * and loads the current entries.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    this.create('h2', { content: 'SQLite Database' });

    this.create('p', {
      content: 'Entries are stored in a SQLite database (node:sqlite) in the Electron main process.',
    });

    // Storage status line: OPFS (persistent) vs transient fallback
    this.statusLine = this.create('p', {
      class: 'db-status',
      content: 'Initializing database…',
    });

    // Entry form: input + add button + index button
    const form = this.create('div', { class: 'db-form' });

    this.input = this.create('input', {
      type: 'text',
      placeholder: 'Write a note…',
    }, form);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.addEntry();
      }
    });

    const addButton = this.create('button', { content: 'Add entry' }, form);
    addButton.addEventListener('click', () => this.addEntry());

    const indexButton = this.create('button', { content: 'Create index' }, form);
    indexButton.addEventListener('click', () => this.createIndex());

    // Line listing the indexes present in the database
    this.indexLine = this.create('p', { class: 'db-indexes' });

    // Entry list
    this.list = this.create('ul', { class: 'db-entries' });

    try {
      const status = await getStatus();
      await initSchema();

      this.statusLine.textContent = status.persistent
        ? `Persistent storage (file): ${status.filename} — SQLite ${status.sqliteVersion}`
        : `Transient database — SQLite ${status.sqliteVersion}`;

      await this.refresh();
    } catch (error) {
      console.error('Database initialization failed:', error);
      this.statusLine.textContent = `Database error: ${error.message}`;
      this.event('DB-ERROR', { error: error.message });
    }
  }

  /**
   * Add a note from the input field and refresh the list.
   *
   * @async
   * @returns {Promise<void>}
   */
  async addEntry() {
    const content = this.input.value.trim();
    if (!content) {
      return;
    }

    try {
      const id = await addNote(content);
      this.input.value = '';
      this.event('DB-ENTRY-ADDED', { id, content });
      await this.refresh();
    } catch (error) {
      console.error('Failed to add entry:', error);
      this.event('DB-ERROR', { error: error.message });
    }
  }

  /**
   * Delete a note by id and refresh the list.
   *
   * @async
   * @param {number} id - The note id
   * @returns {Promise<void>}
   */
  async removeEntry(id) {
    try {
      await deleteNote(id);
      this.event('DB-ENTRY-DELETED', { id });
      await this.refresh();
    } catch (error) {
      console.error('Failed to delete entry:', error);
      this.event('DB-ERROR', { error: error.message });
    }
  }

  /**
   * Generate the notes index and display all user indexes.
   *
   * @async
   * @returns {Promise<void>}
   */
  async createIndex() {
    try {
      await createNotesIndex();
      const indexes = await listIndexes();
      const names = indexes.map((i) => i.name);
      this.indexLine.textContent = names.length > 0
        ? `Indexes: ${names.join(', ')}`
        : 'Indexes: (none)';
      this.event('DB-INDEX-CREATED', { indexes: names });
    } catch (error) {
      console.error('Failed to create index:', error);
      this.event('DB-ERROR', { error: error.message });
    }
  }

  /**
   * Reload entries and indexes from the database and re-render the list.
   * Called internally and by <file-storage-component> after an import.
   *
   * @async
   * @returns {Promise<void>}
   */
  async refresh() {
    const [notes, indexes] = await Promise.all([listNotes(), listIndexes()]);

    this.list.innerHTML = '';
    notes.forEach((note) => {
      const item = document.createElement('li');

      const text = document.createElement('span');
      text.textContent = note.content;
      item.appendChild(text);

      const date = document.createElement('small');
      date.textContent = ` #${note.id} · ${new Date(note.created_at).toLocaleString()}`;
      item.appendChild(date);

      const deleteButton = document.createElement('button');
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => this.removeEntry(note.id));
      item.appendChild(deleteButton);

      this.list.appendChild(item);
    });

    const names = indexes.map((i) => i.name);
    this.indexLine.textContent = names.length > 0
      ? `Indexes: ${names.join(', ')}`
      : 'Indexes: (none yet — click "Create index")';
  }
}

// Register the custom element
if (!customElements.get('db-component')) {
  customElements.define('db-component', DbComponent);
}
