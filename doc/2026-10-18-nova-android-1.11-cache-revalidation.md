# Nova Android 1.11 — Cached Images, 304 Revalidation & Null-Body Responses

**Date:** 2026-10-18
**Session:** "keep improving the nova app and note the changes", round 2. This round replaces the 1.10 `ponytail:` note ("`no-cache` should revalidate, not be skipped") with real conditional requests. Making them work exposed three pre-existing bugs.
**Status:** Completed (no phone attached, so there was no on-device re-check)

---

## Summary
Nova now revalidates expired cache entries with `If-None-Match` / `If-Modified-Since` and reuses the cached body on `304 Not Modified`. Pages marked `no-cache` / `max-age=0` that carry a validator are kept and revalidated on every use. Building this turned up three bugs, all fixed:
- Cached images came back without their bytes, so they broke on revisit.
- Every 204/304 fetch rejected on Android.
- The loader released its concurrency slot twice on CORS/CORP blocks.

Shipped as Nova **1.11** (versionCode 12).

## Root Causes
### 1. Cached images were returned without their bytes (pre-existing)
**Files:** `src/browser/networking/resource-loader.ts`, `cache-manager.ts`
**Problem:**
- `CacheEntry` stored only `body: string`.
- A cache hit returned `bodyBinary: null`.
- `LazyLoader` treats `!result.bodyBinary` as a failed image (`lazy-loader.ts:266`).

So any image loaded a second time within its cache lifetime failed to decode, for example when revisiting a page or reopening a tab. The default lifetime is 5 minutes.
**Fix:** `CacheEntry.bodyBinary?: Uint8Array | null`, filled on store and returned on hit through the new `fromCacheEntry()` helper. `sizeBytes` counts the bytes when present.

### 2. 204 and 304 responses rejected on Android (pre-existing)
**File:** `android/bridge/nova-bridge.js`
**Problem:** for an empty body, Kotlin posts `bodyText: ""`. The shim passed that `""` to `new Response("", { status: 304 })`, which throws, because these statuses must have a null body. The fetch rejected. This broke every 204 (beacons, some APIs) and would have broken every revalidation.
**Fix:**
```js
var nullBodyStatus = [101, 103, 204, 205, 304].indexOf(payload.status) !== -1;
if (nullBodyStatus) { body = null; } else if (payload.bodyBase64) { …
```

### 3. Concurrency slot released twice on CORS/CORP blocks (pre-existing)
**File:** `src/browser/networking/resource-loader.ts`
**Problem:** five early `return`s inside the `try` called `this.releaseSlot()`, and the `finally` called it again. Each blocked resource pushed `activeCount` one lower, which quietly raised the effective concurrency cap.
**Fix:** deleted the five in-`try` calls; `finally` is the single release. (The tracker-block return before the `try` keeps its own release, which is correct.)

### 4. Expired entries were re-downloaded in full
**Files:** `cache-manager.ts`, `resource-loader.ts`
**Problem:** `CacheManager.get` deleted expired entries, so nothing was left to revalidate. 1.10 also skipped `no-cache` responses entirely, so every visit downloaded them in full.
**Fix:**
- **Keeping entries:** `get()` and `prune()` keep expired entries that have an ETag or Last-Modified (when `enableEtagRevalidation`, the default). The new optional `ICacheManager.getStale(url)` returns them.
- **Sending validators:** on a miss, the loader adds `if-none-match` / `if-modified-since` to a copy of the request headers. The copy is made after the CORS pre-check, as a browser's cache does, so validators never trigger a preflight.
- **Handling 304:** the entry is refreshed with merged headers, the new validators and a new expiry, and the cached body (and bytes) are returned with `fromCache: true`.
- **What gets stored:**
  - `no-store` is never stored.
  - `no-cache` / `max-age=0` are stored only if they have a validator, with `expiresAt: 0`, so every use revalidates.
  - Anything else is stored as before.
