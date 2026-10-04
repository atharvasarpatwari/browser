# Search Engine Consolidation — Wire SearchEngineManager into Live UI

**Date:** 2026-10-02
**Session:** Consolidate triplicated hardcoded search-engine logic onto the existing (but previously unused) `SearchEngineManager`
**Status:** Completed

---

## Summary

The live browser UI had search-engine → URL-template logic duplicated and hardcoded in three separate places (`browser-window.ts`, `new-tab-page.ts`, `navigation-bridge.ts`), each capped at 3 engines (Google/Bing/DuckDuckGo). Meanwhile a fully-built, well-tested 8-engine system (`SearchEngineManager` in `src/browser/omnibox/search-engine.ts`) sat completely unused — nothing outside `src/browser/omnibox/` imported it. This session wired `SearchEngineManager` into all three live call sites plus the settings page's engine `<select>`, deleting the duplicated hardcoded maps, and removed a fake random-letter "suggestion" generator from the unrelated-but-adjacent `search-suggestions.ts`.

Scope was deliberately limited to consolidation only — `!keyword` bang search activation, a live suggestions dropdown, and a full add/remove engine-management settings UI were explicitly left out (confirmed with the user beforehand).

## Root Causes

### 1. `ISearchEngineManager` interface missing `onEvent`
**File:** `src/browser/omnibox/search-engine.ts`
**Problem:** The `SearchEngineManager` class implemented a public `onEvent(handler): () => void` method (used for change notifications), but the `ISearchEngineManager` interface it implements never declared it. This was invisible as long as nothing outside the module consumed the manager through its interface type — it surfaced as a `tsc` error (`Property 'onEvent' does not exist on type 'ISearchEngineManager'`) the moment `browser-window.ts` tried to subscribe to default-engine-changed events via the interface.
**Fix:**
```ts
interface ISearchEngineManager extends IDisposable {
  // ...existing methods...
  onEvent(handler: EngineEventHandler): () => void;
}
```

## Design decisions (confirmed with user before implementation)

- **Ownership:** `SearchEngineManager` is self-constructed per `BrowserWindowPage` instance (`new SearchEngineManager()`), matching the existing `UrlParser`/`NavigationBridge` pattern — no DI container changes.
- **Engine-id/settings mapping:** the persisted `defaultSearchEngine` setting stays a lowercased-name string (`'google'`, `'bing'`, `'duckduckgo'`, …). A local `engineSlug(name)` helper in `browser-window.ts` resolves it to/from the manager's auto-generated `.id`, since that id is an unstable `engine-N` counter not safe to persist directly. Existing persisted settings keep working with no migration.
- **Sync model:** pull-based only, resolved at `setSettingsService()` (boot) and at each `renderNewTabPage()` call — no live bidirectional subscription between Settings and an already-open New Tab page.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Added owned `SearchEngineManager` + `engineSlug()` helper; deleted hardcoded `SEARCH_URL_TEMPLATES`; rewired `getSearchTemplate()`, added `syncSearchEngineManagerFromSettings()`; passed manager into `NewTabPage`/`NavigationBridge`; widened the settings page's engine `<select>` via new `buildSettingsSections()` |
| `src/ui/pages/new-tab-page.ts` | Deleted hardcoded `SEARCH_URL_TEMPLATES`/`ENGINE_LABELS`; replaced `setSearchEngine(string)` with `setSearchEngineManager(ISearchEngineManager)`; dropdown now renders all engines from the manager instead of a hardcoded 3-tuple; removed the now-redundant `searchEngineChanged` event |
| `src/ui/components/navigation-bridge.ts` | Added optional `searchEngineManager` to `NavigationBridgeConfig`; `navigate()` now prefers the manager's default engine URL, falling back to the existing literal when no manager is configured |
| `src/browser/omnibox/search-engine.ts` | Added missing `onEvent` to the `ISearchEngineManager` interface (see Root Cause 1) |
| `src/browser/omnibox/search-suggestions.ts` | Deleted the fake random-letter-generating suggestion block |
| `tests/navigation-bridge.test.ts` | Added `buildBridge()` config passthrough + 2 new tests (no-manager fallback; manager-driven search URL) |
| `tests/android-native-bridge.test.ts` | Added 1 new test asserting the settings page's `defaultSearchEngine` select lists all 8 engines |

## Files Created

| File | Purpose |
|------|---------|
| `tests/new-tab-page.test.ts` | New unit tests for the New Tab Page's search-engine dropdown: renders all 8 engines, switching engines updates the manager + label, and the search URL is built from the manager's default engine |
| `.claude/launch.json` | Dev-server launch config (`npm run dev`, port 5173) for previewing the app via the Browser pane in future sessions |

## Test Results

```
npx tsc --noEmit                                           → 0 errors
npx vitest run tests/omnibox.test.ts tests/android-native-bridge.test.ts \
  tests/navigation-bridge.test.ts tests/settings-page.test.ts  → 4 files, 130 passed (pre-existing tests, unmodified assertions confirmed to still hold)
npx vitest run tests/new-tab-page.test.ts                   → 1 file, 3 passed (new)
npx vitest run tests/navigation-bridge.test.ts               → 1 file, 27 passed (25 existing + 2 new)
npx vitest run tests/android-native-bridge.test.ts            → 1 file, 38 passed (37 existing + 1 new)
npx vitest run (full suite)                                  → 218 files, 9207 passed
```

## Verification Steps

1. `npx tsc --noEmit` — clean.
2. Ran the four test files the design explicitly predicted would pass unmodified (`omnibox`, `android-native-bridge`, `navigation-bridge`, `settings-page`) — all green with zero edits needed, confirming the consolidation didn't change observable behavior for existing callers.
3. Added and ran 6 new tests directly exercising the new wiring (engine dropdown rendering/switching, manager-driven search URL construction, settings `<select>` option count).
4. Ran the full suite: 218 files / 9207 tests green.
5. Manually launched the app via `npm run dev` in the Browser pane. Confirmed clean boot with no console errors. Discovered (but did not fix, as it's a pre-existing condition unrelated to this change) that this dev harness's address-bar-driven navigation goes through `NavigationBridge.navigate()` directly and never reaches `BrowserWindowPage.navigate()` → `renderSpecialPage()`, so `nova://newtab`/`nova://settings` typed into the address bar don't visually render in this particular dev entry point. `BrowserWindowPage.navigate()` (the method the Android native bridge and internal quick-links actually use) works correctly, as confirmed by the `tests/android-native-bridge.test.ts` test added in this session calling `page.navigate('nova://settings')` directly and asserting 8 engine options render.

## Explicitly out of scope (not done this session)

- Activating `!keyword` bang search in the address bar (already implemented in `SearchEngineManager.parseKeyword()`/`EngineSwitchProvider`, just not wired to a UI entry point).
- A live suggestions dropdown in the address bar (the `Omnibox` orchestrator and its providers remain unused outside `src/browser/omnibox/`).
- Rebuilding the settings page into a full add/remove/reorder engine manager (only its existing `<select>`'s option list was widened from 3 to 8).
- The pre-existing `NavigationBridge.navigate()` vs. `BrowserWindowPage.navigate()` dual-path routing quirk discovered during manual verification (see Verification Steps §5).
