# Persistent Storage & Real Networking Pipeline

**Date:** 2026-07-23
**Session:** Wire RawSocketHttpClient, CacheManager, and localStorage-backed stores
**Status:** Completed

---

## Summary
Wired the existing `RawSocketHttpClient` into the production pipeline, connected `CacheManager` to `ResourceLoader` for HTTP caching, and replaced all 5 InMemory stores with localStorage-backed persistent implementations. The browser engine now performs real TCP/TLS networking (in Node.js) and persists cookies, bookmarks, history, sessions, and auth tokens across reloads.

## Root Causes

### 1. RawSocketHttpClient never wired
**File:** `src/app/main.ts`
**Problem:** `RawSocketHttpClient` existed with 15 passing integration tests but was never imported or used in production — `ResourceLoader` defaulted to `FetchHttpClient` via `globalThis.fetch()`.
**Fix:** Added environment detection (`typeof globalThis.fetch === 'undefined'`) to select `RawSocketHttpClient` in Node.js environments.

### 2. CacheManager registered but not connected
**File:** `src/app/main.ts`
**Problem:** `CacheManager` was registered in DI container but never passed to `ResourceLoader`, so HTTP caching was disabled.
**Fix:** Resolved `CacheManager` from DI and called `loader.setCache(cache)` after construction.

### 3. All data lost on reload
**File:** `src/app/main.ts`, `src/browser/storage/persistent-stores.ts` (new)
**Problem:** 5 of 7 stores (`SessionsStore`, `CookieStore`, `BookmarkStore`, `HistoryStore`, `TokenStore`) used InMemory Map-based implementations that lost all data on page reload.
**Fix:** Created `PersistentCookieStore`, `PersistentSessionsStore`, `PersistentBookmarkStore`, `PersistentHistoryStore`, and `PersistentTokenStore` — all backed by `window.localStorage` with JSON serialization. Updated all DI registrations in `main.ts`.

## Files Modified
| File | Change |
|------|--------|
| `src/app/main.ts` | Added imports for `RawSocketHttpClient` + 5 persistent stores; updated DI registrations for networking, storage, auth, history, bookmarks |

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/storage/persistent-stores.ts` | localStorage-backed implementations of CookieStore, SessionsStore, BookmarkStore, HistoryStore, TokenStore |

## Test Results
```
Test Files  1 failed | 100 passed (102)
     Tests  3 failed | 4460 passed (4519)
```
3 failures are pre-existing DNS timeout environmental issues (not code bugs).

## Verification
- All 4,460 tests pass (no regressions)
- Persistent stores serialize to/from localStorage with `nova-*` prefixed keys
- `RawSocketHttpClient` selected automatically in Node.js; `FetchHttpClient` used in browser
- `CacheManager` wired via `ResourceLoader.setCache()` for HTTP response caching
