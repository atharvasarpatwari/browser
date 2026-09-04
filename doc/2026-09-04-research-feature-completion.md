# AI Research Feature Completion

**Date:** 2026-09-04
**Session:** Completed the AI Web Research Agent browser integration (resumed from 2026-09-03)
**Status:** Completed

---

## Summary
Fixed the broken half-edited `ResearchService` (10 compile errors, 6 failing tests), added retry-with-backoff, search log extraction, token usage tracking, in-memory result caching, wired settings through to the research panel, updated the page UI to display search log and usage footer, deleted the superseded `E:\nova_1\new` folder.

## Root Causes

### 1. Missing private helper methods
**File:** `src/browser/research/research-service.ts`
**Problem:** The prior session refactored the API call from `this.client.send()` to `this.sendWithRetry()`, but only updated the call site — none of the referenced helper methods (`sendWithRetry`, `extractSearchLog`, `cacheKey`, `lookupCache`, `saveCache`, `clearCache`) were defined. Line 221 also referenced the now-deleted `response` variable.
**Fix:** Implemented all 6 private methods + the public `clearCache()`. `sendWithRetry` retries on 429/500/502/503/504 with exponential backoff + jitter (max 4 attempts). `extractSearchLog` parses `server_tool_use`/`web_search_tool_result` blocks into `{query, resultCount}` entries. Cache keyed via `hashSync('sha256', ...)` from project's `crypto-utils.ts`.

### 2. Interface not implemented
**File:** `src/browser/research/research-service.ts`
**Problem:** `IResearchService` interface declared `clearCache(): void` but the class never implemented it.
**Fix:** Added `clearCache()` public method that clears the in-memory cache map.

### 3. `pause_turn` continuation sent undefined variable
**File:** `src/browser/research/research-service.ts:221`
**Problem:** After refactoring to `sendWithRetry`, the `pause_turn` continuation message still referenced the deleted `response.body` variable instead of `JSON.stringify(parsed.content ?? [])`.
**Fix:** Changed to `JSON.stringify(parsed.content ?? [])` matching the Python agent's `response.content` serialization.

### 4. Settings not wired through
**File:** `src/ui/pages/research-page.ts`, `src/ui/pages/browser-window.ts`
**Problem:** Settings page exposed `researchMaxSearches` and `researchModel` but `renderResearchPanel()` never read them, and `submitQuery()` called `service.research(trimmed)` with no options.
**Fix:** Added `setResearchOptions(ResearchOptions)` to `IResearchPage`; `browser-window.ts` reads settings and passes them via `setResearchOptions` when mounting the research panel; `submitQuery` passes `this.researchOptions` to the service.

### 5. Test mocks missing required fields
**File:** `tests/research-service.test.ts`, `tests/research-page.test.ts`
**Problem:** After `ResearchResult` gained `searchLog` and `usage` required fields, all mock responses were missing them. `MockResearchService` also lacked `clearCache()`.
**Fix:** Updated all fake responses with `usage: { input_tokens, output_tokens }`. `MockResearchService` gained `clearCache()`. Added 5 new tests (retry, search log extraction, cache hit, clearCache, token accumulation across pause_turn).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/research/research-types.ts` | Added `DEFAULT_CACHE_TTL_MS` constant |
| `src/browser/research/research-service.ts` | Added 6 private methods + `clearCache()`, fixed `pause_turn` continuation, retry logic, search log, cache, token usage |
| `src/ui/pages/research-page.ts` | Added `setResearchOptions()`, search log section, usage footer in `renderResult`, accept full `ResearchResult` |
| `src/ui/pages/browser-window.ts` | Read settings (`researchMaxSearches`/`researchModel`) and pass via `setResearchOptions` |
| `tests/research-service.test.ts` | Added `usage` to fake responses, 5 new tests (retry/429, search log, clearCache, cache hit, pause_turn token accumulation) |
| `tests/research-page.test.ts` | Added `clearCache()` to mock, `searchLog`/`usage` to all `ResearchResult` objects |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-04-research-feature-completion.md` | This change log |

## Test Results
```
npx tsc --noEmit          → 0 errors
npx vitest run            → 210 files / 9129 tests passed
npx eslint (research files) → 0 errors, 0 warnings
```
