# Engine Cookie Wiring — Plan

**Date:** 2026-10-16
**Session:** "Wire the engine CookieJar into networking", the follow-up flagged in `2026-10-15-nova-android-cookie-support.md`.
**Status:** Completed. Approved (full scope; switch the Android store and import old cookies) and implemented; see `2026-10-16-engine-cookie-wiring.md`. Deviation: the Android store is a purpose-built `NativeCookieJar` rather than `java.net.CookieManager`, which sends RFC 2965 `$Version` headers for Max-Age cookies.

---

## What the code actually does today (traced this session)

| Area | Finding | Where |
|------|---------|-------|
| `document.cookie` | **Doesn't exist.** `createDocumentBinding()` defines no `cookie` property, so page scripts read `undefined` | `src/browser/js/dom-bindings.ts:139`, called from `src/browser/js/index.ts:1736` |
| Engine `CookieJar` | Complete parser/matcher (domain, path, Secure, HttpOnly, SameSite, expiry, limits), in-memory only, with **zero callers** | `src/browser/networking/cookie-jar.ts` (548 lines, `tests/cookie-jar.test.ts` exists) |
| Second store | `ICookieStore` / `PersistentCookieStore` (localStorage key `nova-cookies`), registered as `Tokens.CookieStore`; only used by `media/cookies.ts`. It's a different data model from `CookieJar`, with no parsing | `src/browser/storage/{cookie-store,persistent-stores}.ts`, `src/app/main.ts:533` |
| Documents + subresources | `ResourceLoader` runs its **own** redirect loop and calls `IHttpClient.send()` per hop | `src/browser/networking/resource-loader.ts:~210` |
| `RequestManager` | Has a redirect/retry loop, but **nothing constructs it** in production; only a doc comment does | `request-manager.ts`, `ip-adapter.ts:210` |
| HTTP client per platform | Desktop (Electron, `isNode`): `RawSocketHttpClient`. Android / plain browser: default `FetchHttpClient` → `globalThis.fetch` → on Android the `nova-bridge.js` shim → native | `src/app/main.ts:439-445` |
| Page `fetch()` / XHR | Use `globalThis.fetch` directly; `setPlatformFetch()` is exported but **never called**. On Android these reach native too; on desktop they're Chromium's own fetch | `src/browser/js/fetch-api.ts:21`, `src/browser/js/xhr.ts:227` |
| Multiple `Set-Cookie` | The raw-socket response parser does `headers.set(key, value)`, so when a server sends several `Set-Cookie` lines **only the last survives** | `raw-socket-http-client.ts:348-356` |
| Android network cookies | Already work (v1.6): every Android request path ends in native `HttpURLConnection`, with `NovaCookieHandler` → `android.webkit.CookieManager`. But webkit's store **doesn't expose HttpOnly**, so it can't safely back `document.cookie` | `android/.../NovaCookieHandler.kt` |

## Plan

### Engine (all platforms)
1. **Script-facing jar API** in `CookieJar`: `getScriptCookieString(url)` returns only non-HttpOnly, path/domain/Secure-matched, non-expired cookies in `a=1; b=2` form. `setFromScript(url, cookieString)` parses one cookie and ignores `HttpOnly` sets, as browsers do.
2. **Persistence:** `CookieJar.serialize()/restore()` into localStorage (`nova-cookie-jar`), with debounced writes. Session cookies (no Expires/Max-Age) are not persisted. Incognito uses a separate in-memory jar, swapped when incognito toggles. `PersistentCookieStore` is left as is; it's a different API used by `media/cookies.ts`.
3. **`document.cookie`** accessor in `createDocumentBinding()` (getter/setter) delegating to a pluggable `ScriptCookieProvider`, with the page URL taken from the document's location. The default provider is the engine jar.

### Desktop network (raw sockets)
4. **`CookieAwareHttpClient`** decorator around whichever `IHttpClient` `main.ts` builds. On each `send()` it adds `cookie:` (unless the caller set one) and stores that hop's `Set-Cookie`s. Because `ResourceLoader` calls `send()` once per redirect hop, cookies set on a 302 (common in logins) are kept too.
5. **Fix multi-`Set-Cookie`** in `RawSocketHttpClient`: collect every value into a new optional `HttpResponseSpec.setCookies: string[]` field, leaving the `headers` Map shape unchanged for existing callers.
6. Applied only where the engine owns the socket (`RawSocketHttpClient` / proxy client). Not applied on Android, where native already owns network cookies, so nothing is sent twice.

### Android
7. **Native store that knows HttpOnly:** replace `WebkitCookieHandler` with `java.net.CookieManager` over a small file-backed `CookieStore` (persist on change, plus on pause). `HttpCookie.isHttpOnly()` exists on API 24+. Incognito routing (v1.6) is unchanged.
8. **`NovaCookies` `@JavascriptInterface`:** `getForScript(url)` returns non-HttpOnly cookies only, and `setFromScript(url, value)` refuses HttpOnly. Both follow the current incognito jar. `nova-bridge.js` installs it as the `ScriptCookieProvider` on Android. These are synchronous calls, so the `document.cookie` getter stays synchronous.
9. Existing logins from v1.6 (webkit store) are imported once on first run so nobody gets logged out.

### Not in scope (noted)
- **SameSite enforcement on requests:** the client layer doesn't know the initiating site. The jar stores the attribute but treats requests as same-site for now (`ponytail:` comment, upgrade path is to pass the initiator through `HttpRequestSpec`).
- **Desktop page `fetch()`/XHR:** these go through Chromium's own fetch, not the engine socket. Routing them via `setPlatformFetch()` is a separate change.
- **Third-party cookie blocking.**

## Tests
- vitest:
  - jar script API (HttpOnly hidden; HttpOnly set refused; path, Secure, expiry);
  - serialize/restore round-trip, session cookies dropped;
  - `CookieAwareHttpClient` (sends, stores, keeps cookies set on a 302 hop, caller's own `cookie` wins);
  - raw-socket parser with 3 `Set-Cookie` lines;
  - `document.cookie` get/set through the binding with a fake provider.
- Kotlin unit:
  - file-backed store round-trip;
  - `getForScript` hides HttpOnly;
  - incognito isolation (existing test kept).
- Device: feature-test **#16**. The server sets `a=1` and `b=2; HttpOnly`; `document.cookie` in the page shows `a=1` only; a script sets `c=3`, which reaches the server on the next request and survives a restart.
- Regression: full `npx vitest run`, `npx tsc --noEmit`, Gradle unit tests + release build.

## Deliverables
Doc `doc/2026-10-16-engine-cookie-wiring.md` (results), README/analytics entries, Nova APK **1.7**.
