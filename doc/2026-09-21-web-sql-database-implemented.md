# Web SQL Database — Implemented from Scratch

**Date:** 2026-09-21
**Session:** Asked to "give me the database and implement them in the browser" — genuinely ambiguous, since Nova already has a full, wired IndexedDB implementation. Clarified with the user: they meant the deprecated **WebSQL** API (`window.openDatabase`), which was confirmed genuinely missing.
**Status:** Completed

---

## Summary

Web SQL Database (the W3C draft that shipped `window.openDatabase()`/`SQLTransaction`/`executeSql()` before it was abandoned in favor of IndexedDB) had zero implementation in Nova — no `openDatabase`, no `SQLTransaction`, no `SQLError`, confirmed by grep before writing anything. It's deprecated, but real legacy pages still use it, and IndexedDB doesn't substitute for it API-wise (different shape entirely: SQL text + callbacks vs. object stores + cursors).

Built a real, bounded SQL engine rather than a full one: a hand-written tokenizer + recursive-descent parser + executor covering `CREATE TABLE [IF NOT EXISTS]`, `DROP TABLE [IF EXISTS]`, `INSERT INTO [(cols)] VALUES (...)`, `SELECT (*|cols) FROM ... [WHERE ...] [ORDER BY ...] [LIMIT n]`, `UPDATE ... SET ...`, and `DELETE FROM ...`, with `?`-placeholder binding, `AND`/`OR`/parenthesized `WHERE` clauses, and comparison operators including `LIKE`. This covers the CRUD shape real legacy WebSQL demo/toy apps actually use. No JOINs, no subqueries, no real transactional rollback — documented as a deliberate ceiling, matching how this codebase already scopes the native-networking HTTP/TLS gaps rather than pretending to be complete.

Followed the exact architecture Nova already uses for localStorage/IndexedDB: a real TypeScript engine + persistence backend in `src/browser/storage/`, wired into the guest JS environment via a dedicated bindings file in `src/browser/js/`, called from `createGlobalEnv()` right alongside `bindStorageAPIs`.

## Design

- **`src/browser/storage/web-sql.ts`** — the real engine. `NovaDatabase` (per-origin-per-name, backed by `IWebSQLBackend`) and `NovaSqlTransaction` (a queue of `executeSql()` calls, drained one at a time so a success/error callback can itself queue more, matching the spec's chaining behavior). `SQLError` mirrors the old spec's numeric error codes (`SYNTAX_ERR`, `DATABASE_ERR`, `VERSION_ERR`, etc.). `InMemoryWebSQLBackend` and `DiskWebSQLBackend` (JSON file per origin+db name under `userData`) mirror `local-storage.ts`'s exact backend pattern.
- **`src/browser/js/web-sql-bindings.ts`** — translates between the real engine's TS API and Nova's guest `JSValue`/`JSObject` shapes: wraps `Database`/`SQLTransaction`/`SQLResultSet`/`SQLError` as guest objects, converts a guest array argument to real `SqlValue[]`, and invokes guest success/error callback functions via `callJSFunction`. Transaction draining is scheduled via `eventLoop.enqueueMicrotask()` so it's genuinely asynchronous, matching real browser timing (a page can't assume `executeSql`'s callback fires synchronously).
- Wired into `createGlobalEnv()` in `src/browser/js/index.ts`, sharing the same `pageOrigin`/`storageDir` options `bindStorageAPIs` already uses.

## Notes

- Read-only transactions (`db.readTransaction(...)`) reject any non-`SELECT` statement with an error, matching spec behavior — verified live.
- `changeVersion()` enforces the expected-old-version check the spec requires, including the "empty string always matches" special case.
- Caught a real bug in my own first draft before it shipped: the `DELETE` statement's row-filtering predicate was inverted (kept matching rows instead of removing them) — found by writing tests for the intended behavior first and confirming they failed against the draft, not by inspection alone.
- Also hit a second self-caught issue: my first test file used `await run(tx, sql)` (a promise tied to one queued statement) *before* calling `tx.drain()`, which deadlocks since nothing processes the queue until `drain()` is called — this looked exactly like a hung/infinite-looping engine from the outside (multiple tests time out with zero output) and took a `--testTimeout` flag plus a plain-Node isolation pass to prove the engine itself was fine and the bug was in the test's own await ordering.
- ponytail: no JOINs, no subqueries, no aggregate functions (`COUNT`/`SUM`/etc.), no real rollback-on-error — a page doing anything beyond CRUD against a single table needs a real embedded engine (e.g. `sql.js`); this covers what legacy WebSQL pages actually tend to do, not the full SQL surface.

## Files Created

- `src/browser/storage/web-sql.ts` — SQL tokenizer, parser, executor, `NovaDatabase`/`NovaSqlTransaction`, in-memory + disk persistence backends
- `src/browser/js/web-sql-bindings.ts` — guest-JS wrapper exposing `window.openDatabase`
- `tests/web-sql.test.ts` — 14 tests against the engine directly
- `tests/web-sql-bindings.test.ts` — 4 tests through the real page-script pipeline (`runJS`/`createGlobalEnv`)

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | Added `bindWebSQL(env, eventLoop, { origin, diskPath })` call in `createGlobalEnv()`, alongside the existing `bindStorageAPIs` call |

## Test Results

```
npx tsc --noEmit -p .                                            → 0 errors
npx vitest run tests/web-sql.test.ts tests/web-sql-bindings.test.ts → 18/18 passed
npx vitest run (full suite)                                      → 228/228 files, 9305/9305 tests, 0 regressions
Real Electron diagnostic (CREATE/INSERT/SELECT/UPDATE, readTransaction enforcement) → all 3 checks passed live
```

## Verification Steps

1. Grepped for `openDatabase`/`SQLTransaction`/`WebSQL`/`executeSql` across `src/` before writing anything — confirmed genuinely absent (unlike IndexedDB, which is already fully wired).
2. Read `local-storage.ts`, `indexed-db.ts`, and `web-storage-bindings.ts` in full to match Nova's established backend/bindings architecture exactly, rather than inventing a new pattern.
3. Wrote the engine, then wrote its test file second — caught the inverted `DELETE` predicate this way (tests failed against the real draft before the fix, confirming the bug was real).
4. Wrote the JS-bindings test file using the same `runJS`/`createGlobalEnv` real-pipeline pattern established earlier this session (`script-execution.test.ts`) — caught the test-deadlock bug the same way (tests hung until the await-ordering issue was found and fixed).
5. Ran the full unit suite (0 regressions) and a real Electron diagnostic serving a page over a real local HTTP server (matching this session's `js-dom-api-sweep.spec.ts` pixel-based verification pattern, since Nova renders to a canvas — the host DOM can't be queried directly) — all three real-browser checks (SELECT after INSERT, SELECT after UPDATE, read-only transaction blocking a write) passed.
