/**
 * Memory Profiler Component
 *
 * A fixed upper-left overlay that displays live memory and CPU metrics
 * streamed from the Electron main process. The component is hidden by
 * default and only appears when the app is launched with the
 * --memory-profiler command-line flag.
 *
 * The renderer has no Node/Electron access; it receives data through the
 * small contextBridge API exposed by electron/preload.js.
 *
 * Events emitted (dataroom-js this.event):
 *   PROFILER-ENABLED  { }
 *   PROFILER-METRICS  { metrics }
 */

import DataroomElement from 'dataroom-js';

/**
 * MemoryProfilerComponent
 *
 * Renders application memory and CPU usage as a fixed modal in the
 * upper-left corner of the window.
 *
 * @extends DataroomElement
 */
class MemoryProfilerComponent extends DataroomElement {
  /**
   * Initialize the component.
   *
   * Builds the overlay UI, hides it by default, and wires up the IPC
   * callbacks when running inside Electron.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    this.classList.add('memory-profiler');
    this.style.display = 'none';

    this.create('h3', { content: 'Memory Profiler', class: 'profiler-title' });

    this.summary = this.create('div', { class: 'profiler-summary' });
    this.summary.innerHTML = `
      <div class="profiler-metric">Mem: <span class="profiler-value">—</span></div>
      <div class="profiler-metric">CPU: <span class="profiler-value">—</span></div>
    `;

    this.create('h4', { content: 'Processes', class: 'profiler-subtitle' });
    this.processList = this.create('ul', { class: 'profiler-processes' });

    this.ageLine = this.create('div', { class: 'profiler-age', content: 'Waiting for metrics…' });

    if (window.electronProfiler) {
      window.electronProfiler.onEnabled(() => {
        this.style.display = 'block';
        this.event('PROFILER-ENABLED', {});
      });

      window.electronProfiler.onMetrics((metrics) => {
        this.renderMetrics(metrics);
        this.event('PROFILER-METRICS', { metrics });
      });
    }
  }

  /**
   * Render a metrics payload into the overlay.
   *
   * @param {{
   *   timestamp: number,
   *   totalMemoryMB: number,
   *   totalCpuPercent: number,
   *   processes: Array<{type: string, memoryMB: number, cpuPercent: number}>
   * }} metrics - Metrics payload from the main process
   */
  renderMetrics(metrics) {
    this.dataset.timestamp = String(metrics.timestamp);

    const memorySpan = this.summary.querySelector('.profiler-metric:first-child .profiler-value');
    const cpuSpan = this.summary.querySelector('.profiler-metric:last-child .profiler-value');

    if (memorySpan) {
      memorySpan.textContent = `${metrics.totalMemoryMB.toFixed(1)} MB`;
    }
    if (cpuSpan) {
      cpuSpan.textContent = `${metrics.totalCpuPercent.toFixed(1)}%`;
    }

    this.processList.innerHTML = '';
    metrics.processes.forEach((processInfo) => {
      const item = document.createElement('li');
      item.innerHTML = `
        <span class="process-type">${this.escapeHtml(processInfo.type)}</span>
        <span class="process-memory">${processInfo.memoryMB.toFixed(1)} MB</span>
        <span class="process-cpu">${processInfo.cpuPercent.toFixed(1)}%</span>
      `;
      this.processList.appendChild(item);
    });

    this.updateAgeLine();
  }

  /**
   * Update the "last updated" line.
   */
  updateAgeLine() {
    if (!this.dataset.timestamp) {
      return;
    }
    const seconds = Math.round((Date.now() - Number(this.dataset.timestamp)) / 1000);
    this.ageLine.textContent = `Updated ${seconds}s ago`;
  }

  /**
   * Escape special HTML characters to safely render process type names.
   *
   * @param {string} text - Raw text
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Register the custom element
if (!customElements.get('memory-profiler-component')) {
  customElements.define('memory-profiler-component', MemoryProfilerComponent);
}
