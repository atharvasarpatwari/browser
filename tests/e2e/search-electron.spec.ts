import { test, expect } from '@playwright/test';
import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  launchNova, startTestSite, omnibox, dropdown, typeInOmnibox, submitInOmnibox, openPage, rightClickPage, readResolverEvents, archiveKeys, plantArchiveRecord,
  LINK_AT, IMAGE_AT, EMPTY_AT, TEXT_AT, PAST_TEXT_END, pagePointToClient,
} from './helpers/electron-app';
import type { NovaApp, TestSite } from './helpers/electron-app';

/**
 * The search subsystem in the real shell (plan §6.4): the omnibox, `nova://search`, find-in-page, engine discovery,
 * row actions and the archive, driven through the packaged-style Electron app against a local web site.
 * `launchNova` switches online suggestions off, so nothing typed here leaves the machine, and every page loaded comes
 * from 127.0.0.1 (the one exception is the DNS warm-up test, which looks up and fetches two public example hosts).
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

test('an archive saved before sharding is imported, rewritten as shards in real IndexedDB, and found again after a restart', async () => {
  test.setTimeout(240_000);
  nova = await launchNova(profile);
  let { page } = nova;
  // The old format: the whole index as one string under `snapshot` (one page about zeppelins).
  const legacy = JSON.stringify({
    v: 1,
    docs: [['https://legacy.example.com/zeppelins', 'Zeppelins of old', 'A page about zeppelin airships, saved before the archive was sharded.', 6, 1000, 'abc123']],
    postings: [['zeppelin', [0], [6]], ['airship', [0], [1]], ['old', [0], [5]]],
  });
  await plantArchiveRecord(page, 'snapshot', legacy);
  expect(await archiveKeys(page)).toEqual(['snapshot']);
  await page.reload();
  await expect(omnibox(page)).toBeVisible({ timeout: 45_000 });

  const searchFindsIt = async (): Promise<number> => {
    await submitInOmnibox(page, 'nova://search?q=zeppelin');
    await expect(page.locator('.content-area h1')).toHaveText('Nova Search');
    return page.locator('.content-area article', { hasText: 'Zeppelins of old' }).count();
  };
  await expect.poll(searchFindsIt, { timeout: 60_000, intervals: [2_000] }).toBeGreaterThan(0); // searchable straight away

  // The first save rewrites it as shards plus a meta record and drops the old snapshot, all in one transaction.
  await expect.poll(() => archiveKeys(page), { timeout: 60_000, intervals: [2_000] }).toEqual(['snapshot/meta', 'snapshot/shard:00000']);

  await nova.app.close();
  nova = await launchNova(profile);
  page = nova.page;
  await expect.poll(searchFindsIt, { timeout: 60_000, intervals: [2_000] }).toBeGreaterThan(0); // restored from the shards
  expect(await archiveKeys(page)).toEqual(['snapshot/meta', 'snapshot/shard:00000']);
});

test('typing a very familiar site looks its address up ahead of time; the later load finds it in the resolver cache', async () => {
  test.setTimeout(180_000);
  const warmed = 'www.example.net';
  const control = 'www.iana.org'; // never typed: its lookup shows what a cold load looks like in the log
  const resolvable = await dns.promises.lookup(warmed).then(() => true, () => false);
  nova = await launchNova(profile);
  const { app, page } = nova;

  // One site the user knows well (history is read at start-up, so reload), then record what Chromium's resolver does.
  await page.evaluate((host) => {
    const now = Date.now();
    localStorage.setItem('nova-history', JSON.stringify([
      { id: 'hist-1-1', url: `https://${host}/`, title: 'Example Net', visitTime: now, visitCount: 90, typedCount: 40, lastVisitTime: now },
    ]));
  }, warmed);
  await page.reload();
  await expect(omnibox(page)).toBeVisible({ timeout: 45_000 });
  const netLog = path.join(profile, 'net-log.json');
  await app.evaluate(({ netLog: log }, file) => log.startLogging(file), netLog);

  await typeInOmnibox(page, 'examp'); // no Enter: only the hint, nothing is opened
  await page.waitForTimeout(3_000);

  // Now load both sites the way the engine loads pages (fetch from the app document), noting when that starts.
  const fetchStarts = await page.evaluate(() => performance.timeOrigin + performance.now());
  for (const host of [warmed, control]) {
    await page.evaluate(async (h) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 8_000);
      await fetch(`https://${h}/`, { mode: 'no-cors', signal: abort.signal }).catch(() => undefined);
      clearTimeout(timer);
    }, host);
  }
  await page.waitForTimeout(500);
  await app.evaluate(({ netLog: log }) => log.stopLogging());

  const events = readResolverEvents(netLog);
  const forHost = (host: string) => events.filter((e) => e.host === `https://${host}`);
  // The hint is what asked: a speculative request for exactly the `https://host` key the page load uses (and before the load).
  const speculative = forHost(warmed).filter((e) => e.speculative);
  expect(speculative.length).toBeGreaterThan(0);
  expect(speculative[0]!.at).toBeLessThan(fetchStarts);
  expect(events.filter((e) => e.speculative && e.host !== `https://${warmed}`)).toEqual([]); // nothing else was warmed

  if (!resolvable) {
    test.info().annotations.push({ type: 'dns', description: `${warmed} does not resolve on this machine; the load-time lookups were not asserted` });
    return;
  }
  const lookupsDuringLoad = (host: string) => forHost(host).filter((e) => e.kind === 'job' && e.at >= fetchStarts);
  expect(lookupsDuringLoad(control).length).toBeGreaterThan(0); // a cold host is looked up while loading — the log can see lookups
  expect(lookupsDuringLoad(warmed)).toEqual([]); // a warmed one is not: it was already in the resolver's cache
});

test('text on a rendered page can be selected, copied, and searched from the right-click menu', async () => {
  test.setTimeout(180_000);
  nova = await launchNova(profile);
  const { app, page } = nova;
  const clipboard = () => app.evaluate(({ clipboard: c }) => c.readText());
  const menu = page.locator('.nova-context-menu');
  await openPage(page, `${site.origin}/select`);
  const at = async (p: { x: number; y: number }) => pagePointToClient(page, p);

  // Double-click a word: it is highlighted over the page, and Ctrl+C puts it on the OS clipboard.
  const word = await at(TEXT_AT);
  await page.mouse.dblclick(word.x, word.y);
  await expect(page.locator('canvas.nova-selection-overlay')).toHaveCount(1);
  await page.keyboard.press('Control+c');
  await expect.poll(clipboard).toBe('Alpha');

  // Drag from the start of the line past its end: the whole line.
  const from = await at({ x: 1, y: TEXT_AT.y }); // left of the first letter (the body has a small margin)
  const to = await at(PAST_TEXT_END);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, to.y, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Control+c');
  await expect.poll(clipboard).toBe('Alpha bravo charlie delta echo foxtrot golf hotel');

  // Right-click on the selection: the menu leads with copy / search / ask for it; "Search" opens a new tab.
  const on = await at({ x: 100, y: TEXT_AT.y });
  await page.mouse.click(on.x, on.y, { button: 'right' });
  await expect(menu.getByText('Copy', { exact: true }).first()).toBeVisible();
  await expect(menu.getByText(/^Ask Nova AI about “Alpha bravo charlie/)).toBeVisible();
  await menu.getByText(/^Search Nova for “Alpha bravo charlie/).click();
  await expect(page.locator('.nova-tab')).toHaveCount(2);
  await expect(omnibox(page)).toHaveValue(/^nova:\/\/search\?q=Alpha%20bravo/, { timeout: 30_000 });

  // Back on the first tab, a click elsewhere ends the selection; Ctrl+A selects the whole page's text.
  await page.locator('.nova-tab').first().click();
  await expect(omnibox(page)).toHaveValue(`${site.origin}/select`, { timeout: 30_000 });
  await page.keyboard.press('Control+a');
  await expect(page.locator('canvas.nova-selection-overlay')).toHaveCount(1);
  const blank = await at(EMPTY_AT);
  await page.mouse.click(blank.x, blank.y);
  await expect(page.locator('canvas.nova-selection-overlay')).toHaveCount(0);
});

test('a long page scrolls with the wheel, the keys and the scrollbar; clicks land on what is shown; Back restores the place', async () => {
  test.setTimeout(240_000);
  nova = await launchNova(profile);
  const { page } = nova;
  const thumb = page.locator('.nova-page-scrollbar-thumb');
  const thumbTop = async (): Promise<number> => parseFloat((await thumb.evaluate((el) => (el as HTMLElement).style.top)) || '0');
  /** How many pixels of the page bitmap are red (the link block): none while the top is shown. */
  const redPixels = () => page.evaluate(() => {
    const canvas = document.querySelector('.content-area canvas') as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) n++;
    return n;
  });
  const menu = page.locator('.nova-context-menu');

  await openPage(page, `${site.origin}/tall`);
  await expect(thumb).toBeVisible(); // the page is taller than the viewport
  expect(await thumbTop()).toBe(0);
  expect(await redPixels()).toBe(0); // the link is below the fold

  // The wheel.
  const middle = await pagePointToClient(page, { x: 960, y: 500 });
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, 400);
  await expect.poll(thumbTop).toBeGreaterThan(0);
  const afterWheel = await thumbTop();

  // The keyboard: PageDown moves further, Home returns, End reaches the bottom where the link is.
  await page.locator('.content-area').click({ position: { x: 5, y: 5 } }); // focus the page, not the address bar
  await page.keyboard.press('PageDown');
  await expect.poll(thumbTop).toBeGreaterThan(afterWheel);
  await page.keyboard.press('Home');
  await expect.poll(thumbTop).toBe(0);
  await page.keyboard.press('End');
  await expect.poll(redPixels, { timeout: 15_000 }).toBeGreaterThan(50_000);

  // Clicks land on what is shown: the link, at the bottom of the page, is found by a right-click there.
  const onLink = await pagePointToClient(page, { x: 400, y: 1000 });
  await page.mouse.click(onLink.x, onLink.y, { button: 'right' });
  await expect(menu.getByText('Open link in new tab', { exact: true })).toBeVisible(); // found at its scrolled position
  await expect(menu.getByText(/^Search Nova for “Read about quasars”/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // The scrollbar: dragging the thumb to the middle of the track.
  const box = (await thumb.boundingBox())!;
  const track = (await page.locator('.nova-page-scrollbar').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, track.y + track.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(thumbTop).toBeLessThan(80);
  expect(await thumbTop()).toBeGreaterThan(20);

  // Back / Forward return to the same place.
  await page.keyboard.press('End');
  await expect.poll(redPixels).toBeGreaterThan(50_000);
  const bottom = await thumbTop();
  await openPage(page, `${site.origin}/quasar`);
  await expect(thumb).toBeHidden(); // a short page: no scrollbar
  await rightClickPage(page, EMPTY_AT);
  await menu.getByText('Back', { exact: true }).click();
  await expect(omnibox(page)).toHaveValue(`${site.origin}/tall`, { timeout: 30_000 });
  await expect(thumb).toBeVisible({ timeout: 30_000 });
  await expect.poll(redPixels, { timeout: 15_000 }).toBeGreaterThan(50_000); // still at the bottom, not back at the top
  expect(Math.abs((await thumbTop()) - bottom)).toBeLessThan(1);
});

test('Ctrl+F scrolls to a match below the fold, and a drag held at the bottom edge scrolls and keeps selecting', async () => {
  test.setTimeout(240_000);
  nova = await launchNova(profile);
  const { page } = nova;
  const thumb = page.locator('.nova-page-scrollbar-thumb');
  const thumbTop = async (): Promise<number> => parseFloat((await thumb.evaluate((el) => (el as HTMLElement).style.top)) || '0');
  await openPage(page, `${site.origin}/tall`); // the only text besides the heading is "Read about quasars", 3,000 px down
  await expect(thumb).toBeVisible();
  expect(await thumbTop()).toBe(0);

  // Find: a new query scrolls to its match; scrolling away is not undone by the re-search that follows; Enter steps back to it.
  await page.keyboard.press('Control+f');
  const find = page.locator('.nova-find-bar input[type="search"]');
  await find.fill('quasars');
  await expect(page.locator('.nova-find-bar-count')).toContainText(/1\s*(of|\/)\s*1/, { timeout: 15_000 });
  await expect.poll(thumbTop).toBeGreaterThan(50);
  await expect(page.locator('canvas.nova-find-overlay')).toHaveCount(1);
  const middle = await pagePointToClient(page, { x: 960, y: 500 });
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, -5000);
  await expect.poll(thumbTop).toBe(0);
  await page.waitForTimeout(1_000); // longer than the re-search interval
  expect(await thumbTop()).toBe(0);
  await find.press('Enter');
  await expect.poll(thumbTop).toBeGreaterThan(50);
  await find.press('Escape');

  // Drag-select from the heading down to the bottom edge and hold: the page scrolls on its own.
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, -5000);
  await expect.poll(thumbTop).toBe(0);
  const from = await pagePointToClient(page, { x: 20, y: 50 });
  const area = (await page.locator('.content-area').boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 200, area.y + area.height - 6, { steps: 6 });
  await expect.poll(thumbTop, { timeout: 15_000 }).toBeGreaterThan(30); // scrolling by itself, the button still down
  await expect(page.locator('canvas.nova-selection-overlay')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('canvas.nova-selection-overlay')).toHaveCount(1); // the selection stays
});

