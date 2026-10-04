import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchNova, startTestSite, omnibox, dropdown, typeInOmnibox, submitInOmnibox, openPage } from './helpers/electron-app';
import type { NovaApp, TestSite } from './helpers/electron-app';

/**
 * The search subsystem in the real shell (plan §6.4): the omnibox, `nova://search`, find-in-page, engine discovery,
 * row actions and the archive, driven through the packaged-style Electron app against a local web site.
 * Remote suggestions are never reached (nothing here types a query the provider would send to the network and
 * waits for it), and every page loaded comes from 127.0.0.1.
 */
test.describe.configure({ mode: 'serial' });

let site: TestSite;
let profile: string;
let nova: NovaApp | null = null;

test.beforeAll(async () => { site = await startTestSite(); });
test.afterAll(async () => { await site.close(); });
test.beforeEach(() => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-e2e-'));
  site.hits.length = 0;
});
test.afterEach(async () => {
  await nova?.app.close().catch(() => undefined);
  nova = null;
  fs.rmSync(profile, { recursive: true, force: true });
});

test('the omnibox classifies what is typed and offers rows for it', async () => {
  test.setTimeout(120_000);
  nova = await launchNova(profile);
  const { page } = nova;
  const badge = page.locator('.nova-addressbar-badge');

  await typeInOmnibox(page, 'hello world');
  await expect(badge).toHaveAttribute('data-kind', 'search');
  await expect(dropdown(page).locator('.nova-dropdown-item[data-type="search"]')).toContainText('hello world');

  await typeInOmnibox(page, '!w cats');
  await expect(badge).toHaveAttribute('data-kind', 'bang');
  await expect(badge).toHaveText('!w');
  await expect(badge).toHaveAttribute('title', 'Search Wikipedia');

  await typeInOmnibox(page, '2+2');
  await expect(badge).toHaveAttribute('data-kind', 'calc');
  await expect(dropdown(page).locator('.nova-dropdown-item[data-type="answer"]')).toContainText('4');

  await omnibox(page).press('Escape'); // typing ends: no badge, no dropdown
  await expect(badge).toBeHidden();
});

test('plain text lands on Nova search; the search page is rendered by the window', async () => {
  test.setTimeout(120_000);
  nova = await launchNova(profile);
  const { page } = nova;
  await submitInOmnibox(page, 'hello world');
  await expect(page.locator('.content-area h1')).toHaveText('Nova Search', { timeout: 30_000 });
  await expect(page.locator('.content-area input[type="search"]')).toHaveValue('hello world');
  await expect(omnibox(page)).toHaveValue('nova://search?q=hello%20world');
});

test('a local page is painted by the engine and can be searched with Ctrl+F', async () => {
  test.setTimeout(120_000);
  nova = await launchNova(profile);
  const { page } = nova;
  await openPage(page, `${site.origin}/quasar`);

  await page.keyboard.press('Control+f');
  const findBar = page.locator('.nova-find-bar');
  await expect(findBar).toBeVisible();
  await findBar.locator('input[type="search"]').fill('luminous');
  await expect(findBar.locator('.nova-find-bar-count')).toContainText(/\d+\s*(of|\/)\s*\d+/, { timeout: 15_000 });
  await expect(page.locator('canvas.nova-find-overlay')).toBeVisible();

  await findBar.locator('input[type="search"]').fill('zzzzqqqq');
  await expect(findBar.locator('.nova-find-bar-count')).not.toContainText(/\d+\s*(of|\/)\s*\d+/);
});

