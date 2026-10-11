# Cookie Jar Networking Wiring

**Date:** 2026-09-17
**Session:** Wire real HTTP cookie handling into the page-load pipeline. Landed into this branch on 2026-09-20 from a separate background session (`charming-gould-cd3a6e`) that had finished and verified this fix independently.
**Status:** Completed

---

## Summary

Nova had two parallel, fully-implemented cookie subsystems and neither was reachable from an
actual HTTP request: `ICookieStore`/`PersistentCookieStore` (`storage/cookie-store.ts`,
`storage/persistent-stores.ts`) was registered in the DI container but never resolved anywhere, and
`CookieJar` (`networking/cookie-jar.ts`) — which has the RFC 6265bis shape (`setFromResponse`,
`getForRequest`, `getCookieHeader`) purpose-built for the request/response pipeline — was referenced
only inside its own file. This session wired `CookieJar` into `ResourceLoader`, the one place every
document/resource load actually passes through (`PageLoader.load()` → `ResourceLoader.loadResource()`
→ `IHttpClient.send()`), so `Set-Cookie` response headers are now stored and a `Cookie` request
header is now attached on every subsequent same-scope request, redirects included.

A real, pre-existing bug was found and fixed along the way: the production transport
(`RawSocketHttpClient`, used whenever Nova runs under Node/Electron) parsed headers into a
`Map<string,string>`, which silently drops all but the last `Set-Cookie` line when a response sets
more than one cookie. That would have made the new wiring lose every cookie except the last one on
any multi-cookie response — a broken feature, not a working one — so the parser now also collects
every `Set-Cookie` line into a `setCookieHeaders` array carried alongside `headers`.

## Investigation

**Which subsystem is "real"?** Confirmed by reading both stores and grepping every reference:
- `Tokens.CookieStore` → `PersistentCookieStore` (`src/app/main.ts:534`) is registered but the token
  is never resolved anywhere in `src/`. Its shape (async Promise-based CRUD, localStorage-backed) fits
  a future "manage cookies" settings UI, not the hot request path.
- `CookieJar` (`src/browser/networking/cookie-jar.ts`) was referenced only within its own file
  despite its doc comment already describing the intended pipeline position
  (`ResponseParser.parse()` → `CookieJar.setFromResponse()` → `RequestManager.send()` →
  `CookieJar.getForRequest()`). It's a synchronous in-memory jar with full domain/path/Secure/
  SameSite/expiry matching — exactly what `getCookieHeader(url)` on an outgoing request needs.
- A third, unrelated cookie layer (`CookieService` in `src/browser/media/cookies.ts`, wrapping its
  own private `InMemoryCookieStore`) also exists and is also unused outside its own module — out of
  scope, left untouched.

**Where does a request actually flow?** `PageLoader.load()` (`src/browser/engine/page-loader.ts`) is
a thin wrapper over `IResourceLoader.loadResource()`; that's the only place headers are visible.
`ResourceLoader` talks to `IHttpClient` directly (bypassing `RequestManager`), and per
`main.ts`'s DI wiring the real production client is `RawSocketHttpClient` (raw TCP/TLS, full header
access) — `FetchHttpClient` (`globalThis.fetch()`) is only the non-Node fallback. That matters
because the Fetch spec hides `Set-Cookie` from a page's own `fetch()` response headers entirely;
`RawSocketHttpClient` has no such restriction, which is why it's the client worth fixing.

**Does the incognito ephemeral wiring need to move?** No changes needed for this fix: incognito's
`beginEphemeral()`/`endEphemeral()` cookie wiring already lives on this branch
(`claude/ponytail-folder-browser-8b310d`), landed separately the same day as the incognito-mode
feature itself. `CookieJar` is what actually holds live network cookies now; `ICookieStore` remains
a reasonable, separate fit for a settings-page cookie manager and stays registered as-is.

## Root Cause

### `RawSocketHttpClient` collapsed multiple `Set-Cookie` headers into one
**File:** `src/browser/networking/raw-socket-http-client.ts`
**Problem:** `parseHttpResponse` parsed headers into a plain `Map<string, string>` via
`headers.set(key, value)`. A response setting more than one cookie sends multiple `Set-Cookie` lines
with the same header name — the last one silently overwrote the rest before the jar ever saw them.
**Fix:** The parse loop now also pushes every `set-cookie` line into a `setCookieHeaders: string[]`
array, returned alongside `headers` on `HttpResponseSpec`. `ResourceLoader` prefers this array and
falls back to `headers.get('set-cookie')` (single cookie) for clients that don't populate it.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/raw-socket-http-client.ts` | `parseHttpResponse` collects every `Set-Cookie` line into `setCookieHeaders` instead of losing all but the last via the headers `Map` |
| `src/browser/networking/request-manager.ts` | `HttpResponseSpec` gains optional `readonly setCookieHeaders?: readonly string[]` |
| `src/browser/networking/resource-loader.ts` | New `ICookieJar` collaborator + `setCookieJar()`; the redirect loop (inside `loadResourceCore()` on this branch) now attaches a `Cookie` header per hop (from `currentUrl`, so cookies don't leak across a cross-host redirect) and applies `Set-Cookie` from every hop's response, not just the final one |
| `src/app/main.ts` | New `Tokens.CookieJar` DI singleton (`CookieJar`); `ResourceLoader` registration calls `loader.setCookieJar(...)` |

## Files Created

- `tests/raw-socket-http-client.test.ts` — `parseHttpResponse` keeps every `Set-Cookie` line in
  `setCookieHeaders` while documenting that `headers.get('set-cookie')` only keeps the last one.

## Test Results

```
npx tsc --noEmit -p .                                         → 0 errors
npx vitest run tests/resource-loader.test.ts tests/raw-socket-http-client.test.ts → 22/22 passed
```

New tests:
- `tests/raw-socket-http-client.test.ts` (new file, 1 test, above).
- `tests/resource-loader.test.ts` (new `Cookie integration` block, 3 tests) — a `Set-Cookie` on one
  request is sent back as `Cookie` on the next; `setCookieHeaders` (not the collapsed `headers` Map)
  is what the jar consumes, so multiple cookies from one response survive; a cookie set for one host
  is not sent to a different host reached via redirect.

## Verification Steps

1. Read `cookie-store.ts`, `persistent-stores.ts`, `cookie-jar.ts`, `cookies.ts` in full; grepped
   every reference to `CookieJar`, `ICookieStore`, `Tokens.CookieStore` across `src/` to confirm
   which subsystem (if either) was actually reachable.
2. Traced the real load path (`PageLoader` → `ResourceLoader` → `IHttpClient`) and the DI wiring in
   `main.ts` to identify the production transport (`RawSocketHttpClient`) versus the browser-`fetch()`
   fallback, and why only the former can see `Set-Cookie` at all.
3. Found the header-collapsing bug by inspecting `parseHttpResponse`'s `Map.set` loop before writing
   any wiring code — fixing it first, so the jar wiring wasn't built on a source that could only ever
   deliver one cookie per response.
4. Wired `CookieJar` into `ResourceLoader` and DI, added the three integration tests plus the parser
   unit test, ran `tsc --noEmit` after every edit, then the full suite — 0 errors, 0 regressions.
