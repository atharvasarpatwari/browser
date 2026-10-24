# Nova Android 1.27 — Browser User-Agent, Error Pages, No More Zero Tabs, Saved Library Shown, Modern CSS Colours

**Date:** 2026-10-24
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", the first round after the end-user test pass.
**Status:** Completed (no device was connected; verified by unit and full-suite tests and the Kotlin build; on-device check pending)

---

## Summary
This round fixes five of the open root causes from [2026-10-21-nova-android-1.26-end-user-test-results.md](2026-10-21-nova-android-1.26-end-user-test-results.md), picked as the highest user impact for the least code:

| RC | Before | After |
|----|--------|-------|
| RC-1 | Pages were fetched as `Dalvik/2.1.0`, and Wikimedia banned the phone's IP | The WebView's Chrome UA + `NovaBrowser/1.27`, plus `Accept-Language`, plus an HTML `Accept` for documents |
| RC-3 | DNS failure → a blank white page with a green lock; an empty 404 → blank | The native error page (with Retry) appears; an empty HTTP error shows "This page isn't working · HTTP 404 Not Found" |
| RC-5 | Closing the last tab left "0 tabs" and pages then loaded invisibly | Closing the last tab opens a fresh home tab |
| RC-13 | After a restart, Bookmarks said "No bookmarks yet" and History was empty | The saved lists are re-pushed once the services connect |
| RC-8 | `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()` and `color()` painted as black | Converted to sRGB (CSS Color 4 matrices) |

## Root causes and fixes

### RC-1 — the HTTP library's User-Agent
**Files:** `android/.../NovaFetchBridge.kt`, `src/browser/networking/resource-loader.ts`

**Problem:** `ResourceLoader.loadResource` sends only `accept: */*`. With no `User-Agent` from JS, `HttpURLConnection` used its `Dalvik/…` default, which Wikimedia treats as a bot.

**Fix:**
- The bridge fills in a User-Agent and an `Accept-Language` whenever JS didn't send one:
  ```kotlin
  private val userAgent: String by lazy {
      val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "1"
      val base = runCatching { WebSettings.getDefaultUserAgent(context) }.getOrNull() ?: "Mozilla/5.0 (Linux; Android …) …"
      "$base NovaBrowser/$version"
  }
  // … if (!hasUserAgent) setRequestProperty("User-Agent", userAgent)
  //   if (!hasAcceptLanguage) setRequestProperty("Accept-Language", acceptLanguage)   // e.g. "en-IN,en;q=0.9,en;q=0.8"
  ```
- `ResourceLoader` now asks for `text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8` when `kind === 'document'`.

### RC-3 — failed loads looked like empty pages
**File:** `src/browser/engine/page-loader.ts`

**Problem:** `ResourceLoader` reports network failures as `{ statusCode: 0, error }` without throwing. `PageLoader` rendered the empty body, so `pageLoadError` never fired and neither did the native `ErrorPage` (BrowserScreen.kt:147).

**Fix:**
```ts
if (result.error || result.statusCode === 0) {
  throw new Error(result.error || 'The server did not respond.');
}
```
Also, `mapResult` swaps an empty-bodied HTTP ≥ 400 response for a small page, "This page isn't working · \<host\> returned an empty response · HTTP 404 Not Found". A real error body (a site's own 404 page) is kept.

### RC-5 — zero tabs
**File:** `src/ui/pages/browser-window.ts` `closeTab()`

**Fix:** If the tab manager is empty after `removeTab`, create a tab, activate it and `syncFromActiveTab()`.

### RC-13 — the saved library wasn't shown after a restart
**File:** `src/ui/pages/browser-window.ts`

**Problem:** The Android bridge reads the bookmark and history lists when it's installed (main.ts:821). The services are attached later (main.ts:931–932), and attaching them didn't re-announce anything.

**Fix:** `setBookmarkService()` and `setHistoryService()` end with `this.emitLibraryChanged()`, so the bridge re-pushes the saved data.

### RC-8 — CSS Color 4 colours
**File:** `src/browser/rendering/rasterizer.ts`

**Fix:** A new `parseModernColor()`, used by `parseColor` before its black fallback and by `isParsableColor`:

| Function | Conversion |
|----------|------------|
| `oklab`, `oklch` | Björn Ottosson's OKLab → linear sRGB matrices |
| `lab`, `lch` | CIE Lab (D50) → XYZ → Bradford to D65 → linear sRGB |
| `hwb` | hue → hsl, then a white/black mix |
| `color(srgb …)`, `color(srgb-linear …)` | direct |

All of them handle `%`, `none`, hue units (`deg`/`turn`/`rad`/`grad`) and `/ alpha`. Borders, gradients and backgrounds share this parser. iana.org's footer text, `oklch(0.685 0.01 286)`, now comes out light grey instead of black.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/NovaFetchBridge.kt` | Browser User-Agent and Accept-Language when JS sends none |
| `src/browser/networking/resource-loader.ts` | HTML `Accept` for documents |
| `src/browser/engine/page-loader.ts` | Throw on load errors; built-in page for empty HTTP errors |
| `src/ui/pages/browser-window.ts` | `closeTab` keeps one tab; library re-announced when services connect |
| `src/browser/rendering/rasterizer.ts` | CSS Color 4 colour functions |
| `android/app/build.gradle` | versionCode 28, versionName 1.27 |

## Files Created
| File | Purpose |
|------|--------|
| `tests/css-color4.test.ts` | 3 tests: oklch/oklab against the sRGB primaries, lab/lch/hwb/color(srgb), parsability |
| `tests/end-user-fixes-127.test.ts` | 4 tests: load errors throw; empty 404 page vs a real body; the last tab is replaced; the library is re-announced |

## Test Results
```
npx tsc --noEmit                         → exit 0
npx vitest run                           → Test Files 282 passed (282) · Tests 10577 passed (10577)   (+7 new; was 10565 + 5)
./gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0 (Kotlin compiles; unit tests pass)
apksigner verify Nova-1.27.apk           → verified
```

## Verification
- **Unit and regression tests:** all listed above, passing.
- **Pending on a device** (no phone or tablet was connected this round):
  - open `https://httpbin.org/headers` and check that the User-Agent shows Chrome + `NovaBrowser/1.27`;
  - `nonexistent.invalid` → the native error page;
  - close all tabs → one fresh tab;
  - restart → Bookmarks and History are listed;
  - iana.org footer text is readable.

## Still Open (from the test report)
- RC-2 Google results are blank (the interpreter fails on Google's script).
- RC-4 `http://` is silently blocked by HTTPS-only mode.
- RC-9 tabs aren't restored after a restart (session-restore is unused).
- RC-10 no page titles.
- RC-11 history noise.
- RC-12 POST forms.
- RC-14 SVG scaling.
- RC-15 to RC-19: sheet inset, select overlay, dark mode, underline gaps, error formatting.
