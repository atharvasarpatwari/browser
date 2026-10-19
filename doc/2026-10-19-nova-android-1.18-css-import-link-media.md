# Nova Android 1.18 — @import, `<link media>`, and the Token CSS Parser's At-Rule Bugs

**Date:** 2026-10-19
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 8. This round fixes the two stylesheet ceilings from 1.17. Mid-round, the user confirmed the newly attached tablet (OPD2305, serial `IZ9HSSBUYHG6G6AU`) is theirs and asked for tests on it.
**Status:** Completed (1.18 installed on the tablet; on-screen checks pending, because it locked and then disconnected)

---

## Summary
- **`@import`:** sheets imported by a linked stylesheet are now fetched, resolved against the importing sheet, and placed before the importer's own rules. Their media lists are honoured, and import cycles are cut off.
- **`<link media>`:** `<link rel=stylesheet media="print">` (or any media query) is honoured. The sheet's rules apply only where the query matches; before, a print sheet styled the screen.
- **Bugs fixed along the way** in the token-level CSS parser (`css5/parser.ts` `parseStylesheet`):
  - every `@import` was dropped;
  - a statement at-rule swallowed the rules after it;
  - `@media screen and (…)` lists were mangled into `"screenand(max-width:600px)"`.
- **Version:** Nova **1.18** (versionCode 19).

## Root Causes
### 1. `@import` never followed; `<link media>` ignored
**Files:** `src/browser/engine/page-renderer.ts`, `src/browser/rendering/css-parser.ts`
**Problem:**
- 1.17 fetched linked sheets but didn't look inside them for `@import`.
- The `__external__` placeholder didn't record the link's `media`, so `media="print"` sheets applied on screen.

**Fix:**
- `extractStylesFromDocument` stores `media: [parseMediaQueries(attr)]` on the placeholder (unless it's `all`).
- `fetchStylesheet(url, page, media, seen, signal)` takes the import rules from `parseStylesheetRobust` and recursively fetches each one, resolved against the importing sheet's URL.
- Rules come out in cascade order: imported sheets first, then the sheet's own rules. Each rule's `media` gets the enclosing link and import media lists prepended, and the existing `@media` re-wrapping makes the cascade evaluate them.
- A `seen` set plus a cap of 16 sheets stops cycles and runaway chains.

`parseMediaQueries` is now exported from `css5/parser.ts`.

### 2. Token parser: at-rule prelude ran to the next `{`
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** `consumeAtRule` collected the prelude with `collectTokensUntil(CurlyBracketOpen)`. Statement at-rules end at `;` (CSS Syntax §5.4.2), so `@import a; @import b; p {…}` gave the first import a prelude running through `p`. The other imports and the first style rule's selector were swallowed.
**Fix:**
- The prelude stops at `{` or `;`.
- Unknown statement at-rules (`@layer a, b;`) consume their `;` instead of `skipAtRuleBody()`, which would have eaten the next block.

### 3. Token parser: `@import` URL never extracted
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** `consumeImportRule` matched a regex on `tokensToText(prelude)`, which joins token values. `url("a.css")` is a `Url` token whose value is just `a.css`, and `"a.css"` is a `String` token without its quotes. Neither form matched the regex, so every `@import` was dropped.
**Fix:** the URL is read from the first token: a `Url` or `String` token, or a `url(` `Function` token followed by a `String`.

### 4. Token parser: media lists lost their spaces
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** whitespace tokens are removed before parsing, and `parseMediaQueriesFromTokens` joined token values. `@media screen and (max-width: 600px)` became one media type, `"screenand(max-width:600px)"`. The app's own pipeline uses the string-level `parseStylesheetRobust`, which was correct, but the token path is the parser's documented API and is used by the benchmarks.
**Fix:** `sourceOf(tokens)` slices the original CSS between the first token's start and the last token's end. `@media` and `@import` media lists both use it, and the dead `parseMediaQueriesFromTokens` is deleted.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | `fetchStylesheet` (imports, media, cycle guard); `CssMediaQuery` type import |
| `src/browser/rendering/css-parser.ts` | `<link media>` stored on the placeholder |
| `src/browser/rendering/css5/parser.ts` | prelude ends at `;`; token-based import URL; `sourceOf` for media text; `parseMediaQueries` exported; dead helper removed |
| `tests/example-domain-render.test.ts` | 4 tests: `@import` fetched and ordered; `<link media>` print/max-width plus `@import` media; cycle; parser `@import` forms with a spaced media list |
| `android/app/build.gradle` | 1.17 (18) → 1.18 (19) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-19-nova-android-1.18-css-import-link-media.md` | This change log |

## Test Results
- **On the 1.17 sources** (3 files reverted): the import, media and parser tests failed (3). The cycle test passes either way.
- **Along the way:** the first media and cycle tests passed before imports worked at all. A direct parser test exposed that, then root causes 2–4.

```
npx vitest run tests/example-domain-render.test.ts -> 34 passed (34)
npx tsc --noEmit                                   -> exit 0
npx vitest run                                     -> 271 files, 10504 passed (10504)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.18.apk                     -> verified (1,523,448 B)
```

## Devices
| Device | State |
|--------|-------|
| Realme RMX5264 (`KNEUZTEE6TIBAIIV`, Android 16) | Not attached this round. Has 1.17. |
| OPD2305 tablet (`IZ9HSSBUYHG6G6AU`, Android 14, 1720×2408) | Attached mid-round as "unauthorized". The user confirmed it's theirs ("this device is also mine please do the tests") and authorized USB debugging. It had Nova 1.0. 1.18 installed with `adb install -r`: `Success`, versionName 1.18, no OEM prompt. It then locked, and later disconnected (`adb devices` empty), so the on-screen checks are pending. |

## What's new in Nova 1.18 (user-facing)
- Sites that split their CSS across files with `@import` now get all of it.
- Print-only style sheets no longer change how pages look on screen.
