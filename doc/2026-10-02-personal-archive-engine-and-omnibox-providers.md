# Personal Archive Search Engine + Omnibox Command/Tab Providers

**Date:** 2026-10-02
**Session:** Search subsystem implementation, part 2 — plan Phase 3 core (local full-text archive of visited pages: tokenizer, Porter stemmer, BM25 inverted index, DOM extractor, persistence, archive service, omnibox provider) and the rest of Phase 4 (browser-command and open-tab switching providers)
**Status:** Completed (engine + providers + tests; the `nova://search` page and UI/DI wiring are later parts of this branch)

---

## Summary

Built the personal "local Google" described in the plan as a self-contained engine under `src/browser/search/`, plus the three omnibox providers that surface it and the browser itself: archive hits, browser commands ("open settings", "new incognito window"…), and "switch to tab" rows. Nothing here touches the shared UI files, so it is independent of the engine-consolidation work in the other worktree; wiring comes last.

## Design decisions

- **Ranking:** BM25 (k1 = 1.2, b = 0.75) over field-weighted term frequencies baked in at index time (title 5, h1 3, h2 2, h3 1.5, meta description 2, body 1). Results are ordered by *how many query terms matched* first, then BM25 score, so a page containing every word beats a page repeating one word. The last typed word is also matched as a prefix (as-you-type), capped at 20 expansions at 0.6 weight.
- **Text pipeline:** Unicode tokenisation (`\p{L}\p{N}`), diacritic stripping, a curated multi-language stop-word union that deliberately omits words that are common English content words (`war`, `hat`, `die`, `car`, `son`, `mit`, `uber`, `sans`, `sin`, `era`), full Porter stemmer (verified on 78 canonical vectors from the 1980 paper), and CJK character bigrams. A query made only of stop words falls back to unfiltered words.
- **Storage:** postings are parallel arrays; removal tombstones the page and the index compacts itself when tombstones pile up. Snapshots are versioned JSON with strict validation — any malformed snapshot yields an empty index instead of an exception. Persistence is a single blob behind `IIndexStorage` (in-memory for tests, IndexedDB for the app), debounced, best-effort: a storage failure sets `stats().lastError` and keeps the data dirty for the next flush, and never breaks search.
- **Privacy:** only `http(s)` pages; skipped entirely in incognito and when the user setting is off (both re-read on every call); pages with a password field and `robots: noindex` pages are never extracted; `clear()` wipes memory *and* storage and cancels pending saves; the archive provider returns nothing in incognito. Snippets are plain text with highlight ranges — nothing is ever returned as HTML.
- **No Web Worker, no IndexedDB-in-tests:** indexing runs one page per timer tick; extraction is capped (100k chars body, 50 headings) and the snippet source is the first 2000 characters. `ponytail:` upgrade path — move indexing to a Worker if the 10k-page budget or UI jank measurably misses.
- **Default is the caller's call:** `PersonalSearchArchive` takes `isEnabled()`; the plan to ship it **off by default** (opt-in) is applied at wiring time.

## Defects found while testing

### 1. Extractor depended on `bodyElement`, which the HTML tree builder can duplicate
**File:** `src/browser/search/content-extractor.ts`
**Problem:** for a page whose `<head>` contains whitespace after `</title>`, the engine's tree builder emits a *second* `<body>` (the first holds only whitespace and the `<meta>`), and `DomDocument.bodyElement` points at the empty one — so the whole page body extracted as `''`.
**Fix:** traverse the whole document, skipping `head`/`title` and boilerplate subtrees, instead of trusting `bodyElement`.
```ts
const NON_BODY_TAGS = new Set(['head', 'title']);
const body = textOf(main ?? doc, MAX_BODY_CHARS);   // was: main ?? doc.bodyElement ?? doc
```

