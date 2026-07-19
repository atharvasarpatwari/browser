# HTML5 Tree Builder — Modular Architecture Rewrite

**Date:** 2026-07-18 (early session)
**Session:** Complete rewrite of the HTML5 tree builder with modular architecture
**Status:** Completed — all existing tests pass

---

## Summary

Rewrote the monolithic HTML5 tree builder into a modular architecture with 9 core modules, 12 insertion mode files, and a tree builder orchestrator. All 23 WHATWG §13.2.6 insertion modes are implemented in separate files. Backward compatible with all existing tests.

## Architecture

```
html5/
├── dom.ts              — DomDocument, DomElement, HtmlNode, HtmlParseResult, DiscoveredResource types
├── constants.ts        — Tag sets, attribute sets, namespace URIs, insertion mode enum
├── encoding.ts         — Character encoding detection (UTF-8, UTF-16, etc.)
├── events.ts           — Event system (EventTarget, Event, CustomEvent)
├── mutation-observer.ts — MutationObserver API
├── shadow.ts           — Shadow DOM (ShadowRoot, attachShadow, mode: open/closed)
├── tree-builder.ts     — Main orchestrator: token dispatch, open elements stack, formatting elements
├── modes/
│   ├── types.ts        — TreeBuilderContext interface
│   ├── initial.ts      — §13.2.6.1
│   ├── before-html.ts  — §13.2.6.2
│   ├── before-head.ts  — §13.2.6.3
│   ├── in-head.ts      — §13.2.6.4
│   ├── in-head-noscript.ts — §13.2.6.5
│   ├── after-head.ts   — §13.2.6.6
│   ├── in-body.ts      — §13.2.6.7
│   ├── text.ts         — §13.2.6.8
│   ├── in-table.ts     — §13.2.6.9
│   ├── in-table-text.ts — §13.2.6.10
│   ├── in-caption.ts   — §13.2.6.11
│   ├── in-column-group.ts — §13.2.6.12
│   ├── in-table-body.ts — §13.2.6.13
│   ├── in-row.ts       — §13.2.6.14
│   ├── in-cell.ts      — §13.2.6.15
│   ├── in-select.ts    — §13.2.6.16
│   ├── in-select-in-table.ts — §13.2.6.17
│   ├── in-template.ts  — §13.2.6.18
│   ├── after-body.ts   — §13.2.6.19
│   ├── in-frameset.ts  — §13.2.6.20
│   ├── after-frameset.ts — §13.2.6.21
│   ├── after-after.ts  — §13.2.6.22
│   └── foreign-content.ts — §13.2.6.23 (SVG/MathML namespaces)
└── index.ts            — Re-exports
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `const enum` → `enum` | Regular `enum` in tokens.ts | vitest/esbuild incompatibility with `const enum` |
| One mode per file | Separate `.ts` files | Circular dependency avoidance; each mode is ~50-200 lines |
| TreeBuilderContext | Interface passed to modes | Avoids circular imports; modes access shared state via context |
| Namespace support | URI constants in constants.ts | SVG/MathML foreign content handling per §13.2.6.23 |
| Resource discovery | `discoverResources()` on tree builder | Captures `<link>`, `<script>`, `<img>`, `<video>` resources during parsing |

## Files Created

| File | Purpose | LOC |
|------|---------|-----|
| `html5/dom.ts` | All DOM node types, interfaces | ~200 |
| `html5/constants.ts` | Tag/attribute sets, insertion modes | ~150 |
| `html5/encoding.ts` | Character encoding detection | ~100 |
| `html5/events.ts` | EventTarget/Event/CustomEvent | ~120 |
| `html5/mutation-observer.ts` | MutationObserver API | ~100 |
| `html5/shadow.ts` | Shadow DOM | ~150 |
| `html5/tree-builder.ts` | Main orchestrator | ~400 |
| `html5/modes/*.ts` (12 files) | Individual insertion modes | ~50-200 each |

## Test Results

All existing HTML5 parser tests continue to pass. 117 error recovery tests, 89 node type tests, 48 shadow DOM tests, 44 event tests, 33 mutation observer tests, 106 encoding tests — all passing.
