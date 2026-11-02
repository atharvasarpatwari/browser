# Nova Android 1.74: DOM APIs — Detached/Head Queries, Reflected Attributes, Timer Order, Listener Signals, TextEncoder, Form Validation

**Date:** 2026-11-02
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed. The 1.74 APK (versionCode 75) contains this round and the earlier 1.74 engine commit `e1ef2c4` (margins, calc em, aspect-ratio, vertical-align, fixed containing blocks).

---

## Summary
First, the full suite was run on the 1.74 engine commit, which had been left pending: 322 files, 11202 tests, all passing. Then a **70-case DOM / web API probe** ran page scripts against a fixture page covering events, tree manipulation, attributes, selectors, forms, URL, storage and timers. It passed **56** at first and **68** now. Two are left:
- **Live collections:** `getElementsByClassName` returns a snapshot, not a live collection (`ponytail:`).
- **`location`:** it is only bound when a navigation controller is attached. The app always has one; the test harness doesn't, so this isn't a Nova bug.

## Root Causes

### 1. Element queries missed detached subtrees, and document queries missed `<head>`
**Files:** `src/browser/rendering/dom-tree.ts`, `src/browser/js/dom-bindings.ts`
**Problem:**
- `el.querySelector()` ran a document-wide query and filtered it to descendants. So `d.innerHTML = '<p>…'; d.querySelector('p')` on a not-yet-inserted element returned `null`, which breaks the usual "build, fill, then insert" templating pattern.
- `matches` and `closest` had the same problem.
- The document query started at `<body>`, so `document.querySelector('meta[name=…]')`, `title` and `link` found nothing.

**Fix:**
- `IDomTree.querySelectorAll(selector, root?)`: the document query now starts at `<html>`.
- Element `querySelector*`, `matches` and `closest` query from the element's top-most ancestor (`topAncestor`), whether that is the document or a detached subtree.

### 2. Reflected attributes and document collections were missing
**File:** `dom-bindings.ts`
**Problem:**
- Only `id`, `className`, `lang`, `dir` and `title` were reflected. `input.type`, `a.href`, `btn.disabled`, `label.htmlFor`, `img.alt` and the rest were all `undefined`.
- `a.pathname`, `a.search` and `a.hash` were missing.
- `document.head` and `document.forms` were missing.

**Fix:**
- A `reflect()` helper (it never overrides an existing binding) adds:
  - **String attributes:** name, placeholder, alt, rel, target, htmlFor, autocomplete, accept, pattern, min, max, step, method, enctype, inputMode.
  - **`type`:** with each element's default (`text` for input, `submit` for button, `select-one` / `select-multiple` for select).
  - **Boolean attributes:** disabled, required, readOnly, multiple, autofocus, noValidate, defer, async, selected.
  - **URL attributes:** href, src and action, resolved against the document URL. `createDocumentBinding` stores that URL at module level for element wrappers.
- `a` and `area` elements expose protocol, host, hostname, port, pathname, search, hash and origin.
- New on `document`: `head`, plus `forms`, `images`, `links` and `scripts` as fresh arrays on each read. `documentElement` now prefers the parsed `<html>` element.

### 3. Timers ran in insertion order
**File:** `src/browser/js/event-loop.ts`
**Problem:** `runOnce` ran the *first due* task in insertion order, so once both timers were due, `setTimeout(a, 10); setTimeout(b, 0)` ran `a` before `b`.
**Fix:** it runs the due task with the earliest due time; ties keep scheduling order.

### 4. The `signal` listener option was ignored
**File:** `dom-bindings.ts`
**Problem:** `addEventListener(type, fn, { signal })` ignored the signal, so listeners meant to be removed by `controller.abort()` kept firing.
**Fix:** `listenerOptions` returns the signal, and `bindListenerSignal` handles it:
- an already-aborted signal adds nothing;
- otherwise an `abort` listener removes the entry.

This applies to element and document listeners.

### 5. Smaller gaps
- **`TextEncoder` / `TextDecoder`** (`index.ts`): added (UTF-8). `encode` returns a page `Uint8Array`, and `decode` accepts typed arrays or arrays.
- **Constraint validation** (`dom-bindings.ts`, `validityOf`):
  - `checkValidity()`, `reportValidity()` and a `validity` object (`valueMissing`, `typeMismatch`, `patternMismatch`, `tooShort`, `tooLong`) on form controls;
  - `form.checkValidity()` over its controls.
- **`localStorage.getItem`** (`web-storage-bindings.ts`): a missing key returns `null`, not `undefined`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/dom-tree.ts` | `querySelectorAll(selector, root?)`, document root `<html>` (#1) |
| `src/browser/js/dom-bindings.ts` | root-aware queries (#1); reflected attributes, URL parts, `document.head`/`forms`/`images`/`links`/`scripts` (#2); listener `signal` (#4); constraint validation (#5) |
| `src/browser/js/event-loop.ts` | earliest-due timer first (#3) |
| `src/browser/js/index.ts` | TextEncoder / TextDecoder (#5) |
| `src/browser/js/web-storage-bindings.ts` | `getItem` returns null (#5) |
| `tests/web-storage-bindings.test.ts` | two assertions expected the old `undefined` |
| `android/app/build.gradle` | 1.73 (74) → 1.74 (75) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/dom-apis-174.test.ts` | 68 cases: events, tree manipulation, attributes, selectors, forms, URL, storage, timers |

## Test Results
```
npx vitest run (1.74 engine commit e1ef2c4)   → Test Files 322 passed (322); Tests 11202 passed (11202)
DOM probe (70 cases)                          → 56 → 58 (queries) → 63 (reflection) → 66 (timers, signal, getItem) → 67 (TextEncoder) → 68 (validation)
npx vitest run tests/dom-apis-174.test.ts     → 68 passed
npx tsc --noEmit                              → clean
npx vitest run (final)                        → Test Files 322 passed, 1 failed (323); Tests 11268 passed, 2 failed
  the 2: tests/web-storage-bindings.test.ts expected getItem(missing) to be undefined (the old bug);
  updated to toBeNull()                       → 9 passed
gradlew :app:testDebugUnitTest :app:assembleRelease → OK
apksigner verify Nova-1.74.apk                → verified; versionCode 75, versionName 1.74
Tablet                                        → not connected (adb lists no devices); not installed
```
