import { afterEach, describe, expect, it } from 'vitest';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';

/**
 * On the user's OPD2305 tablet (1.19) the WebView is ~1070 CSS px wide, so the page took the
 * desktop layout (innerWidth >= 768): its status strip ("Ready · 0 blocked · HTTPS · Secure ·
 * 100%") showed above Nova's native bottom bar, and the desktop side column left a white band.
 * Inside the Android app (hideChromeUI) only the content area may show, at any width.
 */
describe('BrowserWindowPage in the Android app on a tablet-width screen', () => {
  const realWidth = window.innerWidth;
  afterEach(() => { Object.defineProperty(window, 'innerWidth', { value: realWidth, configurable: true }); });

  const visibleChrome = async (hideChromeUI: boolean) => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const page = new BrowserWindowPage({ hideChromeUI });
    await page.mount(host);
    const shown = [...host.querySelectorAll<HTMLElement>('*')]
      .filter((el) => /status|toolbar|tab-?bar|bookmark|sidebar|title-?bar|bottom-?nav/i.test(el.className))
      .filter((el) => {
        for (let n: HTMLElement | null = el; n && n !== host; n = n.parentElement) if (n.style.display === 'none') return false;
        return true;
      })
      .map((el) => el.className);
    await page.unmount?.();
    host.remove();
    return shown;
  };

  it('shows no web chrome (status bar, toolbars, sidebar) around the page', async () => {
    expect(await visibleChrome(true)).toEqual([]);
  });

  it('the desktop web build still shows its chrome at that width', async () => {
    expect((await visibleChrome(false)).length).toBeGreaterThan(0);
  });
});
