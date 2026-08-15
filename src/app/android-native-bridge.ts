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
//                  called on every tab/nav change (ChromeStateSnapshot JSON),
//                  plus onBookmarksChanged/onHistoryChanged/onDownloadRequested.
//   Kotlin -> JS:  window.novaNative.navigate/back/forward/reload/stop/
//                  createTab/closeTab/activateTab(...), called via
//                  webView.evaluateJavascript(...) from BrowserViewModel.
// ─────────────────────────────────────────────────────────────────────────────

import type { IBrowserWindowPage } from '../ui/pages/browser-window';

interface NovaStateBridgeHost {
  onStateChanged(json: string): void;
  onBookmarksChanged(json: string): void;
  onHistoryChanged(json: string): void;
  onDownloadRequested(json: string): void;
  onContextMenuRequested(json: string): void;
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
      /** Ask the native host to start a download. `optionsJson` is optional: `{filename?, mimeType?, referrer?}`. */
      download: (url: string, optionsJson?: string) => void;
      /** Open a URL in a fresh engine tab (used by context-menu / target=_blank flows). */
      openInNewTab: (url: string) => void;
      /** Toggle the engine's incognito (private browsing) session. */
      setIncognito: (enabled: boolean) => void;
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
    download: (url: string, optionsJson?: string) => {
      let options: Record<string, unknown> = {};
      if (optionsJson) {
        try { options = JSON.parse(optionsJson) as Record<string, unknown>; } catch { options = {}; }
      }
      window.NovaStateBridge?.onDownloadRequested(JSON.stringify({
        url,
        filename: options.filename ?? null,
        mimeType: options.mimeType ?? null,
        referrer: options.referrer ?? null,
      }));
    },
    openInNewTab: (url: string) => {
      page.createTab(url);
    },
    setIncognito: (enabled: boolean) => {
      page.setIncognitoExternal(enabled);
    },
  };

  wireContextMenuDetection(page);

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

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT-MENU (LONG-PRESS) DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/** Long-press dwell before a context menu is requested (ms). */
const LONG_PRESS_DELAY_MS = 550;

/** The most recently installed page that document-level context-menu listeners delegate to. */
let activeContextPage: IBrowserWindowPage | null = null;
/** Guards against installing the document listeners more than once (test installs, HMR). */
let contextMenuWired = false;

/**
 * Drives a native context menu from long-presses on the engine's content area.
 * The engine renders page content to a canvas, so the WebView's own
 * HitTestResult never sees page links/images — the engine must resolve the
 * element under the pointer itself (page.resolveContextTarget → layout
 * engine hit-test) and push the result to the native host.
 *
 * Reacts to the DOM `contextmenu` event where the platform fires it, and
 * falls back to explicit pointer-down dwell detection for engines (Chrome for
 * Android) that only fire it on selectable content.
 */
function wireContextMenuDetection(page: IBrowserWindowPage): void {
  activeContextPage = page;
  if (contextMenuWired) return;
  contextMenuWired = true;

  let pressTimer = 0;
  let pressX = 0;
  let pressY = 0;
  /** Set when a dwell already opened a menu; swallows the click released on top of it. */
  let suppressNextClick = false;

  const cancelPress = (): void => {
    window.clearTimeout(pressTimer);
    pressTimer = 0;
  };

  const requestContextMenu = (x: number, y: number): void => {
    cancelPress();
    suppressNextClick = true;
    const page = activeContextPage;
    if (!page) return;
    let target: ReturnType<IBrowserWindowPage['resolveContextTarget']>;
    try {
      target = page.resolveContextTarget(x, y);
    } catch (err) {
      console.error('[AndroidNativeBridge] resolveContextTarget failed:', err);
      target = null;
    }
    const state = page.getChromeState();
    try {
      window.NovaStateBridge?.onContextMenuRequested(JSON.stringify({
        x,
        y,
        pageUrl: state.addressValue,
        pageTitle: state.activeTabId
          ? (state.tabs.find((t) => t.id === state.activeTabId)?.title ?? '') : '',
        linkUrl: target?.linkUrl ?? null,
        linkText: target?.linkText ?? null,
        imageUrl: target?.imageUrl ?? null,
        imageAlt: target?.imageAlt ?? null,
      }));
    } catch (err) {
      console.error('[AndroidNativeBridge] Failed to push context menu to native host:', err);
    }
  };

  const onContextMenuEvent = (e: Event): void => {
    e.preventDefault();
    const mouse = e as MouseEvent;
    requestContextMenu(mouse.clientX, mouse.clientY);
  };

  const onPointerDown = (e: PointerEvent): void => {
    pressX = e.clientX;
    pressY = e.clientY;
    cancelPress();
    pressTimer = window.setTimeout(() => {
      requestContextMenu(pressX, pressY);
    }, LONG_PRESS_DELAY_MS);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (pressTimer === 0) return;
    if (Math.abs(e.clientX - pressX) > 12 || Math.abs(e.clientY - pressY) > 12) {
      cancelPress();
    }
  };

  const onPointerEnd = (): void => cancelPress();

  const onClick = (e: Event): void => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  document.addEventListener('contextmenu', onContextMenuEvent, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  document.addEventListener('click', onClick, true);
}
