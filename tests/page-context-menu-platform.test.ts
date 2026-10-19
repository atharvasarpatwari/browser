import { describe, it, expect } from 'vitest';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';

/**
 * The engine paints pages to a canvas, so a right-click there is handled by
 * PageContextMenuController. Android has its own native long-press sheet
 * (android-native-bridge.ts), so the DOM menu must stay out of the way there.
 */
describe('BrowserWindowPage — page context menu per platform', () => {
  it('hideChromeUI leaves the desktop DOM page menu unattached, so a long-press only reaches the native sheet', async () => {
    const openMenus = async (hideChromeUI: boolean): Promise<number> => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const page = new BrowserWindowPage({ hideChromeUI });
      await page.mount(host);
      // Desktop layout: .content-area; the Android app (hideChromeUI) always uses the mobile layout's .mobile-content.
      const area = host.querySelector('.content-area, .mobile-content') as HTMLElement;
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 400;
      area.appendChild(canvas);
      canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      const count = document.querySelectorAll('.nova-context-menu').length;
      await page.unmount?.();
      host.remove();
      document.querySelectorAll('.nova-context-menu').forEach((el) => el.remove());
      return count;
    };

    expect(await openMenus(false)).toBe(1); // desktop still gets its right-click menu
    expect(await openMenus(true)).toBe(0);  // Android: native sheet only
  });

});
