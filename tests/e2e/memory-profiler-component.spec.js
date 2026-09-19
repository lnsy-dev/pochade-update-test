/**
 * Memory Profiler Component E2E Tests
 *
 * The overlay is normally only visible inside Electron when the app is
 * launched with --memory-profiler. These tests stub the Electron preload
 * API with browser.addInitScript() so the component can be exercised in
 * the WebdriverIO browser as well.
 */

import { expect, browser, $ } from '@wdio/globals';

/**
 * Install a mock electronProfiler bridge into the page.
 *
 * The real bridge is injected by Electron's preload script; here we
 * provide a manual equivalent so the web-only test browser can trigger
 * enable/metrics callbacks. addInitScript runs before any page script
 * on every navigation of this session.
 */
async function installMockProfilerBridge() {
  await browser.addInitScript(() => {
    window.__profilerCallbacks = {
      enabled: [],
      metrics: [],
    };

    window.electronProfiler = {
      onEnabled: (callback) => window.__profilerCallbacks.enabled.push(callback),
      onMetrics: (callback) => window.__profilerCallbacks.metrics.push(callback),
    };
  });
}

/**
 * Notify all registered enabled callbacks.
 */
async function enableProfiler() {
  await browser.execute(() => {
    window.__profilerCallbacks.enabled.forEach((callback) => callback());
  });
}

/**
 * Send a sample metrics payload to all registered metrics callbacks.
 */
async function sendSampleMetrics() {
  await browser.execute(() => {
    const metrics = {
      timestamp: Date.now(),
      totalMemoryMB: 123.45,
      totalCpuPercent: 12.34,
      processes: [
        { type: 'Browser', memoryMB: 45.1, cpuPercent: 2.3 },
        { type: 'Renderer', memoryMB: 78.4, cpuPercent: 10.0 },
      ],
    };
    window.__profilerCallbacks.metrics.forEach((callback) => callback(metrics));
  });
}

describe('Memory Profiler Component', () => {
  beforeEach(async () => {
    await installMockProfilerBridge();
    await browser.url('/');
  });

  it('is hidden by default', async () => {
    const profiler = $('memory-profiler-component');
    await expect(profiler).not.toBeDisplayed();
  });

  it('appears when the profiler is enabled', async () => {
    const profiler = $('memory-profiler-component');
    await expect(profiler).not.toBeDisplayed();

    await enableProfiler();
    await expect(profiler).toBeDisplayed();
  });

  it('renders totals and process breakdown after receiving metrics', async () => {
    const profiler = $('memory-profiler-component');

    await enableProfiler();
    await sendSampleMetrics();

    const summary = profiler.$('.profiler-summary');
    await expect(summary).toHaveText(expect.stringContaining('123.5 MB'));
    await expect(summary).toHaveText(expect.stringContaining('12.3%'));

    const processes = profiler.$('.profiler-processes');
    await expect(processes).toHaveText(expect.stringContaining('Browser'));
    await expect(processes).toHaveText(expect.stringContaining('Renderer'));
    await expect(processes).toHaveText(expect.stringContaining('45.1 MB'));
    await expect(processes).toHaveText(expect.stringContaining('78.4 MB'));
    await expect(processes).toHaveText(expect.stringContaining('2.3%'));
    await expect(processes).toHaveText(expect.stringContaining('10.0%'));
  });

  it('shows an age line after receiving metrics', async () => {
    const profiler = $('memory-profiler-component');

    await enableProfiler();
    await sendSampleMetrics();

    await expect(profiler.$('.profiler-age')).toHaveText(expect.stringContaining('Updated'));
  });
});
