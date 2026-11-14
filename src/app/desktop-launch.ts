/**
 * Addresses handed to the desktop app from outside: the one it was started with (`Nova Browser.exe https://...`) and
 * those of later launches, which the main process forwards to the running window instead of starting a second app.
 * The preload exposes them as `window.nova.app` (electron/preload.cjs); each opens in a new tab.
 */
interface LaunchBridge {
  takeLaunchUrl(): Promise<string | null>;
  onOpenUrl(handler: (url: string) => void): () => void;
}

/** Only web and built-in pages: whatever else arrives (a script, a file path) is ignored, as in the main process. */
const OPENABLE = /^(https?:\/\/|nova:\/\/|about:newtab$)/i;

/** Returns a function that stops listening. Without the bridge (the web build, Android) it does nothing. */
export function installDesktopLaunchUrls(
  open: (url: string) => void,
  bridge: LaunchBridge | undefined = (globalThis as { nova?: { app?: LaunchBridge } }).nova?.app,
): () => void {
  if (!bridge) return () => undefined;
  const openChecked = (url: unknown): void => {
    if (typeof url === 'string' && OPENABLE.test(url)) open(url);
  };
  const stop = bridge.onOpenUrl(openChecked);
  bridge.takeLaunchUrl().then(openChecked, () => undefined);
  return stop;
}
