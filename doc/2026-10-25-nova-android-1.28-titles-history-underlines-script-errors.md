# Nova Android 1.28 — Page Titles, Clean History, Unbroken Underlines, Catchable Script Errors

**Date:** 2026-10-25
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (no device connected; verified locally). The follow-up JS object-model plan is at [2026-10-25-nova-js-object-model-plan.md](2026-10-25-nova-js-object-model-plan.md) (awaiting approval)

---

## Summary
Six more root causes from [the end-user test report](2026-10-21-nova-android-1.26-end-user-test-results.md) are fixed:

| RC | Fix |
|----|-----|
| RC-10 | Tabs, history and new bookmarks use the page's `<title>` instead of the host name |
| RC-11 | History records completed loads only, without `about:` pages, with their real titles |
| RC-15 | The long-press sheet scrolls and clears the gesture bar, so "Cancel" is visible |
| RC-16 | A picked `<select>` option closes its native overlay |
| RC-18 | A link's underline runs across the spaces between its words |
| RC-19 | Script errors read `TypeError: …` instead of `[object Object]` |

Fixing RC-19 uncovered two interpreter bugs, fixed here:
- **Host errors escaped page `try/catch`.** Errors the engine raises itself (`null.x`, CSP blocks) bypassed every page `try { } catch { }`, so a guarded feature test killed the whole script.
- **`finally` was skipped** when an exception passed through a `try` with no `catch`.

It also exposed a broken object model (`instanceof`, prototypes, `extends Error`), which is now planned separately.

## Root causes and fixes

### RC-10 — titles never left the document
**Files:** `src/browser/engine/page-renderer.ts`, `browser-engine.ts`, `navigation/navigation-controller.ts`, `ui/components/navigation-bridge.ts`

**Problem:** Nothing read `<title>`. The navigation bridge set every tab title to `parsedUrl.hostname`.

**Fix:**
- `PageRenderer.getDocumentTitle()` returns the first `<title>` outside `<svg>`/`<math>`, whitespace collapsed.
- The engine passes it to `completeNavigation(entryId, title)`, which stores it on the current history entry before emitting `navigationCompleted`.
- The bridge's `_titleFor(entry)` uses the controller's current-entry title everywhere it sets a tab title (on completion and in the three `navigate()` result paths). Whichever runs last gets the real title.
- Kotlin's tab cards and "Add bookmark" read the tab title, so they follow.

### RC-11 — history recorded at commit time
**File:** `src/browser/history/history-service.ts`

**Problem:** `connectController` recorded on `navigationCommitted`. At that point the load could still fail and the title was the host name, so history filled with "httpbin.org", DNS failures and `about:newtab`.

**Fix:** Record on `navigationCompleted`, only for `http(s):` URLs.
```ts
const listener = (event: NavigationEvent): void => {
  if (event.kind !== 'navigationCompleted' || this.recordingPaused) return;
  const { url, title } = event.entry;
  if (!/^https?:/i.test(url)) return;
  void this.addVisit(url, title, false);
};
```

### RC-15 — "Cancel" cut off
**File:** `android/.../ui/components/ContextMenuSheet.kt`

**Problem:** The column had `heightIn(max = 560.dp)` but neither scrolled nor padded for the navigation bar. The link menu is taller than 560 dp, so its last row was clipped.

**Fix:** `.verticalScroll(rememberScrollState()).navigationBarsPadding()`.

### RC-16 — select overlay stayed on top
**File:** `src/ui/pages/browser-window.ts` `openFieldEditor`

**Fix:** For `kind === 'select'`, `change` closes the overlay (which commits and fires the page's `change`).

### RC-18 — underline broken at every space
**File:** `src/browser/rendering/paint-engine.ts`

**Problem:** Decoration skipped every whitespace-only run (added in 1.21 against stray underlines).

**Fix:** A whitespace run is decorated when the runs on both sides of it are decorated and on the same line. Text runs are stored per owning element, so the spaces inside one link are underlined while the space between two adjacent links (owned by the parent) is not.

### RC-19 — "[object Object]"
**File:** `src/browser/js/values.ts` `JSError`

**Fix:** A new `describeThrown(value)`. An object with a `message` (own or inherited data property) becomes `"name: message"`; anything else keeps `toString`.

### Host errors escaping `try/catch`; `finally` skipped
**File:** `src/browser/js/interpreter.ts` `execTry`

**Problem:**
- `catch (e) { … else if (!(e instanceof JSError)) throw e; }`: engine-raised `TypeError`s were rethrown past the page's `catch`.
- A rethrow (no handler) left the function before the `finalizer` ran.

**Fix:**
- A host `Error` reaching a `try` with a handler becomes `new JSError(this.hostErrorToJS(err, env))`, built with the page's own constructor of the same name (`TypeError`, …) when present.
- Rethrows are held in `rethrow` until `finally` has run. An abrupt `finally` (return, throw, break, continue) cancels the rethrow, as in JS.
- The same applies to a host error raised inside the `catch` body.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | `getDocumentTitle()` |
| `src/browser/engine/browser-engine.ts` | `IPageRenderer.getDocumentTitle?`; the title passed to `completeNavigation` |
| `src/browser/navigation/navigation-controller.ts` | `completeNavigation(entryId, title?)` updates the entry title |
| `src/ui/components/navigation-bridge.ts` | `_titleFor()`; tab title set on completion |
| `src/browser/history/history-service.ts` | Record on `navigationCompleted`, web URLs only |
| `src/browser/rendering/paint-engine.ts` | Underline spaces between decorated runs |
| `src/ui/pages/browser-window.ts` | Select overlay closes on change |
| `src/browser/js/values.ts` | `describeThrown()` for `JSError` messages |
| `src/browser/js/interpreter.ts` | `hostErrorToJS()`; catchable host errors; `finally` before rethrow |
| `android/.../ContextMenuSheet.kt` | Scroll and nav-bar inset |
| `tests/android-native-bridge.test.ts` | Incognito history test drives `navigationCompleted` (the new recording point) |
| `android/app/build.gradle` | versionCode 29, versionName 1.28 |

## Files Created
| File | Purpose |
|------|--------|
| `tests/end-user-fixes-128.test.ts` | 5 tests: `<title>` extraction (svg titles ignored); history records only completed web loads with titles; underline inside a link vs between links; host TypeError caught and `finally` before rethrow; readable thrown-error messages |
| `doc/2026-10-25-nova-js-object-model-plan.md` | Plan for prototypes, `instanceof`, subclassing built-ins, ToPrimitive, non-function calls |

## Test Results
```
npx tsc --noEmit                         → exit 0
npx vitest run                           → (first run) 1 failed | 10581 passed — the incognito history test
                                           still drove `navigationCommitted`; updated to `navigationCompleted`
npx vitest run tests/android-native-bridge.test.ts → 51 passed
npx vitest run                           → Test Files 283 passed (283) · Tests 10582 passed (10582)
./gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.28.apk           → verified
```