### Engine parser quirks observed (not fixed here; out of scope)
- Unclosed foreign content: `<svg><text>…</text></svg>` leaves later siblings nested *inside* the `<svg>`, so an extractor that (correctly) skips `<svg>` loses the rest of such a page. `<template>` content is emitted as a sibling of the empty `<template>`.
- These are tree-builder bugs; the extractor's SVG/template skipping is therefore covered with hand-built DOM trees.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/search/porter-stemmer.ts` | Porter stemmer (with the `bli`/`logi` amendments) |
| `src/browser/search/tokenizer.ts` | Tokenisation with offsets, stop words, stemming, CJK bigrams, `parseQuery()` |
| `src/browser/search/bm25-index.ts` | `Bm25Index`: upsert/remove/compact, BM25 + prefix search, snippets with highlight ranges, snapshot (de)serialisation |
| `src/browser/search/content-extractor.ts` | `extractIndexableDocument()` from the engine's `DomDocument` |
| `src/browser/search/archive-storage.ts` | `IIndexStorage`, `MemoryIndexStorage`, `IndexedDbIndexStorage` |
| `src/browser/search/search-archive.ts` | `PersonalSearchArchive`: gating, background queue, re-visit de-dupe, eviction, debounced persistence, stats/events |
| `src/browser/omnibox/archive-suggestions.ts` | `ArchiveSuggestionsProvider` ("From your archive"; `@archive` scoped search) |
| `src/browser/omnibox/browser-actions.ts` | `BrowserActionsProvider` + action catalog; exposes `phrases` for the classifier |
| `src/browser/omnibox/tab-switch-provider.ts` | `TabSwitchSuggestionsProvider` ("Switch to tab"; `@tabs` scoped search) |
| `tests/porter-stemmer.test.ts` | 78 canonical vectors + conflation/idempotence |
| `tests/search-tokenizer.test.ts` | Tokenisation, stop words, CJK, query parsing |
| `tests/bm25-index.test.ts` | Ranking, field weights, prefix, updates, compaction, snippets, snapshots, scale smoke test |
| `tests/content-extractor.test.ts` | Extraction against the real parser + hand-built DOMs (deep tree, svg/template) |
| `tests/search-archive.test.ts` | Gating, revisit window, eviction, queue, persistence, failure handling |
| `tests/archive-storage.test.ts` | IndexedDB adapter against a minimal fake `IDBFactory` |
| `tests/archive-suggestions.test.ts` | Result mapping, incognito, all-terms rule, scoped search |
| `tests/browser-actions.test.ts` | Exact/alias/prefix/word-prefix matching, caps, phrases |
| `tests/tab-switch-provider.test.ts` | Matching, active/blank exclusion, scoped listing, live tab list |

## Files Modified

None (all additions; the only shared file touched earlier in this branch is `omnibox.ts`, documented in part 1).

## Test Results

```
npx tsc --noEmit
(0 errors)

npx vitest run tests/porter-stemmer.test.ts tests/search-tokenizer.test.ts tests/bm25-index.test.ts \
  tests/content-extractor.test.ts tests/search-archive.test.ts tests/archive-storage.test.ts \
  tests/archive-suggestions.test.ts tests/browser-actions.test.ts tests/tab-switch-provider.test.ts
 Test Files  9 passed (9)
      Tests  201 passed (201)

npx vitest run   (full suite)
 Test Files  231 passed (231)
      Tests  9614 passed (9614)      (part 1: 9413 + 201 new)
   Duration  163.86s
```

## Verification Steps

1. `npx tsc --noEmit` — 0 errors.
2. Five first-run failures were fixed in the tests/extractor, not papered over: the duplicate-`<body>` extractor defect above; a fake-timer expectation (a timer created during a tick lands 1 ms later); a fixture whose `Title` field made a "no text" page indexable; and two stemming expectations I had mis-derived (`Haus`→`hau` under Porter's plural rule).
3. The IndexedDB adapter is unit-tested against a minimal fake; it still needs one real-browser smoke test, done when the archive is wired into the app.
