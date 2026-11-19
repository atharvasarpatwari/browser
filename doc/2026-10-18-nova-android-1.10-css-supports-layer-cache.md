# Nova Android 1.10 — @supports/@layer CSS and Cache-Control Freshness

**Date:** 2026-10-18
**Session:** "keep improving the nova app and note the changes". This session fixed the two engine gaps the 1.9 change log left open; both affect every page Nova Android renders.
**Status:** Completed (no phone attached, so there was no on-device re-check)

---

## Summary
- **`@supports` and `@layer`:** modern sites wrap much of their CSS in these blocks, and the legacy CSS converter dropped both. Their rules now reach the cascade.
- **Cache-Control:** responses marked `no-store`, `no-cache` or `max-age=0` were cached for the 5-minute default. In practice that meant most dynamic HTML pages, so you could see a stale page for up to 5 minutes. Those responses are no longer cached.
- Shipped as Nova **1.10** (versionCode 11).

## Root Causes
### 1. `@supports` / `@layer` blocks dropped before the cascade
**File:** `src/browser/rendering/css-parser.ts`
**Problem:** `convertRule` recursed into `@media` (fixed in 1.9) but still ended with `if (rule.type !== 'style') return []`. Every `@supports (…) { … }` and `@layer x { … }` block disappeared, and so did any `@media` nested inside them. Sites built with Tailwind v4 (everything is in `@layer`) or with `@supports` feature guards rendered unstyled.
**Fix:** reuse the cascade's existing `@supports` evaluator (now exported) and flatten layers:
```ts
if (rule.type === 'supports') {
  return evaluateSupportsCondition(rule.condition)
    ? rule.rules.flatMap((inner) => this.convertRule(inner, order, sourceUrl, media))
    : [];
}
// ponytail: layer precedence lost (layered rules should lose to unlayered ones)
if (rule.type === 'layer') {
  return rule.rules.flatMap((inner) => this.convertRule(inner, order, sourceUrl, media));
}
```
`@supports` doesn't depend on the viewport, so it's settled at parse time. Nested `@media` keeps its query list through the `media` argument.

### 2. Dynamic responses were cached for 5 minutes
**File:** `src/browser/networking/resource-loader.ts`
**Problem:** `const ttlMs = maxAgeMatch ? … * 1000 : undefined;` then `expiresAt: ttlMs ? … : null`. Two things went wrong:
- `max-age=0` gives `ttlMs = 0`, which is falsy, so `expiresAt` became `null` and `CacheManager.set` applied the 5-minute `defaultTtlMs`.
- `no-store` and `no-cache` were never checked at all.

The result: a typical HTML page (`private, max-age=0, must-revalidate`) came back from cache on the next visit for 5 minutes.
**Fix:**
```ts
const storable = !/no-store|no-cache/.test(cacheControl) && ttlMs !== 0;
if (this.cache && storable && res.statusCode >= 200 && res.statusCode < 400) { … }
```
`ponytail:` `no-cache` really means "store, but revalidate" (`If-None-Match` → 304). Not storing is the safe subset until conditional requests are handled.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css-parser.ts` | `convertRule` handles `supports` (evaluated) and `layer` (flattened) |
| `src/browser/rendering/css5/cascade.ts` | `evaluateSupportsCondition` exported |
| `src/browser/networking/resource-loader.ts` | Cache-Control parsed once; `no-store`/`no-cache`/`max-age=0` not cached; `max-age` regex anchored |
| `tests/page-viewport.test.ts` | 2 tests: `@supports` true/false/`not`; `@layer` + nested `@media` at phone width |
| `tests/resource-loader.test.ts` | 4 tests: 3 non-storable Cache-Control values, `max-age` freshness |
| `android/app/build.gradle` | 1.9 (10) → 1.10 (11) |
| `android/app/src/main/assets/*` | rebuilt engine bundle |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-18-nova-android-1.10-css-supports-layer-cache.md` | This change log |

## Test Results
The new tests were run before each fix and failed (2 of 5 and 3 of 19). Both runs pass after the fix:
```
npx vitest run tests/page-viewport.test.ts    -> 5 passed (5)
npx vitest run tests/resource-loader.test.ts  -> 19 passed (19)
npx tsc --noEmit                              -> exit 0
npx vitest run                                -> 266/267 files, 10420 passed, 9 skipped; the 1 failure was
                                                 tests/search-performance.test.ts "gates" (a timing gate, run
                                                 while Gradle was building) -> re-run alone: 16 passed (16)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.10.apk                -> verified (1,515,256 B)
```

## Verification Steps
1. Wrote the tests first and confirmed they failed for the stated reason (`canvastext` instead of the layered colour; cache entries present).
2. Applied the fixes and re-ran the two files, then the full suite and tsc.
3. Built the bundle (`npx vite build && node android/scripts/copy-web.mjs`), then ran the Kotlin tests and the release build. Zipaligned and signed it with the debug key, then ran `apksigner verify`.
4. **Not done:** no on-device check, because `adb devices` was empty. The 1.9 items (pull-to-refresh, reload, find) still need the phone connected, unlocked and set to Stay awake.

## What's new in Nova 1.10 (user-facing)
- Sites that use modern CSS (`@supports`, `@layer`, e.g. Tailwind v4) now get their styles.
- News and feed pages are fresh on every visit instead of being up to 5 minutes stale.
