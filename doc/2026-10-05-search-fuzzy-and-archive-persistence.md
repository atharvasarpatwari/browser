# Typo-Tolerant Archive Search and Incremental Archive Persistence

**Date:** 2026-10-05
**Session:** Last of four follow-ups (Electron verification → page right-click menu → speculative DNS warm-up → fuzzy search + archive scale)
**Status:** Completed — measured first; the persistence redesign was warranted by the numbers and is verified in the real Electron app with real IndexedDB

---

## Summary

**1. Typo tolerance.** Archive search (omnibox rows, `@archive`, `nova://search`) now finds a page for a misspelled word: `quazar`, `quasr`, `quassar` and `qausar` all find the page that says "quasar". It is an opt-in `SearchOptions.fuzzy` of `Bm25Index.search`; the equivalence oracle (`bm25-equivalence`) runs without it and is untouched.

**2. Archive persistence at scale.** The archive was saved as one JSON string rewritten whole on every change. Measured at 10,000 pages that blocked the main thread ~430 ms per save and ~290 ms per load, over the 50 ms threshold set before measuring. It is now stored as shards of 100 pages: a save writes one small shard plus a meta record (**1.1 ms median, 2.6 ms p95, 8.5 ms max**), and a load restores it in slices that each fit in a frame. An archive in the old format is migrated once.

## 1. Typo tolerance

- A query word of 4+ letters that **no page contains** also matches words one typo away — a wrong, missing, extra or swapped-neighbour letter, same first letter — up to the 5 most widespread such words, scored at half weight so the word as typed always wins. Candidates come from the existing 2-character prefix buckets (no new index structure).
- Never applied to: a word that exists (however rare), the as-you-type last word that has completions, a word with a digit (another year is not a typo), a word under 4 letters (`cot` is not a typo of `cat`). Matching is on the stemmed word, so `quas` (stem `qua`) is correctly too short.
- Known limit, pinned by a test: a typo in the **first** letter is not corrected, and a typo inside a half-typed word is corrected once the word is complete.
- Enabled by `ArchiveSuggestionsProvider` (both the omnibox and `@archive`) and the search page.
- Cost at 10,000 pages: typo queries p50 2.6 ms, p95 5.6 ms (gate: 15 ms); with fuzzy on in the omnibox the keystroke gate is p95 8.7 ms (16 ms).

## 2. Persistence — measured first, then redesigned

Decision rule written before measuring: if one save blocks the main thread more than ~50 ms, make persistence incremental.

| 10,000 pages | Before (one snapshot) | After (shards) |
|---|---|---|
| Save, main thread | **432 ms** median (`toSnapshot` 194 + `JSON.stringify` 186; 26M characters) | **1.1 ms** median, 2.6 p95, 8.5 max (one new page; the archive at its limit, so each page also evicts one) |
| Load, longest block | **286 ms** (`JSON.parse` 185 + restore 70) | decode a shard 3.6 ms (p95 5.5); restore 50 pages 2.2 ms (p95 12.6) |
| Load, wall clock | 286 ms, frozen | ~1.4 s, in the background, in slices |

### Design (`archive-shards.ts`, `search-archive.ts`)

- Every page has a **sequence number** (`seq`) that is never reused or renumbered (unlike the dense in-memory id). Shard *n* holds pages `100n … 100n+99`, each with its **term vector**, so loading never tokenises.
- **A save writes the newest shard and a `meta` record in one atomic batch and reads nothing first.** The newest shard is held whole in memory. That matters: the save also runs as the window closes (`pagehide`), where a read-then-write could be cut off between the two steps.
- A page removed from an **older shard** becomes a tombstone in `meta` (`removed`); once 64 have piled up a background pass rewrites those shards (best effort: if cut short, the tombstones are still there). `clear()` bumps an epoch so an unfinished pass can never bring a wiped archive back.
- `meta.next` persists the next sequence number, and a load also numbers above the highest page ever seen — see root cause 2.
- **Loading** reads `meta`, then shards oldest first, one record per turn of the event loop, and yields every 50 restored pages. Pages indexed *while* the archive loads are held and indexed right after (indexing them into the index about to be replaced would lose them); a `clear()` that overtakes a load discards what it read.
- **Migration:** an archive saved as one snapshot is imported, searchable at once, and the first save writes all shards and deletes the old record **in one atomic batch** (a failure keeps the old record and retries). Shards win over a leftover snapshot.
- `IIndexStorage` is now a small record store (`list / read / commit(changes, dropLegacy) / clear`, plus `loadLegacy` for the old record); IndexedDB keeps one object store with records under `snapshot/<id>`.

### In the real app (Electron, real IndexedDB, 10,000 pages)

Main-thread long tasks (≥ 50 ms), from a `PerformanceObserver` installed before reload:

