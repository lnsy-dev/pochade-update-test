/**
 * Memory Profiler Unit Tests
 *
 * Tests the Electron main-process logic that parses the --memory-profiler
 * CLI flag and builds the metrics payload from app.getAppMetrics().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('profiler', () => {
  let originalArgv;

  beforeEach(() => {
    originalArgv = process.argv;
    vi.resetModules();
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  /**
   * Import the profiler module with a fresh module cache and optional mocks.
   *
   * @param {object} [appMetrics] - Mock return value for app.getAppMetrics()
   * @returns {Promise<object>} The profiler module
   */
  async function importProfiler(appMetrics = []) {
    vi.doMock('electron', () => ({
      app: {
        getAppMetrics: vi.fn(() => appMetrics),
      },
    }));
    return import('../../electron/profiler.js');
  }

  it('reports enabled when --memory-profiler is in process.argv', async () => {
    process.argv = ['node', 'electron', '--memory-profiler'];
    const { isProfilerEnabled } = await importProfiler();
    expect(isProfilerEnabled()).toBe(true);
  });

  it('reports disabled when --memory-profiler is absent', async () => {
    process.argv = ['node', 'electron'];
    const { isProfilerEnabled } = await importProfiler();
    expect(isProfilerEnabled()).toBe(false);
  });

  it('reports disabled when only a similar flag is present', async () => {
    process.argv = ['node', 'electron', '--memory-profiler-extra'];
    const { isProfilerEnabled } = await importProfiler();
    expect(isProfilerEnabled()).toBe(false);
  });

  it('collects total memory and CPU across processes', async () => {
    const metrics = [
      {
        type: 'Browser',
        memory: { workingSetSize: 102400 },
        cpu: { percentCPUUsage: 5.1234 },
      },
      {
        type: 'Renderer',
        memory: { workingSetSize: 204800 },
        cpu: { percentCPUUsage: 10.5678 },
      },
    ];

    const { collectMetrics } = await importProfiler(metrics);
    const result = collectMetrics();

    expect(result.totalMemoryMB).toBe(300); // 100 + 200
    expect(result.totalCpuPercent).toBeCloseTo(15.69, 1);
    expect(result.processes).toHaveLength(2);
    expect(result.processes[0]).toEqual({
      type: 'Browser',
      memoryMB: 100,
      cpuPercent: 5.12,
    });
    expect(result.processes[1]).toEqual({
      type: 'Renderer',
      memoryMB: 200,
      cpuPercent: 10.57,
    });
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('returns zero totals when no processes are reported', async () => {
    const { collectMetrics } = await importProfiler([]);
    const result = collectMetrics();

    expect(result.totalMemoryMB).toBe(0);
    expect(result.totalCpuPercent).toBe(0);
    expect(result.processes).toEqual([]);
  });
});
