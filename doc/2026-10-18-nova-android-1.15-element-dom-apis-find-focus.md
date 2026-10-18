# Nova Android 1.15 — Element DOM APIs for Page Scripts, Find-Bar Focus

**Date:** 2026-10-18
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 5. Before this, 1.14 was verified on the phone. Then the approved plan `2026-10-18-nova-element-dom-apis-plan.md` ("Implement the full plan") was carried out.
**Status:** Completed, and verified on the phone (1.15 installed after the user approved the install check)

---

## Summary
- **On the phone, with 1.14:**
  - example.com renders correctly: a `#eee` background, centred text in a `max-width` column (the black screen is gone);
  - pull-to-refresh re-fetches the page;
  - reload re-fetches it;
  - find-in-page highlights and counts matches (1/1 for "domain").

  That clears the device checks pending since 1.9. One new bug turned up: the find field didn't take focus when opened from the menu.
- **Page scripts:** element wrappers gain:
  - live `children`/`parentNode`/sibling getters;
  - `querySelector(All)`, `closest` and a correct `matches`;
  - `insertAdjacentHTML` and a working `innerHTML` setter, both cleaned like `setAttribute`;
  - `append`, `prepend`, `before`, `after`, `remove`, `replaceChildren`;
  - `lang`, `dir`, `title`, `hidden`.

  Three underlying bugs are fixed too: array spread (`[...x]`) didn't spread, moving a DOM node duplicated it, and `matches()` only matched the document's first hit. example.com's own script now runs to completion.
- **Version:** Nova **1.15** (versionCode 16).

## Root Causes
### 1. Element APIs missing; navigation properties were stale snapshots
**File:** `src/browser/js/dom-bindings.ts`
**Problem:**
- `wrapElement` defined `querySelector`/`querySelectorAll` only on `document`, and had no `insertAdjacentHTML`, `append`, `prepend`, `before`, `after`, `remove`, `replaceChildren` or `closest`.
- `innerHTML` was a value written once, so assigning to it did nothing to the DOM.
- `children`, `childNodes`, `parentNode`, `firstChild` and `innerHTML` were computed when the wrapper was made. Wrappers are cached per element (`elementCache`), so after any `appendChild`/`removeChild` a script kept seeing the old tree. Building `children` also wrapped every child eagerly, at wrap time.

**Fix:** `defineTreeApis(obj, el, domTree)` adds the following, all as getters, setters or methods that work through the existing `DomTree` mutation methods (so reflow and paint still see every change):
- **Navigation:** `children`, `childNodes`, `childElementCount`, `parentNode`, `parentElement`, `first/lastChild`, `first/lastElementChild`, `next/previousSibling`, `next/previousElementSibling`.
- **HTML:** `innerHTML` (getter and setter) and `insertAdjacentHTML` (all 4 positions, and a `SyntaxError` for a bad position).
- **Selectors:** `querySelector(All)` scoped to descendants, and `closest`. `ponytail:` this is a document-wide query filtered to descendants, O(document) per call.
- **Insertion:** `append`/`prepend`/`before`/`after`/`remove`/`replaceChildren`; non-node arguments become text nodes.
- **Reflected attributes:** `lang`, `dir`, `title`, `hidden`.

**Security:** inserted HTML is parsed with `HtmlParser` into detached nodes (the new `DomTree.parseFragment`). Each attribute then goes through the same checks as `setAttribute`: `isEventHandlerAttribute` drops `on*`, and `isUrlAttribute` with `isBlockedUrlScheme` drops `javascript:` URLs. Scripts inside inserted HTML aren't run, as in browsers.

### 2. `matches()` was only true for the document's first match
**File:** `src/browser/js/dom-bindings.ts`
**Problem:** `return domTree.querySelector(sel) === el`.
**Fix:** `domTree.querySelectorAll(sel).includes(el)`.

### 3. Array spread didn't spread
**File:** `src/browser/js/interpreter.ts`
**Problem:** `evalArray` evaluated a `SpreadElement` to its operand and stored it as **one element**, so `[...nodeList]` was `[nodeList]`. Because of this, example.com's `P=[...B.querySelectorAll("p")]` gave `P[0].lang` on an array. Spreading `undefined` didn't throw either.
**Fix:** `spreadValues()` covers JS arrays, interpreter arrays and array-likes (by index, through getters) and strings (by character). `null`/`undefined` throw `TypeError: … is not iterable`. Call-argument spread already worked.

