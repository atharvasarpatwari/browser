# Nova Android 1.38–1.39: Restored Tabs Load, Dark-Mode Text, `right`/`bottom` Insets, Plain-Words Errors

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html". Fixes for the findings from the 1.37 device test, plus the open items it left.
**Status:** Completed (1.39 built and signed; the phone was not connected, so the on-device re-check is pending)

---

## Summary
This round fixes four things:
- **Restored tabs:** a tab restored after a restart now loads its page.
- **Dark-mode text:** pages that opt into dark mode get white default text.
- **Positioned boxes:** boxes anchored with `right` or `bottom` land where CSS says (httpforever.com's theme switcher now sits top-right, not top-left).
- **Error page:** it shows plain sentences instead of Java exception text.

## Device findings (1.37 on the Realme RMX5264)
| Test | Result |
|------|--------|
| httpforever.com first frame | ✅ 778 ms (was 32 630 ms) |
| Restart with tabs open | ❌ Tab strip restored, but the page showed the start page under the tab's address → RC-1 (fixed in 1.38) |
| example.com in dark mode | ❌ Dark grey text on #222 → RC-2 (fixed in 1.38) |
| httpforever.com theme switcher | ❌ Top-left instead of top-right → RC-3 (fixed in 1.39) |
| neverssl.com from the phone's network | Error page showed `java.net.SocketTimeoutException: failed to connect … after 30000ms` → RC-4 (fixed in 1.39) |

## Root Causes

### RC-1: The restored tab's page loaded on a controller wired to nothing
**File:** `src/ui/pages/browser-window.ts`
**Problem:** At mount, the navigation pipeline runs on a local controller that has no fetcher. The restored tab's load was requested there and went nowhere, so the start page stayed under the restored address.
**Fix:** The load waits until the real controller and fetcher exist:
```ts
private loadRestoredTabWhenReady(): void {
  if (!this.restoredTabPending || !this.navController || !this.navigationBridge || !this.navigationFetcher) return;
  this.restoredTabPending = false;
  this.navigationBridge.syncFromActiveTab();
}
```
It is called at mount and at the end of both branches of `syncNavigationPipeline()`.

### RC-2: `CanvasText` never resolved for dark pages
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** With `color-scheme: light dark` and a dark preference, the root text colour stayed black. `canvastext` was never mapped to the dark scheme's white.
**Fix:** `applyDarkCanvasText(root)` runs on the root computed style. When the page set no colour, or set `canvastext`, the root gets `#ffffff` in dark mode and `#000000` otherwise.

### RC-3: Auto-width positioned boxes were as wide as the page
**Files:** `src/browser/rendering/layout-engine.ts`, `src/browser/rendering/positioning.ts`
**Problem:**
1. An absolutely or fixed positioned box with `width: auto` was laid out at the full available width. `right: .9rem` therefore had no room to move it, and it sat at the left edge.
2. `resolveOutOfFlow` treats `box.width` as the border box, but subtracted borders and padding a second time when anchoring right, stretching or anchoring bottom.
3. A trailing "auto margins" block re-pinned right-anchored boxes to the edge, ignoring the `right` value.
4. A `bottom`-anchored box was placed before its height was known (height 0), so it hung below the edge.

**Fix:**
- With exactly one of `left`/`right` set, the width is **shrink-to-fit** (CSS 2.2 §10.3.7). It is measured with the existing `measureContentWidth`, which now takes a flex flag so flex rows such as the switcher are measured as rows.
- Inset math uses border-box widths and heights.
- The bogus re-pin is removed.
- Once the height is known, a bottom-anchored box (with no `top`) is moved up by its height, and its content moves with it via `translateContent`.

```ts
} else if (isInsetSet(style, 'left') !== isInsetSet(style, 'right')) {
  const frame = paddingLeft + paddingRight + borderLeft + borderRight;
  const room = Math.max(0, availableWidth - frame - marginLeft - marginRight);
  const flex = display === 'flex' || display === 'inline-flex';
  borderWidthBox = this.measureContentWidth(node, room, fontSize, domTree, flex) + frame;
}
```
Boxes with neither `left` nor `right` keep the old full width. Their static position isn't tracked yet (they are centred in the containing block), and shrinking them would visibly move them.

### RC-4: The error page printed Java exceptions
**File:** `src/browser/engine/page-loader.ts`
**Problem:** `NovaFetchBridge.kt` reports `e.toString()`, and the page loader passed it straight through as the error description.
**Fix:** `friendlyNetworkError()` maps the known failures to sentences. Unknown messages keep the old `Failed to load page from …` form.

| Exception | Message |
|-----------|---------|
| `UnknownHostException` | Couldn't find this site. Check the address and your internet connection. |
| `SocketTimeoutException` | The site took too long to respond. |
| `NoRouteToHost` / unreachable | No internet connection. |
| `SSLHandshakeException` / certificate errors | A secure connection to this site couldn't be made. |
| `ConnectException` / refused | Couldn't connect to the site. |
| unexpected end of stream / reset | The connection closed before the page loaded. |

The http:// fallback is unaffected, because it keys on the failed URL, not the message.

## Still open
- The httpforever inline SVG brand logo isn't drawn, and the `.hero__wave` strip is white.
- The Wikipedia wordmark (SVG) is blurry, and mask-image icons are dark squares.
- Absolutely positioned boxes with no horizontal or vertical insets use a centred position, not their static position.
- async generators / for-await, the drop-shadow filter, and generator `return()` with `finally` are not done.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | `restoredTabPending` + `loadRestoredTabWhenReady()` (1.38) |
| `src/browser/engine/page-renderer.ts` | `applyDarkCanvasText()` on the root style (1.38) |
| `src/browser/rendering/layout-engine.ts` | Shrink-to-fit width for one-sided horizontal insets; bottom re-anchoring after height; `measureContentWidth(…, flex)`; `isInsetSet()` |
| `src/browser/rendering/positioning.ts` | Border-box inset math; removed the re-pin that ignored `right`/`bottom` |
| `src/browser/engine/page-loader.ts` | `friendlyNetworkError()` |
| `tests/device-findings-137.test.ts` | Dark-mode default text colour test (1.38) |
| `tests/end-user-fixes-127.test.ts` | Expects the plain-words DNS message |
| `android/app/build.gradle` | 1.38 (39), then 1.39 (40) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/positioned-insets-139.test.ts` | 6 tests: httpforever switcher top-right; `right` shrink-to-fit; `left` shrink-to-fit; `bottom: 0` with content; `bottom` with explicit height; error-message mapping |
| `Nova-1.38.apk`, `Nova-1.39.apk` | Signed builds |

## Test Results
```
npx tsc --noEmit                                  -> clean
npx vitest run tests/positioned-insets-139.test.ts tests/page-loader.test.ts -> 20 passed (20)
npx vitest run tests/positioning.test.ts tests/stacking.test.ts tests/wikipedia-render.test.ts tests/device-findings-137.test.ts -> 93 passed (93)
npx vitest run (1.38, before this round)          -> Test Files 294 passed (294), Tests 10684 passed (10684)
npx vitest run (1.39)                             -> 1 failed | 10689 passed: end-user-fixes-127 expected the raw "resolve host" text (intended change; assertion updated, 4/4 pass)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.39.apk                    -> Verifies; versionCode 40, versionName 1.39
adb devices                                       -> no device attached (on-device re-check pending)
```
