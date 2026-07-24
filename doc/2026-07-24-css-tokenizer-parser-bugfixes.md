# CSS5 Tokenizer & Parser Bug Fixes — Comprehensive Session

**Date:** 2026-07-24
**Session:** CSS5 tokenizer/parser audit and bug fixes — 12 bugs fixed across tokenizer, parser, selector engine, and facade
**Status:** Completed

---

## Summary

Audited the CSS5 tokenizer and parser against the CSS specification, identified 12 bugs across tokenization, rule parsing, selector parsing, and string handling. Fixed all issues while maintaining backward compatibility with the `ICssParser` facade API. Total CSS test count: 273 (52 + 86 + 105 + 30). Full suite: 5683 passed (131 files).

---

## Root Causes

### 1. Asterisk Tokenization (Bug #1)
**File:** `src/browser/rendering/css5/tokenizer.ts`
**Problem:** `*` was consumed by `isIdentStart()` check before the explicit character checks, producing an `Ident` token instead of `Asterisk`.
**Fix:** Added `CssTokenType.Asterisk` to the enum and added an explicit check for `*` in the main tokenize loop before the ident check.

### 2. Negative Dimensions (Bug #2 — CRITICAL)
**File:** `src/browser/rendering/css5/tokenizer.ts`
**Problem:** `-5px` was tokenized as `Ident(-5px)` because `-` was checked before number parsing.
**Fix:** Moved the number/dimension/percentage check before the ident check in the main tokenize loop (per CSS spec §4.3.1).

### 3. Whitespace in Dimensions (Bug #3)
**File:** `src/browser/rendering/css5/tokenizer.ts`
**Problem:** `10 px` was tokenized as a single `Dimension` because `skipWhitespace()` was called before the dimension unit check.
**Fix:** Removed the `skipWhitespace()` call before the dimension unit check — CSS spec says whitespace between number and unit prevents dimension creation.

### 4. Multiple Pseudo-Classes (Bug #4)
**File:** `src/browser/rendering/css5/types.ts` + `parser.ts` + `selector.ts` + `css-parser.ts`
**Problem:** `CssCompoundSelector.pseudoClass` was singular, so `a:hover:focus` only stored the last pseudo-class.
**Fix:** Changed `pseudoClass: CssPseudoClassSelector | null` to `pseudoClasses: readonly CssPseudoClassSelector[]` and updated all references across parser, selector matching, specificity, and string conversion.

### 5. Unterminated Strings (Bug #5)
**File:** `src/browser/rendering/css5/tokenizer.ts`
**Problem:** Unterminated strings emitted `String` instead of `BadString`.
**Fix:** Changed unterminated string handling to emit `CssTokenType.BadString`.

### 6. Unquoted URLs (Bug #6)
**File:** `src/browser/rendering/css5/tokenizer.ts`
**Problem:** `consumeUrl()` was unreachable dead code because `u` always matched the ident check first.
**Fix:** Moved the URL check (`ch === 'u' && this.matchAhead('url(')`) before the ident check. Added `isNonPrintable()` method. Emits `BadUrl` for backslashes, quotes, parentheses, and non-printable characters in unquoted URLs.

### 7. Dead `consumeQualifiedRule` (Bug #7)
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** `consumeQualifiedRule()` always returned `null` — the code path to `consumeQualifiedRuleFromTokens()` was unreachable.
**Fix:** Changed `consumeRuleList` to call `consumeQualifiedRuleFromTokens` directly.

### 8. Selector Lists (Bug #8 — CRITICAL)
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** Comma-separated selectors like `h1, h2, h3` were parsed as a single selector because `consumeQualifiedRuleFromText` didn't split on commas.
**Fix:** Added `splitSelectorList()` helper that respects parentheses and strings. Updated `consumeQualifiedRuleFromText` to split selector string on commas, parse each part separately, and use the most specific selector's specificity (per CSS spec).

### 9. `:not()` Combinators (Bug #9)
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** `cleanTokens(arg)` stripped whitespace before parsing functional pseudo-class arguments, losing descendant combinators (e.g., `:not(a b)` → `:not(ab)`).
**Fix:** Changed `cleanTokens(arg)` to `tokenizeCss(arg).filter(...)` in both `consumePseudoClass` and `consumePseudoClassFunction` to preserve whitespace tokens.

