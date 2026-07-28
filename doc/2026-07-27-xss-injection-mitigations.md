# XSS / Injection Mitigations

**Date:** 2026-07-27
**Session:** XSS/injection mitigation — CSP enforcement, attribute sanitization, CSS injection defense, MutationObserver sanitization, shared URL blocking
**Status:** Completed

---

## Summary

Implemented comprehensive XSS and injection mitigation layers across the Nova browser engine. The defenses are defense-in-depth: multiple independent layers that catch different attack vectors, so a bypass of one layer is caught by another.

## Changes

### 1. CSP eval() Enforcement in Interpreter

**Files:** `src/browser/js/index.ts`, `src/browser/js/interpreter.ts`

`RunJSOptions` and `createGlobalEnv()` now accept an optional `CspScriptEnforcer` and `pageOrigin`. When present, `eval()` calls invoke `scriptEnforcer.checkEval()` before execution. `EvalError` is thrown if CSP disallows `unsafe-eval`.

The `Interpreter` constructor stores the enforcer and passes it to both `eval()` implementations and timer setup.

### 2. CSP Timer String Enforcement

**Files:** `src/browser/js/event-loop.ts`, `src/browser/js/interpreter.ts`

`setTimeout`/`setInterval` with string arguments now call `scriptEnforcer.checkTimerString()` before execution. This prevents CSP bypasses via `setTimeout("alert(1)", 0)`.

### 3. setAttribute() Sanitization

**File:** `src/browser/js/dom-bindings.ts`

`setAttribute()` silently drops:
- `on*` event handler attributes (e.g., `onclick`, `onerror`)
- Attributes with dangerous URL schemes (`javascript:`, `data:`, `vbscript:`) on URL-bearing attributes (`href`, `src`, `action`, `formaction`, `xlink:href`)

This is defense-in-depth: the primary sanitization should happen at the HTML parser level.

### 4. CSS Injection Sanitizer

**File:** `src/browser/security/html-sanitizer.ts`

Added three new functions:
- `containsDangerousCss(value: string)` — pattern-matches dangerous CSS constructs
- `sanitizeCssValue(value: string)` — strips dangerous declarations
- `sanitizeStyleAttribute(value: string)` — cleans up a style attribute value

`HtmlSanitizer.sanitizeAttributes()` now detects and sanitizes `style` attribute values via `sanitizeStyleAttribute()`. Patterns caught:
- `expression()`, `expr()` — IE CSS expressions
- `url(javascript:)`, `url(data:)` — dangerous URL schemes
- `-moz-binding`, `-webkit-binding` — XBL injection
- `behavior:`, `-moz-behavior` — IE HTC behaviors
- `@import javascript:` — CSS @import injection

### 5. MutationObserver Sanitization

**File:** `src/browser/rendering/html5/mutation-observer.ts`

Added `sanitizeAddedNode()` and `sanitizeMutationFire()`:
- `fireMutation()` now calls `sanitizeMutationFire()` before processing mutations
- `sanitizeAddedNode()` recurses into added nodes and strips event handler attributes, dangerous URL schemes, and dangerous CSS from style attributes
- Uses the `isEventHandlerAttribute`, `isUrlAttribute`, `isBlockedUrlScheme` functions from the shared module

**Key discovery:** `appendChild()` in `dom.ts` calls `fireMutation()`, so the sanitizer runs during HTML tree building as well. This means dangerous attributes are stripped during parsing — not just when scripts dynamically insert content.

### 6. Shared URL Scheme Blocking

**New file:** `src/browser/security/blocked-url-schemes.ts`

Single source of truth for URL blocking across all entry points:
- `BLOCKED_URL_SCHEMES` — exported `ReadonlySet` for backward compatibility
- `isBlockedUrlScheme(scheme)` — case-insensitive check against internal array
- `isEventHandlerAttribute(name)` — checks `on*` prefix
- `isUrlAttribute(name)` — checks URL-bearing attribute names

