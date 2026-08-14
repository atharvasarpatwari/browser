// ─────────────────────────────────────────────────────────────────────────────
// ANDROID NATIVE BRIDGE
//
// When Nova runs inside the Android app's WebView, Kotlin registers a
// @JavascriptInterface object named `NovaStateBridge` on the WebView BEFORE
// loading this page (see NovaStateBridge.kt / MainActivity.kt). Its presence
// is the signal that a native chrome (Compose address bar / tab strip) is in
// control and this page's own chrome should stay hidden.
//
// Two-way contract:
//   JS  -> Kotlin: window.NovaStateBridge.onStateChanged(jsonString)
//                  called on every tab/nav change (ChromeStateSnapshot JSON).
//   Kotlin -> JS:  window.novaNative.navigate/back/forward/reload/stop/
//                  createTab/closeTab/activateTab(...), called via
//                  webView.evaluateJavascript(...) from BrowserViewModel.
// ─────────────────────────────────────────────────────────────────────────────

import type { IBrowserWindowPage } from '../ui/pages/browser-window';

interface NovaStateBridgeHost {
  onStateChanged(json: string): void;
  onBookmarksChanged(json: string): void;
  onHistoryChanged(json: string): void;
}

declare global {
  interface Window {
    NovaStateBridge?: NovaStateBridgeHost;
    novaNative?: {
      navigate: (url: string) => void;
      back: () => void;
      forward: () => void;
      reload: () => void;
      stop: () => void;
      createTab: (url?: string) => string;
      closeTab: (tabId: string) => boolean;
      activateTab: (tabId: string) => boolean;
      getState: () => string;
      addBookmark: (title: string, url: string) => void;
      removeBookmark: (id: string) => void;
      refreshBookmarks: () => void;
      removeHistoryEntry: (id: string) => void;
      clearHistory: () => void;
      refreshHistory: () => void;
    };
  }
}

/** True when a native Android host has registered its JS interface on this WebView. */
export function isNativeHostPresent(): boolean {
  return typeof window !== 'undefined' && typeof window.NovaStateBridge !== 'undefined';
}

/**
 * Wires window.novaNative to the given page and starts pushing state-change
 * snapshots to the native host. No-ops (and logs once) if no native host is
 * present, so it's always safe to call from mountBrowserUI().
 */
export function installAndroidNativeBridge(page: IBrowserWindowPage): void {
  if (!isNativeHostPresent()) return;

  window.novaNative = {
    navigate: (url: string) => { void page.navigate(url); },
    back: () => page.goBack(),
    forward: () => page.goForward(),
    reload: () => page.reload(),
    stop: () => page.stop(),
    createTab: (url?: string) => page.createTab(url),
    closeTab: (tabId: string) => page.closeTab(tabId),
    activateTab: (tabId: string) => page.activateTabExternal(tabId),
    getState: () => JSON.stringify(page.getChromeState()),
    addBookmark: (title: string, url: string) => { void page.addBookmarkExternal(title, url); },
    removeBookmark: (id: string) => { void page.removeBookmarkExternal(id); },
    refreshBookmarks: () => { void pushBookmarks(); },
    removeHistoryEntry: (id: string) => { void page.removeHistoryEntryExternal(id); },
    clearHistory: () => { void page.clearHistoryExternal(); },
    refreshHistory: () => { void pushHistory(); },
  };

  const pushBookmarks = async (): Promise<void> => {
    try {
      const list = await page.listBookmarksExternal();
      window.NovaStateBridge?.onBookmarksChanged(JSON.stringify(list));
    } catch (err) {
      console.error('[AndroidNativeBridge] Failed to push bookmarks to native host:', err);
    }
  };

  const pushHistory = async (): Promise<void> => {
    try {
      const list = await page.listHistoryExternal();
      window.NovaStateBridge?.onHistoryChanged(JSON.stringify(list));
    } catch (err) {
      console.error('[AndroidNativeBridge] Failed to push history to native host:', err);
    }
  };

  page.onLibraryChanged(() => {
    void pushBookmarks();
    void pushHistory();
  });
  void pushBookmarks();
  void pushHistory();

  page.onChromeState((snapshot) => {
    try {
      window.NovaStateBridge?.onStateChanged(JSON.stringify(snapshot));
    } catch (err) {
      console.error('[AndroidNativeBridge] Failed to push state to native host:', err);
    }
  });

  // Push the initial state immediately so native chrome doesn't wait for the
  // first navigation to know about the initial tab.
  try {
    window.NovaStateBridge?.onStateChanged(JSON.stringify(page.getChromeState()));
  } catch (err) {
    console.error('[AndroidNativeBridge] Failed to push initial state to native host:', err);
  }

  console.log('[AndroidNativeBridge] Native host detected — window.novaNative installed, chrome UI hidden.');
}
