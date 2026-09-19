/**
 * File Storage Component
 *
 * Demonstrates Google Chrome's File System Access API working together
 * with the SQLite database:
 *   - Export: serialize the database and save it to a real file on disk
 *     via showSaveFilePicker()
 *   - Import: pick a .sqlite3/.db file via showOpenFilePicker() and load
 *     it into the database
 *
 * The API is available in Chrome, Edge and the Electron renderer.
 * Elsewhere the component explains that the feature is unsupported.
 *
 * Events emitted (dataroom-js this.event):
 *   DB-EXPORTED  { name }
 *   DB-IMPORTED  { name }
 *   DB-ERROR     { error }
 */

import DataroomElement from 'dataroom-js';
import { exportDatabase, importDatabase } from './lib/database.js';
import {
  isFileSystemAccessSupported,
  isUserCancellation,
  saveBytesToDisk,
  pickFileFromDisk,
} from './lib/file-storage.js';

/**
 * FileStorageComponent
 *
 * A custom HTML element with export/import buttons for the database file.
 *
 * @extends DataroomElement
 */
class FileStorageComponent extends DataroomElement {
  /**
   * Initialize the component.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    this.create('h2', { content: 'Local File Storage' });

    this.create('p', {
      content: 'Export the database to a file on disk, or import one back, using the File System Access API.',
    });

    if (!isFileSystemAccessSupported()) {
      this.create('p', {
        class: 'file-storage-unsupported',
        content: 'The File System Access API is not available in this browser. Use Chrome, Edge, or the Electron app.',
      });
      return;
    }

    const controls = this.create('div', { class: 'file-storage-controls' });

    const exportButton = this.create('button', { content: 'Export database to file' }, controls);
    exportButton.addEventListener('click', () => this.exportToFile());

    const importButton = this.create('button', { content: 'Import database from file' }, controls);
    importButton.addEventListener('click', () => this.importFromFile());

    this.resultLine = this.create('p', { class: 'file-storage-result' });
  }

  /**
   * Serialize the database and save it to disk with a save dialog.
   *
   * @async
   * @returns {Promise<void>}
   */
  async exportToFile() {
    try {
      const bytes = await exportDatabase();
      const name = await saveBytesToDisk('app.sqlite3', bytes);
      this.resultLine.textContent = `Exported ${bytes.byteLength} bytes to ${name}.`;
      this.event('DB-EXPORTED', { name, size: bytes.byteLength });
    } catch (error) {
      if (isUserCancellation(error)) {
        return; // User closed the save dialog — nothing to do
      }
      console.error('Export failed:', error);
      this.resultLine.textContent = `Export failed: ${error.message}`;
      this.event('DB-ERROR', { error: error.message });
    }
  }

  /**
   * Pick a database file from disk and load it into the database.
   * Afterwards, refreshes <db-component> if one is on the page.
   *
   * @async
   * @returns {Promise<void>}
   */
  async importFromFile() {
    try {
      const { name, bytes } = await pickFileFromDisk();
      await importDatabase(bytes);
      this.resultLine.textContent = `Imported ${name} (${bytes.byteLength} bytes).`;
      this.event('DB-IMPORTED', { name, size: bytes.byteLength });

      // dataroom-js events do not bubble, so refresh the db component directly
      const dbComponent = document.querySelector('db-component');
      if (dbComponent && typeof dbComponent.refresh === 'function') {
        await dbComponent.refresh();
      }
    } catch (error) {
      if (isUserCancellation(error)) {
        return; // User closed the open dialog — nothing to do
      }
      console.error('Import failed:', error);
      this.resultLine.textContent = `Import failed: ${error.message}`;
      this.event('DB-ERROR', { error: error.message });
    }
  }
}

// Register the custom element
if (!customElements.get('file-storage-component')) {
  customElements.define('file-storage-component', FileStorageComponent);
}
