# Engine Cookie Wiring (Nova Android v1.7)

**Date:** 2026-10-16
**Session:** "Wire the engine CookieJar into networking". Plan: `2026-10-16-engine-cookie-wiring-plan.md` (approved: full scope, desktop + Android; switch the Android store and import old logins).
**Status:** Completed. One blocking pre-existing issue found (page scripts never run; see *Finding*), flagged as a separate task.

---

## Summary

The engine's `CookieJar` is now live:
- **Desktop page loads** carry cookies on every request and redirect hop, persisted to localStorage.
- **`document.cookie` exists** for page scripts, with HttpOnly enforced, on desktop through the engine jar and on Android through a new native bridge.
- **Android's native store** was replaced with an HttpOnly-aware, file-persisted jar, and v1.6 logins are imported.

Fixed along the way:
- the raw-socket client kept only the last `Set-Cookie`;
- three RFC bugs in `CookieJar`.

## Root Causes

### 1. The CookieJar had no callers; `document.cookie` didn't exist
**Files:** `src/browser/networking/cookie-jar.ts`, `src/browser/js/dom-bindings.ts`
**Problem:** Nothing called `setFromResponse`/`getCookieHeader`, and `createDocumentBinding()` defined no `cookie` property, so page scripts read `undefined`.
**Fix:**
- **New `cookie-service.ts`:**
  - `CookieService` holds the normal jar, restored from and debounce-saved to localStorage key `nova-cookie-jar`; session cookies are never written. Each incognito session gets a fresh, unsaved jar.
  - `CookieAwareHttpClient` is an `IHttpClient` decorator that adds `cookie:` (unless the caller set one) and stores that hop's `Set-Cookie`s.
  - A `ScriptCookieProvider` registry backs `document.cookie`.
- **`main.ts` `installCookies()`:** on Android (when `window.NovaCookies` exists) the provider is the native bridge; elsewhere it's `CookieService`. The decorator wraps only the clients where the engine owns the socket (`RawSocketHttpClient` / `ProxyAwareHttpClient`). The hook sits at the client level because `ResourceLoader` calls `client.send()` once per redirect hop (cookies set on a login 302 are kept), and `RequestManager` turned out to have **no production callers**.
- **`document.cookie`:** a getter/setter in `createDocumentBinding(doc, domTree, cookieUrl)`, scoped to `controller.getCurrentEntry().parsedUrl.href` (the same source as `location.href`).
- **Incognito:** `BrowserWindowPage.setIncognitoExternal()` calls `setCookieIncognito()`.
- **Jar script API:** `getScriptCookieString()` hides HttpOnly. `setFromScript()` refuses `HttpOnly` and can't overwrite an existing HttpOnly cookie (RFC 6265bis §5.6). `serialize()`/`restore()` handle persistence.

### 2. Only the last `Set-Cookie` survived on desktop
**File:** `src/browser/networking/raw-socket-http-client.ts`
**Problem:** The response parser did `headers.set(key, value)`, so when a server sends several `Set-Cookie` lines (normal, e.g. session + CSRF), all but the last were lost. They can't be comma-joined either, because `Expires` dates contain commas.
**Fix:** Every value is also collected into a new optional `HttpResponseSpec.setCookies: string[]`. The `headers` Map shape is unchanged for existing callers.

### 3. CookieJar RFC bugs that mattered once it was live
- **Default path:** a cookie without `Path` got `/`. RFC 6265 §5.1.4 says the request's directory, so `/app/login` gives `/app`. Fixed.
- **`Max-Age=0` / past `Expires` must delete (logout):** the jar *stored* the expired cookie instead. It now deletes it. The old `prune` test depended on storing; it now uses a cookie that expires over (fake) time, plus a new explicit logout test.
- **Replacement vs limits:** replacing an existing cookie counted against the per-domain and total limits. Fixed. `Domain` is also lower-cased.

### 4. Android's store couldn't back `document.cookie`
**File:** `android/app/src/main/java/com/nova/browser/NovaCookieHandler.kt`
**Problem:** v1.6 stored cookies in `android.webkit.CookieManager`, which doesn't expose HttpOnly, so it can't safely answer `document.cookie`. `java.net.CookieManager` (the planned replacement) turns any `Max-Age` cookie into an RFC 2965 "version 1" cookie and sends `$Version="1"; sid="x";$Path="/"`, which many servers don't parse.
**Fix:**
- **New `NativeCookieJar`:**
  - `HttpCookie.parse` for attributes;
  - own RFC 6265 matching (host-only vs domain, path, Secure, expiry);
  - plain `name=value` output;
  - HttpOnly-aware `cookieHeader(forScript)` / `setCookie(fromScript)`.
  - Persisted to `filesDir/nova-cookies.json` as one tab-separated line per cookie. RFC 6265 forbids control characters in names, values, domains and paths, so no escaping is needed. `org.json` also isn't usable in JVM unit tests.
- **`NovaCookieHandler`:** routes normal vs incognito, flushes on pause, and is exposed to the engine bundle as `window.NovaCookies` (`NovaCookiesBridge`, `@JavascriptInterface getForScript/setFromScript`).
- **Import of v1.6 logins:** the WebView store can't be enumerated, so on the first history snapshot each history origin's `CookieManager.getCookie()` pairs are imported once. They come in as host-only, path `/`, **HttpOnly** (attributes unknown, so hidden from scripts to be safe), and kept 30 days. Guarded by a `legacyCookiesImported` preference.

