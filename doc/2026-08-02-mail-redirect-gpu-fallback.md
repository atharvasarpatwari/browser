# mail.com Redirect Following + GPU Compute Fallback

**Date:** 2026-08-02
**Session:** WebView-hosted Nova engine — end-to-end mail.com load verification (301 redirect chain, GPU dispatch overflow)
**Status:** Completed

---

## Summary

Verified the Nova engine can reach `https://mail.com/` end-to-end inside the Android WebView host. Two root causes were fixed along the way: (1) `ResourceLoader` never followed 3xx redirects because it talks to `IHttpClient` directly, bypassing `RequestManager`'s redirect loop; (2) a large rendered page made the GPU rasterizer throw a WebGPU `dispatchWorkgroups` validation error that aborted rendering before the software fallback ran.

## Root Causes

### 1. ResourceLoader bypassed redirect handling
**File:** `src/browser/networking/resource-loader.ts`
**Problem:** Top-level page loads go through `PageLoader` → `ResourceLoader.loadResource()`, which calls `this.client.send(spec, signal)` directly (the WebView path injects `FetchHttpClient` with `redirect: 'manual'`). `RequestManager` — the only component with redirect-following — is never invoked for top-level documents or sub-resources. mail.com returned `301` → the engine treated the tiny 269-byte redirect body as the final document and stayed on the loading placeholder.

**Fix:** Added a capped (10 hops) redirect loop inside `loadResource()`: on 3xx with a `Location` header, resolve relative targets via `new URL(location, currentUrl)` and re-issue through `client.send()` until a non-redirect status arrives. Missing `Location` or too many hops produce a `NetworkError`.

```ts
const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 10;
let currentUrl = url;
let res: HttpResponseSpec;

try {
  for (let hops = 0; ; hops++) {
    res = await this.client.send({ ...specBase, url: currentUrl }, signal);
    if (!redirectStatusCodes.has(res.statusCode)) break;

    const location = res.headers.get('location');
    if (!location) {
      throw new NetworkError(currentUrl, `Received ${res.statusCode} redirect from "${currentUrl}" with no Location header.`);
    }
    if (hops >= maxRedirects) {
      throw new NetworkError(currentUrl, `Too many redirects while loading "${url}" (${hops + 1} hops).`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
} catch (err) {
  if (signal.aborted) throw new RequestAbortedError(currentUrl);
  throw err;
}
```

Verified on device: `fetch#1 GET https://mail.com/` → `301` → `fetch#2 GET https://www.mail.com/` → `200` (175 KB body).

### 2. GPU dispatch overflow aborted sync rasterize
**File:** `src/browser/rendering/gpu/gpu-rasterizer.ts`, `src/browser/rendering/gpu/compute-ops.ts`
**Problem:** With `hardwareAcceleration: true` the `GpuRasterizer` is active. Its sync `rasterize()` submitted the command list through WebGPU compute before delegating to the software fallback. For a large scripted page (mail.com: 464 rules, 17 scripts) a hostile/huge layout dimension produced a `dispatchWorkgroups` argument outside the `unsigned long` range; `encoder.finish()` threw a WebGPU validation error that propagated out of `rasterize()` — the software fallback line was never reached. `NavigationFetcher.renderFromEngine()` caught the throw and showed the fallback placeholder instead of the page.

**Fix:** Two layers:
- `ComputeOps.dispatchCompute` now clamps every workgroup count to a finite value in `[0, 2^32-1]` (NaN/negative/overflow → 0) so a hostile dimension can never produce a validation error.
- All GPU command-encode paths in `GpuRasterizer` (`rasterize`, `rasterizeAsync`, `rasterizeLayerToBuffer`, `compositeLayerToBuffer`) are wrapped in `try/catch`: on error the rasterizer logs, sets `useGpu = false`, and falls back to the software path so the returned frame is always real pixels. `rasterizeAsync` now only attempts GPU readback when the GPU submit actually succeeded, otherwise renders the commands via software.

Verified on device: `[navfetch] rasterize w=1920 h=1080` (no throw) → canvas created with rendered mail.com frame.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/networking/resource-loader.ts` | Redirect-following loop (10-hop cap, relative-Location resolution, NetworkError on missing header) |
| `src/browser/rendering/gpu/compute-ops.ts` | `dispatchCompute` workgroup-count clamping to finite `[0, 2^32-1]` |
| `src/browser/rendering/gpu/gpu-rasterizer.ts` | try/catch + `useGpu=false` fallback on all GPU encode paths; `rasterizeAsync` software fallback for un-submitted frames |

## Files Created
| File | Purpose |
|------|---------|
| (none) | Tests appended to existing `tests/resource-loader.test.ts` |

## Tests Added
`tests/resource-loader.test.ts` — 4 new tests:
- follows a 301 and returns the final body (asserts both requests)
- resolves relative `Location` against current URL
- returns `NetworkError` when a redirect lacks a `Location` header
- caps redirect chains (11 requests → "Too many redirects")

## Test Results
```
> npx vitest run tests/resource-loader.test.ts
 ✓ tests/resource-loader.test.ts (14 tests)  — 14 passed  (10 existing + 4 new)

> npx vitest run tests/browser/rendering/gpu-rasterizer.test.ts
 ✓ 68 tests passed

> npx tsc --noEmit
 only pre-existing errors (tests/browser/rendering/gpu-rasterizer.test.ts:730 mock typing, interpreter/values/vm/web-apis/websocket-api) — zero errors in touched source files
```

## Verification Steps
1. `npm run build:web` → `node android/scripts/copy-web.mjs` → `gradlew :app:assembleDebug` → `adb install -r` → launch → `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`.
2. CDP drive `https://mail.com/`: bridge logs showed `fetch#1` (301) → `fetch#2` (200, 175 KB); render pipeline logged parse (26 resources) → DOM (17 scripts) → styles (464 rules) → layout → paint → rasterize `1920x1080` with no throw.
3. Canvas pixel grid: 1920×1080 canvas present; `addr = https://mail.com/`; mail.com's dark theme rendered (1276 black + 20 light-gray text cells) — images not loaded, expected for the JS-light engine.
4. Regression `https://example.com/`: `fetch#1` → 200 (559 B); canvas all non-black (white bg + text + blue link) — unchanged from previous session.
5. Debug instrumentation (`[render]`/`[pipe]`/`[navfetch]` logs) removed after verification — zero diff on `page-renderer.ts`, `browser-engine.ts`, `navigation-fetcher.ts`.

## Follow-ups
- Address bar commits the original URL (`mail.com`) not the redirect target (`www.mail.com`) because `ResourceLoader` returns the requested URL; browser-typical behavior would update the committed URL to the final destination.
- Window title stays "Nova Browser" (chrome title not synced from document `<title>`).
- mail.com hero images do not render (remote `drawImage` pipeline not fully wired for base64 sub-resources).
