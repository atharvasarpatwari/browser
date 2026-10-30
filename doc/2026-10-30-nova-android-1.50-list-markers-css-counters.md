# Nova Android 1.50: List Bullets and Numbers, CSS Counters

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html". A probe of basics most pages rely on found that lists had no markers at all.
**Status:** Completed (built and signed; not installed: no install requested this round)

---

## Summary
- **Markers:** `<ul>` had no bullets and `<ol>` no numbers, on every page. Now they do, with:
  - `disc`/`circle`/`square`, decimal, letters, Roman numerals and Greek;
  - string marker types;
  - `<ol start|reversed|type>` and `<li value>`;
  - `list-style: none`.
- **Counters:** `counter()` in generated content (hand-numbered lists, numbered headings) produced nothing. CSS counters now work.

## Root Causes

### RC-1: `<li>` was a plain block, and no marker was ever painted
**Files:** `src/browser/rendering/css5/cascade.ts`, `src/browser/rendering/list-markers.ts` (new), `src/browser/rendering/paint-engine.ts`
**Problem:**
- `li` was in the UA's block list (`display: block`).
- `ul`/`ol` didn't set `list-style-type`.
- Nothing painted markers.

**Fix:**
- **UA:** `li { display: list-item }`; `ul, menu { list-style-type: disc }`; `ol { list-style-type: decimal }`.
- **Paint:** a `list-item` box gets its marker ("outside" position).
  - **Text:** `markerText(type, n)`.
  - **Number:** `listOrdinal(li)` counts list-item siblings, honouring `start`, `reversed` and `value`. HTML `type="a|A|i|I|1"` applies when the CSS type is the default.
  - **Placement:** right-aligned half an em left of the content box, on the first line's baseline (the first text run in the item or its descendants), in the item's font and colour.
  - **Clipping:** drawn after the item's own clip is restored, so `overflow: hidden` doesn't cut it off.

ponytail: painted, not a `::marker` box. `inside` is drawn like `outside`, `list-style-image` falls back to the type, and nested lists don't step disc → circle → square.

### RC-2: `counter()` gave an empty string
**Files:** `src/browser/rendering/generated-content.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** Generated content parsed `counter()`/`counters()` and dropped them, and nothing tracked `counter-reset`/`counter-increment`.
**Fix:**
- The full style pass runs in document order with a `Counters` map. `applyCounterProperties` applies `counter-reset`, `counter-set` and `counter-increment`: the element's own, then its `::before`'s.
- `counter(name, style)` formats the value through `markerText` (without its trailing dot).
- An incremental restyle has no counter state, so a pseudo box whose `content` is unchanged keeps the text from the full pass.

ponytail: one flat counter set per page; `counters()` gives the innermost value only.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | UA `li` list-item; `ul`/`ol`/`menu` list-style-type |
| `src/browser/rendering/paint-engine.ts` | `listMarkerCommands` for list-items |
| `src/browser/rendering/generated-content.ts` | `Counters`, `applyCounterProperties`, `counter()`/`counters()`, reuse on incremental restyle |
| `src/browser/engine/page-renderer.ts` | Counter state through the full style pass |
| `android/app/build.gradle` | 1.50 (51) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/rendering/list-markers.ts` | `markerText`, `listOrdinal`, `listMarkerCommands` |
| `tests/list-markers-150.test.ts` | 5 tests: marker text for each type; ul bullets and ol numbers placed left of the first line; start/reversed/value/type; `list-style: none`; counters in `::before` with per-list resets and `upper-roman` headings |
| `Nova-1.50.apk` | Signed build |

## Still open
- The on-device check of 1.46–1.50 (install not requested).
- `::marker` styling, `list-style-image`, nested counter scopes.

## Test Results
```
npx tsc --noEmit                              -> clean
npx vitest run tests/list-markers-150.test.ts -> 5 passed (5)
npx vitest run                                -> Test Files 302 passed (302), Tests 10738 passed (10738)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.50.apk                -> Verifies; versionCode 51, versionName 1.50
```
