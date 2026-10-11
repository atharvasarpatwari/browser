# A New Tab's Content Never Rendered — the Real Start Page Was Built but Unreachable

**Date:** 2026-09-16
**Session:** Direct continuation of the same day's Android chrome-unification work. After confirming the unified web chrome on-device, the user shared a design artifact for "Nova Start Page" and repeated that the web UI should be pushed to the Android app. Investigating why the running app's new-tab content didn't match that artifact — despite `new-tab-page.ts` already implementing that exact design — found the real bug: it wasn't an Android problem at all.
**Status:** Completed

---

## Summary
Every screenshot of Nova Browser's new-tab content this session showed a plain, static placeholder ("Nova Browser / Private & secure browsing / Search the web...") — never the actual, fully-built "Nova Start Page" (live clock, real-bookmark quick-links grid, an insight carousel, a stats strip) that already exists in `new-tab-page.ts` and matches the user's shared design artifact closely. The address bar and tab strip both correctly showed `about:newtab` / `nova://newtab`, so the data model was right — only the content area was wrong, which pointed at rendering rather than navigation logic. Root cause: **creating a new tab never triggered content rendering at all**, on desktop or Android — `NavigationBridge`'s tab-manager subscription only listens for `tabActivated`/`tabRemoved`, and even that handler (`syncFromActiveTab()`) only updates chrome state (address bar text, back/forward, a low-level nav-history entry) — it never calls `handleContentForUrl()`, the one method that actually paints internal pages. A tab created via the "+" button, `Ctrl+T`, the main menu, or the app's own startup bootstrap looked correct in the chrome and simply kept showing whatever the *previous* tab had last painted underneath. Fixed by rendering the new tab's content at the moment it's created, and — while investigating why an explicit `about:blank`-vs-`nova://newtab` distinction mattered here — separately fixed a real UX gap: a tab created with no destination in mind defaulted to a truly blank page instead of the app's own start page, unlike every mainstream browser.

## Root Causes

1. **`createTab()` never rendered anything — chrome state and page content are two separate systems, and only one of them reacts to new tabs.** `NavigationBridge.wireTabManagerEvents()` subscribes to `'tabActivated'` and `'tabRemoved'` only; `TabManager.createTab()` does emit `'tabActivated'` (it activates every tab it creates), so the address bar, tab strip, and back/forward state all updated correctly and made the bug easy to miss. But the handler that subscription runs — `syncFromActiveTab()` — stops at syncing chrome and a lower-level `NavigationController` history entry; it never calls `handleContentForUrl()`, which is the only code path that actually renders internal pages (`renderSpecialPage`) or hands a real URL to the engine. `BrowserWindowPage`'s own `navigate(url)` method *does* call that pipeline, but nothing invoked it for a newly created tab — not the toolbar's "+" button, not `Ctrl+T`, not the main menu's "New Tab", not the app's own startup bootstrap tab. Fixed by having the page's `tabCreated` handler call its own `navigate(tab.url)` for the tab that was just created, in addition to the existing chrome sync — the same full pipeline every other navigation already goes through.
2. **A tab created with no destination defaulted to a truly blank page instead of the app's own start page.** `TabSession`'s constructor defaults to `'about:blank'` — correct, spec-accurate behavior for a primitive that should support an explicitly blank tab. But `TabManager.createTab()`, the actual application-level "the user wants a new tab" API every UI action calls, inherited that same default, so every "new tab" action opened a real, dead-end blank page rather than Nova's own start page — unlike Chrome, Firefox, Edge, or Safari, which all open their own new-tab page by default. Gave `TabManager.createTab()` its own default of `'nova://newtab'`, one layer above `TabSession`, so an explicit `about:blank` (still fully supported) and an unspecified new tab no longer collide on the same default.

## Notes
- This was **not** an Android-specific bug — it affects the desktop Electron app identically, since both front ends share this exact code path. It was very easy to miss on desktop specifically because a browser window is rarely opened completely fresh in normal development/testing (an existing session usually has tabs restored from a previous run, going through the tab-*restoration* path in `mount()`, which explicitly sets each tab's title/URL from saved state and was never exercised by the buggy "brand-new tab" path at all).
- This explains the whole arc of the session's confusion: fixing the Android chrome's colors, then replacing the native chrome with the real web chrome, both were real, correct, necessary fixes — but neither one could have made the actual page *content* match the shared design artifact, because the content-rendering gap sat one level deeper, in code the chrome work never touched.
- Verified the fix generalizes beyond `nova://newtab` specifically: any tab created via "Duplicate Tab" (which already had its own explicit `navigationBridge.navigate(tab.url)` workaround at that one call site) still works; the new `tabCreated` handler makes that per-call-site workaround redundant but harmless to leave in place.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | `tabManager.on('tabCreated', ...)` now calls `this.navigate(event.tab.url)` in addition to `syncAll()`, so a newly created tab's content actually renders |
| `src/browser/tabs/tab-manager.ts` | `createTab()`'s own `url` parameter now defaults to `'nova://newtab'` instead of inheriting `TabSession`'s `'about:blank'` default |
| `tests/tab-manager.test.ts` | Updated the one test asserting the old default (`'createTab with default URL about:blank'` → `'createTab with no destination opens the start page, not a blank tab'`, asserting `'nova://newtab'`) |

## Files Created
- `doc/2026-09-16-new-tab-never-rendered-content.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                                → 0 errors (repo-wide)
npx vitest run tests/tab-manager.test.ts tests/navigation-bridge.test.ts
  tests/android-native-bridge.test.ts                                → 91/91 passed
npx vitest run (full suite)                                          → 223 files / 9256 tests passed (0 regressions)
npx playwright test --config=playwright-electron.config.cjs          → 5/5 spec files passed
Real device (Realme RMX5264)                                         → see Verification Steps
```

## Verification Steps
1. Noticed every new-tab screenshot this session showed a static placeholder instead of the real `NewTabPage`; confirmed the actual rich implementation already exists and is wired to `nova://newtab`/`about:newtab` in `renderSpecialPage()`.
2. Created a second tab via the tab strip's "+" button and confirmed the tab strip/address bar correctly showed `nova://newtab` for both tabs, while the content area still showed the first tab's old content — isolating the bug to rendering, not the tab/URL data model.
3. Traced `NavigationBridge.wireTabManagerEvents()` and found it only subscribes to `tabActivated`/`tabRemoved`, and that its handler (`syncFromActiveTab()`) never calls `handleContentForUrl()` — confirmed by reading `BrowserWindowPage.navigate()`, the only method that does.
4. Added the `tabCreated` → `navigate(tab.url)` call, changed `TabManager.createTab()`'s default URL, updated the one affected test, and reran the full unit suite (0 regressions) and Electron e2e suite (5/5 passed).
5. Rebuilt the web bundle, copied it into the Android app, reinstalled, and launched fresh on the connected device: the real Nova Start Page now renders in full — live clock, a quick-links grid of real colored bookmark tiles, the search pill, the insight carousel (with working pagination dots), and the live stats strip (bookmark count, grid-page count, a ticking session timer) — matching the shared design artifact.
6. Deleted all scratch verification screenshots before finishing.
