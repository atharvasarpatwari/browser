# Nova Android 1.66: Selectors and the Cascade (Escaped Classes, :has, Form States, !important, @layer)

**Date:** 2026-11-01
**Session:** "keep improving the nova app" — a 72-case probe of selector matching and cascade order on computed styles
**Status:** Completed (tablet not connected: verified by tests; APK built, not installed)

---

## Summary

A probe of 72 selector and cascade cases passed 58. Three failures hit whole classes of sites: Tailwind's escaped class names (`.md\:flex`, `.w-1\/2`) never matched, so responsive and fraction utilities did nothing; every stylesheet `!important` was dropped on the way to the cascade; and `@layer` was flattened, so layered framework CSS beat a page's own unlayered rules. All fixed, plus `:has()` relative selectors, `:nth-child(-n+B)` and `(An+B of S)`, `:only-child`, `:lang()`, real `:checked/:disabled/:enabled/:required/:optional`, and `:empty` matching elements that hold text. 71/72 now pass; the last (dropping a whole rule when one selector in its list is invalid) is left deliberately — it needs a full validity table and getting it wrong would drop rules browsers apply.

## Root Causes

### 1. Escaped class names never matched
**Files:** `src/browser/rendering/css5/tokenizer.ts`, `css5/parser.ts`, `css-parser.ts`
**Problem:** three steps each broke `.md\:flex`: the CSS tokenizer read escapes only at the start of a name (`consumeIdent`/`consumeHash` loops stopped at `\`, giving class `md`); the string selector tokenizer did the same; and rules were serialized back to text with raw names (`*.md:flex` — now a pseudo-class — and `*.w-1`), then re-parsed by the page renderer.
**Fix:** `isEscapeAt()` continues names through valid escapes; `readSelectorIdent()` decodes `\:`, `\/`, `\31 ` in the string tokenizer; `escapeIdent()` (CSSOM `CSS.escape` rules) writes class and id names back escaped.

### 2. Stylesheet `!important` always lost
**Files:** `src/browser/rendering/css-parser.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** the legacy `CssRule` holds declarations as `property → value`, and `buildCss5Stylesheet` rebuilt them with `important: false`. `p{display:flex !important}` lost to `style="display:grid"` and to any more specific normal rule.
**Fix:** rules carry an `important` set; the rebuild restores each flag.

### 3. `@layer` flattened
**Files:** `css-parser.ts`, `page-renderer.ts`, `css5/cascade.ts`
**Problem:** layered rules were emitted as plain rules (a ponytail note in the code admitted it), so they competed by specificity with unlayered ones; `@layer a, b;` statements vanished; and the cascade's `layer-order` handler `unshift`ed names, ranking a statement's names below layers seen earlier.
**Fix:** rules carry their layer (`a.b` when nested, a unique name when anonymous), statements travel as `__layer_order__` markers, and the rebuild wraps rules back into css5 `layer` / `layer-order` rules. Layer names rank by first declaration; `!important` reverses layer precedence (CSS Cascade 5 §6.4).

### 4. `:has()` ignored its combinator
**Files:** `css5/parser.ts`, `css5/types.ts`, `css5/selector.ts`, `css-parser.ts`
**Problem:** the leading `>`/`+`/`~` of a relative selector was skipped, so `:has(+ p)` looked for descendants (and parsed to an empty list on one path).
**Fix:** `parseRelativeSelectorList()` stores each selector's combinator (`relative`); matching checks children / next sibling / later siblings / descendants; serialization keeps it.

### 5. Structural pseudo-classes
**File:** `css5/selector.ts`
**Problem:** `parseAnB('-n+2')` gave `a = NaN`; `nth-child(2 of .x)` wasn't parsed; `:only-child`/`:only-of-type` and `:lang()` didn't exist (the parser files the argument-less structural names as dynamic, which returned false).
**Fix:** `-n` is −1; `of S` filters the counted siblings (S parsed once, cached); only-child/only-of-type and the other structural names route to the structural matcher; `:lang()` walks to the nearest `lang` with prefix matching.

### 6. Form-state pseudo-classes were constants
**Files:** `css5/selector.ts`, `page-renderer.ts`, `css5/cascade.ts`, `dom-tree.ts`
**Problem:** `:checked`, `:disabled`, `:required` were always false and `:enabled`/`:optional` always true, so `input:checked + label` toggles and disabled-button styles never applied. A tapped checkbox also never restyled anything.
**Fix:** they read the element (disabled includes a disabled fieldset ancestor; checked uses the live `formChecked` passed on the selector mirror); `repaintElement` now also calls `markStyleDirtyFrom` so `:checked + x` rules re-run after a tap.

### 7. `:empty` matched elements with text
**Files:** `css5/selector.ts`, `page-renderer.ts`
**Problem:** the selector mirror lists only element children and `hasTextContent()` always returned false, so `<span class="badge">3</span>` was `:empty` — `.badge:empty{display:none}` hid real badges.
**Fix:** the mirror carries `hasText`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/tokenizer.ts` | escapes inside names (#1) |
| `src/browser/rendering/css5/parser.ts` | `readSelectorIdent`, `parseRelativeSelectorList` (#1, #4) |
| `src/browser/rendering/css5/types.ts` | `has.relative` (#4) |
| `src/browser/rendering/css5/selector.ts` | :has relatives, An+B, of S, only-*, :lang, form states, :empty (#4–#7) |
| `src/browser/rendering/css5/cascade.ts` | layer-order push; !important reverses layers; mirror fields (#3, #6) |
| `src/browser/rendering/css-parser.ts` | escaped serialization; `important`, `layer`, layer-order markers (#1–#4) |
| `src/browser/engine/page-renderer.ts` | importance and layers rebuilt; `selectorFacts`; restyle on control change (#2, #3, #6, #7) |
| `src/browser/rendering/dom-tree.ts` | `markStyleDirtyFrom` public (#6) |
| `android/app/build.gradle` | versionCode 67, versionName 1.66 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/selectors-cascade-166.test.ts` | 75 selector/cascade cases, checkbox tap restyle, escaped-name round trip (77 tests) |

## Verification

- Probe: 58/72 → 67 (escapes, :has, An+B, of S, :lang, form states) → 68 (only-child) → 71 (!important, layers).
- New cases beyond the probe: `:empty` with text, layered vs unlayered `!important`, `@layer y, z;` after an existing layer, an escaped class inside `@media`.
- Device: the tablet was not connected (`adb devices` empty).

## Test Results

```
npx tsc --noEmit                                       → clean
npx vitest run tests/selectors-cascade-166.test.ts     → 77 passed
npx vitest run                                         → Test Files 313 passed (313); Tests 10912 passed (10912)
gradlew :app:testDebugUnitTest :app:assembleRelease    → BUILD SUCCESSFUL
apksigner verify Nova-1.66.apk                         → verified; aapt: versionCode 67, versionName 1.66
```
