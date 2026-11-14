/**
 * 2.17 (Windows app, phase 0): addresses handed to the desktop app (a command-line argument, a second launch)
 * open in a tab; anything that is not a web or built-in address is ignored.
 */
import { describe, expect, it, vi } from 'vitest';
import { installDesktopLaunchUrls } from '../src/app/desktop-launch';

function bridge(launch: string | null) {
  let handler: ((url: string) => void) | null = null;
  const stop = vi.fn();
  return {
    api: { takeLaunchUrl: vi.fn(async () => launch), onOpenUrl: vi.fn((h: (url: string) => void) => { handler = h; return stop; }) },
    send: (url: string) => handler?.(url),
    stop,
  };
}

describe('desktop launch addresses', () => {
  it('opens the address the app was started with, then those of later launches', async () => {
    const b = bridge('https://example.com/a');
    const open = vi.fn();
    installDesktopLaunchUrls(open, b.api);
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith('https://example.com/a');
    b.send('nova://settings');
    expect(open).toHaveBeenLastCalledWith('nova://settings');
  });

  it('ignores scripts, file paths and anything else', async () => {
    const b = bridge('javascript:alert(1)');
    const open = vi.fn();
    installDesktopLaunchUrls(open, b.api);
    await Promise.resolve();
    b.send('file:///C:/Windows/win.ini');
    b.send('data:text/html,<script>1</script>');
    expect(open).not.toHaveBeenCalled();
  });

  it('opens nothing when the app was started without an address', async () => {
    const b = bridge(null);
    const open = vi.fn();
    installDesktopLaunchUrls(open, b.api);
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
  });

  it('stops listening when asked, and does nothing without the bridge', () => {
    const b = bridge(null);
    installDesktopLaunchUrls(vi.fn(), b.api)();
    expect(b.stop).toHaveBeenCalled();
    expect(() => installDesktopLaunchUrls(vi.fn(), undefined)()).not.toThrow();
  });
});
