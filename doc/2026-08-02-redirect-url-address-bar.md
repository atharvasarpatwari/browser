# Address Bar Commits Post-Redirect URL

**Date:** 2026-08-02
**Session:** Propagate the final post-redirect URL (www.mail.com) to the document base URL, history entry, and address bar
**Status:** Completed

---

## Summary

After the redirect-following fix, the address bar still committed the *requested* URL (`https://mail.com/`) instead of the *final* URL (`https://www.mail.com/`), and the document base URL resolved relative links against the wrong origin. This session made `ResourceLoader` report the final redirected URL, recorded it on the page-load session, updated the history entry in place, and surfaced it to the address bar via a new dedicated navigation event.

## Root Causes

### 1. ResourceLoader reported the requested URL, not the final URL
**File:** `src/browser/networking/resource-loader.ts`
**Problem:** The redirect loop tracked `currentUrl` through each 3xx hop, but the success `ResourceLoadResult` still returned the original `url`. Downstream this became `PageLoadResult.url`, which is the document base URL — so relative links in a redirected page resolved against the pre-redirect origin (a real correctness bug, not just cosmetic).
**Fix:** Return `url: currentUrl` in the success branch:

```ts
return {
  url: currentUrl,
  kind: _kind,
  statusCode: res.statusCode,
  ...
};
```

### 2. Navigation commit had no channel to reflect a server-side redirect
**File:** `src/browser/navigation/navigation-controller.ts`, `src/ui/components/navigation-bridge.ts`
**Problem:** The address bar URL is written only from `navigationCommitted` (`navigation-bridge.ts:254-262`), and the history entry is created with the requested URL *before* the fetch (`navigation-controller.ts:602-622`). Re-emitting `navigationCommitted` was not an option because `BrowserEngine` subscribes to it and would start a second document fetch (`browser-engine.ts:343`).
**Fix:** Added a dedicated `urlRedirected` navigation event that is informational only (no re-fetch). `NavigationController.commitRedirectedUrl(url)` replaces the current entry's URL in place — preserving `id`, `title`, `timestamp`, scroll, and `state` so the router does not treat it as a new navigation — then emits `{ kind: 'urlRedirected', url, entry }`. `NavigationBridge` subscribes to it and updates `_currentUrl`, the address bar, and secure state, then emits the bridge's existing `urlNavigated` event so `BrowserWindowPage.syncAll()` re-renders the address bar view.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/resource-loader.ts` | Success result now returns `url: currentUrl` (final post-redirect URL) |
| `src/browser/navigation/navigation-controller.ts` | New `'urlRedirected'` event type + `UrlRedirectedEvent`; new `commitRedirectedUrl(url)` on `INavigationController` and implementation |
| `src/browser/engine/browser-engine.ts` | `PageLoadSession.finalUrl` field; `runPipeline` sets it and calls `commitRedirectedUrl` when `raw.url !== entry.url` |
| `src/ui/components/navigation-bridge.ts` | Subscribes to `'urlRedirected'`; handler updates address bar/secure state and emits `urlNavigated` |
| `src/ui/components/navigation-fetcher.ts` | Fallback render prefers `session.finalUrl` over `session.entry.url` |
| `tests/resource-loader.test.ts` | Assert `result.url` equals the redirect target (absolute + relative Location) |
| `tests/navigation-controller.test.ts` | 2 new tests: `commitRedirectedUrl` updates entry URL (same id, no `navigationCommitted`, emits `urlRedirected`); no-op on unchanged/invalid URLs |

## Test Results

```
npx vitest run tests/resource-loader.test.ts tests/navigation-controller.test.ts tests/navigation-bridge.test.ts
  tests/navigation-bridge.test.ts    (25 tests)  passed
  tests/navigation-controller.test.ts (41 tests)  passed   <- 39 before, +2 new
  tests/resource-loader.test.ts      (14 tests)  passed   <- redirect result.url asserts added

npx vitest run tests/browser/rendering/gpu-rasterizer.test.ts
  68 passed (regression)

npx tsc --noEmit
  only pre-existing errors (interpreter.ts, values.ts, vm.ts, web-apis.ts, websocket-api.ts, gpu-rasterizer.test.ts mock) — none in edited files

Full suite: 8425 passed / 6 failed — the 6 failures (bytecode-vm, js-builtins, worker, networking-integration DNS, rasterizer) confirmed pre-existing by running the same files against git HEAD via stash.
```

## Verification Steps (device KNEUZTEE6TIBAIIV)

1. `npm run build:web` → `node android/scripts/copy-web.mjs` → `cd android && .\gradlew.bat :app:assembleDebug --no-daemon` → `adb install -r` → force-stop + start `com.nova.browser`.
2. Debug logs (removed after verification) confirmed the path:
   - `[engine] redirect: entry= https://mail.com/ final= https://www.mail.com/`
   - `[bridge] urlRedirected → https://www.mail.com/ was https://mail.com/`
3. Final clean build via `cdp-drive-mail.cjs`: `fetch#1` 301 → `fetch#2` 200 (175 KB) → **`inputVal: "https://www.mail.com/"`** (was `https://mail.com/`).
4. Canvas regression: mail.com renders 1920×1080 (567/576 dark cells); example.com renders (14/576 dark cells, white bg + text row).
5. example.com navigation: single fetch 200 (559 B), address bar commits `https://example.com/` — no redirect, no regression.

## Notes

- The `copy-web.mjs` step must be run as its own command — chaining it after `npm run build:web` in the same PowerShell line silently skipped the copy on this machine, leaving a stale bundle in `android/app/src/main/assets`.
- `address-bar.view.ts:87` only writes the DOM input value when the input is not focused; `urlNavigated` → `syncAll()` re-render is what makes the redirect URL visible.
