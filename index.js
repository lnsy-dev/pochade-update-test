/**
 * Main Entry Point
 *
 * This is the primary JavaScript entry point for the webpack build.
 * It imports the global CSS and all custom element modules.
 *
 * Webpack follows this dependency graph to bundle everything into
 * a single output file (plus worker/wasm chunks).
 *
 * For LLMs: When adding a new component:
 *   1. Create the component file in src/
 *   2. Add an import statement below
 *   3. If the component needs styles, create a CSS file in styles/
 *   4. Import the CSS in index.css (not here — keep JS and CSS separate)
 */

// Global styles: imported first so they are available before components render
import './index.css';

// ============================================================================
// Database & Local File Storage
// ============================================================================

// Database: sqlite-wasm in a web worker, OPFS persistence, CRUD + index demo
import './src/db-component.js';

// File storage: Chrome's File System Access API for export/import of the DB file
import './src/file-storage-component.js';

// Memory profiler: optional overlay enabled via --memory-profiler CLI flag
import './src/memory-profiler-component.js';

// ============================================================================
// WebAssembly Examples
// ============================================================================





// ============================================================================
// Application Bootstrap
// ============================================================================

/**
 * Optional: Add any global application initialization here.
 *
 * For example, you might set up a service worker, initialize analytics,
 * or configure global error handlers. Since this is a starter template,
 * we keep it minimal.
 */
console.log('Pochade-Electron application initialized');
