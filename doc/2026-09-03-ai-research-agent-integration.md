# AI Research Agent Integration

**Date:** 2026-09-03
**Session:** Integrate Python research agent as native Nova Browser feature
**Status:** Completed

---

## Summary

Integrated the standalone Python AI Web Research Agent (`new/research_agent.py`) as a native browser feature. The browser now exposes a `nova://research` internal page that lets users run deep web research queries against Anthropic's Messages API, producing structured, cited reports directly in the browser.

## Architecture Decisions

- **Server-side API integration** — Uses the browser's existing `IHttpClient`/`FetchHttpClient` infrastructure to call the Anthropic Messages API with the `web_search_20250305` tool. All web searching, source prioritization, and synthesis is handled server-side by Claude.
- **DI-registered Singleton service** — `ResearchService` is registered in `src/app/main.ts` as a singleton, with an `apiKeyProvider` that checks `ANTHROPIC_API_KEY` env var first, then browser settings.
- **Internal page route** — Added `nova://research` to the built-in router entries, following the same pattern as `nova://settings` and `nova://downloads`.
- **Settings integration** — Added an "AI Research" section to `nova://settings` for API key, max searches per query, and model selection.

## Files Created

| File | Purpose |
|------|--------|
| `src/browser/research/research-types.ts` | Type definitions, constants, and system prompt |
| `src/browser/research/research-service.ts` | Core API integration logic |
| `src/ui/pages/research-page.ts` | Research panel UI with Markdown renderer |
| `tests/research-service.test.ts` | 10 unit tests for the service |
| `tests/research-page.test.ts` | 6 unit tests for the UI component |
| `doc/ai-research-agent-integration-plan.md` | Detailed integration plan |

## Files Modified

| File | Change |
|------|--------|
| `src/app/main.ts` | Added `ResearchService` DI token, registration, and page wiring |
| `src/browser/navigation/router.ts` | Added `nova://research` built-in route |
| `src/ui/pages/browser-window.ts` | Imported `ResearchPage`, added setter + render method + cleanup |
| `src/ui/pages/settings-page.ts` | Added "AI Research" settings section |
| `doc/README.md` | Indexed the plan and change log |

## Implementation Details

### ResearchService
The service:
1. Takes a user query and constructs an Anthropic Messages API request
2. Uses `web_search_20250305` server-side tool (max_uses configurable, default 10)
3. Handles `pause_turn` stop reason by looping up to 6 times
4. Collects and de-duplicates citations from response content blocks
5. Emits `statusChanged`, `progress`, `complete`, and `error` events
6. Supports cancellation via `AbortController`

### ResearchPage
The panel includes:
- Search input + Research button (Enter to submit)
- Progress indicator during research
- Error display panel
- Markdown report rendering (headings, lists, bold, links)
- Source citation list with clickable external links
- Cancel button during active research

## Test Results

```
npx tsc --noEmit          # 0 errors
npx eslint <new files>    # 0 errors
npx vitest run            # 210 files / 9124 tests passed
  ├─ tests/research-service.test.ts  # 10 passed
  └─ tests/research-page.test.ts     # 6 passed

Previously: 208 files / 9108 tests. Added 16 new tests.
```

## Verification Steps

1. **TypeScript:** `npx tsc --noEmit` — clean, 0 errors
2. **Lint:** `npx eslint src/browser/research/ src/ui/pages/research-page.ts src/app/main.ts src/ui/pages/browser-window.ts src/browser/navigation/router.ts src/ui/pages/settings-page.ts tests/research-service.test.ts tests/research-page.test.ts` — 0 errors in new/modified code (only pre-existing warnings)
3. **Tests:** Full suite `npx vitest run` — 9124/9124 pass (16 new)
4. **Coverage of new feature:** Service tests cover API calls, error handling, cancellation, pause_turn continuation, and event emission. Page tests cover rendering, state handling, and unmounting.

## Notes

- The original Python file at `new/research_agent.py` can be kept as reference documentation or archived.
- API key is stored in browser settings (plain text for now) and can alternatively be supplied via `ANTHROPIC_API_KEY` env var.
