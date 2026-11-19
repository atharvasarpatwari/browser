# Search Sessions Merge — Engine Manager as the Single Engine List, Nova Default, Ctrl+T

**Date:** 2026-10-04
**Session:** Merge the three search/tab sessions into `claude/search-subsystem`: the "Search engines processing steps" session (`SearchEngineManager` consolidation + Settings → Search Engines UI), the "Browser new-tab system" session (Ctrl+T / Cmd+T), and the search subsystem (omnibox, `nova://search`, find bar, archive)
**Status:** Completed — covered by tests and verified in the running app (see Verification)

---

## Summary

The three sessions had each been working in its own worktree, and two of them had never committed:

| Session | Worktree | State | What it did |
|---------|----------|-------|-------------|
| Browser new-tab system | `browser-new-tab-system-fd610e` | uncommitted | `Ctrl+T`/`Cmd+T` opens a new tab (`browser-window.ts` + 1 test + doc) |
| Search engines processing steps | `search-engines-processing-da2f24` | uncommitted | Wired the (previously unused) `SearchEngineManager` into the window, new-tab page, `NavigationBridge` and Settings; add/remove/reorder/set-default/persist engines UI; removed a fake random-letter suggestion generator |
| Search subsystem | `search-subsystem` | committed (`b0bd7c5`) | Omnibox wiring, `nova://search`, find bar, personal archive, Nova default engine |

All three edited `browser-window.ts`, and the last two also edited `new-tab-page.ts`, `settings-page.ts`, `tests/android-native-bridge.test.ts` and the engine tables, so a plain `git merge` was not possible (the other two sessions' work lived only in other worktrees' working trees). The code was **ported by hand with 3-way merges** (`git merge-file`, base = `0ffa69d`, the common ancestor): files only the engine session had changed were copied; overlapping files were merged (4 text conflicts, all resolved below). The other two worktrees were only *read* — nothing in them was modified, so their uncommitted copies still exist and can be discarded.

After the merge the pieces fit together — and the three follow-ups the engine session explicitly left out (`!keyword` bang activation, a live suggestions dropdown, a management UI) are all live:

- **`SearchEngineManager` is the single engine list.** The omnibox's default engine, the new-tab page dropdown, the chrome-state search template, the `NavigationBridge` fallback and the `nova://search` page's "Search the web" shortcuts all read from it. My own copy of the engine table (`resolveDefaultEngine`, a keyword list over the bang catalogue, and the map exported from `new-tab-page.ts`) is gone.
- **Nova is the built-in default engine** (first in the list, keyword `nova`). Four more built-ins (Ecosia, Kagi, StartPage, Reddit) were added so the search page keeps the 12 web shortcuts it had (13 engines with Nova).
- **Every engine's keyword is a `!bang`** in the address bar, user engines winning over the 51 built-in bangs of the same keyword. Engines added or removed in Settings — or restored from the saved list at startup — are picked up live.
- The address-bar quirk the engine session documented as out of scope (typed `nova://` pages never rendered, because the address bar bypassed `BrowserWindowPage.navigate()`) is fixed by part 4's commit-time page rendering, so `nova://settings` and the new engine UI can now be reached by typing.

## Root Causes

### 1. Search-engine data lived in four places
**Files:** `src/ui/pages/browser-window.ts`, `new-tab-page.ts`, `src/ui/pages/search-integration.ts`, `src/browser/omnibox/search-engine.ts`
**Problem:** the engine session had just removed three hard-coded engine tables in favour of `SearchEngineManager`; my search wiring (written while that work was still uncommitted elsewhere) had reintroduced a fourth — a Nova-aware id → template map reused from the new-tab page, plus a separate keyword list for the search page's shortcuts. Merging the two as-is would have given the omnibox one idea of "the default engine" and Settings another.
**Fix:** one resolution path. The window turns the `defaultSearchEngine` setting into an engine in one place and everything asks it:
```ts
// browser-window.ts — falls back to the manager's default when the named engine was removed
private currentDefaultEngine(): SearchEngine {
  const id = this.settingsService?.getString('defaultSearchEngine', 'nova') || 'nova';
  return this.searchEngineManager.getEngines().find(e => engineSlug(e.name) === id.toLowerCase())
    ?? this.searchEngineManager.getDefaultEngine();
}
// SearchHost (search-integration.ts)
defaultEngine(): HostEngine;                 // where plain-text searches go
engines(): readonly HostEngine[];            // search-page shortcuts + !keyword bangs
```
`SearchSubsystem` receives `extraBangs: () => host.engines()` and `BangRegistry` gained `replaceExtra()` (plus `SearchSubsystem.refreshBangs()` / `SearchIntegration.onEnginesChanged()`) so the list can change while the window is open; the window calls it from the manager's change events and after the saved engine list is loaded in `setSettingsService()`.