| | Long tasks |
|---|---|
| Empty archive — the app's own startup, then one page visit and its save | startup 357 + 52 ms; visit window 84 + 81 ms |
| 10,000 pages as shards — load | 53 + 90 ms (no archive-specific stall; searchable ~2.8 s after reload) |
| same — page visit + its save | one 92 ms task (like the baseline's page rendering) |
| 10,000 pages as the old snapshot — load, then the migration save | startup up to 417 ms; **the one-time migration save 964 ms** |

So after upgrading, a user with a 10,000-page old-format archive sees one ~1 s pause at the first save; the archive is unreleased, so in practice only development profiles. Not measured: the same table on other machines.

## Root Causes

### 1. The "save" benchmark measured nothing
**File:** `src/benchmark/suites/search.ts`
**Problem:** the first run reported a 0.044 ms save at 10,000 pages — 10,000× faster than the old design, which is not believable. The synthetic pages had `visitedAt` *older* than the whole corpus, so the archive (at its 10,000-page limit) evicted each new page the moment it arrived and the "save" only deleted an empty shard. A scratch run with newest pages gave 1–5 ms.
**Fix:** benchmark pages are the newest, and the benchmark now throws if the last page it indexed is not in the newest saved shard.

### 2. A new page could overwrite an older shard or be swallowed by a tombstone
**File:** `src/browser/search/search-archive.ts`
**Problem:** found while designing the tests. If the next sequence number fell in an older shard than the newest one on disk, a save would overwrite that shard with only the new pages; if it fell on a tombstoned number, the new page would be dropped at the next load. Both need the counter to restart below numbers already used — e.g. all pages of the newest shard removed, or a cleanup that finished just before the window closed.
**Fix:** `meta.next` is persisted and a load also reserves above the highest sequence number seen in any shard, tombstoned or not (`index.reserveSeq(Math.max(meta?.next ?? 0, highest + 1))`). Three tests, each failing when either half is removed.

### 3. Restoring one 250-page shard blocked for ~28 ms
**File:** `src/browser/search/archive-shards.ts`
**Problem:** profiled: 8 ms to parse, 20 ms to rebuild postings — two frames in one stretch, over the 16 ms gate.
**Fix:** shards of 100 pages and a yield every 50 restored pages (`RESTORE_SLICE`), so the two kinds of slice measure 3.6 ms and 2.2 ms (gated separately).

### 4. A `clear()` during a load left an error behind
**File:** `src/browser/search/search-archive.ts`
**Problem:** a load overtaken by `clear()` found its shards gone and kept "1 archive shard could not be read" as `lastError`.
**Fix:** a discarded load also resets the error.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/search/bm25-index.ts` | `fuzzy` option (`oneEditApart`, `termsOneEditFrom`); `seq` per page, `observe`, `reserveSeq`, `addPersisted`, `toPersisted`; legacy snapshot restore numbers pages |
| `src/browser/search/search-archive.ts` | sharded save/load/migration/compaction; yield; held-during-load; epoch |
| `src/browser/search/archive-storage.ts` | record-store interface; Memory and IndexedDB implementations |
| `src/browser/omnibox/archive-suggestions.ts`, `src/ui/pages/search-page.ts` | search with `fuzzy: true` |
| `src/benchmark/runner.ts` | `summarize` (shared by both runners, usable for partly-timed benchmarks) |
| `src/benchmark/suites/search.ts` | typo shapes; archive save/load benchmarks and gates; staged archive; `misspell` |
| `tests/…` | `search-archive`, `archive-storage`, `archive-suggestions`, `search-page` (new contract/arguments); `search-performance` (new gates, shapes, retry counts shape rows too); `e2e/helpers/electron-app.ts`, `e2e/search-electron.spec.ts` (+1) |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/search/archive-shards.ts` | shard/meta record layout, codec with validation |
| `tests/bm25-fuzzy.test.ts` | 36 |
| `tests/bm25-persisted.test.ts` | 15 |
| `tests/archive-persistence.test.ts` | 33 |
| `doc/2026-10-05-search-fuzzy-and-archive-persistence.md` | this change log |

## Test Results

```
$ npx tsc --noEmit                                  (includes tests/e2e/*)
(no output, exit 0 — 0 errors)

$ npm run build:web
$ npx playwright test --config=playwright-electron.config.cjs tests/e2e/search-electron.spec.ts   (+ smoke, keep-alive)
  9 passed (search-electron, 48.7 s); smoke and keep-alive pass
  (one run of "the personal archive … after a restart" timed out once; it then passed 3/3 alone and in the next full runs — not reproduced)

$ npx vitest run            (full suite, final)
 Test Files  256 passed (256)
      Tests  10307 passed (10307)
   Duration  188.76s
```

The vitest suite grew from 10,210 to 10,307 (+97). An earlier full run during this work had 4 failures: the 3 known `DnsResolver` real-resolver timeouts (environmental; they passed in the final run) and the per-shape perf row below. Wall-clock performance gates are load-sensitive: a per-shape query row failed twice in full runs on this 4-core machine (also before this work); the retry that absorbs machine noise now counts those rows as well as the aggregate gates, with no threshold loosened.

## Verification

- **Mutation checks** (each failed the intended test, then restored): fuzzy — no cap, no prefix guard, fuzzing words that exist, fuzzing numbers, 3-letter words, factor 1; persistence — no sequence reserve (and each half alone), legacy snapshot not dropped, cleanup ignoring `clear()`, tombstone list never saved, no tombstones, a read inside save, sealed shards never released, no yield, pages not held during load, a load overtaken by `clear()` kept.
- **Real Electron:** the restart test (pages found after closing the app immediately, via `pagehide`) runs on the sharded format; a new e2e plants an old-format snapshot in the real database, checks it is searchable, that the first save leaves exactly `snapshot/meta` + `snapshot/shard:00000`, and that a restart still finds the page.
- The long-task table above, and the benchmark table (`npm run benchmark:search`).

## Not done

- Searching while the archive is still loading (about 1.4 s at 10,000 pages): archive rows simply appear when it finishes.
- Making the one-time migration non-blocking (it needs one atomic batch; ~1 s once).
- First-letter typo correction; typo-tolerant as-you-type prefixes.