- A reload (`bypassCache`) still skips validators and fetches in full.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/networking/cache-manager.ts` | `bodyBinary` on entries; `getStale()`; expired entries with a validator survive `get()`/`prune()` |
| `src/browser/networking/resource-loader.ts` | conditional requests and 304 handling; `fromCacheEntry()`; binary cached; no-cache stored with a validator; double `releaseSlot()` removed |
| `android/bridge/nova-bridge.js` | null body for 101/103/204/205/304 |
| `tests/resource-loader.test.ts` | 4 tests: cached image bytes, 304 revalidation, no-cache revalidated per use, reload skips validators |
| `tests/nova-bridge-shim.test.ts` | `loadShim(reply)` parameter; 2 tests: 204 and 304 resolve |
| `android/app/build.gradle` | 1.10 (11) → 1.11 (12) |
| `android/app/src/main/assets/*` | rebuilt bundle and injected shim |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-18-nova-android-1.11-cache-revalidation.md` | This change log |

## Test Results
The new tests were run before the fixes: 3 resource-loader tests failed (the reload test already passed), and both shim tests failed with `TypeError: Response constructor: Invalid response status code 204/304`.
```
npx vitest run tests/resource-loader.test.ts tests/cache-manager*.test.ts -> 48 passed (48)
npx vitest run tests/nova-bridge-shim.test.ts                          -> 7 passed (7)
npx tsc --noEmit                                                        -> exit 0
npx vitest run                                                          -> 267 files, 10435 passed (10435)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug  -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.11.apk                                          -> verified (1,519,352 B)
```

## Verification Steps
1. Traced the Android fetch path end to end before relying on 304s:
   - `NovaFetchBridge.kt` forwards request headers via `setRequestProperty`, reads an empty stream for 304, and keeps the server's header casing;
   - `FetchHttpClient` lowercases header names and doesn't throw on non-2xx;
   - the shim was the one that broke (root cause 2).
2. Wrote the tests first and saw them fail, then fixed the code and re-ran the files, the full suite (alone this time, so the timing gates weren't skewed by a parallel Gradle build) and tsc.
3. Rebuilt the bundle and confirmed `nullBodyStatus` is in `assets/nova-bridge.js`. Then ran the Kotlin tests and the release build, and zipaligned, signed and verified the APK.
4. **Not done:** no on-device check (`adb devices` was empty).

## Known ceilings
- `CacheManager` is in memory, so revalidation only helps within one app session.
- Back/forward goes through the same freshness rules. There's no bfcache-style "show it as it was".

## What's new in Nova 1.11 (user-facing)
- Images no longer break when you come back to a page.
- Coming back to a page uses less data: unchanged files are confirmed with the server rather than downloaded again.
- Sites that answer with "204 No Content" (analytics beacons, some web apps) no longer error.

## Follow-up — `E:\nova_1\doc\analytics.html` (main checkout, uncommitted)
Asked for after 1.11 ("update E:\nova_1\doc\analytics.html").
- **New entries:** registered the 1.10 and 1.11 docs and copied both `.md` files into `E:\nova_1\doc`, so the entries resolve. That makes 302 entries with full disk coverage both ways and no duplicates.
- **Stale fallback stats:** the hardcoded values still said 295 documents. Recomputed them: 302 docs · 58 days · 10,573 tests · 567 root causes · 1,782 files. Updated the stamp to `2026-10-18 16:55:00`.
- **Lost in the branch→main merge:**
  - **Glassmorphism CSS:** the block added on 2026-10-17 was gone, because the merge took the branch copy of the file. Restored before `@media print` from this session's transcript.
  - **Stray `see`:** `requestAnimationFrame(sweep);see` was back. It throws a ReferenceError at runtime; removed again.
- **Verified:**
  - `node --check` on the inline script passes.
  - Loaded over `http://127.0.0.1:8765` in the built-in browser:
    - KPIs render 302 / 10,573 / 567 / 1,782;
    - the "Nova Android 1.11" row is present;
    - `.glass` has `backdrop-filter: blur(22px) saturate(1.65)`;
    - 0 console errors.