test('right-clicking a rendered page offers its links, its images and the page itself', async () => {
  test.setTimeout(180_000);
  nova = await launchNova(profile);
  const { app, page } = nova;
  const menu = page.locator('.nova-context-menu');
  const entry = (label: string) => menu.getByText(label, { exact: true });
  const clipboard = () => app.evaluate(({ clipboard: c }) => c.readText());

  await openPage(page, `${site.origin}/links`);

  // A link: its text is searchable, the address copies, and "open in new tab" loads it (the href is relative).
  await rightClickPage(page, LINK_AT);
  await expect(menu).toBeVisible();
  await expect(entry('Search Nova for “Read about quasars”')).toBeVisible();
  await expect(entry('Ask Nova AI about “Read about quasars”')).toBeVisible();
  await entry('Copy link address').click();
  await expect.poll(clipboard).toBe(`${site.origin}/quasar`);

  await rightClickPage(page, LINK_AT);
  await entry('Open link in new tab').click();
  await expect(page.locator('.nova-tab')).toHaveCount(2);
  await expect(omnibox(page)).toHaveValue(`${site.origin}/quasar`, { timeout: 30_000 });
  await expect(page.locator('.content-area canvas').first()).toBeVisible({ timeout: 45_000 });

  // An image on a local address: it can be opened and copied, but no outside service could fetch it.
  await openPage(page, `${site.origin}/links`);
  await rightClickPage(page, IMAGE_AT);
  await expect(entry('Open image in new tab')).toBeVisible();
  await expect(entry('Search the web for this image').locator('..')).toHaveCSS('pointer-events', 'none');
  await entry('Copy image address').click();
  await expect.poll(clipboard).toBe(`${site.origin}/pixel.png`);

  // The page itself: navigation and find.
  await rightClickPage(page, EMPTY_AT);
  await expect(entry('Reload')).toBeVisible();
  await expect(entry('Copy page address')).toBeVisible();
  await entry('Find in page…').click();
  await expect(page.locator('.nova-find-bar')).toBeVisible();
});
