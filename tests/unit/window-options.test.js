/**
 * Window Options Unit Tests
 *
 * Verifies the Electron main process is configured with a transparent
 * (hidden) title bar so app content extends up to the window chrome.
 */

import { describe, it, expect } from 'vitest';
import { WINDOW_OPTIONS } from '../../electron/window-options.js';

describe('WINDOW_OPTIONS', () => {
  it('exports the expected window dimensions', () => {
    expect(WINDOW_OPTIONS.width).toBe(1024);
    expect(WINDOW_OPTIONS.height).toBe(768);
  });

  it('uses a hidden title bar for a transparent menu bar', () => {
    expect(WINDOW_OPTIONS.titleBarStyle).toBe('hidden');
  });

  it('keeps renderer security defaults', () => {
    expect(WINDOW_OPTIONS.webPreferences.contextIsolation).toBe(true);
    expect(WINDOW_OPTIONS.webPreferences.nodeIntegration).toBe(false);
  });

  it('loads the memory profiler preload script', () => {
    expect(WINDOW_OPTIONS.webPreferences.preload).toMatch(/preload\.js$/);
    expect(WINDOW_OPTIONS.webPreferences.preload).toContain('electron');
  });
});
