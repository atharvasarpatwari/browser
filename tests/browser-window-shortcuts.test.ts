import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import type { IBrowserWindowPage } from '../src/ui/pages/browser-window';

function keydown(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('BrowserWindowPage — keyboard shortcuts', () => {
  let container: HTMLElement;
  let page: IBrowserWindowPage;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await page?.unmount?.();
    container.remove();
  });

  it('Ctrl+1..9 activate tabs by position, with Ctrl+9 always selecting the last tab', async () => {
    page = new BrowserWindowPage({ forceDesktopChrome: true });
    await page.mount(container);
    page.createTab('nova://newtab');
    page.createTab('nova://newtab');
    page.createTab('nova://newtab');
    expect(page.getChromeState().tabs).toHaveLength(4);

    keydown({ key: '2', ctrlKey: true });
    expect(page.getChromeState().tabs[1]!.active).toBe(true);

    keydown({ key: '9', ctrlKey: true });
    expect(page.getChromeState().tabs[3]!.active).toBe(true);
  });

  it('Ctrl+Shift+T reopens the most recently closed tab', async () => {
    page = new BrowserWindowPage({ forceDesktopChrome: true });
    await page.mount(container);
    page.createTab('nova://settings');
    expect(page.getChromeState().tabs.some((t) => t.url === 'nova://settings')).toBe(true);

    keydown({ key: 'w', ctrlKey: true });
    expect(page.getChromeState().tabs.some((t) => t.url === 'nova://settings')).toBe(false);

    keydown({ key: 't', ctrlKey: true, shiftKey: true });
    expect(page.getChromeState().tabs.some((t) => t.url === 'nova://settings')).toBe(true);
  });

  it('Ctrl+Shift+T with no closed-tab history is a no-op', async () => {
    page = new BrowserWindowPage({ forceDesktopChrome: true });
    await page.mount(container);
    const before = page.getChromeState().tabs.length;

    keydown({ key: 't', ctrlKey: true, shiftKey: true });

    expect(page.getChromeState().tabs.length).toBe(before);
  });

  it('Ctrl+W never closes the last tab — a fresh one replaces it instead', async () => {
    page = new BrowserWindowPage({ forceDesktopChrome: true });
    await page.mount(container);
    expect(page.getChromeState().tabs).toHaveLength(1);

    keydown({ key: 'w', ctrlKey: true });

    expect(page.getChromeState().tabs).toHaveLength(1);
  });
});
