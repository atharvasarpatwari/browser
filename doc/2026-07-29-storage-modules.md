# Storage API Modules

**Date:** 2026-07-29
**Session:** 7 storage modules — Cookies, LocalStorage, SessionStorage, IndexedDB, Cache API, File System Access API, OPFS
**Status:** Completed

---

## Summary

Created 7 storage wrapper modules under `src/browser/media/`, each following the `IDisposable` + `onEvent` pattern. Four modules wrap existing storage infrastructure (`src/browser/storage/`) and three are entirely new implementations.

## Architecture Decisions

### Which modules wrap existing code vs. are new

| # | Module | Approach | Existing source |
|---|--------|----------|----------------|
| 1 | CookieService | Wraps `storage/cookie-store.ts` InMemoryCookieStore | `ICookieStore` interface |
| 2 | LocalStorageService | Wraps `storage/local-storage.ts` NovaLocalStorage | `NovaLocalStorage` + `InMemoryStorageBackend` |
| 3 | SessionStorageService | Wraps `storage/session-storage.ts` NovaSessionStorage | `NovaSessionStorage` |
| 4 | IndexedDBService | Wraps `storage/indexed-db.ts` IDBFactory | `IDBFactory` + `InMemoryIndexedDBBackend` |
| 5 | CacheStorageService | Self-contained W3C Cache Storage API | No existing W3C Cache API |
| 6 | FileSystemAccessService | Self-contained W3C File System Access API | No existing API (only abstract `FileSystemOps`) |
| 7 | OPFSService | Self-contained Origin Private File System | No existing implementation |

### Bug fixed:
- `IndexedDBService` passed args in wrong order to `IDBFactory(backend, origin)` 

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/media/cookies.ts` | CookieService wrapping InMemoryCookieStore with events |
| `src/browser/media/local-storage.ts` | LocalStorageService wrapping NovaLocalStorage |
| `src/browser/media/session-storage.ts` | SessionStorageService wrapping NovaSessionStorage |
| `src/browser/media/indexed-db.ts` | IndexedDBService wrapping IDBFactory |
| `src/browser/media/cache-api.ts` | CacheStorageService + CacheFacade (W3C Cache API) |
| `src/browser/media/file-system.ts` | FileSystemAccessService + InMemoryFileHandle/InMemoryDirectoryHandle |
| `src/browser/media/opfs.ts` | OPFSService + OPFSDirectoryHandleImpl/OPFSFileHandleImpl/OPFSWritableStreamImpl |
| `tests/storage.test.ts` | 58 tests covering all 7 modules |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/media/index.ts` | Added 7 new exports (classes + interfaces + event types) |

## Test Results

```
 Test Files  1 passed (1)
      Tests  58 passed (58)
```

## Verification Steps

1. `npx vitest run tests/storage.test.ts` — 58/58 pass
2. Aggregate with all previous suites: `npx vitest run tests/security.test.ts tests/storage.test.ts tests/media.test.ts tests/graphics.test.ts tests/web-apis.test.ts` — all pass
