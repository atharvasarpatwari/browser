# JavaScript Engine

**Date:** 2026-07-18
**Session:** Complete TypeScript-based JS interpreter — lexer, Pratt parser, tree-walking interpreter, DOM API bindings, event loop
**Status:** Completed — 107 tests passing

---

## Summary

Implemented a TypeScript-based JavaScript interpreter covering ES2015+ core language features. Architecture: Lexer → Pratt Parser → AST → Tree-walking Interpreter with DOM API bindings and a basic event loop.

## Architecture

```
Source code → Lexer (tokens.ts) → Parser (parser.ts) → AST
  → Interpreter (interpreter.ts) → JSValue results
  + DOM bindings (dom-bindings.ts) → wraps DOM as JS objects
  + Event loop (event-loop.ts) → setTimeout/setInterval/processMicrotask
```

## Lexer (`js/tokens.ts`)

- All JavaScript keywords and operators
- Template literals with expressions
- Numeric literals (integers, floats, hex, binary, octal, BigInt)
- String literals (single, double, template)
- Regex literals (with flags)
- Comments (single-line, multi-line)
- Source positions (line, column, offset)

## Pratt Parser (`js/parser.ts`)

- Full expression parsing with precedence climbing
- Unary prefix/postfix operators
- Binary operators (arithmetic, comparison, logical, bitwise, nullish coalescing)
- Ternary conditional operator
- Comma expressions
- Assignment operators (=, +=, -=, etc.)
- Destructuring patterns (array, object, rest, defaults)
- Arrow functions (expression body, block body)
- Template literals with expressions
- `new` expressions with correct precedence
- `super` property access and calls
- `yield` / `yield*` (generator syntax parsed)
- Class declarations with constructor, methods, static, extends
- `for...of` and `for...in` loops
- Labeled statements, `break`, `continue`
- `try/catch/finally` with `throw`
- `import` / `export` (parsed as AST nodes)
- `typeof`, `void`, `delete` unary operators
- `in` operator

## AST Nodes

40+ node types including:
- Expressions: Identifier, Literal, BinaryExpression, UnaryExpression, CallExpression, MemberExpression, ArrowFunctionExpression, ClassExpression, TemplateLiteral, etc.
- Statements: Block, If, While, For, ForIn, ForOf, Return, Throw, Try, Switch, etc.
- Declarations: VariableDeclaration, FunctionDeclaration, ClassDeclaration, ImportDeclaration

## Tree-Walking Interpreter (`js/interpreter.ts`)

### Variables & Scope
- `var` / `let` / `const` with proper scoping
- Global environment with prototype chain
- Lexical scoping (Environment chain)
- `undefined` initialization for `let`/`const`
- TDZ (Temporal Dead Zone) for `let`/`const`

### Functions
- Function declarations (hoisted)
- Function expressions
- Arrow functions (lexical `this`)
- Default parameters
- Rest parameters
- Closures (environment capture)
- `arguments` object (per non-arrow function)

### Classes
- Constructor methods
- Instance methods on prototype
- Static methods
- `extends` / `super()` calls
- `super.method()` calls
- Derived class default constructor
- Class expressions

### Iterators & Generators
- `Symbol.iterator` protocol
- `for...of` loops
- `yield` / `yield*`
- Generator function execution (lazy evaluation)
- Spread in calls: `fn(...args)`
- Spread in arrays: `[...arr]`

### Async (parsed)
- `async` / `await` (parsed, awaiting event loop integration)

### Operators
- All arithmetic, comparison, logical, bitwise operators
- `in`, `instanceof`
- Nullish coalescing (`??`)
- Optional chaining (`?.`)
- Typeof operator
- Destructuring assignment

## DOM Bindings (`js/dom-bindings.ts`)

```typescript
createDocumentBinding(doc: DomDocument, domTree: DomTree): JSValue
```

### Document Object
- `createElement(tagName)` → wrapped DomElement
- `createTextNode(text)` → wrapped DomTextNode
- `getElementById(id)` → wrapped DomElement or null
- `getElementsByTagName(tagName)` → array of wrapped elements
- `querySelector(selector)` / `querySelectorAll(selector)`

### Element Object
- `tagName`, `id`, `className` (getter/setter)
- `getAttribute(name)`, `setAttribute(name, value)`
- `appendChild(child)`, `removeChild(child)`
- `insertBefore(newNode, referenceNode)`
- `children`, `childNodes`, `firstChild`, `lastChild`
- `textContent` (getter/setter)
- `addEventListener(type, listener)`, `removeEventListener(type, listener)`
- `dispatchEvent(event)`
- `style` object with CSS property access
- `getBoundingClientRect()` → { x, y, width, height }
- `src`, `naturalWidth`, `naturalHeight`, `loading` (images)

### Window Object
- Created in global environment as plain JSObject
- Scripts can access `window.__count` etc.

## Event Loop (`js/event-loop.ts`)

```typescript
class EventLoop {
  setTimeout(callback, delay): number
  setInterval(callback, delay): number
  clearTimeout(id): void
  clearInterval(id): void
  processMicrotask(task): void
  tick(): void  // process one macrotask + all microtasks
}
```

- Microtask queue (Promise callbacks — future)
- Macrotask queue (setTimeout/setInterval)
- `tick()` processes one macrotask then drains microtasks

## `runJS` Entry Point (`js/index.ts`)

```typescript
function runJS(source: string, options: RunJSOptions): JSRunResult
```

- Creates global environment with DOM bindings
- Lexes, parses, and evaluates source
- Returns `{ value, error? }` — errors don't throw, checked via result
- Optional shared `globalEnv` for cross-script state

## Test Results

```
js-engine.test.ts: 107 tests ✓
  - Variable declaration (var/let/const)
  - Scoping (block, function, global)
  - All operators (arithmetic, comparison, logical, bitwise)
  - Functions (declarations, expressions, arrows, closures, default params)
  - Classes (constructor, methods, extends, super, static)
  - Iterators (for...of, spread, destructuring)
  - Generators (yield, yield*, next())
  - DOM manipulation (createElement, appendChild, getElementById)
  - DOM events (addEventListener, dispatchEvent)
  - Template literals
  - try/catch/finally
  - Switch statements
  - Optional chaining, nullish coalescing
  - Binary and unary operators
  - typeof, void, delete
```
