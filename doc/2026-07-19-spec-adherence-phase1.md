# WHATWG/W3C Spec Adherence — Phase 1 Implementation

**Date:** 2026-07-19
**Session:** Phase 1 critical spec fixes (capture phase, CSS specificity, regex lexing, template literals)
**Status:** Completed

---

## Summary

Implemented 4 of 6 Phase 1 critical spec adherence fixes from the audit identified in the prior session. Fixed capture-phase event propagation, CSS specificity comparison, regex literal disambiguation in the lexer, and template literal `${expr}` interpolation in the parser/interpreter. Also fixed pre-existing PermissionManager test failures.

## Root Causes

### 1. Capture Phase Event Propagation
**File:** `src/browser/rendering/html5/events.ts:390`
**Problem:** Capture phase event walk was gated by `if (event.bubbles)`, meaning non-bubbling events (e.g., `focus`, `load`) never reached the capture phase.
**Fix:** Removed the `if (event.bubbles)` guard so the capture phase always runs per WHATWG DOM Living Standard.
**Code:** Removed `if (event.bubbles) {` and its closing `}` around the capture phase walk.

### 2. CSS Specificity Comparison
**File:** `src/browser/rendering/css5/parser.ts:1611`
**Problem:** Typo in `compareSpecificity`: `b.b - b.b` (always 0) instead of `b.b - a.b`, making tag-level specificity tiebreakers always equal.
**Fix:** Changed `b.b - b.b` → `b.b - a.b`.

### 3. Regex Literal Lexing (`/` Ambiguity)
**File:** `src/browser/js/lexer.ts`
**Problem:** The lexer treated `/` as always a `Slash` operator. After binary operators (e.g., `* /`), `/` starts a regex literal per ECMAScript spec.
**Fix:** Added `lastTokenType` tracking, `isRegexContext()` method, and `readRegex()` method. `nextToken()` now checks context before deciding whether `/` is division or regex start. Added `RegExp` token type.

### 4. Template Literal `${expr}` Interpolation
**Files:** `src/browser/js/lexer.ts`, `src/browser/js/tokens.ts`, `src/browser/js/parser.ts`, `src/browser/js/interpreter.ts`
**Problem:** Lexer emitted only `TemplateHead`/`TemplateEnd` tokens (no middle segments), and the parser had no method to handle expressions inside `${}`. A duplicate `parseTemplateLiteral` method silently overwrote the correct implementation.
**Fix (Lexer):** `readTemplate()` now emits `TemplateHead` (stops at `${`) or `TemplateEnd` (closing backtick). New `readTemplatePart()` emits `TemplateMiddle`/`TemplateTail` after parser consumes `${expr}`. `tokenize()` tracks `templateDepth` to correctly handle nested `}`.
**Fix (Tokens):** Added `TemplateHead`, `TemplateMiddle`, `TemplateTail`, `TemplateEnd` token types.
**Fix (Parser):** Converted to lazy lexing mode (`new Parser([], lexer)`) so `readTemplatePart()` can read from the same lexer mid-parse. `parseTemplateLiteral()` handles the full interpolation loop. **Critical bug:** Removed duplicate `parseTemplateLiteral()` at line 468 that silently overwrote the correct implementation — JavaScript class methods with identical names use the last definition.
**Fix (Interpreter):** Added `evalTemplateLiteral()` to `evalExpr` switch — joins quasis with evaluated expressions.

### 5. PermissionManager Test Failures
**File:** `tests/memory-management.test.ts`
**Problem:** Tests called `mgr.getAllRequests()` which never existed on `PermissionManager`. Also used default config (50k max) but only created 6k entries, never testing the cap.
**Fix:** Rewrote tests to use `mgr.size` and `mgr.isGranted()` with `maxEntries: 5000` config.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/html5/events.ts` | Removed `if (event.bubbles)` guard around capture phase |
| `src/browser/rendering/css5/parser.ts` | Fixed `b.b - b.b` → `b.b - a.b` in `compareSpecificity` |
| `src/browser/js/lexer.ts` | Added `lastTokenType`, `isRegexContext()`, `readRegex()`, regex context-aware `/` handling; reworked `readTemplate()` + added `readTemplatePart()` |
| `src/browser/js/tokens.ts` | Added `RegExp`, `TemplateHead`, `TemplateMiddle`, `TemplateTail`, `TemplateEnd` token types |
| `src/browser/js/parser.ts` | Lazy lexing support, `parseTemplateLiteral()` with lexer path, removed duplicate method |
| `src/browser/js/interpreter.ts` | Added `evalTemplateLiteral()` |
| `src/browser/js/index.ts` | Uses lazy lexing: `new Parser([], lexer)` |
| `tests/js-engine.test.ts` | Added regex and template literal tests; updated operators test |
| `tests/memory-management.test.ts` | Fixed PermissionManager cap tests |

## Test Results

```
Test Files:  82 passed (82)
Tests:       3456 passed (3456)
```

Key test additions:
- 5 lexer regex tests (regex/regex-after-keyword/regex-after-assignment/regex-with-character-class/division-after-expression)
- 5 parser template literal tests (simple/nested-expression/multi-interpolation/no-interpolation/adjacent-interpolation)
- 6 runJS template literal tests (simple/empty/with-expression/multi-expression/nested-templates/template-with-calls)

## Verification Steps

1. `npx vitest run tests/js-engine.test.ts` — 124 tests pass including new regex + template tests
2. `npx vitest run tests/memory-management.test.ts` — 37 tests pass (was 35 pass + 2 fail)
3. `npx vitest run` — Full suite: 82 files, 3456 tests, all pass
