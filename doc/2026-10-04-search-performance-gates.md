# Search Performance Gates — Measured, Then Made 3–5× Faster

**Date:** 2026-10-04
**Session:** Third of three search-subsystem follow-ups (omnibox polish → engine auto-discovery → performance gates)
**Status:** Completed — gates in place and met with wide margins; verified with a mutation check and in real Chromium

---

## Summary

§6 of the search-engine plan set a "Performance Gate" that had never been measured: **classify + rank < 2.5 ms, a keystroke through the local omnibox < 16 ms (one frame), a query over a 10,000-page archive < 15 ms.**

- **Measured first.** A deterministic benchmark (new) over a 10,000-page archive found the gates *technically met but only barely*: index p95 11.8 ms / keystroke p95 13.7 ms, with heavy tails (p99 26–58 ms) and single common-word queries at p50 13 ms / p95 34 ms — one noisy neighbour away from missing.
- **Then optimised `Bm25Index.search`** (behaviour-preserving): prefix lookups scan a bucket instead of the whole vocabulary, scoring accumulates in dense typed arrays instead of `Map`s, and only the requested number of best pages is selected instead of sorting every match. Index p95 11.8 → **3.5 ms**, keystroke p95 13.7 → **4.0 ms**, worst-shape p95 34 → **3.9 ms**, tails (p99) down to ~5 ms.
- **Then locked it in** with a performance test (the gates), a randomized equivalence test proving rankings did not move, and a reusable benchmark suite.

The "cap expansion work for 2-character prefixes" fallback from the plan (a behaviour change) turned out to be unnecessary and was not done.

## The benchmark (`src/benchmark/suites/search.ts`)

Deterministic, so runs are comparable: a seeded PRNG (mulberry32), a 50,000-word pronounceable vocabulary, Zipf-distributed word picks (head words are in nearly every page — the worst case for scoring), 10,000 pages (title, 4 headings, description, 150-word body). Query shapes: 1 common / mid / rare term, 2 and 3 terms, 2- / 3- / 4-character typed prefixes, term + prefix. The omnibox pipeline is the **real** `SearchSubsystem` + `OmniboxController` + `AddressBar` model over 5,000 history entries, 500 bookmarks, 30 tabs and the 10,000-page archive (restored through `MemoryIndexStorage` → `PersonalSearchArchive.load()`), typed keystroke by keystroke; remote suggestions are off (no network). History/bookmark sources are linear-scan fakes — the real history service's own query cost is not part of the gate. `createPipeline(corpus, ui?)` can also drive a real `AddressBarView`.

`SEARCH_BUDGETS` (p95): classify + rank 2.5 ms · keystroke 16 ms · index query 15 ms.

## Results

Same corpus, same machine, same configuration (120 measured calls per benchmark, 20 warm-up), milliseconds:

| Benchmark | Before p50 | Before p95 | Before p99 | After p50 | After p95 | After p99 |
|---|---:|---:|---:|---:|---:|---:|
| Index query, all shapes (gate, budget 15) | 8.06 | 11.80 | 25.69 | 2.59 | 7.22¹ | 10.64 |
| 1 common term | 13.05 | 33.68 | 41.46 | 2.20 | 3.93 | 4.74 |
| 1 mid term | 5.82 | 14.38 | 58.28 | 1.65 | 2.45 | 2.62 |
| 1 rare term | 2.31 | 3.67 | 4.50 | 0.80 | 1.44 | 1.93 |
| 2 terms | 8.49 | 12.58 | 15.39 | 2.19 | 3.29 | 3.83 |
| 3 terms | 8.86 | 12.34 | 14.51 | 2.13 | 2.96 | 3.61 |
| 2-char prefix of a common term | 9.73 | 13.38 | 14.79 | 2.93 | 3.97 | 4.66 |
| 3-char prefix of a common term | 10.79 | 15.36 | 17.14 | 2.81 | 3.86 | 9.05 |
| 4-char prefix of a mid term | 8.82 | 15.41 | 16.99 | 2.38 | 3.19 | 3.61 |
| term + 4-char prefix | 11.49 | 19.72 | 57.46 | 2.75 | 3.71 | 4.69 |
| Keystroke → ranked rows (gate, budget 16) | 10.06 | 13.66 | 16.47 | 2.94 | 4.27 | 5.05 |
| Classify + rank (gate, budget 2.5) | 0.032 | 0.089 | 0.126 | 0.026 | 0.036 | 0.066 |

¹ the aggregate's p95 in this short run includes JIT warm-up of the first calls; the longer run below reads 3.5 ms.

The committed gate run (`npm run benchmark:search`: 300 measured calls, 80 warm-up) after the change: index query p95 **3.48 ms** (budget 15), classify + rank p95 **0.057 ms** (2.5), keystroke p95 **4.01 ms** (16); every query shape p95 ≤ 3.7 ms. Through a real `AddressBar` + `AddressBarView` in happy-dom (rows built in a DOM): p50 4.4 / p95 7.1 ms.

