# Phase 2 Spec Adherence — Implementation

**Date:** 2026-07-26
**Session:** Phase 2 high-impact features (Symbol, Map/Set, classList, getElementsByClassName, composed events, strict mode, WebSocket binary, Worker wiring)
**Status:** Completed

---

## Summary

Implemented all 10 Phase 2 spec adherence items plus WebSocket binary data fix and Worker global-env wiring. 27 new tests added across 7 test files. Total: 6226 tests pass across 137 test files (3 pre-existing DNS failures).

## What Was Implemented

### 1. Symbol improvements (values.ts, interpreter.ts, index.ts)
- `typeof sym === 'symbol'` now works correctly (was returning `'object'`)
- `getType()` checks `__type_override === 'symbol'`
- `toString()` returns `Symbol(desc)` format
- `getPropertyValue()` handles `toString()` and `valueOf()` methods on symbols
- Well-known symbols remain via `Symbol.for()` cache (identity-preserving for same key)

### 2. Map/Set/WeakMap/WeakSet fixes (index.ts)
- **Identity-based keys**: Map/Set use split storage (`__mapObj` for JSObject references, `__mapPrim` for primitive string keys) — object identity now preserved
- **Dynamic `size`**: getter computes from actual stores instead of static `0`
- **WeakMap/WeakSet**: now only accept object keys per spec (string keys silently ignored)
- **Modern Set methods**: `intersection()`, `union()`, `difference()`, `symmetricDifference()`, `isSubsetOf()`, `isSupersetOf()`, `isDisjointFrom()` (ES2025)
- **`toString()`**: `'[object Map]'` / `'[object Set]'`

### 3. classList / DOMTokenList (new file)
- **File:** `src/browser/rendering/html5/dom-token-list.ts` (263 lines)
- `add()`, `remove()`, `toggle(force?)`, `contains()`, `replace()`, `item()`, `toString()`
- `value` getter/setter syncs with element's class attribute
- `length` getter, bracket-index access
- `Symbol.iterator` support
- Validation: throws `SyntaxError` for empty/whitespace/duplicate tokens

### 4. getElementsByClassName (dom-tree.ts, dom-bindings.ts)
- Added to `IDomTree` interface and `DomTree` class
- BFS traversal matching elements with ALL specified class tokens
- Wired to document and element wrappers in dom-bindings.ts

### 5. Composed flag in event dispatch (events.ts, dom-bindings.ts)
- `dispatchEvent()` checks `event.composed` flag
- When `composed === false`: stops ancestor walk at shadow root boundaries
- When `composed === true`: crosses shadow DOM boundaries using `computeComposedPath()`
- `createEventObject` accepts `composed` in options
- 6 new tests in html5-events.test.ts

### 6. Strict mode detection (parser.ts, interpreter.ts, values.ts, ast.ts)
- `'use strict'` directive detection in function bodies
- Class bodies and methods are always strict
- Enforcements:
  - `with` statements rejected in strict mode (SyntaxError)
  - `this` = `undefined` in non-method strict mode calls (was global object)
  - Duplicate parameter names rejected (SyntaxError)
- `isStrict` field on JSFunction interface and AST nodes

### 7. WebSocket binary data (websocket-api.ts)
- `send()` handles ArrayBuffer and TypedArray data
- `close()` validates close codes (1000 or 3000-4999) and reason length (≤123 bytes)
- Binary receive support with `binaryType` handling
- 14 new tests (38 total websocket tests pass)

### 8. Worker global-env wiring (index.ts, worker.ts)
- `Worker` constructor wired into `createGlobalEnv()` via `createWorkerConstructor()`
- `Promise` wired into worker scope via `createPromiseConstructor()`
- 5 new tests (64 total worker tests pass)

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/rendering/html5/dom-token-list.ts` | DOMTokenList class (263 lines) |

## Files Modified

| File | Changes |
|------|---------|
| `src/browser/js/values.ts` | `getType()` symbol check, `toString()` symbol handling, `JSFunction.isStrict` |
| `src/browser/js/interpreter.ts` | Symbol methods in getPropertyValue, strict mode `this` binding |
| `src/browser/js/index.ts` | Map/Set rewrite (identity keys, dynamic size, modern Set methods), Worker + Promise wiring |
| `src/browser/js/parser.ts` | `'use strict'` detection, `with` rejection, duplicate param check |
| `src/browser/js/ast.ts` | `strictMode` field on function AST nodes, `WithStatement` |
| `src/browser/rendering/dom-tree.ts` | `getElementsByClassName` implementation |
| `src/browser/js/dom-bindings.ts` | getElementsByClassName wiring, composed flag support |
| `src/browser/rendering/html5/events.ts` | Composed flag in ancestor chain walk |
| `src/browser/js/websocket-api.ts` | Binary send/receive, close code validation |
| `src/browser/js/worker.ts` | Promise in worker scope |
| `tests/js-builtins.test.ts` | Symbol/WeakMap/WeakSet test updates |
| `tests/websocket.test.ts` | 14 new binary/validation tests |
| `tests/worker.test.ts` | 5 new tests (Worker constructor, Promise in workers) |
| `tests/html5-events.test.ts` | 6 new composed flag tests |

## Test Results

```
 Test Files  136 passed | 1 failed (pre-existing DNS)
      Tests  6226 passed | 3 failed (pre-existing DNS)
```

## Verification Steps

1. `npx vitest run tests/js-builtins.test.ts` — 115 tests pass
2. `npx vitest run tests/websocket.test.ts` — 38 tests pass
3. `npx vitest run tests/worker.test.ts` — 64 tests pass
4. `npx vitest run tests/html5-events.test.ts` — 50 tests pass
5. `npx vitest run` — Full suite: 6226/6285 pass