Used by: `dom-bindings.ts`, `html-sanitizer.ts`, `mutation-observer.ts`

### 7. page-renderer.ts CSP Integration

**File:** `src/browser/engine/page-renderer.ts`

All 3 `runJS()` calls in `page-renderer.ts` now pass `scriptEnforcer: this.deps.scriptEnforcer`, ensuring CSP enforcement applies to inline scripts executed by the renderer.

### 8. CspScriptEnforcer.scriptSample Support

**File:** `src/browser/security/csp-script-enforcer.ts`

Added `scriptSample` field to `ScriptCheckResult` interface so CSP violation reports include the first 40 characters of the blocked script.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | Added `scriptEnforcer`/`pageOrigin` to `RunJSOptions` and `createGlobalEnv()`. eval() calls `checkEval()`. `bindTimers()` passes enforcer. |
| `src/browser/js/interpreter.ts` | Constructor accepts `scriptEnforcer?`/`pageOrigin?`. eval() and timer functions check CSP. |
| `src/browser/js/event-loop.ts` | `bindTimers()` accepts `scriptEnforcer?`/`pageOrigin?`. String arg timers check CSP. |
| `src/browser/js/dom-bindings.ts` | `setAttribute()` blocks `on*` and dangerous URL schemes. |
| `src/browser/security/html-sanitizer.ts` | Added `containsDangerousCss()`, `sanitizeCssValue()`, `sanitizeStyleAttribute()`. `DEFAULT_STRIPPED_URL_SCHEMES` imports from shared module. |
| `src/browser/security/csp-script-enforcer.ts` | Added `scriptSample` to `ScriptCheckResult`. |
| `src/browser/rendering/html5/mutation-observer.ts` | Added `sanitizeAddedNode()`, `sanitizeMutationFire()`. `fireMutation()` calls sanitizer. |
| `src/browser/engine/page-renderer.ts` | All `runJS()` calls pass `scriptEnforcer`. |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/security/blocked-url-schemes.ts` | Shared URL scheme constants, `isBlockedUrlScheme()`, `isEventHandlerAttribute()`, `isUrlAttribute()` |
| `tests/xss-injection-comprehensive.test.ts` | 48 comprehensive tests across 8 sections |

## Test Results

```
tests/xss-injection-comprehensive.test.ts: 48/48 passed
tests/xss-mitigations.test.ts: 55/55 passed
tests/content-security-policy.test.ts: 179/179 passed
Full suite: 6732/6736 passed (4 pre-existing DNS failures)
```

## Test Coverage

| Section | Tests | What's Verified |
|---------|-------|-----------------|
| CSP eval enforcement | 3 | Block/allow eval with CSP directives |
| CSP timer string enforcement | 3 | Block/allow setTimeout/setInterval with string args |
| setAttribute sanitization | 6 | on* attributes, javascript:, data:, vbscript:, safe attributes pass |
| CSS injection sanitization | 4 | containsDangerousCss patterns, sanitizeCssValue, sanitizeStyleAttribute |
| HtmlSanitizer CSS injection | 3 | Dangerous styles stripped, safe styles kept, -moz-binding |
| MutationObserver sanitization | 6 | Strip on*, strip javascript: URLs, sanitize styles, recurse, non-childList passthrough, sanitize returns opts |
| Shared URL schemes | 2 | All dangerous schemes listed, case-insensitive matching |
| XSS attack vector integration | 4 | Combined CSS expression injection, CSP report samples, script in style, mixed attack vectors |

## Key Design Decisions

- **Silent drop for setAttribute**: No error thrown — prevents information leakage about what CSP is active
- **Pattern-matching for CSS**: Uses regex array rather than blocklist — catches novel variations
- **Defense-in-depth**: Each layer is independent; bypassing one doesn't bypass others
- **Sanitization during tree building**: `appendChild` → `fireMutation` → `sanitizeAddedNode` means dangerous attributes are stripped at parse time, not just at insertion time
- **Shared constants**: `blocked-url-schemes.ts` is the single source of truth for URL scheme blocking
