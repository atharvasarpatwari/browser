# Omnibox System — Omnibox, Search Suggestions, URL Suggestions, Bookmark Suggestions, History Suggestions, Search Engine Integration

**Date:** 2026-07-29
**Session:** Implement 6-module omnibox system for address bar suggestions
**Status:** Completed

---

## Summary
Implemented a complete omnibox suggestion system with 6 modules: Omnibox (core orchestrator with provider plugin system), SearchSuggestionsProvider, UrlSuggestionsProvider, BookmarkSuggestionsProvider, HistorySuggestionsProvider, SearchEngineManager (with EngineSwitchProvider for `!keyword` bang syntax). Integrates with the existing `AddressBar` model via suggestion events.

## Architecture
- **Provider plugin pattern** — `OmniboxProvider` interface with `name` and `getSuggestions()` allows any number of providers to be registered
- **Orchestrator** (`Omnibox` class) calls all providers in parallel via `Promise.all`, deduplicates results by `type:url` key, sorts by score descending, limits to `maxResults`
- **Score-based ranking** — each provider assigns scores; higher = better. The orchestrator sorts globally so the best results from all sources appear at the top
- **Event emission** — `resultsChanged` fires every time `onInputChanged` completes; `navigated`/`searched` fires on result selection
- **Bang syntax** (`!g query`) — `SearchEngineManager.parseKeyword()` detects `!keyword prefix`; `EngineSwitchProvider` suggests matching engines in omnibox results

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/omnibox/omnibox.ts` | Omnibox — core orchestrator with `OmniboxProvider` plugin interface, `onInputChanged()` (parallel queries, dedup, score sort), `selectResult()`, events |
| `src/browser/omnibox/search-suggestions.ts` | SearchSuggestionsProvider — generates search result + local suggestions for non-URL input; configurable search engine |
| `src/browser/omnibox/url-suggestions.ts` | UrlSuggestionsProvider — TLD completions (`.com`/`.org`/`.net`/etc.), HTTPS prefix completion, known URL matching by substring |
| `src/browser/omnibox/bookmark-suggestions.ts` | BookmarkSuggestionsProvider — delegates to `BookmarkQueryFn` (injectable), filters folders, maps to `OmniboxResult` with score |
| `src/browser/omnibox/history-suggestions.ts` | HistorySuggestionsProvider — delegates to `HistoryQueryFn` (injectable), scores by frecency (visitCount × 0.3 + typedCount × 0.7 + recency) |
| `src/browser/omnibox/search-engine.ts` | SearchEngineManager — 8 built-in engines (DuckDuckGo/Google/Bing/Brave/Wikipedia/YouTube/GitHub/Stack Overflow), add/remove/setDefault/getByKeyword, `buildSearchUrl()` + `parseKeyword()` for `!keyword` bang support; EngineSwitchProvider for omnibox |
| `src/browser/omnibox/index.ts` | Barrel file — re-exports all public types and functions |
| `tests/omnibox.test.ts` | 52 tests across all 6 modules + integration test |

## Test Results
```
✓ tests/omnibox.test.ts (52 tests)
  Omnibox: 12/12
  SearchSuggestionsProvider: 6/6
  UrlSuggestionsProvider: 6/6
  isDomainName/looksLikeUrl: 2/2
  BookmarkSuggestionsProvider: 4/4
  HistorySuggestionsProvider: 4/4
  computeFrecency: 1/1
  SearchEngineManager: 12/12
  EngineSwitchProvider: 3/3
  Integration: 1/1

All 52 tests pass. 414 additional tests across 5 other files show no regressions (466 total).
```
