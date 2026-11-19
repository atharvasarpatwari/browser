# Nova Android 1.67: DOM APIs (Element Geometry, outerHTML, Forms, FormData) and Lost `alt` Text

**Date:** 2026-11-01
**Session:** "keep improving the nova app" — a 60-case probe of DOM APIs page scripts call, plus async ordering
**Status:** Completed (tablet not connected: verified by tests; APK built, not installed)

---

## Summary

A probe of 60 DOM calls passed 45. The misses were ones scripts lean on constantly: `offsetWidth`/`offsetHeight`/`clientWidth` were `undefined` (every script that measures an element computed NaN), `outerHTML`/`innerText`/`getAttributeNames`/`compareDocumentPosition` didn't exist, elements had no `nodeType`, `:scope` in element queries matched nothing, `select.selectedIndex` and `form.elements` were missing and `FormData` didn't exist. All added: 57/60 pass, the other three being live `HTMLCollection`s (snapshots — see below) and a harness-only `history` gap (the app passes a navigation controller; the harness doesn't). Writing the permanent test exposed a parser bug: every `<img>`/`<input>`/void element lost its `alt` attribute. Microtask/timer ordering checked correct (sync → Promise → queueMicrotask → await → MutationObserver → setTimeout).

## Root Causes

### 1. Element geometry missing
**File:** `src/browser/js/dom-bindings.ts`
**Problem:** only `getBoundingClientRect` existed; `offsetWidth/Height/Top/Left/Parent`, `clientWidth/Height/Top/Left` and `scrollWidth/Height` were undefined.
**Fix:** getters from the layout box (border box for offset*, minus borders for client*, offsetParent = nearest positioned ancestor or body). ponytail: no per-element scrolling, so scroll* equal client*.

### 2. Serialization and reflection gaps
**File:** `dom-bindings.ts`
**Problem:** no `outerHTML`, `innerText`, `getAttributeNames`, `compareDocumentPosition`; elements had no `nodeType` (text nodes did).
**Fix:** `outerHTMLOf()` (shared with innerHTML), `innerText` get/set (text content — ponytail: no CSS-aware line breaks), `getAttributeNames`, `nodeType` 1 / `nodeName`, `compareDocumentPosition` with the DOM §4.4 bits.

### 3. `innerHTML` wrote end tags for void elements
**File:** `dom-bindings.ts`
**Problem:** `<br>` serialized as `<br></br>`; a script's `el.innerHTML = el.innerHTML` doubled every line break.
**Fix:** HTML §13.3 void elements are written without end tags; tag names lower-case.

### 4. `:scope` in element queries
**File:** `dom-bindings.ts`
**Problem:** `:scope` matched only the document root, so `list.querySelectorAll(':scope > li')` found nothing.
**Fix:** the element is marked for the query with an attribute set directly on its map (outside the mutation log) and `:scope` rewritten to it.

### 5. Forms: selectedIndex, options, elements, FormData
**Files:** `dom-bindings.ts`, `src/browser/js/index.ts`
**Problem:** `select.selectedIndex`/`options` and `form.elements` were undefined; `new FormData(form)` threw.
**Fix:** `selectedIndex` (get/set through the control value) and `options`; `form.elements` in tree order with named access; `createFormData()` collects successful controls (checked boxes, no buttons/files) with get/getAll/has/append/set/delete/entries/keys/values/forEach. ponytail: string entries only.

### 6. Void elements lost `alt`
**File:** `src/browser/rendering/html5/modes/body.ts`
**Problem:** after inserting an `img`/`input`/`br`… the body-mode handler ran `token.attrs?.delete('alt')`; the element shares the token's attribute map, so images lost their alt text (and `[alt]` selectors and alt fallbacks never saw it) whenever the image wasn't handled by another path.
**Fix:** the delete is gone.

## Known gaps (not fixed)

- `children`, `getElementsByClassName` etc. return snapshots, not live collections (the engine's arrays have no live index access); code that caches a collection and reads it after changes sees the old contents.
- `requestAnimationFrame` isn't exercised by the test harness (frames are driven manually there).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/dom-bindings.ts` | geometry, outerHTML/innerText, getAttributeNames, nodeType, compareDocumentPosition, :scope, select/form APIs, `createFormData`, void-element serialization (#1–#5) |
| `src/browser/js/index.ts` | `FormData` constructor (#5) |
| `src/browser/rendering/html5/modes/body.ts` | `alt` no longer deleted (#6) |
| `android/app/build.gradle` | versionCode 68, versionName 1.67 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/dom-apis-167.test.ts` | 57 DOM API cases, async ordering, void-element innerHTML with alt (59 tests) |

## Verification

- Probe: 45/60 → 57/60 (remaining: two live-collection cases, one harness-only history case).
- The innerHTML test failed with `<img>` (alt lost) until #6.
- Device: the tablet was not connected (`adb devices` empty).

## Test Results

```
npx tsc --noEmit                                  → clean
npx vitest run tests/dom-apis-167.test.ts         → 59 passed
npx vitest run                                    → Test Files 314 passed (314); Tests 10971 passed (10971)
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD SUCCESSFUL
apksigner verify Nova-1.67.apk                    → verified; aapt: versionCode 68, versionName 1.67
```