**Real Chromium** (the Browser pane, the app's actual `AddressBarView` and `styles.css`, 8 mixed rows incl. 7 hover buttons, 350 renders): building the rows p50 0.2 / p95 0.4 ms; with forced style recalculation + layout p50 0.9 / p95 1.9 ms (p99 3.3). Pipeline p95 4.0 + render p95 1.9 ≈ **6 ms** per keystroke against the 16 ms frame — before GPU raster/composite, which is not JavaScript time.

## What changed in `Bm25Index.search` (`src/browser/search/bm25-index.ts`)

1. **Prefix buckets.** Expanding a typed prefix (`rea…` → `react`, `read`, …) scanned *every term of the vocabulary* (50k `startsWith` calls per keystroke). Terms are now bucketed by their first two characters (`prefixIndex`), maintained when a term is first created, rebuilt when compaction drops terms and when a snapshot is restored. Bucket order is the vocabulary's insertion order, so ties between equally common expansions break exactly as before.
2. **Dense score arrays.** Page ids are small integers, so per-query `Map<id, score>`s (five `Map` operations per matching page) became `Float64Array`/`Uint32Array`s plus a list of touched ids. Scores are accumulated in the same order, so they are **bit-identical** to the old ones.
3. **Bounded top-k.** The old code built an object per scored page and sorted all of them (9,000 pages for a head word) to keep 10. Now a sorted array of the best `limit` is maintained by insertion (`limit ≤ 64`, and ≤ 1/8 of the matches); anything larger still sorts, over plain ids.

## Root Causes

### 1. Per-keystroke cost grew with the *vocabulary* and the number of *matching pages*, not with the answer
**File:** `src/browser/search/bm25-index.ts`
**Problem:** a typed prefix scanned the whole term dictionary (O(terms)); every query allocated and sorted one object per matching page (O(matches · log matches)) to return ten rows; scoring paid several `Map` lookups per posting. On a 10,000-page archive a single common word took 13 ms (p95 34 ms) and a keystroke 10 ms (p95 14 ms): inside the 16 ms frame only on an idle machine.
**Fix:** the three changes above; ranking unchanged (see equivalence test).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/search/bm25-index.ts` | prefix buckets (`prefixIndex`, `indexTerm`, `rebuildPrefixIndex`); dense score arrays; bounded top-k with the original ordering (`matched` desc, `score` desc, newest page first); doc comment |
| `src/benchmark/suites/index.ts` | exports the search suite |
| `package.json` | `benchmark:search` script (`vitest run tests/search-performance.test.ts --reporter=verbose`) |

## Files Created

| File | Purpose |
|------|---------|
| `src/benchmark/suites/search.ts` | deterministic 10,000-page corpus, query sets, the real omnibox pipeline (`createPipeline`), `SEARCH_BUDGETS`/`SEARCH_GATES`, `searchSuite()` |
| `tests/search-performance.test.ts` | the gates: p50 under budget and p95 under 2× budget (whole measurement repeated up to 3×; `NOVA_PERF_FACTOR` scales budgets), every query shape separately, a keystroke through a real address bar in happy-dom, and "honesty" checks (deterministic corpus, every query shape finds pages, every keystroke shows rows). Prints the table |
| `tests/bm25-equivalence.test.ts` | random upserts, replacements, removals and the compactions they trigger go to the live index and to a frozen copy of the original algorithm; every answer (urls, snippets, highlights, scores) must be identical, also after a snapshot round trip. 6 cases, ~10 s |
| `tests/helpers/bm25-reference.ts` | the frozen copy of the original `Bm25Index` (from `1dc6ed3`) |
| `doc/2026-10-04-search-performance-gates.md` | this change log |

## Test Results

```
$ npx tsc --noEmit
(no output, exit 0 — 0 errors)

$ npx vitest run tests/bm25-equivalence.test.ts tests/bm25-index.test.ts tests/search-archive.test.ts tests/search-subsystem.test.ts tests/search-performance.test.ts tests/content-extractor.test.ts
 Test Files  6 passed (6)
      Tests  115 passed (115)

$ npm run benchmark:search      (vitest run tests/search-performance.test.ts --reporter=verbose)
 Test Files  1 passed (1)
      Tests  8 passed (8)        gates: index p95 3.479 ms / classify+rank 0.057 ms / keystroke 4.006 ms

$ npx vitest run            (full suite, the gates ran alongside every other test file)
 Test Files  1 failed | 249 passed (250)
      Tests  3 failed | 10144 passed (10147)
   Duration  206.73s
```

The suite grew from 10,133 to 10,147 tests (+14: equivalence 6, performance 8). The 3 failures are the same known environmental ones as before — `tests/networking-integration.test.ts › DnsResolver - real system resolution` (the real resolver's `localhost` lookup times out after 5 s on this machine) — unrelated to this change. The performance gates passed inside the full run too, i.e. under the CPU contention of ~250 test files running on parallel workers.

## Verification

- **Equivalence is real:** the equivalence test passed against the *unchanged* index first (validating the harness), then against the optimised one. Mutation checks on the optimised code — inverting the top-k admission, bucketing by 3 characters instead of 2, dropping the bucket rebuild after compaction and after a snapshot restore — each broke all 6 cases.
- **The gates are real:** with a 20 ms busy-wait injected into `search`, exactly the 4 search-dependent tests failed (index gate p50 21.7 ms, keystroke gate p50 23.3 ms, the per-shape check, the DOM keystroke) while classify + rank and the "honesty" tests still passed. The mutation was reverted.
- **Not done / environment notes:** `npm run benchmark` (the repo's full `tsx`-based runner) cannot run here — `tsx` is not an installed dependency of this checkout (the script was already unrunnable at `HEAD`) — so the search suite is not registered in `run.ts`; it is exported from `suites/index.ts` and runs through vitest. The gates' history and bookmark sources are linear-scan fakes of the real services.
