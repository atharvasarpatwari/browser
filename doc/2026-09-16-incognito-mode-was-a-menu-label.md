# Incognito Mode Was a Menu Label — No History Pause, No Cookie Isolation, No Indicator

**Date:** 2026-09-16
**Session:** Asked directly to "implement incognito mode." `IncognitoManager` already existed (activate/deactivate/session stats) and was already reachable from the main menu ("New Incognito Session" / "Exit Incognito", wired through to Android too), so the toggle itself worked — but nothing downstream of it did anything.
**Status:** Completed

---

## Summary
`IncognitoManager` (`src/browser/settings/incognito.ts`) was a real, tested class — but it was instantiated ad hoc inside `browser-window.ts` (`new IncognitoManager()`, never DI-registered), and `isActive()`/`.incognito` were read in exactly one place: the main-menu label text. Nothing else in the app consulted it. `HistoryService` recorded every navigation unconditionally regardless of incognito state. `PersistentCookieStore` (registered in DI but — separately discovered — never actually resolved or wired into real page loads at all) had no concept of a private session either. And there was no visible indicator anywhere in the chrome; the only way to tell you were "in incognito" was to open the main menu and read whether it said "Exit Incognito." Toggling incognito changed a boolean that changed one menu label and nothing else.

Wired it for real: entering incognito now pauses history recording and snapshots the cookie jar (so nothing set during the session — even if a site's own cookies are set as it's used — reaches the persistent cookie jar or survives when you exit), and exiting rolls the cookie jar back to that snapshot, discarding everything from the session. Added a persistent "🕶️ Incognito" badge to the toolbar itself, driven by the same `Toolbar` state pattern already used for the shield button, so the mode is visible without opening the menu.

## Root Causes

