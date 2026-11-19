# Nova Android 1.33 — POST Forms Work

**Date:** 2026-10-27
**Session:** "keep improving the nova app…". RC-12 from [2026-10-21-nova-android-1.26-end-user-test-results.md](2026-10-21-nova-android-1.26-end-user-test-results.md), the last open item from that report besides follow-ups.
**Status:** Completed (installed on the Realme RMX5264; on-device form test pending — the phone locked during testing)

---

## Summary
Forms with `method="post"` now submit: logins, comments, search boxes that post, checkouts. Before, tapping submit logged `[Forms] POST submission is not supported yet` and did nothing (RC-12). The body is encoded per the form's `enctype` and carried on the navigation through to the network. Redirects after the POST follow browser rules. Going Back to a result page reuses its response instead of resubmitting the form.

## Root Cause
### RC-12 — POST forms did nothing
**Files:** `src/ui/pages/browser-window.ts` (`submitForm`), and every layer below it
**Problem:**
- `submitForm` returned early for any method other than GET.
- No layer could carry a request body: `NavigationRequest`/`NavigationEntry` had no body, `IPageLoader.load` had no method, and `ResourceLoader.loadResource` hard-coded `GET`.
- The Android fetch bridge (`NovaFetchBridge.fetch(…, bodyBase64)`) and its JS shim already supported bodies. Nothing above them ever sent one.

**Fix (top to bottom):**

| Layer | Change |
|-------|--------|
| `browser-window.ts` `submitForm` | `post` → `encodeFormBody(entries, enctype)`: `application/x-www-form-urlencoded` (default), `multipart/form-data` (random boundary) or `text/plain`. `dialog` → nothing; unknown methods → GET, as browsers do. |
| `navigation-bridge.ts` `navigate(url, postData?)` | With a body: `navigateTo({ url, type: Push, userInitiated: true, postData })`; never treated as a search |
| `navigation-controller.ts` | `PostData` type; `NavigationRequest.postData` → stored on the `NavigationEntry` |
| `browser-engine.ts` | A POST entry is loaded with `postData` once. The response is kept by entry id (last 5), so Back/Forward to it reuse the result and never resubmit an order or a payment. |
| `engine-types.ts` / `page-loader.ts` | `load(url, signal, { postData })` → `loadResource(url, 'document', { method: 'POST', body, contentType })` |
| `resource-loader.ts` | Sends `POST` with the body and `content-type`. Never reads from or writes to the cache for a POST. After a POST, 303 (and 301/302, as browsers do) continue as GET without the body; 307/308 repeat the POST. |

```ts
if (specBase.method === 'POST' && (res.statusCode === 303 || res.statusCode === 301 || res.statusCode === 302)) {
  const getHeaders = new Map(specBase.headers);
  getHeaders.delete('content-type');
  specBase = { method: 'GET', headers: getHeaders, timeoutMs: specBase.timeoutMs };
}
```

## Not done
- **File uploads.** `<input type=file>` parts are not sent (`formDataEntries` skips them). That needs the native file picker.
- **Reload.** Reloading a form result reloads the address with GET; Nova never resubmits silently, and there is no "resend?" prompt.
- **`form.submit()` from page JS.** It is not routed through `submitForm` yet.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | POST submission; `encodeFormBody`; `navigate(url, postData?)` |
| `src/ui/components/navigation-bridge.ts` | `navigate(url, postData?)` → `navigateTo` with the body |
| `src/browser/navigation/navigation-controller.ts` | `PostData`; `postData` on requests and entries |
| `src/browser/engine/browser-engine.ts` | POST loads once; kept responses for back/forward |
| `src/browser/engine/engine-types.ts` | `IPageLoader.load` `postData` option |
| `src/browser/engine/page-loader.ts` | Passes the POST to the resource loader |
| `src/browser/networking/resource-loader.ts` | `method`/`body`/`contentType` options; no caching; POST redirect rules |
| `android/app/build.gradle` | versionCode 34, versionName 1.33 |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/form-post.test.ts` | 6 tests: urlencoded / multipart / text/plain bodies; POST method, body and content type sent and never cached; 303 → GET without the body, 307 keeps the POST; the engine sends a POST once and reuses it on Back |
| `Nova-1.33.apk` | Signed release build |

## Test Results
```
npx vitest run                         -> Test Files 290 passed (290), Tests 10659 passed (10659), 248 s
npx vitest run tests/form-post.test.ts -> 6 passed (6)
npx tsc --noEmit                       -> clean
gradlew :app:testDebugUnitTest :app:assembleRelease -> OK
apksigner verify Nova-1.33.apk         -> Verifies
adb install -r Nova-1.33.apk (Realme RMX5264, user approved the install prompt) -> Success; versionName 1.33, versionCode 34
```

## Verification
- **Device:** Nova 1.33 launched on the Realme RMX5264. The start page renders in the phone's dark theme.
- **Device:** https://httpbin.org/forms/post loaded (`[render] … layout2 62 · paint2 33 ms`).
- **Device:** the phone then went to sleep and locked, so submitting the form on the device is still pending. Nova never enters the lock-screen PIN or changes system settings to keep the screen awake.
