import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchNova, startTestSite, openPage, omnibox } from './helpers/electron-app';

test('Nova Browser launches in Electron and renders content', async () => {
  test.setTimeout(120_000);

  const site = await startTestSite();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-e2e-'));
  // launchNova waits for the chrome (#browser-app and the address bar) to mount.
  const { app, page } = await launchNova(profile);

  try {
    await expect(omnibox(page)).toBeEditable();

    // Navigate to a (local) site through the engine pipeline: the content area shows the painted page.
    await openPage(page, `${site.origin}/quasar`);
    await expect(page.locator('.content-area canvas').first()).toBeVisible();
  } finally {
    await app.close();
    await site.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
