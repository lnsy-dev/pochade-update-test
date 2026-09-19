import { browser } from '@wdio/globals';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
describe('probe', () => {
  it('pauses for external inspection', async () => {
    const userDataDir = browser.capabilities?.chrome?.userDataDir;
    console.log('UDD:', userDataDir);
    await browser.url('/');
    console.log('PAUSING_NOW');
    await browser.pause(90000);
  });
});
