# Search Engine Management UI

**Date:** 2026-10-02
**Session:** Full add/remove/reorder/set-default search-engine management UI in Settings
**Status:** Completed

---

## Summary

Built a full search-engine management section inside the Settings page, backed by `SearchEngineManager` (`src/browser/omnibox/search-engine.ts`) — the second of three follow-ups deferred from the earlier search-engine consolidation session. Users can now add custom engines, remove any engine (built-in or custom, minimum 1 enforced), reorder via drag-and-drop, and set the default — all from a new "Search Engines" settings section, with the complete engine list persisted so it survives an app restart. The existing flat `defaultSearchEngine` `<select>` in the General section was kept as-is and now reflects the dedicated section's changes live (both read from/write to the same `SearchEngineManager`/settings store).

## Root Causes (fixed as prerequisites — previously dormant, now reachable from the UI)

### 1. `removeEngine()` had no guard against emptying the engine list
**File:** `src/browser/omnibox/search-engine.ts`
**Problem:** Nothing could call `removeEngine()` from the UI before this session, so removing the last remaining engine (leaving `engines=[]` with a dangling `defaultId`) was never actually reachable, but would have left the manager in a broken state.
**Fix:** `removeEngine()` now returns `false` immediately when only one engine remains.

### 2. `removeEngine()` silently dropped `defaultChanged` when removing the current default
**File:** `src/browser/omnibox/search-engine.ts`
**Problem:** When the removed engine was the current default and others remained, the method reassigned `defaultId`/`isDefault` internally but only emitted a `'removed'` event — never `'defaultChanged'`. `browser-window.ts`'s persistence subscription only listens for `'defaultChanged'` to write `defaultSearchEngine`, so the stored default would silently drift from the manager's actual default the first time a user removed their current default engine.
**Fix:** `removeEngine()` now also emits `'defaultChanged'` (after `'removed'`) when the removed engine was the default and others remain.

## Design decisions (confirmed with the user)

- **Full persistence:** a new `searchEngines` settings key stores the complete ordered engine list (`{name, url, keyword, icon?}[]`, no `id`/`isDefault` — ids are an unstable per-process counter). `BrowserWindowPage.loadPersistedSearchEngines()` rebuilds the manager from it via a new `SearchEngineManager.replaceEngines()` before the existing `defaultSearchEngine` slug sync runs.
- **Uniform removal model:** no `isBuiltIn` flag was added — any engine can be removed down to a minimum of 1.
- **Keep both** the flat General `<select>` and the dedicated section — confirmed this is a single-active-section settings UI, so a new `SettingsPage.updateSections()` method (which reassigns `this.sections` and re-renders) keeps both correct whenever either becomes active, without needing simultaneous live sync.
- **Block name collisions:** the add-engine form rejects a name whose slug (`engineSlug()`) matches an existing engine's, alongside the pre-existing checks for a missing `%s` placeholder and a duplicate keyword.

## Architecture: generalizing `settings-page.ts`'s one existing special-case

