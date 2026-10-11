# Web Crawler — Phase 1 Foundation (storage + politeness + fetch)

**Date:** 2026-10-11
**Session:** Phase 1 of the in-app web crawler + search index plan (`C:\Users\athar\.claude\plans\buzzing-dazzling-stream.md`)
**Status:** In Progress (Phase 1 of 6 complete)

---

## Summary

Earlier in this session, the pasted "build a search engine from scratch" requirements checklist was compared against Nova's existing search subsystem (`claude/search-subsystem`, merged into this branch this session) and found to cover only the local personal-archive retrieval path — no crawling, link analysis, or external indexing existed. This session starts building that: a curated-seed-list web crawler living inside the Electron app. Phase 1 (storage, robots.txt compliance, and a dedicated fetch pipeline) is implemented and tested; Phases 2–6 (link extraction, scheduler, Electron-main wiring, settings UI, `nova://search` integration, PageRank) remain.

## Root Causes / Findings

### 1. `better-sqlite3` cannot be used in this environment
**Problem:** The plan called for `better-sqlite3` (native module) for FTS5-backed storage at vertical scale. Install failed: no prebuilt binary for this Node/Windows combo, and no Visual Studio Build Tools to compile from source.
**Fix:** Switched to `node-sqlite3-wasm` — pure WASM, zero native build step, verified working (`CREATE VIRTUAL TABLE ... USING fts5(...)` + `bm25()` both confirmed functional). The official `@sqlite.org/sqlite-wasm` package was also tried and rejected: its build assumes browser globals (`self`, `self.location`) that don't exist in plain Node/Electron-main.

### 2. `node-sqlite3-wasm`'s `get()` returns `null`, not `undefined`, on no match
**File:** `src/browser/crawler/crawler-db.ts`
**Problem:** `isVisited()`/`hasContentHash()` checked `!== undefined`; the library actually returns `null` for a missing row, so both methods always reported "found" — caught by `tests/crawler-db.test.ts`'s dedup test failing on a fresh, empty table.
**Fix:** Changed both checks to `!== null`.

### 3. robots.txt agent-block selection was unioning groups instead of picking the most specific one
**File:** `src/browser/crawler/robots.ts`
**Problem:** The original parser accumulated `Disallow`/`Allow` directives from *every* matching `User-agent` block (both `*` and an exact match), which is wrong — the de-facto standard says the crawler should use the single most specific matching record exclusively. Caught by `tests/crawler-robots.test.ts`'s "prefers a block matching our user-agent" test.
**Fix:** Rewrote the parser to first split the file into records (one or more `User-agent` lines + their directives), then select exactly one record (exact user-agent match, else `*`), and return only that record's rules.

## Architecture decisions carried into code

- **Fetch pipeline is dedicated, not the browsing-path `RequestManager`.** `CrawlerFetcher` (`src/browser/crawler/crawler-fetcher.ts`) uses plain Node `http`/`https` + the existing `DnsResolver` (`src/browser/networking/dns-resolver.ts`, reused as-is via a custom `lookup` function) for DNS caching across repeated requests to the same domain. Handles redirects (capped, returns the last redirect response rather than throwing on loop), timeouts, gzip/br/deflate decoding (`node:zlib`), and a body-size cap.
- **Storage is SQLite FTS5 via WASM**, not the existing `Bm25Index`/shard code — that code was confirmed (by investigation earlier this session) to be sized for a personal archive (10k-doc eviction, in-memory postings), not vertical-tier scale.
- **robots.txt support is new** (confirmed nothing like it existed in the repo): `robots.ts` (pure parsing + longest-prefix-match `isAllowed`) and `robots-cache.ts` (fetch-once-per-day cache backed by `CrawlerDb`, treats a missing/unreachable robots.txt as allow-all, matching major-crawler behavior).

## Open item for the next phase

**How does Electron's main process (`electron/*.cjs`, plain CommonJS, no TS build step) consume these TypeScript modules?** Confirmed via investigation: `electron/main.cjs` and `socket-owner.cjs` are hand-written CJS with zero bundler/tsc pipeline feeding them — `npm run build` (`tsc`) exists but isn't wired into `electron:dev` or the packaged-app build scripts, and this tsconfig's `moduleResolution: "bundler"` emits extension-less relative imports that Node's native ESM loader can't resolve anyway. Phase 3 (Electron service wiring) needs to resolve this — likely a small dedicated `tsc` invocation (separate tsconfig, `module: commonjs`, scoped to `src/browser/crawler/`) producing plain `require()`-able output for `electron/crawler-service.cjs`, kept isolated from the renderer's Vite/bundler pipeline.

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/crawler/crawler-db.ts` | SQLite schema + queries: URL frontier, visited/dedup, robots cache, documents + FTS5 index, link edges. |
| `src/browser/crawler/robots.ts` | robots.txt parsing (`parseRobotsTxt`) and path matching (`isAllowed`), serialize/deserialize helpers. |
| `src/browser/crawler/robots-cache.ts` | Fetch-and-cache wrapper around `robots.ts` + `CrawlerDb`, daily TTL, allow-all on fetch failure. |
| `src/browser/crawler/crawler-fetcher.ts` | Politeness-agnostic HTTP fetch primitive: DNS-cached, redirect-following, gzip/br/deflate-decoding, size/time capped. |
| `tests/crawler-db.test.ts` | 11 tests. |
| `tests/crawler-robots.test.ts` | 10 tests. |
| `tests/crawler-robots-cache.test.ts` | 5 tests. |
| `tests/crawler-fetcher.test.ts` | 7 tests (against a real local loopback HTTP server, not mocks). |

## Files Modified
| File | Change |
|------|--------|
| `package.json` / `package-lock.json` | Added `node-sqlite3-wasm` dependency. |

## Test Results
```
npx vitest run tests/crawler-db.test.ts tests/crawler-robots.test.ts tests/crawler-robots-cache.test.ts tests/crawler-fetcher.test.ts
Test Files  4 passed (4)
     Tests  33 passed (33)

npx tsc --noEmit
(no output — 0 errors)
```

## Verification Steps Taken
- Manually verified FTS5 + `bm25()` availability in `node-sqlite3-wasm` before committing to it (and ruled out `sql.js` — no FTS5 — and `@sqlite.org/sqlite-wasm` — needs browser globals).
- Manually verified file-based persistence (write, close, reopen, read) for `node-sqlite3-wasm`.
- All new unit tests run against real behavior: a real `:memory:` SQLite instance (not mocked), and `crawler-fetcher.test.ts` against a real local `http.createServer` on loopback (gzip, redirects, redirect loops, oversized body, timeout, 404 — not mocked).
- Full project typecheck (`tsc --noEmit`) clean after adding all four modules.
