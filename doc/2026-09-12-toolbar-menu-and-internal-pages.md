# Toolbar Buttons, Main Menu, and Internal Pages — Making It Behave Like a Real Browser

**Date:** 2026-09-12
**Session:** User asked directly to "add buttons and functionalities... make it look like a real browser." Investigated the toolbar and found its buttons were rendered but non-functional, and that fixing that surfaced a second, deeper bug affecting every internal `nova://` page.
**Status:** Completed

---

## Summary
Two compounding, previously-undiscovered bugs meant the toolbar's Back/Forward/Reload/Shield/Bookmark buttons did nothing when clicked, and every internal page (Settings, History, Bookmarks, Downloads) rendered blank or got silently clobbered by the page-rendering engine. Fixed both, and added the two things a real browser's chrome has that Nova's didn't: a working hamburger menu (New Tab, Bookmarks, History, Downloads, AI Research, Settings) and a Home button — both using the already-existing, already-working internal pages once the render-clobbering bug was fixed.

## Root Causes
1. **`ToolbarView.setEventHandler()` was never called.** Every toolbar button (`toolbar.view.ts`) dispatches through a private `dispatchEvent()` that only calls `this.eventHandler?.(event)` — and nothing in `browser-window.ts` ever registered that handler. Every click on Back, Forward, Reload, the Shield icon, or the Bookmark star was a complete no-op; only the address bar's own keyboard-shortcut wiring (`onBack`/`onForward`/etc.) and the status bar's shield click happened to work, via entirely separate paths. This is the same "view dispatches into a mechanism nothing wires up" shape as most of today's other fixes, just previously undiscovered because nobody had clicked the actual toolbar buttons in a real running app and checked.
2. **`ContentRenderer.renderNewTab()` (called once at mount) is never tracked by `activeContentPanel`.** Every `renderXPanel()` method (`renderSettingsPanel`, `renderHistoryPanel`, `renderBookmarksPanel`, `renderDownloadsPanel`) calls `cleanupContentPanel()`, which only removed `this.activeContentPanel` — a variable the initial new-tab render never set. The new-tab page's DOM sat in `.content-area` as an untracked first child forever; every later special-page render just appended itself as a *second* child underneath it, invisible below the fold. Confirmed via debug instrumentation: `.content-area` had 2 children after navigating to `nova://history`, and the (correctly-rendered) History panel was the second one, hidden by the untouched full-height new-tab page still occupying the viewport.
3. **The address bar's Enter-key path never called `handleContentForUrl()` at all.** Typing a URL and pressing Enter routes through `NavigationBridge`'s own `addressBar.on('navigate', ...)` listener, a completely separate path from `BrowserWindowPage.navigate()` (which menu actions and other programmatic navigation use, and which is the only caller of `handleContentForUrl()` — the method that recognizes `nova://`/`about:` URLs and renders their real panel instead of trying to fetch them as web pages). Typing `nova://settings` directly into the address bar previously never rendered the settings panel by any path.
4. **`NavigationFetcher` unconditionally repaints the content area on every engine event, including for internal pages.** Even after fixing (3), the page-load pipeline still runs for `nova://` URLs (nothing stops it), and its `pageLoadReady`/`pageRepainted`/`navigationStarted`/`pageLoadError` handlers would paint a blank canvas or loading placeholder over whatever `renderSpecialPage()` had just put in the DOM — this is what produced the blank-white-canvas symptom seen before root-causing (2) and (3).
5. **`nova://research` was missing from `url-parser.ts`'s `SPECIAL_PAGES` map**, even though `renderSpecialPage()`'s switch already had a case for it — so the new "AI Research" menu item would have hit the same clobbering bug as the others.
6. **`ContextMenu.hide()` only removed its outside-click listeners when triggered by an actual outside click**, not when a menu item was clicked or `hide()` was called directly. Every menu open leaked two permanent `document`-level listeners (`mousedown`, `contextmenu`) referencing a dead, already-removed menu element. Found because repeatedly opening the new hamburger menu in a test made this a real, observable hang.

## Notes
- The `menuClick` toolbar event already existed in `toolbar.ts` (`showMenu()`) with zero consumers anywhere — it just needed a real button in the view and a real handler. Extended it to carry `x`/`y` (the button's own position) so the dropdown opens right under it, like a real browser's menu.
- Deliberately reused the existing `ContextMenu` component (already used for the tab strip's right-click menu) for the new hamburger menu, rather than building a second dropdown implementation.
- Home button navigates to the existing `homePage` setting (already read by `getHomeUrl()`, previously used only for one native-bridge snapshot field).
- Root cause #2's fix (`cleanupContentPanel()` now does `this.contentArea.innerHTML = ''` as a final catch-all, in addition to the existing per-page-type cleanup calls) is a blunt but correct fix: `.content-area` is meant to hold exactly one renderer's output at a time, and nothing else currently attaches anything else to it directly (the DevTools panel was deliberately moved to a separate `areas.devtools` region earlier today for exactly this reason).
- Root cause #6 (the `ContextMenu` leak) was caught only because the new menu button made repeated real-world opens common enough to actually hang a test — the tab-strip context menu existed before today but is used less frequently, so the leak likely went unnoticed.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/components/toolbar/toolbar.ts` | Added `home` event + `goHome()`; extended `menuClick` to carry `x`/`y`; added `goHome()`/`addBookmark()` to the `IToolbar` interface |
| `src/ui/components/toolbar/toolbar.view.ts` | Added a Home button and a Menu (☰) button, both dispatching real events |
| `src/ui/pages/browser-window.ts` | Wired `toolbarView.setEventHandler()` (the actual fix for root cause #1); added `showMainMenu()`; wired `home`/`menuClick`; `cleanupContentPanel()` now fully clears `.content-area`; `onBridgeUrlNavigated` now also calls `handleContentForUrl()` for special pages |
| `src/ui/components/navigation-fetcher.ts` | Takes an `IUrlParser` and skips all its content-area-painting paths for special pages |
| `src/browser/navigation/url-parser.ts` | Added the missing `nova://research` entry to `SPECIAL_PAGES` |
| `src/ui/components/context-menu/context-menu.ts` | `hide()` now unconditionally removes its close listeners, fixing the leak |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-12-toolbar-menu-and-internal-pages.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9216 tests passed
npx playwright test --config=playwright-electron.config.cjs       → 5/5 passed
  (electron-smoke, fidelity-audit, keep-alive, plus two scratch
   fixtures used to verify this session's fixes, since deleted)
```

## Verification Steps
1. Navigated between two real pages and confirmed the toolbar's Back and Forward buttons actually change the page (previously: no-op).
2. Clicked Home and confirmed it navigates to the configured home page.
3. Clicked the new Menu button, confirmed all six items (New Tab, Bookmarks, History, Downloads, AI Research, Settings) render, and clicking Settings correctly navigates to `nova://settings`.
4. Opened Downloads, Bookmarks, and History via the menu and confirmed each renders its real panel content (not a blank canvas) — caught and fixed the `.content-area` double-child bug via direct DOM inspection (`children.length === 2`) before fixing it.
5. Typed `nova://history` directly into the address bar (bypassing the menu entirely) and confirmed it now renders the same real History panel — this path was fully broken before today's fix, independent of anything the menu feature touched.
6. Confirmed opening the menu multiple times in sequence no longer hangs (the `ContextMenu` listener leak, caught via a real test timeout before the fix).
