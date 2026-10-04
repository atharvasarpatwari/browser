import { _electron as electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Helpers for driving the real Nova Browser (Electron) from Playwright: a throw-away profile, a tiny local
 * web site to browse, and the omnibox. Run from the repository root (`npx playwright test --config=playwright-electron.config.cjs`),
 * after `npm run build:web` — the main process loads `dist/index.html`.
 */

/** A 1×1 red PNG. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64',
);

const html = (title: string, body: string, head = ''): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><h1>${title}</h1>${body}</body></html>`;

const QUASAR_TEXT = 'The quasar is a luminous galactic nucleus powered by a supermassive black hole at the centre of a distant galaxy. ';

interface TestSite {
  /** `http://127.0.0.1:<port>` — an IP literal: the machine's resolver can time out on `localhost`. */
  readonly origin: string;
  /** Every request path the site received, in order. */
  readonly hits: string[];
  close(): Promise<void>;
}

/** A local web site: an article, a page advertising an OpenSearch engine (+ descriptor + results), and a page with a link and an image. */
async function startTestSite(): Promise<TestSite> {
  const hits: string[] = [];
  let origin = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    hits.push(url.pathname);
    const send = (type: string, body: string | Buffer): void => {
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(body);
    };
    switch (url.pathname) {
      case '/quasar':
        return send('text/html; charset=utf-8', html('Quasar notes', `<p>${QUASAR_TEXT.repeat(12)}</p>`));
      case '/engine':
        return send('text/html; charset=utf-8', html('Test Site', `<p>${QUASAR_TEXT.repeat(8)}</p>`,
          '<link rel="search" type="application/opensearchdescription+xml" href="/opensearch.xml" title="Test Site">'));
      case '/opensearch.xml':
        return send('application/opensearchdescription+xml', '<?xml version="1.0"?>'
          + '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>Test Site</ShortName>'
          + `<Url type="text/html" method="get" template="${origin}/find?q={searchTerms}"/></OpenSearchDescription>`);
      case '/find': {
        const q = url.searchParams.get('q') ?? '';
        return send('text/html; charset=utf-8', html(`Results for ${q}`, `<p>You searched for ${q}.</p>`));
      }
      case '/links': // big blocks below a spacer, in normal flow: roughly where they land is known (see LINK_AT / IMAGE_AT)
        return send('text/html; charset=utf-8', html('Links and images',
          '<div style="height:300px">spacer</div>'
          + '<a href="/quasar" style="display:block;height:200px">Read about quasars</a>'
          + '<img src="/pixel.png" alt="a red pixel" style="display:block;width:300px;height:300px">'));
      case '/pixel.png':
        return send('image/png', PIXEL_PNG);
      default:
        res.writeHead(404, { 'content-type': 'text/plain' });
        return void res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    hits,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

interface NovaApp {
  readonly app: ElectronApplication;
  readonly page: Page;
}

/**
 * Starts Nova with its profile in `userDataDir` (reuse the directory to simulate a restart). The profile is made
 * hermetic: online search suggestions are switched off, so typing in the address bar never queries the network —
 * their late arrival re-rendered the dropdown in the middle of a test (hover state lost) and sent the typed text out.
 */
async function launchNova(userDataDir: string): Promise<NovaApp> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: process.cwd(),
    env: { ...process.env, NOVA_HEALTH_LOG: '0' }, // keep nova-health.log out of the working tree
  });
  const page = await app.firstWindow();
  await expect(page.locator('#browser-app')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.nova-addressbar-input')).toBeVisible({ timeout: 45_000 });
  const changed = await page.evaluate(() => { // the settings service reads localStorage once, at start-up: reload to apply
    const settings = JSON.parse(localStorage.getItem('nova-settings') ?? '{}') as Record<string, unknown>;
    if (settings.enableSearchSuggestions === false) return false;
    settings.enableSearchSuggestions = false;
    localStorage.setItem('nova-settings', JSON.stringify(settings));
    return true;
  });
  if (changed) {
    await page.reload();
    await expect(page.locator('.nova-addressbar-input')).toBeVisible({ timeout: 45_000 });
  }
  return { app, page };
}

const omnibox = (page: Page) => page.locator('.nova-addressbar-input');
const dropdown = (page: Page) => page.locator('.nova-dropdown');