## Finding (pre-existing, not fixed here): page scripts never run in the app
`main.ts` builds the `PageRenderer` with `sanitizer: new HtmlSanitizer()`. `render()` runs the sanitizer (step 3b) **before** `executeAllScripts` (step 5), and the sanitizer strips `<script>` unless `keepScriptElements: true`, which only a test sets. A headless boot of the Android bundle confirmed it: a page whose inline script sets `document.cookie` and `location.href` produced no follow-up navigation and no bridge calls. So `document.cookie` is correct and tested through the real interpreter (`runJS`), but pages can't reach it in the app until scripts run. Enabling page JavaScript is a security decision, so it's queued as a separate task ("Decide and fix: page scripts are stripped before running") rather than flipped here. Network cookies don't depend on it and are live now.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/networking/cookie-jar.ts` | script API, `serialize`/`restore`, `onChange`, default-path, delete-on-expire, replacement limits, lower-case Domain; header comment updated |
| `src/browser/networking/raw-socket-http-client.ts` | collect every `Set-Cookie` |
| `src/browser/networking/request-manager.ts` | `HttpResponseSpec.setCookies?` |
| `src/browser/js/dom-bindings.ts` | `document.cookie` accessor via `ScriptCookieProvider` |
| `src/browser/js/index.ts` | passes the document URL to the binding |
| `src/ui/pages/browser-window.ts` | incognito → `setCookieIncognito()` |
| `src/app/main.ts` | `installCookies()`; decorator around engine-owned socket clients |
| `tests/cookie-jar.test.ts` | prune test → time-based expiry; new logout (Max-Age=0) test |
| `android/app/src/main/java/com/nova/browser/NovaCookieHandler.kt` | rewritten: `NativeCookieJar`, `NovaCookiesBridge`, `importLegacy`; `WebkitCookieHandler` removed |
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | installs the file-backed jar; `cookies.flush()` on pause; one-time legacy import |
| `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt` | registers `window.NovaCookies` |
| `android/app/src/test/java/com/nova/browser/NovaCookieHandlerTest.kt` | 5 tests (was 2) |
| `android/scripts/emulator-feature-test.mjs` | `/cookie/pair` route + check #16 |
| `android/app/src/main/assets/**` | engine rebuilt (`main-CwDLMxNu.js`) |
| `android/app/build.gradle` | version 1.7 (code 8) |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/networking/cookie-service.ts` | `CookieService`, `CookieAwareHttpClient`, provider registry, `setCookieIncognito` |
| `tests/cookie-service.test.ts` | 10 tests: HttpOnly hidden/unwritable; default-path; serialize/restore; debounced persistence across "launches"; incognito isolation and not saved; cookies from a 302 hop sent next; caller's Cookie wins; raw parser keeps 3 Set-Cookies (incl. an Expires with commas); `document.cookie` through `runJS`; empty without a provider |
| `doc/2026-10-16-engine-cookie-wiring-plan.md` | Plan (approved) |
| `doc/2026-10-16-engine-cookie-wiring.md` | This changelog |

## Test Results
```
npx vitest run tests/cookie-jar.test.ts            -> first run: 1 failed (prune relied on storing Max-Age=0) -> test updated
npx vitest run tests/cookie-service.test.ts tests/cookie-jar.test.ts -> Tests 34 passed (34)
npx tsc --noEmit                                     -> 0 errors
npx vitest run                                       -> Test Files 219 passed (219), Tests 9217 passed (9217)

cd android && gradlew.bat :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug
  first: e: EngineWebView.kt Unresolved reference: NovaCookiesBridge -> missing import, fixed
  then:  NovaCookieHandlerTest > persistentCookies... "Method put in org.json.JSONObject not mocked" -> switched to line format
  final: BUILD SUCCESSFUL, unit tests 33 (all pass), 0 warnings
after version bump: BUILD SUCCESSFUL in 2m 3s; aapt2 versionCode='8' versionName='1.7'; apksigner verify OK
R8 mapping: getForScript kept; packaged main-CwDLMxNu.js contains "NovaCookies": True

npx vite build -> main-CwDLMxNu.js 1,368.21 kB (gzip 322.02 kB); node android/scripts/copy-web.mjs -> Bridge injected
Headless boot of the Android bundle with stub NovaStateBridge/NovaFetchBridge/NovaCookies:
  engine boots, navigation to https://shop.test/account/ completes (server hit), 0 page errors,
  but cookie bridge calls: []: page scripts are stripped by HtmlSanitizer (see Finding)
node --check android/scripts/emulator-feature-test.mjs -> OK
```

## Verification Steps
- Desktop network cookies: covered by the `CookieAwareHttpClient` + raw-parser tests. A live Electron run wasn't done this session.
- **On device / emulator** (still blocked on the AEHD driver install): `npm run android:feature-test -- --adb <adb> --only 15,16`.
  - **#15** checks native cookies: stored, sent, survive a restart, isolated in incognito.
  - **#16** checks the bridge: hides HttpOnly, script writes reach the server, and HttpOnly can't be overwritten by script.

## What's new in Nova 1.7 (user-facing)
- Sites that set several cookies at once (session + security token) keep all of them on desktop.
- Logging out of a site actually clears its session cookie.
- On Android, cookies now live in Nova's own store, which knows which ones pages may read; existing logins from 1.6 are carried over.
- `document.cookie` works with HttpOnly protection, for page scripts once script execution is enabled (separate task).
