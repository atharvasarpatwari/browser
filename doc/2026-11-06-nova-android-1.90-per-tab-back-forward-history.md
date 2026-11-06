# Nova Android 1.90: Each Tab Keeps Its Own Back/Forward History; Redirected Pages Show Their Final Address

**Date:** 2026-11-06
**Session:** "improvise it !!" (continues 1.89 by fixing the window-wide history it recorded as not changed)
**Status:** Completed. Verified with unit tests and on the emulator. The tablet was not connected.

---

## Summary
Back and Forward now work per tab. Previously the engine kept one history for the whole window, so Back in one tab could land on another tab's page.

Switching tabs no longer adds history entries. A redirected page (iana.org → www.iana.org) keeps its final address in the tab and in the Android address bar.

## Root Causes

### 1. One back/forward history for the whole window
**Files:** `src/browser/navigation/navigation-controller.ts`, `src/ui/components/navigation-bridge.ts`
**Problem:**
- After an outside link opened a new tab, Back in that tab showed the previous tab's page.
- The new tab had Back enabled even though it had no history.

**Root cause:**
- There is one `NavigationController` per window, holding one stack.
- `syncFromActiveTab` pushed every activated tab's page onto that shared stack.

**Fix:**
- `NavigationStack.load(entries, cursor)` was added, and the controller gained `exportHistory()` / `importHistory()`.
- On a tab switch the bridge saves the outgoing tab's stack and loads the incoming tab's (or an empty one for a new tab). Stacks of closed tabs are pruned.
- The tab's current entry is shown with a `Replace` navigation, so its stack is unchanged.
- The toolbar reads `nav.canGoBack()` / `canGoForward()`, which is now per tab.

```ts
if (switched && this.historyTabId !== null && this.nav.exportHistory && this.nav.importHistory) {
  this.tabStacks.set(this.historyTabId, this.nav.exportHistory());
  ...
  this.nav.importHistory(this.tabStacks.get(tab.id) ?? { entries: [], cursor: -1 });
}
```

### 2. Every tab switch pushed the page twice
**File:** `src/ui/components/navigation-bridge.ts`
**Problem:** each tab activation added two identical history entries.
**Root cause:** `activateTabExternal` syncs twice: once from the `tabActivated` event and once directly. The second sync ran before the first navigation landed, so the current entry still differed from the tab's URL.
**Fix:** a `syncNavigating` guard allows one sync navigation per page while it is in flight.

### 3. A redirected page kept its typed address, so switching back pushed it again (found on the emulator)
**File:** `src/ui/components/navigation-bridge.ts` (`urlRedirected` and `navigationCompleted` handlers)
**Problem:** in a tab at example.com → iana.org, switching away and back left Back enabled, but Back reloaded www.iana.org instead of going to example.com.
**Root cause:**
- The engine log showed the fetch of `https://iana.org/` redirected to `https://www.iana.org/`.
- `commitRedirectedUrl` updated the history entry to `www.iana.org`, but the tab kept the typed `https://iana.org/`. The Android address bar also showed iana.org.
- On switching back, the entry (`www.iana.org`) ≠ the tab URL (`iana.org`), so the bridge navigated and pushed `iana.org` on top. Back then went to `www.iana.org`.

**Fix:** the tab follows the final address on redirect and on completion.

```ts
case 'urlRedirected':
  this._currentUrl = e.url;
  if (this.tabs.activeTab && /^https?:/i.test(e.url)) this.tabs.activeTab.setUrl(e.url);
...
case 'navigationCompleted':
  if (this.tabs.activeTab && /^https?:/i.test(e.entry.url)) this.tabs.activeTab.setUrl(e.entry.url);
```

### 4. Backing out of compatibility mode (Kotlin)
**File:** `android/.../BrowserViewModel.kt` (`goBack`)
**Change:** 1.89 opened the new-tab page whenever the engine tab under a compatibility page was on the same site, because the shared `back()` was unsafe. With per-tab history the engine's `back()` is used when that tab can go back. Otherwise the home page opens.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/navigation/navigation-controller.ts` | `NavigationHistoryState`; `NavigationStack.load`/`position`; `exportHistory`/`importHistory` (#1) |
| `src/ui/components/navigation-bridge.ts` | per-tab stacks (#1); `syncNavigating` guard (#2); tab URL follows redirects (#3) |
| `tests/navigation-bridge.test.ts` | 3 new tests (#1, #2, #3) |
| `android/.../BrowserViewModel.kt` | compatibility back-out uses the tab's own history (#4) |
| `android/app/build.gradle` | 1.89 (90) → 1.90 (91) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Test Results
```
npx vitest run tests/navigation-bridge.test.ts → 32 passed (3 new: per-tab Back; switching does not grow history;
  redirected page keeps its final address)
npx tsc --noEmit -p .              → clean
npx vitest run                     → Test Files 335 passed (335); Tests 11441 passed (11441)
npx eslint (changed files)         → 0 errors (2 warnings)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.90.apk     → verified; versionCode 91, versionName 1.90
Emulator (NovaEmu):
  first 1.90 build: tab example.com → iana.org; switch away and back; Back reloaded www.iana.org
    → engine log showed tab URL iana.org vs entry www.iana.org → root cause #3 → fixed, rebuilt
  rebuilt 1.90: tab example.com → iana.org (redirects to www.iana.org); opened example.org in a new tab;
    switched back → www.iana.org re-rendered in place, Back enabled; Back → example.com, Back now disabled
    (doc/img/2026-11-06-nova-1.90-per-tab-back.png)
```
