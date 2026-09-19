/**
 * Memory Profiler Support
 *
 * Parses the --memory-profiler command-line flag and builds the metrics
 * payload sent from the Electron main process to the renderer.
 *
 * All Electron/Node APIs live here so the renderer overlay stays a
 * plain web component.
 */

import { app } from 'electron';

/** Command-line flag that enables the memory profiler overlay. */
export const PROFILER_FLAG = '--memory-profiler';

/**
 * Check whether the memory profiler was requested on the command line.
 *
 * @returns {boolean} True when --memory-profiler is present in process.argv
 */
export function isProfilerEnabled() {
  return process.argv.includes(PROFILER_FLAG);
}

/**
 * Collect current per-process memory and CPU metrics for the application.
 *
 * Uses app.getAppMetrics() so the numbers reflect Electron's own process
 * accounting (main, renderer, GPU, utility, etc.).
 *
 * @returns {{
 *   timestamp: number,
 *   totalMemoryMB: number,
 *   totalCpuPercent: number,
 *   processes: Array<{type: string, memoryMB: number, cpuPercent: number}>
 * }} Metrics payload sent to the renderer
 */
export function collectMetrics() {
  const processes = app.getAppMetrics().map((processInfo) => ({
    type: processInfo.type,
    memoryMB: Math.round((processInfo.memory.workingSetSize / 1024) * 100) / 100,
    cpuPercent: Math.round(processInfo.cpu.percentCPUUsage * 100) / 100,
  }));

  const totalMemoryMB = processes.reduce((sum, processInfo) => sum + processInfo.memoryMB, 0);
  const totalCpuPercent = processes.reduce((sum, processInfo) => sum + processInfo.cpuPercent, 0);

  return {
    timestamp: Date.now(),
    totalMemoryMB,
    totalCpuPercent,
    processes,
  };
}
