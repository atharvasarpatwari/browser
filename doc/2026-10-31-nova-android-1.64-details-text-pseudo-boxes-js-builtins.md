# Nova Android 1.64: Closed `<details>` Text, Generated Boxes Kept in Place, JSON Reviver, `template.content`

**Date:** 2026-10-31
**Session:** "keep improving the nova app" — tablet check of 1.63 (after the user unlocked it) plus a 46-feature JS probe
**Status:** Completed

---

## Summary

The 1.63 tablet check passed for its three features (button/card labels drawn, `toggle` events, the script-grown SVG ring) and found two layout bugs, both fixed and re-verified on the tablet: a closed `<details>` still showed its bare text, and a summary's ▸ marker jumped to the page's left edge after any later frame. The cause of the second also affected every author `::before`/`::after` box. A JS probe of 46 everyday built-ins then found 5 gaps; 4 fixed (`JSON.parse` reviver and SyntaxError, `includes(NaN)`, numeric separators, `template.content`). BigInt arithmetic is left (rare on pages).

Note: Nova (`com.nova.browser`) was gone from the tablet when it was unlocked (only `com.nova.browser.debug` remained); 1.63 was reinstalled before testing.

## Root Causes

### 1. A closed `<details>` rendered its bare text
**File:** `src/browser/rendering/dom-tree.ts`
**Problem:** the cascade hides a closed details' non-summary *elements*, but a text node child (`<details><summary>More</summary>Body text</details>`) has no style to hide, so it was laid out and painted.
**Fix:** `boxChildren()` — the list layout and paint walk — returns only element children for a closed details:
```ts
if ((el.tagName === 'details' || el.tagName === 'DETAILS') && !el.attributes?.has('open')) {
  return node.children.filter((c) => c.nodeType === 'element');
}
```

### 2. Generated boxes stayed layout-dirty and were re-laid at the parent's origin
**Files:** `src/browser/rendering/dom-tree.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** `clearSubtreeDirty` / `markSubtreeDirty` walked `node.children`, which never contains the `::before`/`::after` boxes. A generated box was created layout-dirty and stayed so; on the next incremental frame its clean host was skipped and the dirty box was laid out on its own at the *parent's* origin and full width. The tablet showed the summary's ▸ at x=0 with a gap before its text; any `::before` icon or counter could drift the same way. Restyles that replaced a host's generated boxes also left the new boxes without a place until the host happened to be relaid.
**Fix:** both subtree walks use `boxChildren()`; `applyPseudoElements` marks the host layout-dirty whenever it creates or removes a generated box, so the boxes are placed inside it.

### 3. `JSON.parse` ignored the reviver and swallowed syntax errors
**File:** `src/browser/js/index.ts`
**Problem:** `JSON.parse(text, reviver)` dropped the reviver (date-reviving loaders kept strings), and bad JSON returned `undefined` instead of throwing, so pages carried on with nothing instead of reaching their `catch`.
**Fix:** a bottom-up reviver walk (holder as `this`, `undefined` deletes the key); bad input throws a real `SyntaxError` object (`e instanceof SyntaxError`, `e.name`, `e.message`).

### 4. `[NaN].includes(NaN)` was false
**File:** `src/browser/js/values.ts` (and the duplicate in `index.ts`)
**Problem:** `includes` reused `indexOf`'s strict equality; `includes` uses SameValueZero.
**Fix:** a NaN search value matches NaN elements.

### 5. Numeric separators (`1_000`) lexed as `1`
**File:** `src/browser/js/lexer.ts`
**Problem:** the number scanner stopped at `_`.
**Fix:** each digit run (decimal, fraction, exponent, hex, binary, octal) accepts `_` between digits, stripped from the token.

### 6. `template.content` was undefined
**File:** `src/browser/js/dom-bindings.ts`
**Problem:** `tpl.content.cloneNode(true)` — how libraries and web components stamp markup — threw.
**Fix:** a lazily created `#document-fragment` per template; on each access the template's children (parsed or set by `innerHTML`) move into it.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/dom-tree.ts` | closed details box children (#1); dirty walks include generated boxes (#2) |
| `src/browser/engine/page-renderer.ts` | host relaid when its generated boxes change (#2) |
| `src/browser/js/index.ts` | JSON.parse reviver + SyntaxError (#3); includes SameValueZero (#4) |
| `src/browser/js/values.ts` | `arrayIncludes` SameValueZero (#4) |
| `src/browser/js/lexer.ts` | numeric separators (#5) |
| `src/browser/js/dom-bindings.ts` | `template.content` (#6) |
| `android/app/build.gradle` | versionCode 65, versionName 1.64 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/details-pseudo-js-164.test.ts` | closed details text; summary marker and author ::before stay put across frames; JSON reviver, SyntaxError, includes(NaN), numeric separators, template.content (8 tests) |

## Verification

- Tablet, 1.63: button with a `<div>` label and inline-block card link drawn ✅; details `toggle` log "open, closed" ✅; "Grow the ring" redraws the SVG ✅; closed-details text ❌ and marker jump ❌ → fixed in 1.64.
- Tablet, 1.64 (same taps): closed details hides its body ✅, ▸ stays beside its text after the Grow taps ✅, open ▾ shows the body ✅, toggle log "open, closed" ✅.
- JS probe of 46 built-ins: 41 → 45 pass (BigInt arithmetic left).

## Test Results

```
npx tsc --noEmit                                       → clean
npx vitest run tests/details-pseudo-js-164.test.ts     → 8 passed
npx vitest run                                         → Test Files 311 passed (311); Tests 10791 passed (10791)
gradlew :app:testDebugUnitTest :app:assembleRelease    → BUILD SUCCESSFUL
apksigner verify Nova-1.64.apk                         → verified; aapt: versionCode 65, versionName 1.64
adb install -r Nova-1.64.apk                           → Success (OPPO OPD2305)
```
