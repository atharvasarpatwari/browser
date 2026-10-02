# Web SQL Database — Implemented from Scratch

**Date:** 2026-09-21
**Session:** Asked to "give me the database and implement them in the browser" — genuinely ambiguous, since Nova already has a full, wired IndexedDB implementation. Clarified with the user: they meant the deprecated **WebSQL** API (`window.openDatabase`), which was confirmed genuinely missing.
**Status:** Completed

---

## Summary

Web SQL Database (the W3C draft that shipped `window.openDatabase()`/`SQLTransaction`/`executeSql()` before it was abandoned in favor of IndexedDB) had zero implementation in Nova — no `openDatabase`, no `SQLTransaction`, no `SQLError`, confirmed by grep before writing anything. It's deprecated, but real legacy pages still use it, and IndexedDB doesn't substitute for it API-wise (different shape entirely: SQL text + callbacks vs. object stores + cursors).

Built a real, bounded SQL engine rather than a full one: a hand-written tokenizer + recursive-descent parser + executor covering `CREATE TABLE [IF NOT EXISTS]`, `DROP TABLE [IF EXISTS]`, `INSERT INTO [(cols)] VALUES (...)`, `SELECT (*|cols) FROM ... [WHERE ...] [ORDER BY ...] [LIMIT n]`, `UPDATE ... SET ...`, and `DELETE FROM ...`, with `?`-placeholder binding, `AND`/`OR`/parenthesized `WHERE` clauses, and comparison operators including `LIKE`. This covers the CRUD shape real legacy WebSQL demo/toy apps actually use. No JOINs, no subqueries, no aggregate functions — documented as a deliberate ceiling, matching how this codebase already scopes the native-networking HTTP/TLS gaps rather than pretending to be complete.

**Follow-up same day (1/2 — rollback)**: the transaction engine initially persisted each statement's effect to disk as it ran, with no real rollback if a later statement in the same transaction failed — a real gap, since WebSQL's whole point is atomic transactions (a page doing e.g. a two-step balance transfer relies on "all statements succeed or none do"). Reworked `NovaSqlTransaction.drain()` to snapshot the affected tables before the first statement runs, apply statements to live in-memory state as before, and either commit the whole transaction to disk in one write on success or roll back to the snapshot on an unhandled error — discarding every mutation the transaction made, not just the one that failed. Verified live: a transaction that creates a table, inserts a row, then hits an unhandled error correctly leaves the table not existing at all afterward, both in memory and on disk.

**Follow-up same day (2/2 — aggregate functions)**: asked to "fill the gaps in the code," which pointed straight at the file's own documented ceiling. Filled `COUNT`/`SUM`/`AVG`/`MIN`/`MAX` — the aggregate real legacy WebSQL pages actually reach for constantly (badge counters, totals, "any rows left?" checks) — while deliberately leaving JOINs/subqueries/GROUP BY out (explained below). `SELECT COUNT(*) FROM t`, `SELECT SUM(amount) AS total FROM t WHERE ...`, etc. now work, following real SQL's null-skipping semantics (`COUNT(*)` counts every row, `COUNT(col)`/`SUM`/`AVG`/`MIN`/`MAX` only consider non-null values, and `SUM`/`AVG`/`MIN`/`MAX` over zero contributing values is `NULL`, not `0`). Also added `AS alias` support for both aggregate and plain SELECT columns (`SELECT a AS renamed FROM t`) as a small, nearly-free addition once the parser already had to look ahead for it. An aggregate SELECT always collapses to exactly one row (no GROUP BY), and mixing an aggregate with a plain column in the same SELECT is a real, deliberate `SYNTAX_ERR` rather than silently producing something meaningless.

Followed the exact architecture Nova already uses for localStorage/IndexedDB: a real TypeScript engine + persistence backend in `src/browser/storage/`, wired into the guest JS environment via a dedicated bindings file in `src/browser/js/`, called from `createGlobalEnv()` right alongside `bindStorageAPIs`.

## Design