1. **`IncognitoManager` was never connected to anything that could act on it.** It wasn't registered in the DI container, so `main.ts` — the only place with access to `HistoryService` and `CookieStore` — had no way to react when it activated or deactivated. `browser-window.ts` created its own disposable instance purely to back one boolean read by one menu label. Fixed by registering it as a real singleton (`Tokens.IncognitoManager`) and passing it into `BrowserWindowPage` via a new `setIncognitoManager()` setter (the same pattern already used for `HistoryService`/`BookmarkService`/etc.), then subscribing to its `modeActivated`/`modeDeactivated` events in `main.ts` to actually gate history and cookies.
2. **History recording had no pause switch.** `HistoryService.connectController()`'s listener called `addVisit()` unconditionally on every `navigationCommitted` event — the single choke point every navigation already passes through, but with no way to skip it. Added `setRecordingEnabled(enabled)`, checked at that one listener, so `main.ts` can pause/resume recording exactly when incognito activates/deactivates.
3. **`PersistentCookieStore` had no session concept — writes always hit `localStorage` immediately.** Added `beginEphemeral()`/`endEphemeral()` to `ICookieStore`: `beginEphemeral()` snapshots the current jar and makes `persist()` (the store's single write choke point) a no-op, so cookies keep working in-memory for the duration of the session but nothing reaches disk; `endEphemeral()` restores the snapshot, discarding every addition, update, and deletion made during the session — matching real browsers' "private session cookies vanish when it ends" guarantee. `InMemoryCookieStore` got the same two methods for interface consistency (it's already non-persistent, so there's nothing to suppress, but it needs the same session-scoped rollback so anything it holds during incognito is discarded too).
4. **No visible indicator anywhere in the chrome.** The only way to check incognito state was opening the main menu and reading a label. Added an `incognito` field to `ToolbarState` (mirroring the existing `shieldEnabled` pattern exactly) and a small badge in `ToolbarView`, hidden by default and shown whenever incognito is active — kept in sync the same way the rest of the toolbar already is, via `syncToolbar()`.

## Notes
- While wiring the cookie side, found that `CookieStore` is disconnected from real page loads *entirely* — nothing in `main.ts`'s resource-loading pipeline ever resolves `Tokens.CookieStore` outside my own new incognito wiring. There's also a second, separate, equally-unwired cookie subsystem (`CookieJar` in `src/browser/networking/cookie-jar.ts`) whose method names (`setFromResponse`, `getForRequest`, `getCookieHeader`) look purpose-built for real HTTP request/response handling but aren't called from anywhere either. This means the ephemeral cookie-jar guarantee added here is correct and will take effect the moment cookies are wired into real networking, but has no observable effect *today* since nothing sets real cookies through this store yet. Flagged as a separate follow-up task rather than taking on a full networking-layer cookie implementation as a side effect of this one.
- Deliberately did not touch bookmarks or downloads — real browsers keep both when you explicitly create them during a private session, so gating those would be wrong, not more private.
- Deliberately did not implement `IncognitoConfig.disableExtensions` — there is no real extension-loading/execution system wired into the running app to disable in the first place (this config field predates and is independent of what this task needed).
- The Android path was already correctly threaded end-to-end from a prior session (menu tap → `NovaStateBridge.onIncognitoToggleRequested()` → Kotlin `BrowserViewModel.setIncognito()` → `window.novaNative.setIncognito()` back into the JS bridge → `page.setIncognitoExternal()`) — so this fix's history-pause and cookie-ephemeral wiring, which lives entirely behind `setIncognitoExternal()`, applies on Android with no additional changes needed there.

## Files Modified
| File | Change |
|------|--------|
| `src/app/main.ts` | Registered `IncognitoManager` in the DI container; resolves it plus `CookieStore`, wires `page.setIncognitoManager()`, and subscribes to `modeActivated`/`modeDeactivated` to pause/resume history recording and begin/end the cookie jar's ephemeral mode |
| `src/ui/pages/browser-window.ts` | Added `setIncognitoManager()` setter; `syncToolbar()` now pushes `isIncognito()` into `Toolbar.setIncognito()` on every sync |
| `src/ui/components/toolbar/toolbar.ts` | Added `incognito` to `ToolbarState` and `setIncognito()` to `IToolbar`/`Toolbar` |
| `src/ui/components/toolbar/toolbar.view.ts` | Added a hidden-by-default "🕶️ Incognito" badge, shown/hidden in `update()` based on `state.incognito` |
| `src/browser/history/history-service.ts` | Added `setRecordingEnabled(enabled)`; `connectController()`'s listener now checks it before recording a visit |
| `src/browser/storage/cookie-store.ts` | Added `beginEphemeral()`/`endEphemeral()` to `ICookieStore` and `InMemoryCookieStore` |
| `src/browser/storage/persistent-stores.ts` | Added `beginEphemeral()`/`endEphemeral()` to `PersistentCookieStore`, with `persist()` as the single guarded choke point |
| `tests/persistent-stores.test.ts` | Added an `ephemeral mode (incognito)` describe block covering suppressed persistence, rollback on end, resumed persistence after, and the no-op case |
| `tests/history-service.test.ts` | Added tests for `setRecordingEnabled(false)`/`(true)` |
| `tests/toolbar.test.ts` | Added tests for `Toolbar.setIncognito()` and its initial state |

## Files Created
- `doc/2026-09-16-incognito-mode-was-a-menu-label.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                                              → 0 errors (repo-wide)
npx vitest run tests/persistent-stores.test.ts tests/history-service.test.ts
  tests/toolbar.test.ts tests/incognito-manager.test.ts                            → 165/165 passed (9 new)
npx vitest run tests/android-native-bridge.test.ts tests/navigation-bridge.test.ts → 63/63 passed (no regressions from the interface change)
npx vitest run (full suite)                                                        → 223 files / 9267 tests passed (0 regressions)
```

## Verification Steps
1. Grepped every incognito-related symbol across `src/` and found `IncognitoManager` was constructed locally in `browser-window.ts`, never DI-registered, and `isActive()` was read in exactly one place (a menu label) — confirming the toggle had no real effect.
2. Read `HistoryService.connectController()` and confirmed every navigation is recorded unconditionally with no gate to add a pause to.
3. Read `PersistentCookieStore`/`InMemoryCookieStore` and confirmed `persist()` is the single write choke point in the persistent implementation, making it the natural place to suppress writes during a private session.
4. Read `Toolbar`/`ToolbarView` and found the existing `shieldEnabled` pattern (model boolean → `ToolbarState` → `update()` toggling a DOM element) was the exact template to reuse for an incognito badge.
5. Registered `IncognitoManager` in DI, wired `main.ts` to subscribe to its events and drive `HistoryService.setRecordingEnabled()` + `CookieStore.beginEphemeral()/endEphemeral()`, added the toolbar badge, and added tests at each layer.
6. Traced the Android bridge path (`NovaStateBridge` → `BrowserViewModel` → `window.novaNative.setIncognito()` → `android-native-bridge.ts` → `page.setIncognitoExternal()`) end to end and confirmed it already funnels through the exact same code this fix touches, so no Android-side changes were needed.
7. Ran `npx tsc --noEmit -p .` (0 errors), the four directly-affected test suites (165/165, 9 new), the two interface-adjacent suites (android-native-bridge, navigation-bridge: 63/63), and the full suite.
8. Found and flagged (not fixed) a larger, pre-existing gap: neither of the codebase's two cookie subsystems (`ICookieStore`/`PersistentCookieStore` or the separate, unrelated `CookieJar`) is wired into real HTTP request/response handling, so this fix's cookie-ephemeral guarantee is correct but currently inert until that separate gap is closed.