### 2. The built-in Wikipedia engine did not search
**File:** `src/browser/omnibox/search-engine.ts`
**Problem:** its template was `https://en.wikipedia.org/wiki/%s` — a *page title* lookup, so any real query ("rust lifetimes") 404s. It only went unnoticed because nothing could reach the engine from the UI before.
**Fix:** `https://en.wikipedia.org/w/index.php?search=%s` (the same URL the `!w` bang uses).

### 3. Every setting read as its default after the user had visited Settings
**File:** `src/browser/storage/settings-service.ts`
**Problem:** found live while checking the merged engine UI. `SettingsService.getValue()` answered from the settings page whenever one had ever been `init()`ed (`return this.page.getSetting(key)`), but `SettingsPage.dispose()` — run when the user leaves Settings — clears that page's value map while the service keeps pointing at it. After one visit to Settings every `getString/getBoolean/getNumber` therefore returned its *fallback*: the default engine read as Nova, the archive switch as off, and so on. Worse, the engine session's new-tab sync turned that misread into data loss: `renderNewTabPage()` → `syncSearchEngineManagerFromSettings()` read the fallback, `setDefaultEngine()` fired `defaultChanged`, and the persistence handler wrote `defaultSearchEngine: 'nova'` over the user's saved choice. (Set Google as default → leave Settings → the new-tab page showed Nova and the store said `nova`.) The engine session's tests never navigated away from Settings, so they could not see it.
**Fix:** the service uses the page's value only when the page actually holds one, and otherwise answers from the store:
```ts
getValue<T = unknown>(key: string): T | undefined {
  const live = this.page?.getSetting(key);
  if (live !== undefined) return live as T;
  return this.store.get(key) as T | undefined;
}
```

## Merge decisions (the 4 conflicts)

| Where | Ours (search subsystem) | Theirs | Resolution |
|-------|-------------------------|--------|------------|
| `browser-window.ts` top | removed `SEARCH_URL_TEMPLATES`, imported the new-tab page's | replaced it with `engineSlug()` | theirs (`engineSlug`) |
| `renderNewTabPage()` | default `'nova'` + `setSearchEngine(string)` | `syncSearchEngineManagerFromSettings()` + `setSearchEngineManager()` | theirs; the default `'nova'` moved into the sync helper |
| `getSearchTemplate()` | map lookup, default Nova | manager lookup, default Google | manager lookup, default **Nova**, falling back to the manager's default engine |
| `mount()` | `this.installSearch()` | the Ctrl+T `keydown` handler | both |

Other adjustments: the engine session's tests that hard-coded "8 built-in engines" now use `BUILT_IN_ENGINES.length` (and assert Nova first); `getChromeState().searchTemplate` for an unset setting is Nova's (`nova://search?q=%s`); `new-tab-page.ts`'s fall-back when no manager is set is Nova's template instead of Google's.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/omnibox/search-engine.ts` | (engine session's version, plus) Nova as the first/default built-in; Ecosia, Kagi, StartPage and Reddit added; Wikipedia template fixed |
| `src/browser/omnibox/bangs.ts` | `BangRegistry.replaceExtra()`; `nova://search` accepted as a bang destination |
| `src/ui/components/search-subsystem.ts` | `refreshBangs()` |
| `src/ui/pages/search-integration.ts` | Host provides `defaultEngine()` / `engines()`; removed the duplicate engine table; search-page shortcuts and `!bangs` come from the user's engines; `onEnginesChanged()`; `novaSearchUrl()` |
| `src/ui/pages/browser-window.ts` | Merged: engine manager ownership, persistence, Settings → Search Engines section, `currentDefaultEngine()`, engine-change → bang refresh, Ctrl+T handler |
| `src/ui/pages/new-tab-page.ts` | Engine session's manager-driven dropdown; Nova fall-back template |
| `src/ui/pages/settings-page.ts` | Merged: `renderExtra` hook + `updateSections()` (engine session) with the new search/privacy settings (part 4) |
| `src/browser/storage/settings-service.ts` | `getValue()` falls back to the store when the page holds no value (root cause 3) |
| `tests/search-integration.test.ts`, `tests/android-native-bridge.test.ts`, `tests/new-tab-page.test.ts`, `tests/omnibox.test.ts`, `tests/bangs.test.ts`, `tests/settings-service.test.ts` | Merge adaptations plus the new cases below |

Ported unchanged from the engine session (see its own docs): `src/browser/omnibox/search-suggestions.ts`, `src/ui/components/navigation-bridge.ts`, `tests/navigation-bridge.test.ts`, `tests/settings-service.test.ts`.

## Files Created

| File | Purpose |
|------|---------|
| `tests/new-tab-page.test.ts` | From the engine session (+1 test: Nova is the default, with or without a manager) |
| `tests/browser-window-new-tab-shortcut.test.ts` | From the Ctrl+T session |
| `doc/2026-10-02-search-engine-consolidation.md`, `doc/2026-10-02-search-engine-management-ui.md`, `doc/2026-09-28-new-tab-keyboard-shortcut.md` | The other sessions' change logs, registered in `doc/README.md` and `doc/analytics.html` |
| `.claude/launch.json` | From the engine session: dev-server launch config (`npm run dev`, port 5173) for the browser pane |

