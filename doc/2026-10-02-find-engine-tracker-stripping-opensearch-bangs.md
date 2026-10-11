# Find-in-Page Engine, Tracker Stripping, AI/Speculative Hooks, OpenSearch Discovery and Bangs

**Date:** 2026-10-02
**Session:** Search subsystem implementation, part 3 — plan Phase 5 core (real find-in-page engine), Phase 6 core (tracking-parameter stripping, `@ai` research provider, speculative-warm decision logic) and Phase 2 core (OpenSearch 1.1 discovery + ~50 built-in bangs), all as self-contained modules
**Status:** Completed (engine/provider modules + tests; the find bar view, `nova://search` page and UI/DI wiring are the final part of this branch)

---

## Summary

Replaced the find-in-page stub with a real engine over the page's positioned text, and added the remaining logic-layer pieces of the plan: tracker stripping, the `@ai` research row and its URL scheme, a conservative speculative-warm gate, an OpenSearch descriptor parser with page-link discovery, and the bang catalog/registry. As with parts 1–2, nothing here touches the shared UI files.

## Root Causes

### 1. `FindInPage` searched a hard-coded Lorem ipsum string and was connected to nothing
**File:** `src/browser/navigation-controls/find-in-page.ts`
**Problem:** `getSampleText()` returned a fixed paragraph ("In a real browser, this would search the actual page DOM text content"); the class had no page binding and no UI, so find-in-page never worked. The plan's proposed fix (DOM `TreeWalker` + CSS Custom Highlight API) cannot apply either: web pages are rasterised and `putImageData`'d onto a `<canvas>`, so there are no DOM text nodes to walk or highlight.
**Fix:** the engine now searches an injected `FindTextSource` (the layout engine's per-word `TextRun`s via `createDomFindSource`), and highlights are geometry (rectangles in page coordinates) for an overlay, not DOM mutations.
```ts
// before: private getSampleText(): string { return `Lorem ipsum dolor sit amet…`; }
constructor(private readonly source: FindTextSource = EMPTY_SOURCE) {}
```
The 8 pre-existing `FindInPage` tests were migrated to inject an equivalent sample source (no built-in fake text remains in production code).

## Design notes

- **Matching:** case-insensitive by default; whole-word (Unicode-aware lookarounds), regular-expression and plain modes; plain queries are trimmed and any run of spaces matches a run of spaces. A match may span the layout engine's per-word runs (it emits one run per word and one per space) and words that wrapped onto a new line are joined with a space, but a match never spans two layout blocks. Zero-length regex matches are skipped; matching stops at 5,000 matches / 2M characters (`truncated` is reported). `ponytail:` a pathological user regex still runs synchronously — move to a worker if it ever hangs the UI.
- **Geometry:** one rectangle per run a match touches, positioned proportionally inside the run (top = baseline − 0.8 em, height = 1.2 em, matching the layout engine's line box). Run widths come from the gap to the next run on the same baseline; the last run on a line uses an estimate. `getMatchTicks(pageHeight)` gives scrollbar tick positions. The page text is re-read on every search and on `refresh()`, which keeps the active match across repaints.
- **Tracker stripping** (`stripTrackingParams`): removes `utm_*`, `gclid`/`fbclid`/`msclkid`/`yclid`/…, plus `si` only on YouTube/Spotify hosts; parameter order, encoding, path and fragment are preserved byte-for-byte and the original string is returned when nothing was removed. Generic names (`ref`, `source`, `campaign`) are deliberately left alone.
- **`@ai` research:** `AiResearchProvider` offers one `research` row; `nova://research?q=<query>` is the hand-off URL (`buildResearchUrl`/`parseResearchUrl`) for the existing research page/`ResearchService`.
- **Speculative warm:** `SpeculativeLoader.consider()` warms only a confident (default score ≥ 90) *navigate* result on a plain `https://public.host/` — never in incognito or when disabled, never IP literals, single-label or internal names (`.local`, `.internal`, …), credentials or ports — at most once per host per TTL, with errors swallowed. **The actual `warm(host)` is injected, deliberately:** `DnsResolver` and `ConnectionPool` exist in `networking/` but nothing on the live fetch path uses them (the HTTP client opens sockets through the main-process socket owner), so warming through them would warm nothing. A real warm needs a `dnsPrefetch` op on the socket-proxy wire; TLS preconnect is deferred until the HTTP client pools connections.
- **OpenSearch:** descriptors are parsed with a small tolerant XML reader (namespace prefixes, CDATA, both quote styles, entities) rather than `DOMParser`, so it also works off the main thread. Safety rules: GET `text/html` templates only, `https` only (http only from an http descriptor), no credentials, **no placeholder in the host** (a query must never choose the destination host), icons limited to `http(s)`/`data:image/*`, 100 KB cap, relative templates resolved against the descriptor URL with placeholders protected from percent-encoding. Discovered engines are *offered*, never auto-added.
- **Bangs:** 51 built-ins (`!g`, `!ddg`, `!eco`, `!k`, `!sp`, `!w`, `!gh`, `!yt`, `!so`, `!r`, `!mdn`, `!npm`, …) with caller-supplied bangs taking precedence, `complete()` for as-you-type, and `{searchTerms}`/`%s` templates via the shared expander.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/navigation-controls/find-in-page.ts` | Rewritten around an injected text source: regex/whole-word/case options, cross-run matching, highlight rects, ticks, `refresh()`; sample text removed |
| `src/browser/navigation-controls/index.ts` | Re-exports the new find types and `createDomFindSource` |
| `tests/navigation-controls.test.ts` | `FindInPage` block injects a sample source (8 existing tests unchanged otherwise) |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/navigation-controls/find-page-source.ts` | `createDomFindSource()` / `collectBlocks()` — text runs of the laid-out DOM, iterative, run widths derived from run gaps |
| `src/browser/search/tracking-params.ts` | `stripTrackingParams()` |
| `src/browser/search/speculative-loader.ts` | `SpeculativeLoader` warm gate and `isWarmableHost()` |
| `src/browser/omnibox/ai-research-provider.ts` | `AiResearchProvider`, research URL helpers |
| `src/browser/omnibox/bangs.ts` | `BUILT_IN_BANGS`, `BangRegistry` |
| `src/browser/omnibox/opensearch-discovery.ts` | `findOpenSearchLinks()`, `parseOpenSearchDescription()`, `discoverOpenSearchEngines()` |
| `tests/find-in-page.test.ts` | 31 tests: modes, regex errors, run joining, geometry, ticks, navigation, events, refresh |
| `tests/find-page-source.test.ts` | 7 tests against the real layout engine and hand-built deep trees |
| `tests/tracking-params.test.ts`, `tests/ai-research-provider.test.ts`, `tests/speculative-loader.test.ts`, `tests/bangs.test.ts`, `tests/opensearch-discovery.test.ts` | 111 tests |

## Test Results

```
npx tsc --noEmit
(0 errors)

npx vitest run tests/find-in-page.test.ts tests/find-page-source.test.ts tests/navigation-controls.test.ts
 Test Files  3 passed (3)
      Tests  127 passed (127)

npx vitest run tests/tracking-params.test.ts tests/ai-research-provider.test.ts \
  tests/speculative-loader.test.ts tests/bangs.test.ts tests/opensearch-discovery.test.ts
 Test Files  5 passed (5)
      Tests  111 passed (111)

npx vitest run   (full suite)
 Test Files  238 passed (238)
      Tests  9763 passed (9763)      (part 2: 9614 + 149 new)
   Duration  201.50s
```

## Verification Steps

1. `npx tsc --noEmit` — 0 errors.
2. Probed the real layout engine (`HtmlParser` → `DomTree` → `LayoutEngine`) to see what `textRuns` look like before designing the adapter: one run per word and per space, proportional positions, baseline at 0.8 em. The adapter tests run against that real output, not mocks.
3. Observed while probing (not investigated further): in an unstyled probe, `<p>The quick brown fox <b>jumps</b> over the lazy dog</p>` produced runs only for `jumps` and the text after it, so text before an inline element may be missing from `textRuns` — worth checking in the paint pipeline.
4. Full suite green (238 files / 9763 tests).
