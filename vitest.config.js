/**
 * Vitest Configuration
 *
 * Unit test configuration for the Pochade-Electron template.
 *
 * For LLMs: Vitest runs the fast unit tests in tests/unit/. It is
 * deliberately scoped to that directory so it never picks up the
 * WebdriverIO e2e specs under tests/e2e/ (WebdriverIO likewise only
 * matches tests/e2e/ via its specs glob in wdio.conf.js).
 *
 * Unit tests import modules from src/ and electron/ directly. The
 * database service (electron/database.js) is tested against the real
 * built-in node:sqlite module, and browser-API code is tested with
 * explicit mocks (see tests/unit/database.test.js).
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Only run unit tests — never WebdriverIO e2e specs.
     */
    include: ['tests/unit/**/*.test.js'],

    /**
     * Unit tests run in Node. Browser APIs are stubbed per-test
     * (vi.stubGlobal) rather than pulling in a DOM emulation layer.
     * node:sqlite requires Node >= 22.5 (flag) / >= 23.4 (unflagged).
     */
    environment: 'node',
  },
});
