# CSS5 Full Rewrite

**Date:** 2026-07-18
**Session:** Complete CSS5 engine rewrite — spec-compliant tokenizer, parser, selector engine, cascade engine
**Status:** Completed — 1741+ tests passing, fully wired into rendering pipeline

---

## Summary

Complete rewrite of the CSS engine in the `css5/` directory with a spec-compliant tokenizer, recursive-descent parser, selector engine (class, ID, attribute, pseudo-class, pseudo-element, combinators), cascade engine with specificity, shorthand expansion, and @rules support.

## Architecture

```
css5/
├── types.ts       — CssStylesheet, CssRule, CssStyleRule, CssAtRule, Selector types
├── tokenizer.ts   — CSS tokenizer (strings, URLs, comments, functions, dimensions)
├── parser.ts      — Recursive descent parser (selectors, declarations, @rules)
├── selector.ts    — Selector matching engine ( specificity calculation)
├── cascade.ts     — Cascade engine (specificity, source order, !important)
├── index.ts       — Re-exports
```

## Key Components

### 1. CSS Tokenizer (`css5/tokenizer.ts`)

Tokenizes CSS source into tokens:
- Identifiers, strings, numbers, dimensions (e.g., `12px`), percentages
- Hash tokens (`#id`), at-rules (`@media`), function tokens (`rgb(`)
- Comments (removed from token stream)
- Delimiters (`{`, `}`, `;`, `:`, `,`)

### 2. CSS Parser (`css5/parser.ts`)

Recursive descent parser producing `CssStylesheet`:
- Rule sets: `selector { prop: value; }`
- Declarations with value parsing (shorthand + longhand)
- @media rules (nested)
- @import, @font-face, @keyframes
- Error recovery (skip to next `}` on parse error)

### 3. Selector Engine (`css5/selector.ts`)

Spec-compliant selector matching:
- Type selectors (`div`), class (`.foo`), ID (`#bar`)
- Attribute selectors (`[href]`, `[href="..."]`, `[href~="..."]`)
- Pseudo-classes (`:hover`, `:first-child`, `:not()`, `:is()`, `:has()`)
- Pseudo-elements (`::before`, `::after`, `::first-line`)
- Combinators: descendant (` `), child (`>`), sibling (`~`, `+`)
- Specificity calculation per CSS Cascading spec

### 4. Cascade Engine (`css5/cascade.ts`)

Implements CSS cascade sorting:
- Specificity-based ordering (inline > ID > class > type)
- Source order tiebreaking
- `!important` declaration handling
- Shorthand expansion (`margin`, `padding`, `border`, `background`, `font`, `flex`)
- `computeComputedStyles()` function for final style resolution

## Files Modified

| File | Change |
|------|--------|
| `css5/types.ts` | Complete type definitions for CSS5 |
| `css5/tokenizer.ts` | Full CSS tokenizer implementation |
| `css5/parser.ts` | Recursive descent parser |
| `css5/selector.ts` | Selector matching + specificity |
| `css5/cascade.ts` | Cascade sorting + shorthand expansion |

## Integration

The CSS5 engine is wired into the rendering pipeline via:
- `CssParser.getCss5Parser()` returns the CSS5 parser instance
- `computeComputedStyles()` is called from `main.ts` after HTML parsing
- Legacy `CssRule[]` from old parser is converted to `CssStylesheet` via `buildCss5Stylesheet()`

## Test Results

```
css5.test.ts:  86 tests ✓ (tokenizer, parser, selector, cascade, shorthand, @rules)
              +1655 tests from related CSS test files
              ──────
              1741+ total CSS tests
```
