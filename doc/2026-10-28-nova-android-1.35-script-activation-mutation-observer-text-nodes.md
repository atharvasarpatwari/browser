# Nova Android 1.35 — Scripted Clicks and Form Submits, a Real MutationObserver, Live Text Nodes

**Date:** 2026-10-28
**Session:** "keep improving the nova app…". No device was connected, so this round is engine work aimed at how real sites drive pages from script.
**Status:** Completed (APK built and signed; no device connected)

---

## Summary
- **Scripted activation:** page scripts can drive navigation. `link.click()` follows the link, `button.click()` submits its form, and `form.submit()`, `form.requestSubmit()` and `form.reset()` exist. Before, a scripted click fired the event and did nothing, and the form methods were missing.
- **MutationObserver:** it now reports DOM changes; it had been a stub that never called back.
- **Text nodes:** their wrappers are live and keep their identity.

## Root Causes

### 1. A scripted click had no default action; form submit methods were missing
**Files:** `src/browser/js/dom-bindings.ts`, `src/ui/pages/browser-window.ts`
**Problem:**
- `el.click()` (added in 1.30) dispatched `click` and stopped. Default actions — follow a link, tick a box, submit a form — only happened in the tap path (`activateAt`).
- `form.submit()`, `form.requestSubmit()` and `form.reset()` did not exist, so calling them threw "is not a function".

**Fix:**
- The post-click half of `activateAt` became `activateElement(el)`, shared by taps and scripts.
- dom-bindings gets an `ActivationHandler` that the browser window registers at mount. `el.click()` calls `activate(el)` unless a listener called `preventDefault()`.
- `form.submit()` submits **without** the `submit` event or validation (as the spec says); `requestSubmit(submitter?)` fires them.
- `form.reset()` drops the user's values (`formValue`/`formChecked`) and fires `reset`.
- `submitForm` gained `fireSubmitEvent`, and the request building moved into `sendForm`.

### 2. MutationObserver never reported
**Files:** `src/browser/rendering/dom-tree.ts`, `src/browser/js/index.ts`
**Problem:** Since 1.30 the constructor returned `observe`/`disconnect` no-ops. Frameworks, lazy-loaders and widgets that wait for DOM changes stalled.
**Fix:**
- `DomTree.onMutation(listener)` passes each change with the actual nodes (`childList` added/removed, `attributes` with name and old value, `characterData` with the old value). This is needed because removed nodes leave the id index, so the recorded mutation list alone can't resolve them.
- All recording sites go through one `record()`.
- `MutationObserver` keeps its targets and options (`childList`, `attributes`, `attributeFilter`, `attributeOldValue`, `characterData`, `characterDataOldValue`, `subtree`) and queues `MutationRecord`s.
- Records are delivered **once per microtask** per observer. `takeRecords()` and `disconnect()` work, `observe(document, …)` works, and invalid options throw a TypeError.
- `DomTree.mutationCount` replaces `getMutations().length` in the page pump; the old call copied the whole mutation list on every timer tick.

### 3. Text node wrappers were dead snapshots
**File:** `src/browser/js/dom-bindings.ts` `wrapTextNode`
**Problem:**
- `textContent` was a value copied at wrap time, so `textNode.textContent = "x"` (or `.data`/`.nodeValue`) changed nothing in the DOM or on screen.
- Every access made a new object, so `p.firstChild === p.firstChild` was false.

**Fix:**
- Wrappers are cached per node.
- `textContent`/`data`/`nodeValue` are live accessors through `domTree.setTextContent`, which also reaches MutationObservers.
- `wholeText`, `length`, `nodeName`, `parentNode`/`parentElement` and `remove()` were added.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/dom-bindings.ts` | `ActivationHandler` / `setActivationHandler`; `click()` default action; `form.submit/requestSubmit/reset`; live, cached text node wrappers; `wrapNode` exported |
| `src/ui/pages/browser-window.ts` | `activateElement` (shared with taps); `submitForm(…, fireSubmitEvent)` + `sendForm`; registers the activation handler |
| `src/browser/rendering/dom-tree.ts` | `DomChange`, `onMutation`, `mutationCount`; recording through `record()` |
| `src/browser/js/index.ts` | Real `MutationObserver` |
| `src/browser/engine/page-renderer.ts` | Page pump uses `mutationCount` |
| `android/app/build.gradle` | versionCode 36, versionName 1.35 |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/script-activation.test.ts` | 3 tests: click() default action and preventDefault; submit() without the event, requestSubmit() with it, reset(); `activateElement` follows a link and sends a GET form |
| `tests/mutation-observer.test.ts` | 6 tests: batched childList records; subtree + attributeFilter + old values; no subtree → no deep records; characterData/takeRecords/disconnect; live text nodes with identity; observing document; bad options throw |
| `Nova-1.35.apk` | Signed release build |

## Test Results
```
npx vitest run                          -> Test Files 293 passed (293), Tests 10671 passed (10671), 256 s
npx vitest run tests/mutation-observer.test.ts tests/web-api-baseline.test.ts tests/script-activation.test.ts -> 19 passed
npx tsc --noEmit                        -> clean
gradlew :app:testDebugUnitTest :app:assembleRelease -> OK
apksigner verify Nova-1.35.apk          -> Verifies; versionCode 36, versionName 1.35
```

## Still to check on a device
The 1.34 list (radios, rounded corners, neverssl page, tab restore, dark mode, Wikipedia logo), plus a site that submits a form from script.