## Tests added by the merge

- `tests/search-integration.test.ts` — the omnibox sends plain text to whichever engine the host names default; user-engine keywords are `!bangs` (built-in, added later, removed, overriding a catalogue bang, `!nova` while another engine is the default); the search page's shortcuts follow the engine list (and never list Nova itself); end to end through the real window and a real settings store: an engine added in Settings → Search Engines works as a `!bang` immediately, "Set default" changes where plain searches go and persists, a removed engine's keyword stops working, and engines saved by an earlier run come back as bangs after a restart.
- `tests/bangs.test.ts` — `replaceExtra()` (restores an overridden built-in), `nova://search` accepted while `nova://settings` is still rejected.
- `tests/omnibox.test.ts` — Nova first/default, unique keywords and name-slugs, every template has `%s`, Wikipedia searches.
- `tests/settings-service.test.ts` — falls back to the store for a value the page does not hold; with a real `SettingsPage`, values survive the page being disposed and later writes still show up. A window-level test in `tests/search-integration.test.ts` reproduces the live symptom (default engine lost after leaving Settings).

## Test Results

```
npx tsc --noEmit
(no output — 0 errors)

npx vitest run
 Test Files  1 failed | 247 passed (248)
      Tests  3 failed | 10032 passed (10035)
```
The 3 failures are `tests/networking-integration.test.ts > DnsResolver - real system resolution` (`DnsTimeoutError: DNS resolution for "localhost" timed out after 5000ms` — a real OS-resolver call with a 5 s budget). They fail identically when that file is run on its own (`npx vitest run tests/networking-integration.test.ts` → 3 failed | 12 passed) and passed in the previous day's runs, so this is the machine's resolver, not this change; nothing under `src/browser/networking/` is touched.

Before the merge the branch was 246 files / 9994 tests, so the merge adds 2 files / 41 tests: the Ctrl+T session's 2, the engine session's 23 (6 + 17, as recorded in its docs) and 16 of its own. Focused runs while merging: `tests/search-integration.test.ts` 65 passed, `tests/android-native-bridge.test.ts` + `tests/new-tab-page.test.ts` + `tests/omnibox.test.ts` + `tests/navigation-bridge.test.ts` + `tests/settings-service.test.ts` + `tests/settings-page.test.ts` + `tests/bangs.test.ts` all green.

Mutation checks (change reverted afterwards): restoring the old `SettingsService.getValue()` fails the two new service tests and the window-level "default survives leaving Settings" test (`Expected "Google", Received "Nova"`).

## Verification

Run in the real app (Vite dev server, `npx vite --port 5199`, in the browser pane). The pane was hidden — a hidden pane has a 0-px viewport, so the app was loaded inside a 1280×720 `<iframe>` on a temporary wrapper page and driven with scripted input events (wrapper page, server and the pane's saved settings were removed afterwards).

- **Typed `nova://settings`** renders Settings (the address-bar routing quirk the engine session documented is gone) with the new "🔎 Search Engines" section: 13 engine rows, **Nova first and starred "Default"**, a 🗑 button on each, an add-engine form; the General → "Search engine" select lists the same 13 engines.
- **Omnibox → engines:** `rust lifetimes` shows "Search Nova for…" and lands on `nova://search?q=rust%20lifetimes`, whose "Search the web" shortcuts are the 12 non-Nova engines from the list; `!ddg cats` → `https://duckduckgo.com/?q=cats`; adding "Example" (`!ex`) in Settings makes `!ex cats` go to `https://example.com/search?q=cats` immediately.
- **Default engine:** "Set default" on Google → `defaultSearchEngine: google` stored, plain searches go to Google, `!nova cats` still reaches Nova's page. After leaving Settings the new-tab page labelled the engine "Nova" and the store had been overwritten with `nova` — root cause 3; fixed, then re-checked: label "Google", store `google`.
- **Persistence:** after a reload the default (Google), the added engine and its `!ex` bang were all back.
- **Ctrl+T** opened a second tab (1 → 2).
- Lint (`npx eslint` on the changed sources): 0 errors (3 warnings: two in the engine session's `persistSearchEngines` destructuring, one pre-existing).

## Notes

- The other two worktrees still contain their uncommitted copies of this work; once this branch is merged they can be discarded (this session did not touch them).
- Ctrl+T opens a blank `about:blank` tab, exactly like the tab strip's "+" button (the content area keeps showing the previous page until something navigates); the omnibox "new tab" command opens `about:newtab`. Making both open the new-tab page is a one-line change if wanted.
- Choosing an engine in Settings → General → "Search engine" updates the setting (which the omnibox and the chrome-state template read directly) but not the manager's own default until the next sync (boot, or the next new-tab page render) — the engine session's documented pull-based sync; the "★ Default" marker in the Search Engines section can lag until then.
