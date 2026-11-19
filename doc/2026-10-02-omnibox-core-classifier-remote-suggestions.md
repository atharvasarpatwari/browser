# Omnibox Core — Query Classifier, Remote Suggestions, Instant Answers

**Date:** 2026-10-02
**Session:** Search subsystem implementation, part 1 — plan Phase 1 (classifier + live remote suggestions + privacy guard) and the instant-answer half of Phase 4, built as self-contained modules on top of a progressive-results orchestrator
**Status:** Completed (modules + tests; wiring into the address bar UI is a later part of this branch)

---

## Summary

Implemented the pure/logic layer of the omnibox described in `2026-10-02-highest-search-engine-implementation-plan.md`: a synchronous query-intent classifier, a privacy-guarded remote-suggestion provider (debounce, `AbortController`, LRU+TTL cache, OpenSearch/DuckDuckGo parsers), a safe instant-answer engine (calculator, unit conversion, colors), an OpenSearch/`%s` template expander, and the orchestrator changes they need (progressive publishing and a stale-response guard). Everything is new files plus an additive change to `omnibox.ts`; no UI or settings file is touched yet, so it cannot conflict with the engine-consolidation work in the `search-engines-processing` worktree.

## Plan reality-check (why scope and order differ from the plan doc)

The plan was drafted from docs only. Tracing it against the code changed the work:

- The existing omnibox (`src/browser/omnibox/`) is **not wired into the app** — nothing outside that folder imports it, `AddressBar` only accepts `string[]` suggestions, and typing fires no event. So wiring is a prerequisite step ("Phase 0") for the plan's Phases 1/2/4 to have any user-visible effect.
- Search-engine config is duplicated in 7 places; another worktree (`search-engines-processing-da2f24`, uncommitted at the time of writing) is consolidating it. This branch therefore builds the self-contained modules first and does the shared-file wiring last, after rebasing onto that work.
- `FindInPage` is a stub over hard-coded text, and web pages are painted to a canvas (`putImageData`), so the plan's DOM `TreeWalker`/CSS Highlight API approach cannot apply to web content — the find work targets the engine's DOM/paint commands instead (later commit).
- Decisions confirmed with the user: all phases P0–P6; local commits per phase on `claude/search-subsystem`; default engine is Nova's own search (`nova://search`), so remote suggestions come from a separate provider setting (default DuckDuckGo) rather than "the default engine".

## Root Causes (defects in the orchestrator that the new providers would have hit)

### 1. Head-of-line blocking in `Omnibox.onInputChanged`
**File:** `src/browser/omnibox/omnibox.ts`
**Problem:** results were published once, after `Promise.all` over every provider, so a network provider would hold back instant local rows (history/bookmarks/tabs) for its whole round trip — incompatible with the plan's "< 16 ms local response".
**Fix:** providers may declare `slow: true`; fast providers publish immediately and each slow provider's results are merged in (another `resultsChanged`) as it resolves. With no slow providers behaviour is unchanged (exactly one event).

### 2. No stale-response protection
**Problem:** a slow response for an older keystroke could overwrite results for the current input.
**Fix:** every `onInputChanged` bumps a sequence number; results from an older call are computed but never published. `clear()`, `dispose()` and toggling `enabled` also bump it, so in-flight results never surface after the omnibox is cleared/disabled.

### 3. Rows with the same URL but different identity collapsed (and the same page could not be collapsed across types)
**Problem:** de-duplication keyed on `type:url`, so two open tabs on one URL merged, while the same page as history + bookmark showed twice.
**Fix:** results gain an optional stable `id` used in the key, and an opt-in `canonicalDedupe` mode collapses navigable rows for the same page (scheme/`www`/trailing slash ignored), keeping the best score. Default behaviour is unchanged.

## Design notes

- **Zero-leakage guard lives in one place** (`RemoteSearchSuggestionsProvider.getSuggestions`): disabled setting, incognito (re-read on every call), non-search intent (URLs, bangs, `@scopes`, calculations, browser commands), minimum length, and sensitive-looking text (Luhn-valid card numbers, SSN, e-mail, JWT, `password:`/`token=` pairs, long opaque tokens) all return before any timer or request exists.
- **No `eval`/`Function`**: the calculator is a recursive-descent parser with input-length and nesting caps; names resolve through `Map`s so `constructor(1)`/`__proto__` cannot reach prototype members. Dates (`2024-01-15`) are never evaluated as subtraction.
- **Transport is injected** (`fetchJson`), so the app's own HTTP client (no CORS) can be used instead of `window.fetch`; `fetchJsonWithGlobalFetch` is provided as a credential-less, referrer-less default.
- `ponytail:` markers: static TLD allow-list in the classifier (swap for a public-suffix list if misclassification shows up); currency conversion deliberately omitted (needs live rates); `%` is modulo.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/omnibox/omnibox.ts` | `slow` providers + progressive publishing, stale-response guard, optional `canonicalDedupe`, new result types (`answer`, `tab`, `action`, `archive`, `ai`) and actions (`copy`, `switch-tab`, `run-action`, `research`), optional `id`/`hint`/`meta` on results, `activated` event |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/omnibox/instant-answers.ts` | Safe calculator, unit conversion (length/mass/volume/time/data/speed/temperature), color parsing, and `InstantAnswerProvider` |
| `src/browser/omnibox/query-classifier.ts` | Pure, regex-only `classifyQuery()` → `DIRECT_URL` / `BANG_SEARCH` / `SCOPED_SEARCH` / `BROWSER_ACTION` / `CALCULATION_OR_CONVERSION` / `GENERAL_SEARCH` |
| `src/browser/omnibox/remote-search-suggestions.ts` | `RemoteSearchSuggestionsProvider`, `LruCache`, suggestion parsers, privacy guard, built-in endpoint table |
| `src/browser/omnibox/search-template.ts` | `expandSearchTemplate()` for OpenSearch `{searchTerms}`/`{count?}`/… and Chrome-style `%s` |
| `tests/instant-answers.test.ts` | Calculator, units, colors, provider |
| `tests/query-classifier.test.ts` | Every intent, precedence, edge cases, per-keystroke budget |
| `tests/remote-search-suggestions.test.ts` | Parsers, privacy guard, LRU/TTL, debounce, abort, cache, stale responses |
| `tests/search-template.test.ts` | Template expansion |
| `tests/omnibox-async.test.ts` | Progressive publishing, stale guard, canonical de-dupe, new actions |

## Test Results

```
npx tsc --noEmit
(0 errors)

npx vitest run tests/instant-answers.test.ts tests/query-classifier.test.ts \
  tests/remote-search-suggestions.test.ts tests/search-template.test.ts \
  tests/omnibox-async.test.ts tests/omnibox.test.ts
 Test Files  6 passed (6)
      Tests  264 passed (264)        (52 existing omnibox tests unchanged + 212 new)

npx vitest run   (full suite)
 Test Files  222 passed (222)
      Tests  9413 passed (9413)      (baseline 9201 + 212)
   Duration  315.16s
```

## Verification Steps

1. `npx tsc --noEmit` — 0 errors.
2. The 52 pre-existing `tests/omnibox.test.ts` tests pass unmodified against the changed orchestrator (backward compatibility of `onInputChanged`/`selectResult`/dedupe).
3. Full suite green: 222 files / 9413 tests.
4. A first run of the new async tests caught one wrong expectation (a handler had legitimately fired before `dispose()`); the stale-guard test was rewritten around `enabled = false`, and `enabled` now invalidates in-flight results.
