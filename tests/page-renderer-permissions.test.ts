/**
 * Real-pipeline coverage for the permission-gated Web APIs — previously
 * completely unreachable from page scripts (no navigator.geolocation,
 * window.Notification, or navigator.clipboard bindings existed at all).
 * No mocks of the engine itself: a real PageRenderer renders real HTML+
 * <script>, and only the host-side "show a UI prompt" callback is faked,
 * exactly the one seam that's supposed to be engine-supplied.
 */
import { describe, it, expect } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { ResourceLoader } from '../src/browser/networking/resource-loader';
import { ResourcePrioritizer } from '../src/browser/networking/resource-prioritizer';
import type { PermissionName } from '../src/browser/web-apis/web-apis-permissions';

function makeRenderer(onPermissionRequest?: (origin: string, name: PermissionName) => Promise<'granted' | 'denied'>) {
  return new PageRenderer({
    htmlParser: new HtmlParser(),
    domTree: new DomTree(),
    cssParser: new CssParser(),
    layoutEngine: new LayoutEngine(),
    paintEngine: new PaintEngine(),
    resourceLoader: new ResourceLoader(),
    prioritizer: new ResourcePrioritizer(),
    onPermissionRequest,
  });
}

async function render(renderer: PageRenderer, body: string, url = 'https://example.test/'): Promise<void> {
  await renderer.render({
    url, statusCode: 200, contentType: 'text/html', body,
    headers: new Map(), loadedAt: Date.now(),
  }, new AbortController().signal);
}

// The permission grant/deny decision and the geolocation position fetch each
// resolve via a real await inside PermissionStore/GeolocationAPI — neither
// goes through the interpreter's own synthetic event loop, so the resulting
// DOM mutation lands on a later real microtask/macrotask than render()'s own
// return. A macrotask flush guarantees every pending microtask has run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function textOf(renderer: PageRenderer, id: string): string {
  const el = renderer.getDomTree()!.getElementById(id);
  return (el?.children.find((c) => c.nodeType === 'text') as { text?: string } | undefined)?.text ?? '';
}

describe('PageRenderer — permission-gated Web APIs (real pipeline, no mocks)', () => {
  it('navigator.geolocation.getCurrentPosition prompts, and on "granted" returns the default position', async () => {
    const renderer = makeRenderer(async () => 'granted');
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          navigator.geolocation.getCurrentPosition(function(pos) {
            document.getElementById('log').textContent = 'ok:' + pos.coords.latitude + ',' + pos.coords.longitude;
          }, function(err) {
            document.getElementById('log').textContent = 'err:' + err.code;
          });
        </script>
      </body></html>
    `);

    await flush();

    expect(textOf(renderer, 'log')).toBe('ok:37.7749,-122.4194');
  });

  it('navigator.geolocation.getCurrentPosition calls the error callback with PERMISSION_DENIED when the user blocks', async () => {
    const renderer = makeRenderer(async () => 'denied');
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          navigator.geolocation.getCurrentPosition(function(pos) {
            document.getElementById('log').textContent = 'ok';
          }, function(err) {
            document.getElementById('log').textContent = 'err:' + err.code;
          });
        </script>
      </body></html>
    `);

    await flush();

    expect(textOf(renderer, 'log')).toBe('err:1'); // PERMISSION_DENIED
  });

  it('Notification.requestPermission() resolves with the real decision and Notification.permission reflects it afterward', async () => {
    const renderer = makeRenderer(async () => 'granted');
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          Notification.requestPermission().then(function(perm) {
            document.getElementById('log').textContent = perm + ':' + Notification.permission;
          });
        </script>
      </body></html>
    `);

    await flush();

    expect(textOf(renderer, 'log')).toBe('granted:granted');
  });

  it('creating a Notification after permission is denied throws (matches the facade\'s spec-accurate behavior)', async () => {
    const renderer = makeRenderer(async () => 'denied');
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          Notification.requestPermission().then(function() {
            try {
              new Notification('hi');
              document.getElementById('log').textContent = 'no-throw';
            } catch (e) {
              document.getElementById('log').textContent = 'threw:' + e.message;
            }
          });
        </script>
      </body></html>
    `);

    await flush();

    expect(textOf(renderer, 'log')).toBe('threw:Notification permission has been denied');
  });

  it('navigator.clipboard.writeText resolves through the same permission flow (a real bridged Promise, not a callback)', async () => {
    const renderer = makeRenderer(async () => 'granted');
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          navigator.clipboard.writeText('hello').then(function() {
            document.getElementById('log').textContent = 'wrote';
          }, function(err) {
            document.getElementById('log').textContent = 'failed:' + err.message;
          });
        </script>
      </body></html>
    `);

    await flush();

    expect(textOf(renderer, 'log')).toBe('wrote');
  });

  it('navigator.clipboard.writeText rejects when the user blocks', async () => {
    const renderer = makeRenderer(async () => 'denied');
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          navigator.clipboard.writeText('hello').then(function() {
            document.getElementById('log').textContent = 'wrote';
          }, function(err) {
            document.getElementById('log').textContent = 'failed:' + err.message;
          });
        </script>
      </body></html>
    `);

    await flush();

    expect(textOf(renderer, 'log')).toBe('failed:Clipboard write permission denied');
  });

  it('an unwired renderer (no onPermissionRequest) denies by default instead of silently granting', async () => {
    const renderer = makeRenderer(); // no onPermissionRequest at all
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          navigator.geolocation.getCurrentPosition(function(pos) {
            document.getElementById('log').textContent = 'granted';
          }, function(err) {
            document.getElementById('log').textContent = 'denied:' + err.code;
          });
        </script>
      </body></html>
    `);

    await flush();

    expect(textOf(renderer, 'log')).toBe('denied:1');
  });
});
