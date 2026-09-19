/**
 * File Storage Component Tests
 *
 * End-to-end tests for <file-storage-component> — the File System
 * Access API dialog flows (export/import of the database file).
 *
 * Why the pickers are stubbed: showSaveFilePicker() and
 * showOpenFilePicker() open NATIVE OS dialogs that no browser
 * automation can drive. So these tests install JavaScript stand-ins
 * for the picker functions via browser.addInitScript() and assert:
 *   - the component invokes the dialogs from the click handlers
 *   - the bytes written through the save dialog are a real SQLite file
 *   - a file "picked" through the open dialog is imported and rendered
 *   - user cancellation (AbortError) is swallowed quietly
 *   - browsers without the API get the unsupported notice
 *
 * What these tests do NOT cover: the actual native dialog chrome.
 *
 * WebdriverIO note: addInitScript registrations persist for the whole
 * session and re-run on every navigation, so each mock overwrites the
 * previous one and the unsupported-API test runs LAST.
 */

import { expect, browser, $, $$ } from '@wdio/globals';
import {
  waitForDbReady,
  clearExistingEntries,
  addNote,
  expectEntryVisible,
  findButton,
} from '../helpers/e2e-utils.js';

/**
 * Install picker stand-ins in the page before any app code runs.
 *
 * window.showSaveFilePicker resolves to a fake handle whose writable
 * collects written chunks into window.__exportedFiles.
 * window.showOpenFilePicker resolves to a fake handle wrapping
 * window.__importFile (a File the test assigns later).
 */
async function mockFileSystemAccessDialogs() {
  await browser.addInitScript(() => {
    window.__exportedFiles = [];
    window.__importFile = null;

    window.showSaveFilePicker = async (options) => {
      const chunks = [];
      return {
        name: options.suggestedName,
        async createWritable() {
          return {
            async write(data) { chunks.push(data); },
            async close() {
              window.__exportedFiles.push({ name: options.suggestedName, chunks });
            },
          };
        },
      };
    };

    window.showOpenFilePicker = async () => [{
      name: window.__importFile?.name ?? 'import.sqlite3',
      async getFile() { return window.__importFile; },
    }];
  });
}

/**
 * Read back the bytes captured by the mocked save dialog as a plain
 * array of numbers plus the 16-byte file header.
 */
async function readExportedBytes() {
  return browser.execute(() => {
    const exported = window.__exportedFiles[0];
    const totalLength = exported.chunks.reduce((n, c) => n + c.byteLength, 0);
    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of exported.chunks) {
      bytes.set(new Uint8Array(chunk instanceof Uint8Array ? chunk : chunk.data ?? chunk), offset);
      offset += chunk.byteLength;
    }
    return {
      name: exported.name,
      length: totalLength,
      header: Array.from(bytes.slice(0, 16)),
    };
  });
}

describe('File Storage Component (dialog UI)', () => {
  it('export dialog saves a real SQLite database file', async () => {
    await mockFileSystemAccessDialogs();
    await browser.url('/');
    await waitForDbReady();
    await clearExistingEntries();
    await addNote('note to export');

    await (await findButton('file-storage-component', 'Export database to file')).click();

    const resultLine = $('file-storage-component .file-storage-result');
    await expect(resultLine).toHaveText(
      expect.stringMatching(/Exported \d+ bytes to app\.sqlite3\./)
    );

    const exported = await readExportedBytes();
    expect(exported.name).toBe('app.sqlite3');
    expect(exported.length).toBeGreaterThan(0);

    // SQLite database files start with the magic string "SQLite format 3\0"
    const magic = Array.from(new TextEncoder().encode('SQLite format 3\0'));
    expect(exported.header).toEqual(magic);
  });

  it('import dialog replaces the database with the picked file', async () => {
    await mockFileSystemAccessDialogs();
    await browser.url('/');
    await waitForDbReady();
    await clearExistingEntries();

    // Export a database containing only "original note"
    await addNote('original note');
    await (await findButton('file-storage-component', 'Export database to file')).click();
    await expect($('file-storage-component .file-storage-result')).toHaveText(
      expect.stringContaining('Exported')
    );

    // Change the database after the export
    await addNote('after export');

    // Point the mocked open dialog at the exported bytes
    await browser.execute(() => {
      const exported = window.__exportedFiles[0];
      window.__importFile = new File(exported.chunks, 'backup.sqlite3');
    });

    await (await findButton('file-storage-component', 'Import database from file')).click();

    const resultLine = $('file-storage-component .file-storage-result');
    await expect(resultLine).toHaveText(
      expect.stringMatching(/Imported backup\.sqlite3 \(\d+ bytes\)\./)
    );

    // The list refreshes to the imported state: original is back,
    // the post-export note is gone.
    await expectEntryVisible('original note');
    await browser.waitUntil(
      async () => {
        const spans = await $$('db-component .db-entries li span');
        for (const span of spans) {
          if ((await span.getText()) === 'after export') return false;
        }
        return true;
      }
    );
  });

  it('cancelling the save dialog is silent (no error shown)', async () => {
    await browser.addInitScript(() => {
      window.showSaveFilePicker = async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      };
    });
    await browser.url('/');
    await waitForDbReady();

    await (await findButton('file-storage-component', 'Export database to file')).click();

    // Give the click handler time to run; the result line must stay empty
    await browser.pause(500);
    const resultLine = $('file-storage-component .file-storage-result');
    expect(await resultLine.getText()).toBe('');
  });

  it('cancelling the open dialog is silent (no error shown)', async () => {
    await browser.addInitScript(() => {
      window.showOpenFilePicker = async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      };
    });
    await browser.url('/');
    await waitForDbReady();

    await (await findButton('file-storage-component', 'Import database from file')).click();

    await browser.pause(500);
    const resultLine = $('file-storage-component .file-storage-result');
    expect(await resultLine.getText()).toBe('');
  });

  it('shows an unsupported notice when the File System Access API is missing', async () => {
    // Must run LAST: this init script overrides the picker mocks above on
    // every subsequent navigation of the shared session.
    await browser.addInitScript(() => {
      // Override the globals before the app loads (simulates Firefox/Safari)
      window.showSaveFilePicker = undefined;
      window.showOpenFilePicker = undefined;
    });
    await browser.url('/');

    const notice = $('file-storage-component .file-storage-unsupported');
    await expect(notice).toBeDisplayed();
    await expect(notice).toHaveText(
      expect.stringContaining('File System Access API is not available')
    );
    expect((await $$('file-storage-component button')).length).toBe(0);
  });
});
