# Nova Android 1.32 — http:// Works, Tabs Survive a Restart, Smooth Image Scaling, Dark Mode for Pages

**Date:** 2026-10-26
**Session:** "keep improving the nova app…". Four of the open root causes from [2026-10-21-nova-android-1.26-end-user-test-results.md](2026-10-21-nova-android-1.26-end-user-test-results.md): RC-4, RC-9, RC-14 and RC-17.
**Status:** Completed (APK built and signed; no device was connected, so there was no on-device run)

---

## Summary
- **RC-4:** Typing an `http://` address now loads the site. It tries `https://` first and falls back to `http://` when the site has no HTTPS. Before, nothing happened.
- **RC-9:** Open tabs, including which one was active, come back after a restart.
- **RC-14:** Shrunk images and SVGs (the Wikipedia wordmark, the IANA logo) are smoothly averaged instead of turning into stripes and checkerboards.
- **RC-17:** Pages follow the phone's dark mode through `prefers-color-scheme`, `light-dark()` and `matchMedia`.

RC-12 (POST forms) needs a request body through navigation; it is the next round.

## Root Causes

### RC-4 — every `http://` navigation silently did nothing
**Files:** `src/browser/navigation/navigation-controller.ts`, `src/browser/media/security-layer.ts`, `src/app/main.ts`
**Problem:** HTTPS-only mode returned `decision: 'upgrade'` with an `upgradeUrl`, but the guard interface only answers yes or no. The controller treated the answer as a block, nobody followed `upgradeUrl`, and no message was shown.
**Fix:**
- `INavigationGuard` has an optional `rewriteUrl(request)`. `navigateTo` applies guard rewrites before parsing (new step 0), so `http://x` loads `https://x`.
- `SecurityLayer.upgradeNavigation()` records HTTPS-only-mode upgrades.
- On `pageLoadError` for an upgraded URL, main.ts calls `fallbackToHttp()`. That adds the host to `httpFallbackHosts` (exempt from HTTPS-only mode this session) and re-navigates to the original `http://` URL, replacing the failed entry. This matches Chrome's HTTPS-Upgrades; the address bar shows the page as not secure.
- HSTS / preloaded hosts never fall back.
```ts
for (const guard of this.guards) {
  const to = guard.rewriteUrl?.(request);
  if (to && to !== request.url) request = { ...request, url: to };
}
```

### RC-9 — open tabs were never saved
**Files:** `src/ui/pages/browser-window.ts`, `src/browser/tabs/tab-persistence.ts`
**Problem:**
- `TabPersistenceManager` auto-saved, but into a `MemoryStore`, so every launch started with one blank tab. (`settings/session-restore.ts` was unused and also in-memory only.)
- A restore would also have missed the active tab: restored tabs get new ids, so the saved `activeTabId` never matched.

**Fix:**
- The existing `LocalStorageStore` is used, wrapped so nothing is written while incognito.
- Tabs are restored before auto-save starts. The active tab is matched by position, and its page is loaded once the navigation pipeline exists (`syncFromActiveTab`).
- Saved tabs are kept for 30 days instead of 24 hours.
- The Kotlin side mirrors the TS tab state, so no native change was needed.
- Tests: a global `beforeEach` in `tests/setup-gpu.ts` clears the saved tabs, so a tab one test opened doesn't reappear in the next.

### RC-14 — shrunk images aliased into stripes and checkerboards
**File:** `src/browser/rendering/rasterizer.ts`
**Problem:** `drawImage` sampled the source with nearest-neighbour (`Math.floor` on source coordinates). Shrinking a large SVG raster or photo skipped most source pixels.
**Fix:** `resampled(src, w, h)` makes a destination-size copy, cached per image and last size, so repaints don't redo it:
- shrinking uses an area average (box filter);
- enlarging uses bilinear interpolation;
- both work on premultiplied alpha, so transparent edges don't darken.

Above 4 megapixels it samples directly, to bound memory.

