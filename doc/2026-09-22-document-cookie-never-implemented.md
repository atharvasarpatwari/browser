# `document.cookie` Was Never Implemented — Found Bisecting Wikipedia

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps after closing out the YouTube-bisection list. Switched targets (YouTube's inline/external scripts are now fully clean) and bisected `en.wikipedia.org` the same way — real HTML fetched directly, every script run through Nova's own `Lexer`/`Parser`/`runJS` — which surfaced a real, high-impact gap in a completely different subsystem than this session's earlier JS-engine fixes.
**Status:** Completed (1 root cause fixed)

---

## Summary

`document.cookie` didn't exist anywhere in Nova's `document` binding — reading it returned `undefined`, and any real-world code that reads it unconditionally (the overwhelming majority of client-side cookie-handling code does, e.g. MediaWiki's own `document.cookie.match(/.../)`  ) crashed immediately with `Cannot read properties of undefined (reading 'match')`. Nova already had a full, real RFC 6265bis `CookieJar` for the HTTP networking pipeline (`src/browser/networking/cookie-jar.ts`) — it was just never wired to the JS-facing API at all.

## Root Cause

**File:** `src/browser/js/index.ts` (`createGlobalEnv()`), `src/browser/networking/resource-loader.ts` (`IResourceLoader`), `src/browser/engine/page-renderer.ts`
**Real trigger:** `document.cookie.match(/(?:^|; )enwikimwclientpreferences=([^;]+)/)` — real Wikipedia code checking a user preference stored in a cookie, found while bisecting `en.wikipedia.org/wiki/JavaScript`.
**Problem:** `createDocumentBinding()` never set a `cookie` property on the `document` object at all. In a real browser, `document.cookie` always returns a string (empty if there are no cookies) — never `undefined` — and a huge amount of real-world code relies on that guarantee without checking for it first. Nova's `ResourceLoader` already had a real, working `CookieJar` (parses `Set-Cookie`, matches cookies to requests by domain/path/secure/SameSite, RFC 6265bis-compliant) wired into the HTTP request/response pipeline, but nothing connected it — or any fallback — to the JS environment.
**Fix:**
- Added `getCookieJar(): ICookieJar | null` to `ResourceLoader` (and its `IResourceLoader` interface), exposing the same jar already used for real HTTP requests.
- `createGlobalEnv()` gained an optional trailing `cookieJar` parameter (appended at the end, not inserted mid-list, since every existing call site passes its arguments positionally) and now sets a real `cookie` accessor property on `document`: the getter returns `cookieJar.getCookieHeader(pageOrigin)` and the setter calls `cookieJar.setFromResponse(pageOrigin, [rawValue])` — reusing the existing `Set-Cookie`-parsing method as-is, since a `document.cookie = "name=value; path=..."` assignment uses the exact same attribute syntax as one `Set-Cookie` header.
- When no real jar/origin is available (unit tests, or any other `createGlobalEnv()` caller that doesn't wire one up), falls back to a page-local in-memory `Map` so reads/writes still round-trip sanely instead of crashing or silently no-op-ing.
- `page-renderer.ts`'s real script-execution path now passes `resourceLoader.getCookieJar()` through, so a page reading/writing `document.cookie` sees the exact same cookies its own real HTTP requests already carried (and vice versa — a cookie set via JS is immediately available to the next real request `ResourceLoader` makes).

## Notes

- Verified end-to-end, not just the crash fix: pre-loaded a `CookieJar` with a simulated `Set-Cookie` response, confirmed `document.cookie` read it back, then set a new cookie via `document.cookie = "..."` and confirmed both (a) it was immediately visible to a subsequent `document.cookie` read in the same script, and (b) the underlying `CookieJar` now has it available for real future HTTP requests too — the full real request/response ↔ JS loop, not a one-directional stub.
- `createGlobalEnv()`'s new parameter was deliberately appended at the very end of the parameter list rather than inserted where it logically groups with the other CSP/origin parameters — every real call site (`page-renderer.ts`, dozens of tests) passes arguments positionally, so inserting mid-list would have silently shifted every subsequent parameter at any call site passing more than a few args, corrupting `pageOrigin`/`htmlParser`/`storageDir` without a type error.
- Two existing test files (`tests/page-loader.test.ts`, `tests/page-renderer.test.ts`) mock `IResourceLoader` and needed the new `getCookieJar` method added to their mocks after it was added to the interface — caught immediately by `tsc`, not a runtime surprise.
- This is a different bisection target and a different subsystem than this session's earlier 5 JS-engine fixes (all found on `youtube.com`, all in the lexer/parser/global-object layer) — confirms the "bisect a real site, fix what's actually broken" methodology generalizes past one site and one class of bug.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | `createGlobalEnv()` gains a trailing `cookieJar?: ICookieJar` parameter; sets a real `cookie` getter/setter on `document`, backed by the jar when present, a page-local `Map` fallback otherwise |
| `src/browser/networking/resource-loader.ts` | `ResourceLoader` gains `getCookieJar()`; added to the `IResourceLoader` interface |
| `src/browser/engine/page-renderer.ts` | Passes `resourceLoader.getCookieJar()` into `createGlobalEnv()` |
| `tests/page-loader.test.ts`, `tests/page-renderer.test.ts` | Mock `IResourceLoader` objects gain `getCookieJar: vi.fn()` |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check (`document.cookie` is always a string and round-trips a written value) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 227/228 files, 9313/9316 tests passed (3 pre-existing DNS-timeout failures, unrelated — see doc/known-test-failures.md)
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
Real Wikipedia trigger line                              → no longer throws
```

## Verification Steps

1. Fetched `en.wikipedia.org/wiki/JavaScript`'s real HTML directly and ran its 3 inline scripts through `runJS()` — found `document.cookie.match(...)` throwing `Cannot read properties of undefined`.
2. Confirmed `document.cookie` was simply never set on the `document` binding anywhere in `src/browser/js/`, and that a real, unused `CookieJar` already existed one layer down in the networking stack.
3. Wired it through with the smallest change that connects the two: expose the jar, thread it through `createGlobalEnv()`, add a real accessor property that delegates to the jar's existing `getCookieHeader`/`setFromResponse` methods.
4. Verified with 3 minimal repros before considering it done: `document.cookie` is a string and a real regex match against it returns `null` for a missing cookie; a `document.cookie = "..."` write round-trips within the same script; the exact real Wikipedia trigger line no longer throws.
5. Verified the real-jar path specifically (not just the local-fallback path): pre-populated a `CookieJar` via `setFromResponse()` (simulating a prior HTTP response), confirmed `document.cookie` read it, then confirmed a JS-side write flowed back into the same jar.
6. Added 1 permanent e2e regression check, rebuilt, and re-ran the full vitest suite, the full real-Electron e2e suite, and a full typecheck for regressions.
