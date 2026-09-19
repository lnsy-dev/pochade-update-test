/**
 * Dev Server Detection Unit Tests
 *
 * Tests the logic that decides whether Electron should load the webpack
 * dev server or fall back to the production app:// build. The probe must
 * only trust responses that carry the project's custom identity header,
 * preventing Electron from loading an unrelated service on the same port.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('dev-server', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Import the dev-server module with a fresh module cache and a mocked
   * electron net.fetch implementation.
   *
   * @param {Function} mockFetch - Mock implementation of net.fetch
   * @returns {Promise<object>} The dev-server module exports
   */
  async function importDevServer(mockFetch) {
    vi.doMock('electron', () => ({
      net: { fetch: mockFetch },
    }));
    return import('../../electron/dev-server.js');
  }

  it('loads dev URL when dev server responds with identity header', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: {
          get: (name) => (name === 'X-Pochade-Dev-Server' ? 'pochade' : null),
        },
      })
    );

    const { resolveStartUrl } = await importDevServer(mockFetch);
    const url = await resolveStartUrl('http://localhost:45678');

    expect(url).toBe('http://localhost:45678');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:45678', { method: 'HEAD' });
  });

  it('falls back to app:// when response lacks identity header', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => null },
      })
    );

    const { resolveStartUrl } = await importDevServer(mockFetch);
    const url = await resolveStartUrl('http://localhost:45678');

    expect(url).toBe('app://./index.html');
  });

  it('falls back to app:// when identity header value is wrong', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: {
          get: (name) => (name === 'X-Pochade-Dev-Server' ? 'other-project' : null),
        },
      })
    );

    const { resolveStartUrl } = await importDevServer(mockFetch);
    const url = await resolveStartUrl('http://localhost:45678');

    expect(url).toBe('app://./index.html');
  });

  it('falls back to app:// when dev server responds with non-OK status', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        headers: { get: () => 'pochade' },
      })
    );

    const { resolveStartUrl } = await importDevServer(mockFetch);
    const url = await resolveStartUrl('http://localhost:45678');

    expect(url).toBe('app://./index.html');
  });

  it('falls back to app:// when probe times out', async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn(() => new Promise(() => {}));

    try {
      const { resolveStartUrl, DEV_SERVER_PROBE_TIMEOUT } = await importDevServer(mockFetch);
      const promise = resolveStartUrl('http://localhost:45678');
      vi.advanceTimersByTime(DEV_SERVER_PROBE_TIMEOUT);
      const url = await promise;

      expect(url).toBe('app://./index.html');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to app:// when probe rejects', async () => {
    const mockFetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));

    const { resolveStartUrl } = await importDevServer(mockFetch);
    const url = await resolveStartUrl('http://localhost:45678');

    expect(url).toBe('app://./index.html');
  });
});