### RC-17 — pages ignored dark mode
**Files:**
- `src/browser/rendering/color-scheme.ts` (new);
- `css5/cascade.ts` and `css5/computed-value-resolver.ts`;
- `js/index.ts` and `app/main.ts`.

**Problem:**
- The `prefers-color-scheme` media feature was hard-coded to `light`.
- `light-dark(a, b)` always resolved to `a`.
- Page `matchMedia` (added in 1.30) answered light.

**Fix:**
- A shared preference is set at startup from the host WebView's own `prefers-color-scheme`. The app theme has day and night variants and targetSdk is 34, so the WebView follows the phone's setting. A `change` listener keeps it current for later page loads.
- The media query, `light-dark()` (dark value when dark) and page `matchMedia` all read it.

## Not done
- **RC-12 (POST forms):** next round.
- **Mid-page dark-mode switch:** a page already open re-styles only when it is reloaded.
- **`light-dark()` and `color-scheme`:** it follows the preference without checking the element's `color-scheme` property (pages using it declare `color-scheme: light dark`).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/navigation/navigation-controller.ts` | `INavigationGuard.rewriteUrl`; guard rewrites applied before parsing |
| `src/browser/media/security-layer.ts` | `upgradeNavigation`, `fallbackToHttp`, `httpFallbackHosts`; guard `rewriteUrl` |
| `src/app/main.ts` | HTTPS→HTTP fallback on `pageLoadError`; colour-scheme preference from the WebView |
| `src/ui/pages/browser-window.ts` | Tabs persisted to localStorage (not in incognito), restored with the active tab, active page loaded |
| `src/browser/tabs/tab-persistence.ts` | Saved tabs kept 30 days |
| `src/browser/rendering/rasterizer.ts` | `drawImage` draws a resampled (box / bilinear, premultiplied) cached copy |
| `src/browser/rendering/css5/cascade.ts` | `prefers-color-scheme` uses the preference |
| `src/browser/rendering/css5/computed-value-resolver.ts` | `light-dark()` picks the dark value when dark |
| `src/browser/js/index.ts` | Page `matchMedia` uses the preference |
| `tests/tab-persistence.test.ts` | Stale-data test uses the new 30-day limit |
| `tests/setup-gpu.ts` | Clears saved tabs before each test |
| `android/app/build.gradle` | versionCode 33, versionName 1.32 |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/rendering/color-scheme.ts` | The page-visible colour-scheme preference |
| `tests/end-user-fixes-132.test.ts` | 8 tests: http→https, HTTP fallback (and none for HSTS), tabs + active tab restored after remount, nothing saved in incognito, checkerboard shrinks to grey, transparent pixels don't darken, light-dark()/media query in dark and light, matchMedia |
| `Nova-1.32.apk` | Signed release build |

## Test Results
```
npx vitest run                                    (first full run, machine loaded, 849 s)
 Test Files  2 failed | 287 passed (289)
 FAIL tests/search-integration.test.ts > keeps the start screen when a tab commits its initial about:blank
   -> a tab saved by an earlier test in the file was restored (RC-9 working as designed);
      fixed by clearing saved tabs before each test (tests/setup-gpu.ts)
 FAIL tests/search-performance.test.ts > typing renders the dropdown within a frame / gates
   -> wall-clock gate under load; 16 passed (16) when run alone
npx vitest run                                    (re-run after the setup fix, 318 s)
 Test Files  289 passed (289)
      Tests  10653 passed (10653)
npx vitest run tests/end-user-fixes-132.test.ts   -> 8 passed (8)
npx tsc --noEmit                                   -> clean
gradlew :app:testDebugUnitTest :app:assembleRelease -> OK
apksigner verify Nova-1.32.apk                     -> Verifies (v2 + v3); versionCode 33, versionName 1.32
```

## Verification
- Traced every root cause in code before fixing it (guard API, the in-memory store, the nearest-neighbour loop, the hard-coded `light`).
- The tab-restore test mounts a browser window, opens tabs, remounts, and checks the URLs and the active tab.
- The dark-mode test renders the same page under both preferences and checks the computed colours.
- `adb devices`: none connected.