test('a page that advertises a search engine offers it; the added keyword works and survives a restart', async () => {
  test.setTimeout(180_000);
  nova = await launchNova(profile);
  let { page } = nova;
  await openPage(page, `${site.origin}/engine`);

  const chip = page.locator('.nova-addressbar-offer');
  await expect(chip).toHaveText('＋ Add Test Site', { timeout: 15_000 });
  expect(site.hits).not.toContain('/opensearch.xml'); // spotting the engine costs no request

  await chip.click();
  await expect(chip).toContainText('Added · !', { timeout: 15_000 }); // the descriptor is fetched cross-origin from the renderer
  expect(site.hits).toContain('/opensearch.xml');
  const keyword = (await chip.textContent())!.split('!')[1]!.trim();
  expect(keyword).toBe('test'); // the site is an IP address, so the keyword comes from the engine's name, not from "127"
  await expect(chip).toBeHidden({ timeout: 10_000 });

  await submitInOmnibox(page, `!${keyword} pasta`);
  await expect(omnibox(page)).toHaveValue(`${site.origin}/find?q=pasta`, { timeout: 30_000 });

  // The saved engine list comes back after a restart (same profile), and the keyword is still a bang.
  await nova.app.close();
  nova = await launchNova(profile);
  page = nova.page;
  await submitInOmnibox(page, `!${keyword} noodles`);
  await expect(omnibox(page)).toHaveValue(`${site.origin}/find?q=noodles`, { timeout: 30_000 });

  // And it is listed in Settings → Search Engines.
  await submitInOmnibox(page, 'nova://settings');
  await page.locator('.settings-page').getByText(/Search Engines/).first().click();
  await expect(page.locator('.search-engine-row', { hasText: 'Test Site' })).toContainText(`!${keyword}`);
});

test('dropdown rows copy their link and remove history entries', async () => {
  test.setTimeout(120_000);
  nova = await launchNova(profile);
  const { app, page } = nova;
  const url = `${site.origin}/quasar`;
  await openPage(page, url);

  await typeInOmnibox(page, 'quasar');
  const row = dropdown(page).locator('.nova-dropdown-item[data-type="history"]').first();
  await expect(row).toBeVisible();
  await row.hover();
  await expect(row.locator('.nova-dropdown-item__action[data-action="copy"]')).toBeVisible();

  await row.locator('.nova-dropdown-item__action[data-action="copy"]').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(url); // the real OS clipboard
  await expect(dropdown(page)).toBeVisible(); // clicking a button neither navigates nor closes the dropdown
  await expect(omnibox(page)).toBeFocused();

  await row.hover();
  await row.locator('.nova-dropdown-item__action[data-action="delete"]').click();
  await expect(dropdown(page).locator('.nova-dropdown-item[data-type="history"]')).toHaveCount(0, { timeout: 10_000 });
});

test('the personal archive indexes visited pages and still finds them after a restart, even if the app is closed right away', async () => {
  test.setTimeout(240_000);
  nova = await launchNova(profile);
  let { page } = nova;

  // Opt in (off by default) and reload so the window reads the setting.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('nova-settings') ?? '{}') as Record<string, unknown>;
    settings.archiveEnabled = true;
    localStorage.setItem('nova-settings', JSON.stringify(settings));
  });
  await page.reload();
  await expect(omnibox(page)).toBeVisible({ timeout: 45_000 });

  await openPage(page, `${site.origin}/quasar`);
  // Indexing runs in the background; the search page reads the archive when it is opened.
  await expect.poll(async () => {
    await submitInOmnibox(page, 'nova://search?q=luminous');
    await expect(page.locator('.content-area h1')).toHaveText('Nova Search');
    return page.locator('.content-area article').count();
  }, { timeout: 60_000, intervals: [2_000] }).toBeGreaterThan(0);
  await expect(page.locator('.content-area article').first()).toContainText('Quasar notes');

  // No waiting for the archive's 5 s debounced save: closing the window must flush it (a page indexed in the
  // last seconds used to be lost — SearchIntegration now saves on pagehide / visibilitychange).
  await nova.app.close();
  nova = await launchNova(profile);
  page = nova.page;
  await submitInOmnibox(page, 'nova://search?q=luminous');
  await expect(page.locator('.content-area h1')).toHaveText('Nova Search', { timeout: 30_000 });
  await expect(page.locator('.content-area article').first()).toContainText('Quasar notes', { timeout: 30_000 });
});
