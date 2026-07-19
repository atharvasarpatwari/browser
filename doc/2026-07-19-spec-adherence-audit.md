# WHATWG/W3C Spec Adherence — Audit & Roadmap

**Date:** 2026-07-19
**Status:** Completed
**Session:** Full spec compliance audit across HTML parser, CSS5, JS engine, DOM/Events/Navigation

---

## Summary

Comprehensive audit of all subsystems against WHATWG and ECMAScript specifications. Four parallel audits covered HTML5 tree builder, CSS5 engine, JavaScript interpreter, and DOM/Events/Navigation. The codebase is strongest in HTML parsing (~90%) and weakest in JS engine (~55%).

## Overall Compliance

| Subsystem | Estimated Compliance | Tests |
|-----------|---------------------|-------|
| HTML5 Tree Builder | ~90% | 883 (error recovery) + 117 (error recovery) + 46 (parser) |
| CSS5 (cascade, selectors, layout) | ~55% | 86 (css5) + 37 (flex) + 50 (grid) + 37 (positioning) + 26 (stacking) |
| JavaScript Engine | ~55% | 107 (js-engine) |
| DOM / Events / Navigation | ~65% | 20 (dom-tree) + 44 (events) + 33 (mutation-observer) + 48 (shadow-dom) + 39 (navigation) |

---

## Phase 1: Critical Fixes (6 items)

These break fundamental functionality and should be fixed first.

### 1. Capture phase skipped for non-bubbling events
- **File:** `src/browser/rendering/html5/events.ts:390`
- **Problem:** Capture phase guarded by `if (event.bubbles)`. FocusEvent and other non-bubbling events miss capture-phase listeners.
- **Fix:** Remove the `event.bubbles` guard around the capture phase walk.

### 2. CSS specificity comparison bug
- **File:** `src/browser/engine/css5/cascade.ts` (compareSpecificity function)
- **Problem:** Typo in comparison operator (`> <` vs `>`) breaking cascade ordering.
- **Fix:** Correct the comparison logic.

### 3. Regex literal lexing broken
- **File:** `src/browser/js/lexer.ts:75-77`
- **Problem:** `/` always tokenized as `Slash` (division). No context-aware regex detection.
- **Fix:** After operators/statements/keywords, `/` should be lexed as regex start.

### 4. Template literal `${expr}` interpolation not parsed
- **File:** `src/browser/js/lexer.ts:255-266`, `src/browser/js/parser.ts:399-406`
- **Problem:** Template literals emitted as flat strings. `${...}` expressions not parsed.
- **Fix:** Lexer must emit TemplateHead/TemplateMiddle/TemplateTail tokens with expression spans. Parser must create tagged template expressions.

### 5. `querySelector`/`querySelectorAll` are stubs
- **File:** `src/browser/rendering/dom-tree.ts:153-159`
- **Problem:** Always returns `null`/`[]`.
- **Fix:** Wire CSS selector engine to DOM tree traversal.

### 6. JS event propagation disconnected
- **File:** `src/browser/js/dom-bindings.ts:383-402, 561-567`
- **Problem:** `dispatchEvent` has no propagation/phases. `preventDefault`/`stopPropagation` are no-ops.
- **Fix:** Wire JS bindings to the real event system in `events.ts`.

---

## Phase 2: High-Impact Features (10 items)

### 7. Promise + microtask queue
- **Files:** `src/browser/js/interpreter.ts`, `src/browser/js/event-loop.ts`, `src/browser/js/values.ts`
- **Scope:** Promise constructor, `.then`/`.catch`/`.finally`, `Promise.all`/`race`/`resolve`/`reject`, microtask queue draining after each macrotask.

### 8. `async`/`await` keywords
- **Files:** `src/browser/js/tokens.ts`, `src/browser/js/lexer.ts`, `src/browser/js/parser.ts`, `src/browser/js/ast.ts`, `src/browser/js/interpreter.ts`
- **Scope:** Lexer tokens, parser (async function declarations/expressions, await expression), interpreter (pause/resume on Promise).

### 9. Optional chaining (`?.`) + nullish coalescing (`??`)
- **Files:** `tokens.ts`, `lexer.ts`, `parser.ts`, `interpreter.ts`
- **Scope:** `?.()` call, `?.` member, `?.[]` bracket. `??` and `??=` operators.

### 10. `classList` (DOMTokenList)
- **File:** New: `src/browser/rendering/html5/dom-token-list.ts`
- **Scope:** `add`/`remove`/`toggle`/`contains`/`replace`/`value`/`toString`. Wire to element's class attribute.

### 11. `getElementsByClassName`
- **File:** `src/browser/rendering/dom-tree.ts`
- **Scope:** Match elements whose class list contains all space-separated tokens.

### 12. `composed` flag in event dispatch
- **File:** `src/browser/rendering/html5/events.ts:376-432`
- **Scope:** When `composed: true`, event crosses shadow DOM boundaries. Wire to `computeComposedPath` in `shadow.ts`.

### 13. Standard History API (`pushState`/`replaceState`/`popstate`)
- **File:** `src/browser/navigation/navigation-controller.ts`
- **Scope:** Expose `history.pushState(state, title, url)`, `history.replaceState(...)`, `history.go(n)`, `history.state`, `history.length`. Dispatch `popstate` on back/forward.

### 14. Map/Set/WeakMap/WeakSet
- **Files:** `src/browser/js/values.ts`, `src/browser/js/index.ts`
- **Scope:** Full collection types with iterators, `entries()`/`keys()`/`values()`.

### 15. Symbol
- **Files:** `src/browser/js/values.ts`, `src/browser/js/interpreter.ts`
- **Scope:** Symbol type, well-known symbols (`Symbol.iterator`, `Symbol.toPrimitive`, `Symbol.toStringTag`).

### 16. Strict mode detection
- **File:** `src/browser/js/parser.ts`, `src/browser/js/interpreter.ts`
- **Scope:** Detect `'use strict'` directive, enforce restrictions (no `with`, no duplicate params, no octal literals, `this` = undefined in non-method calls).

---

## Phase 3: Important Completeness (9 items)

### 17. `eval()` / `Function` constructor
### 18. Modules (`import`/`export`)
### 19. Generators (`function*`/`yield`)
### 20. Date built-in
### 21. RegExp built-in (constructor + prototype)
### 22. `cancelBubble` setter
### 23. WheelEvent / PointerEvent / ClipboardEvent
### 24. `parentElement` / `ownerDocument` / `isConnected`
### 25. Named character references (expand to ~2,231)

---

## Phase 4: Polish (7 items)

### 26. `calc()` in CSS values
### 27. `:where()` / `:is()` pseudo-classes
### 28. CSS custom properties (`--var()`)
### 29. TDZ enforcement for `let`/`const`
### 30. ASI (Automatic Semicolon Insertion)
### 31. `super.x` / `super[expr]` member access
### 32. Timer clamping (4ms after 5 nested calls)

---

## Files Modified in This Session

| File | Change |
|------|--------|
| `doc/README.md` | Added this session entry |

## Test Results

No tests modified. This was a read-only audit.