### 10. Semicolons Inside Strings (Bugs #10/#11)
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** Declaration splitting used naive `;` splitting that broke inside quoted strings.
**Fix:** Added `splitOnSemicolon()` helper that respects string boundaries (handles escaped quotes). Updated both `consumeDeclarationList` and `consumeDeclarationsFromText`.

### 11. Media Query Feature Parsing (Bug #12)
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** `parseSingleMediaQuery` lost feature content when whitespace separated name and value (e.g., `(min-width: 800px)` → name only).
**Fix:** Fixed `parseSingleMediaQuery` to reconstruct full feature string by joining parts until closing `)`.

### 12. Hex Escape Validation (Bug #13)
**File:** `src/browser/rendering/css5/tokenizer.ts`
**Problem:** Hex escapes >0x10FFFF, surrogates, null, U+FFFE, and U+FFFF were not validated.
**Fix:** Added range checks for null (→U+FFFD), surrogates (→U+FFFD), >0x10FFFF, U+FFFE, and U+FFFF (all →U+FFFD).

### 13. Attribute Operators (Bug #14)
**Files:** `tokenizer.ts`, `parser.ts`
**Problem:** `|`, `^`, `$` characters were skipped as unknown in the tokenizer, making `|=`, `^=`, `$=` operators unparseable in the token-level parser. In the text-level parser (`tokenizeSelector`), `|` was consumed into attribute names instead of being recognized as an operator prefix.
**Fix:** Emitted `|`, `^`, `$` as tokens in the main tokenizer. Fixed `tokenizeSelector` attribute name loop to stop at operator-prefix characters when followed by `=`.

### 14. CDC Token Reachability (Bug #15)
**File:** `src/browser/rendering/css5/tokenizer.ts`
**Problem:** CDC (`-->`) was checked after the ident check, making it unreachable for strings starting with `-`.
**Fix:** Moved CDC check before the ident check.

### 15. Ident Character Range (Bug #16)
**File:** `src/browser/rendering/css5/tokenizer.ts`
**Problem:** `isIdentStart` used `>` instead of `>=` for U+0080 check, excluding valid identifier characters.
**Fix:** Changed to `>=` in `isIdentStart` and added `-` to `isIdentChar` (not `isIdentStart`).

### 16. `@layer` Support (Feature)
**File:** `types.ts`, `parser.ts`
**Problem:** No CSS cascade layer support.
**Fix:** Added `CssLayerRule` and `CssLayerOrderRule` types. Added handling in `consumeAtRuleFromText` for both `@layer name { ... }` and `@layer a, b, c;`.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/browser/rendering/css5/tokenizer.ts` | Asterisk token, negative dims, URL check ordering, whitespace in dimensions, unterminated strings, unquoted URLs, hex escapes, CDC reachability, ident range, pipe/caret/dollar tokens |
| `src/browser/rendering/css5/parser.ts` | Dead code removal, selector lists, :not() combinators, multiple pseudo-classes, semicolon splitting, media queries, @layer, splitSelectorList helper |
| `src/browser/rendering/css5/types.ts` | Added `Asterisk` token type, `CssLayerRule`, `CssLayerOrderRule` types, changed `pseudoClass` → `pseudoClasses` |
| `src/browser/rendering/css5/selector.ts` | Updated `matchesCompound` to iterate `pseudoClasses` array |
| `src/browser/rendering/css-parser.ts` | Updated `compoundToString` to iterate `pseudoClasses` array |

## Files Created

| File | Purpose |
|------|---------|
| `tests/css5-tokenizer-parser.test.ts` | 52 comprehensive tests for all tokenizer and parser fixes |

## Test Results

```
css5.test.ts:                   86 passed
css5-tokenizer-parser.test.ts:  52 passed
wpt/css-spec.test.ts:          105 passed
wpt/css-specificity-cascade:    30 passed
Full suite:                   5683 passed (131 files, 1 pre-existing OOM failure)
```

## Verification Steps

1. Ran `npx vitest run tests/css5-tokenizer-parser.test.ts` — 52/52 pass
2. Ran `npx vitest run tests/css5.test.ts` — 86/86 pass
3. Ran `npx vitest run tests/wpt/css-spec.test.ts` — 105/105 pass
4. Ran `npx vitest run tests/wpt/css-specificity-cascade.test.ts` — 30/30 pass
5. Ran full suite `npx vitest run` — 5683/5683 pass (1 pre-existing OOM)
6. Verified backward compatibility with `ICssParser` facade API