The Settings page's generic `SettingDefinition` rendering (`text`/`boolean`/`select`/`range`) has no list/array type. Rather than hardcoding a second special case alongside the existing `section.id === 'menu'` block (which appended a hardcoded "Preview Browser Menu" button), that special case was generalized into a `renderExtra?: (ctx) => void` hook on `SettingsSection`, with the menu section's button now defined as its own `renderExtra` (net-zero behavior change, proving the generalization is faithful). `buildSettingsSections()` in `browser-window.ts` supplies the new "Search Engines" section with a `renderExtra` that builds the list + add-form UI, keeping `settings-page.ts` itself fully decoupled from `SearchEngineManager`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/omnibox/search-engine.ts` | Fixed `removeEngine` (min-1 guard, `defaultChanged` emission); normalized keyword casing in `addEngine`; added `reorderEngine()`, `replaceEngines()` |
| `src/ui/pages/settings-page.ts` | Added `renderExtra` hook to `SettingsSection`; generalized the `'menu'` special-case onto it; added `updateSections()` to `ISettingsPage`/`SettingsPage` |
| `src/ui/pages/browser-window.ts` | Added `persistSearchEngines()`, `loadPersistedSearchEngines()`, `refreshSettingsEngineUI()`, `renderSearchEngineManager()` (list + add-form + drag-reorder DOM); extended the engine `onEvent` subscription and `setSettingsService()`; extended `buildSettingsSections()` to append the new section |
| `tests/omnibox.test.ts` | 8 new `SearchEngineManager` tests (removal guard, `defaultChanged` emission, keyword normalization, `reorderEngine`, `replaceEngines`) |
| `tests/settings-service.test.ts` | Added `updateSections` to the mock `ISettingsPage` (interface addition) |
| `tests/android-native-bridge.test.ts` | Added `getValue` to a partial settings-service mock that was missing it; added a 9-test "Search Engines management section" suite |

## Test Results

```
npx tsc --noEmit                                  → 0 errors
npx vitest run tests/omnibox.test.ts tests/android-native-bridge.test.ts \
  tests/settings-page.test.ts tests/settings-service.test.ts \
  tests/navigation-bridge.test.ts tests/new-tab-page.test.ts  → 6 files, 164 passed
npx vitest run tests/android-native-bridge.test.ts → 1 file, 47 passed (38 existing + 9 new)
npx vitest run tests/omnibox.test.ts               → 1 file, 60 passed (52 existing + 8 new)
npx vitest run (full suite)                        → 218 files, 9224 passed
```

## Verification Steps

1. `npx tsc --noEmit` — clean.
2. Ran the full suite before and after each file's edits — 218 files / 9224 tests green (+17 new tests from this session).
3. New tests exercise the real `BrowserWindowPage.navigate('nova://settings')` entry point directly (the same one the Android native bridge and quick-links use), covering: rendering all 8 engines, add-form validation (missing `%s`, duplicate keyword, colliding name), successful add without leaving Settings, remove + persistence + disable-at-1, default-engine switching + persistence, cross-section refresh (General `<select>` picks up an engine added in the dedicated section), and reorder-via-drag-drop persisting across a simulated reload (new `BrowserWindowPage` + `SettingsService` reading the same underlying store).
4. **Found and worked around a happy-dom test-environment bug**, not an application bug: `<option>.selected` assignment during `appendChild` to a `<select>` in a detached subtree doesn't reliably end up matching what was explicitly set (confirmed via an isolated repro outside the app's own code — a detached 3-option `<select>` with only the last option's `.selected` set to `true` ended up reporting a *different* option as selected after the fact). The actual application logic was verified correct via direct inspection of `SettingsPage`'s internal `values` map and the persisted settings store (both correctly reflect the new default); only the test assertion on the rendered `<select>`'s live DOM `.value`/`.selected` was adjusted to avoid relying on the buggy DOM reflection — real-browser (Chromium/Electron) `<select>` rendering is unaffected by this happy-dom-specific quirk.
5. Manually launched the app via the existing `.claude/launch.json` dev-server config — clean boot, zero console errors. Did not reach the Settings UI visually in this dev harness: as documented in the previous session, this specific `npm run dev` entry point's address bar routes through `NavigationBridge.navigate()` directly and never reaches `BrowserWindowPage.navigate()` → `renderSpecialPage()`, and no window-level debug handle to the live `BrowserWindowPage` instance exists to route around it from the console. This is the same pre-existing, out-of-scope condition noted last session — not something introduced or fixable within this change's scope.

## Explicitly out of scope (not done this session)

- Activating `!keyword` bang search in the address bar (still unwired — one of the three original follow-ups, not picked this round).
- A live suggestions dropdown in the address bar (still unwired — the other remaining follow-up).
- The pre-existing `NavigationBridge.navigate()` vs. `BrowserWindowPage.navigate()` dev-harness routing quirk (unchanged from last session).