/**
 * Types into the address bar like a user (focus, replace, input event) and gives the dropdown a moment to appear.
 * Some input has no rows at all (a built-in address such as `nova://settings`), so a missing dropdown is not an error —
 * tests that expect rows assert on them themselves.
 */
async function typeInOmnibox(page: Page, text: string): Promise<void> {
  const input = omnibox(page);
  await input.click();
  await input.fill(text);
  await dropdown(page).waitFor({ state: 'visible', timeout: 4_000 }).catch(() => undefined);
}

/** Types `text` and presses Enter. */
async function submitInOmnibox(page: Page, text: string): Promise<void> {
  await typeInOmnibox(page, text);
  await omnibox(page).press('Enter');
}

/**
 * Page-bitmap coordinates (CSS px of the 1920-wide page) inside the `/links` page's link block and image: the heading
 * and the 300 px spacer put the link at about y 390–590 and the image at about 590–890 (generous: ±60 px of slack).
 */
const LINK_AT = { x: 400, y: 490 };
const IMAGE_AT = { x: 150, y: 740 };
/** A page point nothing is at. */
const EMPTY_AT = { x: 1500, y: 900 };

/**
 * Where a point of the page bitmap lands in the window: the bitmap is scaled into the content area with
 * `object-fit: contain`, so this applies the same letterbox transform the app uses (in reverse).
 */
async function pagePointToClient(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const canvas = page.locator('.content-area canvas').first();
  const box = (await canvas.boundingBox())!;
  const frame = await canvas.evaluate((c: HTMLCanvasElement) => ({ width: c.width, height: c.height }));
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  return {
    x: box.x + (box.width - frame.width * scale) / 2 + point.x * scale,
    y: box.y + (box.height - frame.height * scale) / 2 + point.y * scale,
  };
}

/** Right-clicks a point of the page bitmap. */
async function rightClickPage(page: Page, point: { x: number; y: number }): Promise<void> {
  const at = await pagePointToClient(page, point);
  await page.mouse.click(at.x, at.y, { button: 'right' });
}

/** One thing Chromium's host resolver did, from a net log: a request for `host`, or the job that really asks the DNS server. */
interface ResolverEvent {
  readonly at: number; // epoch milliseconds, comparable with `Date.now()` / `performance.timeOrigin + performance.now()`
  readonly kind: 'request' | 'job';
  readonly host: string; // as the resolver keys it: `https://www.example.net`
  readonly speculative: boolean;
}

/**
 * The resolver activity in a net log written by `netLog.startLogging(file)` (call `netLog.stopLogging()` first). A page
 * load that finds its host already in the resolver's cache makes a request but no job; a cold one makes both.
 */
function readResolverEvents(logFile: string): ResolverEvent[] {
  const log = JSON.parse(fs.readFileSync(logFile, 'utf8')) as {
    constants: { logEventTypes: Record<string, number>; timeTickOffset: string | number };
    events: Array<{ phase: number; time: string; type: number; params?: { host?: string; is_speculative?: boolean } }>;
  };
  const request = log.constants.logEventTypes.HOST_RESOLVER_MANAGER_REQUEST;
  const job = log.constants.logEventTypes.HOST_RESOLVER_MANAGER_JOB;
  const BEGIN = 1;
  return log.events
    .filter((e) => e.phase === BEGIN && (e.type === request || e.type === job))
    .map((e) => ({
      at: Number(log.constants.timeTickOffset) + Number(e.time),
      kind: e.type === request ? 'request' as const : 'job' as const,
      host: e.params?.host ?? '',
      speculative: e.params?.is_speculative === true,
    }));
}

/** Opens `url` through the address bar and waits until the engine has painted it. */
async function openPage(page: Page, url: string): Promise<void> {
  await submitInOmnibox(page, url);
  await expect(page.locator('.content-area canvas').first()).toBeVisible({ timeout: 45_000 });
  await expect(omnibox(page)).toHaveValue(url, { timeout: 15_000 });
}

export {
  startTestSite, launchNova, omnibox, dropdown, typeInOmnibox, submitInOmnibox, openPage, readResolverEvents,
  LINK_AT, IMAGE_AT, EMPTY_AT, pagePointToClient, rightClickPage,
};
export type { TestSite, NovaApp, ResolverEvent };
