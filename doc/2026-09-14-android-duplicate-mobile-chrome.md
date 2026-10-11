# Android — Duplicate Bottom Toolbar Under the Native Host

**Date:** 2026-09-14
**Session:** User connected a real Android device (Realme RMX5264) and asked to run the app and fix whatever's wrong. Automated install/boot/CDP-bridge checks all passed, but a real screenshot of the running app showed a second, non-functional bottom toolbar sitting directly above the real native one.
**Status:** Completed

---

## Summary
On a real device, Nova Browser's bottom chrome showed two toolbars stacked on top of each other: the real native Compose `BottomAppBar` (back/forward/downloads/library — fully functional), and directly above it a second, visually similar bar (◀ ▶ ☰ 🔍 ✕) whose buttons had no click handlers at all. Root cause: `BrowserWindowPage.mount()`'s mobile-viewport branch never checked `hideChromeUI`, so on any screen under 768px wide — every phone, native host or not — it always built and displayed its own `MobileLayout` bottom-nav and address bar on top of whatever chrome the host was already providing.

## Root Cause
`main.ts` correctly computes `hideChromeUI: isNativeHostPresent()` and passes it into `BrowserWindowPage`'s config so the page's own chrome hides itself under a native shell. `mount()` does honor that — but only inside its desktop-layout branch (`areas.toolbar`/`areas.tabBar`/`areas.bookmarkBar` get `display:none` when `hideChromeUI` is true). The mobile-layout branch (`isMobile = window.innerWidth < 768`, which is always true on a phone) is a completely separate code path that wires `MobileLayout`'s own `addressBar`/`bottomNav`/`statusBar` areas and never once reads `this.config.hideChromeUI`. On Android, `isNativeHostPresent()` is true (Kotlin registers `window.NovaStateBridge` before the page loads) *and* the viewport is a phone width, so both conditions that should have suppressed the JS-side chrome were true — but only one of the two branches that needed to check `hideChromeUI` actually did.

## Notes
- `MobileLayout`'s bottom-nav buttons (`['◀','▶','☰','🔍','✕']`) were never wired to any click handler in the first place — even setting aside the duplication, that bar was inert. This session's fix hides it under a native host rather than wiring it up, since the native `BottomAppBar` already covers back/forward and the Kotlin `AddressBar`/menu already cover the rest; building real handlers for a bar that duplicates existing native chrome would be the "build a fake feature" mistake, not a fix.
- The mobile status bar (Ready / blocked count / HTTPS / zoom) is left visible under `hideChromeUI`, matching the existing desktop behavior — it shows engine-only info (tracker count, zoom level) that the native Kotlin chrome doesn't surface, so it isn't a duplicate.
- Verified end-to-end on real hardware, not just in the test harness: rebuilt the APK, reinstalled, and confirmed via `adb exec-out screencap` before/after — the duplicate bar is gone and the single native `BottomAppBar` remains. Also drove a real navigation through the CDP bridge (`window.novaNative.navigate('https://example.com')`, the same mechanism the native host itself uses) and confirmed the page rendered correctly with a working back button and secure padlock.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Mobile-layout branch of `mount()` now hides `areas.addressBar`/`areas.bottomNav` when `this.config.hideChromeUI` is true, mirroring the existing desktop-branch treatment |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9230 tests passed (no change — no test
                                                                     exercises mobile-viewport mount(), see below)
npx playwright test --config=playwright-electron.config.cjs       → 3/3 passed (electron-smoke, fidelity-audit, keep-alive)
node android/scripts/device-smoke-test.mjs (real device)          → all Tier 1 + Tier 2 checks passed, before and after
```

## Verification Steps
1. Built the debug APK (`npm run build:android`) and ran `android/scripts/device-smoke-test.mjs` against the connected device — install, cold launch, boot-log markers, and the CDP bridge/tabs check all passed automatically.
2. Took a real `adb exec-out screencap` of the running app — the smoke test's own "still needs a human" list explicitly calls out visual checks it can't automate, and this is exactly the kind of bug that only shows up in a screenshot: everything the smoke test can check (bridge installed, state shape correct, tabs work) was already green.
3. Found the duplicate bar, traced it to `MobileLayout`'s unconditional bottom-nav construction, and confirmed via `grep` that `hideChromeUI` was referenced exactly once in `browser-window.ts` — inside the desktop-only branch.
4. Fixed it, rebuilt, reinstalled, and re-screenshotted: confirmed the duplicate bar is gone.
5. Ran the full unit suite, full Electron e2e suite, and the device smoke test again — all green, no regressions on the desktop chrome-hiding path this change also touches.
6. Drove a real navigation via the CDP bridge to confirm actual page content (not just the new-tab page) renders correctly on the device: example.com loaded with correct text/layout, address bar and padlock updated, back button enabled.
