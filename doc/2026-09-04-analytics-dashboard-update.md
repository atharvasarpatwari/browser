# Analytics Dashboard Refresh — 37 New Session Docs (through 2026-09-04)

**Date:** 2026-09-04
**Session:** Documentation analytics dashboard updated to reflect the full doc history through 2026-09-04.
**Status:** Completed

---

## Summary
`doc/analytics.html` carried a stale `DOCS` dataset (201 hand-maintained entries, generated 2026-08-21, max date 2026-08-21). This session parsed all 37 session/plan docs written since the last refresh, merged them with the existing 201 entries, re-sorted, and verified the resulting 238-entry dataset end-to-end (full disk coverage, syntax check, headless-Chromium smoke test).

## Root Causes
### 1. Stale hand-maintained dataset
**File:** `doc/analytics.html`
**Problem:** The `const DOCS=[...]` array is hand-maintained (no generator script exists). It held 201 entries while `doc/` holds 238 `.md` files (237 session/plan docs + `README.md` index), so the dashboard under-reported by 37 docs — including all of `2026-08-23` through `2026-09-04` plus 6 dateless plan docs (catalogued by date in `doc/README.md`).
**Fix:** Parsed all 37 missing docs into the `{file, date, title, category, tests, status, rootCauses, filesModified, filesCreated}` schema (counting Files Modified/Created table rows; `tests` = test cases added by the session; `rootCauses` = numbered root-cause entries; dates for dateless files resolved from the README index), merged + re-sorted (date, then filename) the combined 238-entry array.

### 2. Hardcoded summary values
**File:** `doc/analytics.html`
**Problem:** The header stat-line and the four primary KPIs were hardcoded static numbers (201 docs, 28 days, 8,947 suite tests, 201/9,022/399/1,113) that no longer matched the dataset.
**Fix:** Updated them from the parsed dataset: 238 docs, 37 days, 9,129 total suite tests (latest full-suite run per `2026-09-04-research-feature-completion.md`: 210 files / 9129 tests), KPIs 238 / 9,206 / 444 / 1,253; footer refresh date set to 2026-09-04.

## Notes
- One title (`Android Interface Redesign — "Nova Flash" Theme`) contained raw double quotes and was normalized to remove them so the JS array literal stays valid.
- Existing-entry counting convention confirmed against sources: `filesModified`/`filesCreated` mirror the doc's own Files tables (including the changelog doc when the table lists it); three existing entries were found off-by-one versus current doc tables (docs edited after entry creation) and were left untouched to avoid churn.

## Files Modified
| File | Change |
|------|--------|
| `doc/analytics.html` | Replaced 201-entry `DOCS` array (lines ~806-1006) with 238-entry array; updated header stat-line (docs/days/suite-tests/generated date), 4 primary KPIs, footer refresh date |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-09-04-analytics-dashboard-update.md` | This change log |

## Test Results
```
node verify.cjs            -> ENTRIES: 238, PARSED OK: true, DUPS: 0, DAYS: 37,
                              TESTS: 9206, ROOTCAUSES: 444, FILES: 1253,
                              COMPLETED: 216, PLANNED: 22, titles-with-raw-quotes: 0
disk coverage check        -> disk .md (excl README): 238  in DOCS: 238
                              missing from DOCS: 0  in DOCS but not on disk: 0
node --check (extracted inline <script>) -> SYNTAX OK
Playwright smoke test      -> page loads file://, 0 console/page errors
                              kpiDocs=238 kpiTests=9,206 kpiRootCauses=444 kpiFiles=1,253
                              metaTotal=238 heatCells=37
                              statLine=238 Documents 37 Days 9,129 Total Suite Tests Generated 2026-09-04
```

## Verification Steps
1. Extracted the `DOCS` block via Node; parsed all 238 entries (0 duplicates, schema valid, no raw quotes in titles), re-derived sums (tests 9,206 / root causes 444 / files 1,253 / 37 distinct dates).
2. Cross-checked disk coverage: every `.md` file in `doc/` (excluding `README.md`) maps to exactly one entry and vice-versa — delta of 37 resolved one-directionally.
3. Extracted the inline `<script>` and ran `node --check` — syntax valid.
4. Launched the page in headless Chromium (Playwright) via `file://`; zero console/page errors; all four primary KPIs, meta total, 37-day heat strip and stat-line rendered with the new values.