### 4. Moving a node duplicated it
**File:** `src/browser/rendering/dom-tree.ts`
**Problem:** `appendChild`/`insertBefore` never removed the node from its current parent. So `body.prepend(existingChild)`, or any re-append, left the node in two places.
**Fix:** a private `detach()` runs before inserting (DOM §4.2.3). The insertion index is computed after detaching, and inserting a node before itself does nothing.

### 5. Find field not focused when opened from the menu (found on the phone)
**File:** `android/app/src/main/java/com/nova/browser/ui/components/FindBar.kt`
**Problem:** the bar appeared, but typing went nowhere until the field was tapped. Nothing requested focus.
**Fix:** a `FocusRequester` on the `BasicTextField`. A `LaunchedEffect` waits one frame, then requests focus and shows the soft keyboard.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/dom-bindings.ts` | snapshot props removed; `defineTreeApis`, `parseHtmlFragment`, `argsToNodes`, `wrapNode`, `isDescendantOf`; `matches` fixed |
| `src/browser/js/interpreter.ts` | `evalArray` spreads; `spreadValues` |
| `src/browser/rendering/dom-tree.ts` | `parseFragment` (on the class, optional on `IDomTree`); `detach` before insert |
| `android/app/src/main/java/com/nova/browser/ui/components/FindBar.kt` | focus and keyboard on open |
| `tests/example-domain-render.test.ts` | `renderAtPhoneWidth(page, script)`; end-to-end test of the real `s.js` as `<script src>` |
| `doc/2026-10-18-nova-element-dom-apis-plan.md` | Status → Completed |
| `android/app/build.gradle` | 1.14 (15) → 1.15 (16) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/dom-bindings-element-apis.test.ts` | 10 tests through `runJS`: spread, scoped selectors, live navigation, `insertAdjacentHTML` ×4, `innerHTML` set/get, fragment cleaning, ParentNode/ChildNode, move-not-duplicate, `closest`/`matches`, reflected attributes |
| `doc/2026-10-18-nova-android-1.15-element-dom-apis-find-focus.md` | This change log |

## Test Results
The new tests were run against the 1.14 versions of the three source files (diff saved, files checked out, re-applied afterwards):
```
on 1.14 sources: tests/dom-bindings-element-apis.test.ts -> 10 failed (10)
                 s.js end-to-end test                    -> 1 failed
with the fixes:  tests/dom-bindings-element-apis.test.ts -> 10 passed (10)
                 s.js end-to-end test                    -> passed
npx tsc --noEmit                                         -> exit 0
npx vitest run                                           -> 270 files, 10488 passed (10488)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.15.apk                           -> verified (1,519,352 B)
```

## Verification on the phone (Realme RMX5264, Android 16)
Checked on 1.14 before this round's code changes. Every tap went through a guard that allows input only when Nova owns the focused window; the guard now also accepts Nova's own popup windows, checked via `dumpsys window windows`.

| Check | Result |
|-------|--------|
| example.com renders (was black on 1.13) | **Pass**: `#eee` canvas, centred text column |
| Pull-to-refresh | **Pass**: a swipe from the top triggered `fetch[3] GET https://example.com/` |
| Reload button | **Pass**: `fetch[4] GET https://example.com/` |
| Find in page | **Pass** after tapping the field: "domain" highlighted, 1/1, scroll-track marker. The missing auto-focus is root cause 5, fixed in 1.15 |
| example.com script | still failed on 1.14 (`reading 'lang'`), as expected; fixed in 1.15 (end-to-end test) |
| 1.15 installed | **Pass**: `Success`, versionName 1.15 |
| example.com script on 1.15 | **Pass**: no `[ScriptEngine]` errors in logcat; the translations were added (French visible) and the page now scrolls |
| Find opened from the menu, typed immediately | **Pass**: the field took focus and showed the keyboard; "domain" gave 1/2 (with the French "domaine") |

## Found on the phone, not fixed
- **Non-ASCII text is blank:** the rasterizer draws glyphs from a built-in 8×8 bitmap font that covers ASCII 32–126 only. Arabic, Chinese and Russian text come out empty, and accented letters drop out ("réservé" shows as "r serv"). Next candidate: draw text through the WebView's own canvas `fillText`, or ship a Unicode bitmap font.

## What's new in Nova 1.15 (user-facing)
- Sites whose scripts add or move content (menus, translations, "load more", widgets) now work far more often.
- Find in page is ready to type as soon as it opens.
