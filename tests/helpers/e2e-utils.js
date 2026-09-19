/**
 * E2E Test Utilities (WebdriverIO)
 *
 * Shared helpers for the WebdriverIO e2e specs, which run inside the
 * real Electron app. One session is reused per spec file and database
 * state persists between tests, so suites that touch the
 * <db-component> must call clearExistingEntries() in beforeEach.
 */

import { browser, $, $$, expect } from '@wdio/globals';

/**
 * Wait until the component has finished initializing the database.
 * The status line always ends up containing the SQLite version.
 */
export async function waitForDbReady() {
  const status = $('db-component .db-status');
  await expect(status).toHaveText(
    expect.stringContaining('SQLite'),
    { timeout: 15000 }
  );
}

/**
 * Delete every entry currently listed in <db-component> through its
 * own UI. Gives each test a clean table even though the OPFS database
 * persists across navigations in a shared session.
 */
export async function clearExistingEntries() {
  let guard = 100;
  while ((await $$('db-component .db-entries li')).length > 0 && guard-- > 0) {
    const count = (await $$('db-component .db-entries li')).length;
    const firstEntry = await $('db-component .db-entries li');
    await (await firstEntry.$('button=Delete')).click();
    await browser.waitUntil(
      async () => (await $$('db-component .db-entries li')).length < count
    );
  }
}

/**
 * Add a note through the db-component UI and wait for it to appear.
 */
export async function addNote(content) {
  const input = $('db-component .db-form input');
  await input.setValue(content);
  await (await findButton('db-component', 'Add entry')).click();
  await expectEntryVisible(content);
}

/**
 * Assert that an entry with exactly this text is visible in the list.
 */
export async function expectEntryVisible(content) {
  await browser.waitUntil(
    async () => {
      const spans = await $$('db-component .db-entries li span');
      for (const span of spans) {
        if ((await span.getText()) === content && (await span.isDisplayed())) {
          return true;
        }
      }
      return false;
    },
    { timeoutMsg: `Entry "${content}" never appeared in the list` }
  );
}

/**
 * Count entries whose text equals `content`.
 */
export async function countEntries(content) {
  const spans = await $$('db-component .db-entries li span');
  let n = 0;
  for (const span of spans) {
    if ((await span.getText()) === content) n++;
  }
  return n;
}

/**
 * Find the first button inside `containerSelector` whose label
 * contains `text` (auto-waiting; throws after the timeout otherwise).
 */
export function findButton(containerSelector, text) {
  return browser.waitUntil(async () => {
    const buttons = await $$(`${containerSelector} button`);
    for (const button of buttons) {
      if ((await button.getText()).includes(text)) {
        return button;
      }
    }
    return false;
  }, { timeoutMsg: `Button "${text}" not found within ${containerSelector}` });
}

/**
 * Find the first element matching `selector` whose full text matches
 * `regex` (auto-waiting).
 */
export function findByTextRegex(selector, regex) {
  return browser.waitUntil(async () => {
    const elements = await $$(selector);
    for (const element of elements) {
      if (regex.test(await element.getText())) {
        return element;
      }
    }
    return false;
  }, { timeoutMsg: `No element ${selector} matching ${regex}` });
}
