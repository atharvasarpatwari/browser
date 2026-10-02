# Search Engine Subsystem — Flagship Architecture & Implementation Plan

**Date:** 2026-10-02  
**Session:** Architecture and specification for the flagship browser search engine subsystem  
**Status:** Completed  

---

## Summary

Designed a comprehensive, tier-1 browser search engine subsystem architecture for Nova Browser, specifying the complete ecosystem across 6 pillars: sub-2ms omnibox query classification & live remote suggestion pipeline, OpenSearch 1.1 autodiscovery, personal full-text search engine (client-side inverted index with BM25 ranking), zero-DOM-mutation find-in-page, contextual selection search with AI research agent integration, and privacy/speculative preconnection. Produced the architectural specification document `doc/2026-10-02-highest-search-engine-implementation-plan.md` and indexed it in `doc/README.md`.

---

## Architectural Scope & Key Decisions

### 1. Six-Pillar Flagship Search Architecture
- **Pillar 1: Intelligent Omnibox & Query Classification:**
  - Synchronous `< 2ms` intent classifier categorizing inputs into `DIRECT_URL`, `BANG_SEARCH`, `SCOPED_SEARCH`, `BROWSER_ACTION`, `CALCULATION_OR_CONVERSION`, or `GENERAL_SEARCH`.
  - Live remote suggestion client supporting standard OpenSearch Suggestion JSON, DuckDuckGo AC, Google Suggest JSON, Brave Suggestions, and Bing.
  - Multi-layer defense: 120ms/180ms debounce, LRU cache (256 entries), `AbortController` cancellation, and zero-keystroke-leakage incognito bypass.
  - Safe client-side recursive descent mathematical and unit-conversion instant answer evaluator.

- **Pillar 2: OpenSearch 1.1 Specification & Engine Management:**
  - Autodiscovery of `<link rel="search" type="application/opensearchdescription+xml">` tags on visited pages.
  - XML template parser supporting `{searchTerms}`, `{count}`, `{startIndex}`, `{language}`.
  - Expansion to 12 built-in flagship search engines (DuckDuckGo default, Google, Bing, Brave, Ecosia, Kagi, StartPage, Wikipedia, GitHub, YouTube, Stack Overflow, Reddit) and 50+ DuckDuckGo-style bangs (`!g`, `!yt`, `!w`, `!gh`, etc.).

- **Pillar 3: Personal Full-Text Search Engine (Local Personal Web Archive):**
  - "Local Google" inside Nova indexing full page body text, headings, and reader-mode articles into an inverted index with BM25 ranking ($k_1=1.2, b=0.75$).
  - Multi-language tokenization, Unicode normalization, stop-word removal, and Porter stemmer.
  - IndexedDB storage with background Web Worker processing to guarantee 60fps UI responsiveness.
  - Dedicated `nova://search` portal and `@archive` omnibox query scope.

- **Pillar 4: Hardware-Accelerated Find-in-Page:**
  - `TreeWalker` DOM traversal across inline element boundaries.
  - Zero-DOM-mutation rendering via standard `CSS.highlights` (`HighlightRegistry`) with canvas fallback.
  - Scrollbar visual tick markers indicating match positions.

- **Pillar 5: Contextual Search & AI Deep Search Bridge:**
  - Context menu selection search with engine switcher.
  - Omnibox `@ai <query>` delegation to Nova's native autonomous `ResearchService` (`nova://research`).

- **Pillar 6: Privacy, Anti-Tracking & Speculative Performance:**
  - Query parameter tracker stripping (`utm_*`, `gclid`, `fbclid`).
  - Speculative DNS prefetch and TLS preconnect on high-confidence omnibox predictions (score > 900), cutting 120ms–250ms off navigation TTFB.

---

## Files Modified

| File | Change |
|------|--------|
| `doc/README.md` | Indexed `2026-10-02-highest-search-engine-implementation-plan.md` in Plans & Reports table and `2026-10-02-search-engine-subsystem-planning.md` in Change Logs table. |

---

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-02-highest-search-engine-implementation-plan.md` | Formal architectural specification document covering all 6 pillars, component models, interfaces, roadmap, and test gates. |
| `doc/2026-10-02-search-engine-subsystem-planning.md` | Session change log documenting the search engine planning milestone. |

---

## Test Results

### 1. Existing Omnibox Suite Verification (`npx vitest run tests/omnibox.test.ts`)
```
 RUN  v4.1.10 E:/nova_1

 ✓ tests/omnibox.test.ts (52 tests) 118ms

 Test Files  1 passed (1)
      Tests  52 passed (52)
   Start at  16:13:37
   Duration  4.11s (transform 754ms, setup 154ms, import 873ms, tests 118ms, environment 1.65s)
```

### 2. Repo-wide TypeScript Compilation (`npx tsc --noEmit`)
```
Exit code: 0
0 errors across all 216+ files in the repository.
```

---

## Verification Steps Taken

1. Audited existing omnibox and search modules (`src/browser/omnibox/`, `src/browser/navigation-controls/`, `src/ui/components/address-bar/`, `src/browser/research/`) via documentation records.
2. Ran baseline test suite `tests/omnibox.test.ts` (52/52 passing).
3. Drafted comprehensive architecture plan `doc/2026-10-02-highest-search-engine-implementation-plan.md`.
4. Executed `npx tsc --noEmit` to verify zero typecheck errors across the codebase.
5. Updated `doc/README.md` index with both the plan and the session change log.
