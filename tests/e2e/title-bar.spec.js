/**
 * Transparent Title Bar E2E Tests
 *
 * The Electron main process hides the macOS title bar so the app content
 * extends up to the window chrome. These tests verify that the renderer
 * reserves space for the traffic-light buttons via CSS padding.
 */

import { expect, browser } from '@wdio/globals';

describe('transparent title bar', () => {
  beforeEach(async () => {
    await browser.url('/');
  });

  it('body has top padding reserved for the title bar', async () => {
    const paddingTop = await browser.execute(
      () => window.getComputedStyle(document.body).paddingTop
    );

    expect(paddingTop).toBe('40px');
  });

  it('title bar height is exposed as a CSS variable', async () => {
    const titleBarHeight = await browser.execute(
      () => getComputedStyle(document.documentElement)
        .getPropertyValue('--title-bar-height')
        .trim()
    );

    expect(titleBarHeight).toBe('2.5rem');
  });

  it('has a draggable title bar region at the top of the window', async () => {
    const titleBar = await $('.title-bar');
    await expect(titleBar).toExist();

    const appRegion = await browser.execute(
      () => window.getComputedStyle(document.querySelector('.title-bar'))
        .getPropertyValue('-webkit-app-region')
    );

    expect(appRegion).toBe('drag');
  });
});
