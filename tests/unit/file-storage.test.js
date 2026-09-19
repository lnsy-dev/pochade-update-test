/**
 * File Storage Unit Tests
 *
 * Unit tests for src/lib/file-storage.js — the File System Access API
 * wrappers used for database export/import.
 *
 * The picker APIs (window.showSaveFilePicker / window.showOpenFilePicker)
 * are stubbed per-test with fake handles, so these tests pin down how
 * our code drives the dialogs without needing a browser.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isFileSystemAccessSupported,
  isUserCancellation,
  saveBytesToDisk,
  pickFileFromDisk,
} from '../../src/lib/file-storage.js';

describe('file-storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isFileSystemAccessSupported', () => {
    it('returns false when no window exists (Node)', () => {
      expect(isFileSystemAccessSupported()).toBe(false);
    });

    it('returns false when the pickers are missing', () => {
      vi.stubGlobal('window', {});
      expect(isFileSystemAccessSupported()).toBe(false);
    });

    it('returns false when the pickers are overridden with undefined', () => {
      vi.stubGlobal('window', {
        showSaveFilePicker: undefined,
        showOpenFilePicker: undefined,
      });
      expect(isFileSystemAccessSupported()).toBe(false);
    });

    it('returns true when both pickers are functions', () => {
      vi.stubGlobal('window', {
        showSaveFilePicker() {},
        showOpenFilePicker() {},
      });
      expect(isFileSystemAccessSupported()).toBe(true);
    });
  });

  describe('isUserCancellation', () => {
    it('recognizes AbortError as a user cancellation', () => {
      const error = new DOMException('The user aborted a request.', 'AbortError');
      expect(isUserCancellation(error)).toBe(true);
    });

    it('does not treat other errors as cancellations', () => {
      expect(isUserCancellation(new Error('disk full'))).toBe(false);
      expect(isUserCancellation(new DOMException('nope', 'NotAllowedError'))).toBe(false);
    });

    it('handles null and undefined', () => {
      expect(isUserCancellation(null)).toBe(false);
      expect(isUserCancellation(undefined)).toBe(false);
    });
  });

  describe('saveBytesToDisk', () => {
    it('opens the save dialog with the suggested name and sqlite types', async () => {
      let pickerOptions = null;
      const written = [];
      let closed = false;

      vi.stubGlobal('window', {
        showSaveFilePicker: async (options) => {
          pickerOptions = options;
          return {
            name: options.suggestedName,
            createWritable: async () => ({
              write: async (data) => { written.push(data); },
              close: async () => { closed = true; },
            }),
          };
        },
      });

      const bytes = new Uint8Array([1, 2, 3, 4]);
      const name = await saveBytesToDisk('app.sqlite3', bytes);

      expect(pickerOptions.suggestedName).toBe('app.sqlite3');
      expect(pickerOptions.types).toEqual([
        {
          description: 'SQLite database',
          accept: { 'application/x-sqlite3': ['.sqlite3', '.db'] },
        },
      ]);
      expect(written).toEqual([bytes]);
      expect(closed).toBe(true);
      expect(name).toBe('app.sqlite3');
    });

    it('propagates picker rejection (e.g. user cancellation) to the caller', async () => {
      const abort = new DOMException('The user aborted a request.', 'AbortError');
      vi.stubGlobal('window', {
        showSaveFilePicker: async () => { throw abort; },
      });

      await expect(saveBytesToDisk('app.sqlite3', new Uint8Array())).rejects.toBe(abort);
    });
  });

  describe('pickFileFromDisk', () => {
    it('returns the picked file name and bytes', async () => {
      const contents = new Uint8Array([5, 6, 7, 8]);
      let pickerOptions = null;

      vi.stubGlobal('window', {
        showOpenFilePicker: async (options) => {
          pickerOptions = options;
          return [{
            getFile: async () => ({
              name: 'backup.sqlite3',
              arrayBuffer: async () => contents.buffer,
            }),
          }];
        },
      });

      const { name, bytes } = await pickFileFromDisk();

      expect(pickerOptions.multiple).toBe(false);
      expect(pickerOptions.types).toEqual([
        {
          description: 'SQLite database',
          accept: { 'application/x-sqlite3': ['.sqlite3', '.db'] },
        },
      ]);
      expect(name).toBe('backup.sqlite3');
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(bytes)).toEqual([5, 6, 7, 8]);
    });

    it('propagates picker rejection (e.g. user cancellation) to the caller', async () => {
      const abort = new DOMException('The user aborted a request.', 'AbortError');
      vi.stubGlobal('window', {
        showOpenFilePicker: async () => { throw abort; },
      });

      await expect(pickFileFromDisk()).rejects.toBe(abort);
    });
  });
});
