# DOMTokenList Implementation

**Date:** 2026-07-26
**Session:** DOMTokenList API — WHATWG DOM spec § 7.1
**Status:** Completed

---

## Summary

Implemented the `DOMTokenList` API for managing CSS class tokens on elements, conforming to the WHATWG DOM specification.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/rendering/html5/dom-token-list.ts` | DOMTokenList class — wraps a JSObject + DomElement reference, manages class tokens |

## Files Modified

| File | Change |
|------|--------|
| `doc/README.md` | Indexed new change log entry |

## Design

### Architecture

- `DOMTokenList` is a TypeScript class that holds a reference to a `DomElement` and an `IDomTree` (for `setAttribute`/`getAttribute`)
- Constructor parses the element's `class` attribute into an internal `_tokens: string[]`
- All mutations call `_flush()` which writes tokens back via `domTree.setAttribute(el, 'class', ...)`
- Re-reads from the DOM before each read operation (`_parseTokens()`) to stay in sync with external changes

### Methods Implemented

| Method | Behavior |
|--------|----------|
| `add(...tokens)` | Adds tokens, throws SyntaxError for empty/whitespace tokens, deduplicates |
| `remove(...tokens)` | Removes tokens, silently skips invalid tokens |
| `toggle(token, force?)` | Toggle/add/remove based on force arg, returns boolean |
| `contains(token)` | Returns boolean |
| `replace(oldToken, newToken)` | Replaces old with new, returns boolean |
| `item(index)` | Returns token at index or null |
| `toString()` | Returns space-joined tokens |
| `value` (getter/setter) | Syncs with element's class attribute |
| `length` (getter) | Returns token count |
| `getTokenByIndex(i)` / `setTokenByIndex(i, v)` | Numeric bracket-index access |
| `[Symbol.iterator]` | Returns iterator object for for-of support |

### Validation

- `validateToken()` throws `SyntaxError` for empty tokens or tokens containing ASCII whitespace (per WHATWG spec)

## Test Results

TypeScript compilation: 0 errors from the new file (pre-existing project errors only).
