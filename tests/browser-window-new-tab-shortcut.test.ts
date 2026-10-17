import { describe, it, expect, afterEach } from 'vitest';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import type { IBrowserWindowPage } from '../src/ui/pages/browser-window';

describe('BrowserWindowPage — Ctrl+T new tab shortcut', () => {
  let container: HTMLElement;
  let page: IBrowserWindowPage;

  afterEach(async () => {
    await page?.unmount?.();
    container.remove();
  });

  it('Ctrl+T opens and activates a new tab', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);

    const before = page.getChromeState().tabs.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true }));
    const state = page.getChromeState();

    expect(state.tabs.length).toBe(before + 1);
    expect(state.tabs.find((t) => t.active)?.id).toBe(state.activeTabId);
  });

  it('does not open a tab for an unrelated Ctrl+ shortcut', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(container);

    const before = page.getChromeState().tabs.length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }));

    expect(page.getChromeState().tabs.length).toBe(before);
  });
});