- **`src/browser/storage/web-sql.ts`** — the real engine. `NovaDatabase` (per-origin-per-name, backed by `IWebSQLBackend`) exposes `snapshotTables()`/`rollback()`/`commit()` so a transaction is atomic, not just a sequence of individually-persisted statements. `NovaSqlTransaction` (a queue of `executeSql()` calls, drained one at a time so a success/error callback can itself queue more, matching the spec's chaining behavior) snapshots before the first statement and commits-once/rolls-back based on how the queue finishes. `SQLError` mirrors the old spec's numeric error codes (`SYNTAX_ERR`, `DATABASE_ERR`, `VERSION_ERR`, etc.). `InMemoryWebSQLBackend` and `DiskWebSQLBackend` (JSON file per origin+db name under `userData`) mirror `local-storage.ts`'s exact backend pattern.
- **`src/browser/js/web-sql-bindings.ts`** — translates between the real engine's TS API and Nova's guest `JSValue`/`JSObject` shapes: wraps `Database`/`SQLTransaction`/`SQLResultSet`/`SQLError` as guest objects, converts a guest array argument to real `SqlValue[]`, and invokes guest success/error callback functions via `callJSFunction`. Transaction draining is scheduled via `eventLoop.enqueueMicrotask()` so it's genuinely asynchronous, matching real browser timing (a page can't assume `executeSql`'s callback fires synchronously).
- Wired into `createGlobalEnv()` in `src/browser/js/index.ts`, sharing the same `pageOrigin`/`storageDir` options `bindStorageAPIs` already uses.

## Notes

- Read-only transactions (`db.readTransaction(...)`) reject any non-`SELECT` statement with an error, matching spec behavior — verified live.
- `changeVersion()` enforces the expected-old-version check the spec requires, including the "empty string always matches" special case.
- Caught a real bug in my own first draft before it shipped: the `DELETE` statement's row-filtering predicate was inverted (kept matching rows instead of removing them) — found by writing tests for the intended behavior first and confirming they failed against the draft, not by inspection alone.
- Also hit a second self-caught issue: my first test file used `await run(tx, sql)` (a promise tied to one queued statement) *before* calling `tx.drain()`, which deadlocks since nothing processes the queue until `drain()` is called — this looked exactly like a hung/infinite-looping engine from the outside (multiple tests time out with zero output) and took a `--testTimeout` flag plus a plain-Node isolation pass to prove the engine itself was fine and the bug was in the test's own await ordering.
- ponytail: still no JOINs, no subqueries, no GROUP BY — a page reading from more than one table at once, or grouping rows before aggregating, needs a real embedded engine (e.g. `sql.js`). Implementing a real JOIN correctly (qualified `alias.column` resolution threaded through WHERE/SELECT/ORDER BY, multiple FROM clauses) is a much bigger, riskier rewrite than aggregates were, and real legacy WebSQL toy apps (todo lists, notes, contacts) essentially never use them — single-table CRUD-plus-a-counter is the actual shape. Left as an explicit boundary rather than attempted partway.

## Files Created

- `src/browser/storage/web-sql.ts` — SQL tokenizer, parser, executor, `NovaDatabase`/`NovaSqlTransaction` (atomic: snapshot/commit/rollback), aggregate functions, in-memory + disk persistence backends
- `src/browser/js/web-sql-bindings.ts` — guest-JS wrapper exposing `window.openDatabase`
- `tests/web-sql.test.ts` — 25 tests against the engine directly (14 original + 2 rollback + 9 aggregate/alias)
- `tests/web-sql-bindings.test.ts` — 4 tests through the real page-script pipeline (`runJS`/`createGlobalEnv`)

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | Added `bindWebSQL(env, eventLoop, { origin, diskPath })` call in `createGlobalEnv()`, alongside the existing `bindStorageAPIs` call |

## Test Results

```
npx tsc --noEmit -p .                                            → 0 errors
npx vitest run tests/web-sql.test.ts tests/web-sql-bindings.test.ts → 29/29 passed
npx vitest run (full suite)                                      → 228/228 files, 0 regressions
Real Electron diagnostic (CREATE/INSERT/SELECT/UPDATE, readTransaction enforcement) → all 3 checks passed live
Real Electron diagnostic (transaction rollback)                  → confirmed: table + row from a failed transaction do not exist afterward
Real Electron diagnostic (COUNT(*), COUNT(*) WHERE ...)          → both checks passed live
```

## Verification Steps

1. Grepped for `openDatabase`/`SQLTransaction`/`WebSQL`/`executeSql` across `src/` before writing anything — confirmed genuinely absent (unlike IndexedDB, which is already fully wired).
2. Read `local-storage.ts`, `indexed-db.ts`, and `web-storage-bindings.ts` in full to match Nova's established backend/bindings architecture exactly, rather than inventing a new pattern.
3. Wrote the engine, then wrote its test file second — caught the inverted `DELETE` predicate this way (tests failed against the real draft before the fix, confirming the bug was real).
4. Wrote the JS-bindings test file using the same `runJS`/`createGlobalEnv` real-pipeline pattern established earlier this session (`script-execution.test.ts`) — caught the test-deadlock bug the same way (tests hung until the await-ordering issue was found and fixed).
5. Ran the full unit suite (0 regressions) and a real Electron diagnostic serving a page over a real local HTTP server (matching this session's `js-dom-api-sweep.spec.ts` pixel-based verification pattern, since Nova renders to a canvas — the host DOM can't be queried directly) — all three real-browser checks (SELECT after INSERT, SELECT after UPDATE, read-only transaction blocking a write) passed.
6. Follow-up (rollback): reworked the engine for real atomicity (snapshot/commit/rollback), added two tests proving a rolled-back transaction leaves neither the in-memory state nor the disk-persisted backend changed, and re-verified live in real Electron with a dedicated rollback diagnostic — confirmed the whole transaction (a CREATE TABLE plus an INSERT) was correctly undone after a later statement in the same transaction hit an unhandled error.
7. Follow-up (aggregates): added `COUNT`/`SUM`/`AVG`/`MIN`/`MAX` plus `AS` aliasing to the parser and executor, added 9 tests covering null-skipping semantics, the zero-matching-rows-is-NULL case, WHERE-before-aggregate ordering, and the two new rejected-syntax cases (mixing an aggregate with a plain column; `SUM(*)`/etc. instead of `COUNT(*)`), then re-verified live in real Electron with a dedicated diagnostic — confirmed `COUNT(*)` and a WHERE-filtered `COUNT(*)` both compute correctly against a real served page.
