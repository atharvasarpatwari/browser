# HttpOnly Cookie Enforcement (Phase 6a) — document.cookie Was Exposing HttpOnly Cookies

**Date:** 2026-09-28
**Session:** Next roadmap slice after Forms, Permission-Prompt UI, and the Profiles settings page. Investigation compared this against wiring the downloads-panel's `openFile`/`showInFolder`/`retry` stubs; HttpOnly won as the real security bug with no hidden traps (the download stubs are blocked by a separate, undocumented gap — downloaded bytes are never actually written to disk on desktop).
**Status:** Completed (1 root cause fixed)

---

## Summary

`document.cookie`'s JS-facing getter called the exact same `CookieJar.getCookieHeader()` that real HTTP requests use, with zero HttpOnly filtering. `CookieData.httpOnly` was correctly parsed from `Set-Cookie` and stored — nothing anywhere ever read it. That meant any page script (or an XSS payload) could read an HttpOnly-flagged session cookie via plain `document.cookie`, exactly as if HttpOnly were never set — defeating the entire purpose of the attribute. Fixed with a new script-facing accessor that excludes HttpOnly cookies, while the real HTTP request path is untouched and still sends them over the wire exactly per spec.

SameSite enforcement was investigated as the other half of this audit item and found to be materially bigger, separate work — it needs a "requesting site" + top-level-navigation-vs-subresource context that only half-exists in production wiring today (`ResourceLoader.setCors()`, the one seam that context would flow through, is never actually called from `main.ts`) — deferred as its own future phase, not attempted here.

## Root Causes

1. **`document.cookie` had no HttpOnly filtering because it read from the same accessor real HTTP requests use, and nothing else in the cookie jar ever consulted the `httpOnly` flag it already stored.** Fixed by adding `CookieJar.getCookieHeaderForScript(url)` — reuses the existing `getForRequest(url)` matching logic (secure/domain/path/expiry, unchanged) and additionally filters out `cookie.httpOnly === true` before joining into a header string. `document.cookie`'s getter (`src/browser/js/index.ts`) now calls this new method instead of `getCookieHeader()`. `getCookieHeader()`/`getForRequest()`/`get()` themselves are untouched — they back real outgoing HTTP requests (`resource-loader.ts`), which must keep including HttpOnly cookies; HttpOnly only ever hides a cookie from script, never from the network.

## Notes

- **A second candidate was investigated and rejected for this phase**: wiring the downloads panel's `openFile`/`showInFolder`/`retry` stub handlers (`browser-window.ts`, `case 'openFile': break` / `case 'showInFolder': break`). Duplicate-tab (on the same "Phase 6" list) turned out already shipped — a stale audit item, dropped. The three remaining stubs are each individually tiny (a new small Electron IPC channel for `shell.openPath`/`shell.showItemInFolder`, since the renderer runs with `contextIsolation: true` and no existing bridge reaches real `electron.shell`; a `DownloadManager.retry()` method structurally identical to the existing `resume()`) — but `DownloadManager.startDownload()` accumulates fetched bytes in memory purely for progress tracking and **never writes them to disk anywhere on desktop**. Wiring the UI now would demo as "file not found" against any real download. That's real, separate, bigger work (streaming writes, directory handling, path sanitization) — left for a later phase.
- **Live dev-preview verification for this specific fix isn't possible through the Vite-dev-server-in-a-browser-tab harness used throughout this session** — traced down, not skipped: `main.ts`'s `ResourceLoader` DI factory only selects `RawSocketHttpClient` (which correctly captures multi-value `Set-Cookie` via a `setCookieHeaders` array) when a real Electron IPC bridge (`window.nova.ipc`) is present; without it, `ResourceLoader` falls back to `FetchHttpClient`, which calls the browser's real `fetch()` — and the Fetch spec deliberately hides the `Set-Cookie` response header from JS entirely (a forbidden response header, filtered for security), so `res.headers.get('set-cookie')` always returns `null` there. Confirmed live: a page loaded via the dev-preview against a local test server sending two `Set-Cookie` headers showed `document.cookie = ""` — neither cookie reached the jar at all, regardless of HttpOnly, because the dev-preview's `FetchHttpClient` path can never observe `Set-Cookie` in the first place. This is a pre-existing constraint of testing via a plain browser tab, not a flaw in this fix — the real packaged Electron app (with its preload IPC bridge) uses `RawSocketHttpClient` and would capture the cookie correctly. The real-pipeline automated test (below) exercises the exact same `CookieJar` → `PageRenderer` → `document.cookie` code path without this limitation, and is the actual proof of correctness for this fix.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/cookie-jar.ts` | Added `getCookieHeaderForScript(url)` to `ICookieJar`/`CookieJar` — same matching logic as `getForRequest`, additionally excludes HttpOnly cookies |
| `src/browser/js/index.ts` | `document.cookie`'s getter now calls `getCookieHeaderForScript()` instead of `getCookieHeader()` |
| `tests/cookie-jar.test.ts` | +2 tests: HttpOnly excluded from the script-facing header while still present in the real request header; empty string when only an HttpOnly cookie is set |

## Files Created

| File | Purpose |
|------|--------|
| `tests/page-renderer-cookies.test.ts` | Real-pipeline (no mocks) coverage: a page script reading `document.cookie` never sees an HttpOnly cookie set on the same response, while the cookie jar's HTTP-facing header still includes it |
| `doc/2026-09-28-httponly-cookie-enforcement-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 237/237 files, 9374/9374 tests (3 new)
```

## Verification Steps

1. Real-pipeline test (the primary correctness check, no mocks): a real `CookieJar` stores one HttpOnly and one regular cookie via `setFromResponse`; a real `PageRenderer` renders a page whose `<script>` reads `document.cookie` into the DOM; asserted the script only ever sees the regular cookie, while `cookieJar.getCookieHeader()` (the real-HTTP-request path) still includes both.
2. `tests/cookie-jar.test.ts`: confirmed the same distinction at the `CookieJar` unit level directly.
3. Attempted live dev-preview verification; found and documented (see Notes) that the Vite-dev-server-in-a-browser harness can't observe `Set-Cookie` at all due to `FetchHttpClient`'s reliance on the real Fetch API's forbidden-header filtering — a pre-existing environment constraint unrelated to this fix, not a gap in the fix itself.
4. Ran the full suite (`npx tsc --noEmit -p .`, `npx vitest run`) — 0 regressions across all 237 files / 9374 tests.
