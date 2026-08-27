# Rendering Pipeline Session 5 — stacking-context.ts

**Date:** 2026-08-25
**Session:** Implemented Session 5 of 9 of the rendering pipeline (stacking contexts) in `src/browser/rendering/pipeline/`
**Status:** Completed

---

## Summary
Added `stacking-context.ts`: takes a laid-out LayoutBox tree plus the flat painter's-algorithm display list from paint-record.ts (session 4) and re-orders it into CSS 2.2 Appendix E stacking order. Commands are regrouped/resequenced only — never rebuilt. 22-test suite; tsc 0 errors; full suite 201 files / 9027 tests.

## API
| Export | Purpose |
|--------|---------|
| `createsStackingContext(style, isRoot?)` | Root, positioned+z-index≠auto, opacity<1, transform≠none, isolation:isolate, will-change transform/opacity |
| `StackingNode` / `StackItem` | Context tree; items are commands or child-context refs in document order |
| `buildStackingTree(root, commands)` | Classifies boxes (3 passes: classify+doc-index → command bucketing → item fill with document-order sort) |
| `flattenStackingOrder(node)` | Appendix E: own bg/border → negative-z children (z asc) → document-order items incl. z=0/auto contexts → positive-z children |
| `countContexts(node)` / `maxContextDepth(node)` | Diagnostics |

## Root Causes (bugs found during TDD)
### 1. z=0/auto child contexts were silently dropped
**Problem:** Child context nodes were registered in `node.children` but never inserted as `{kind:"context"}` items, so flattening (which walks items for the middle band) skipped them entirely — opacity<1 static boxes vanished from output.
**Fix:** Insert a context item per child node during the fill pass; step-3 flattening skips banded (z<0/z>0) context items to avoid double emission.

### 2. Items lost document-order interleaving
**Problem:** Context items were pushed during classification DFS while commands were appended afterwards, so all contexts sorted before all flow content.
**Fix:** Assign a pre-order `docIndex` to every box during classification; after filling each node's items, stable-sort by `docIndex` of the item's source/context box.

### 3. TextRun boxes spuriously formed stacking contexts
**Problem:** Render-tree shares the parent's style object with text nodes (debug showed a TextRun carrying its parent's `opacity: 0.4`), so `createsStackingContext` fired on every text run under a fading parent, creating phantom contexts.
**Fix:** `BoxType.TextRun` and `BoxType.Anonymous` boxes are never treated as context-formers during classification (per CSS they are not elements).

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/rendering/pipeline/stacking-context.ts` | Session 5 module: stacking-context formation rules, stack tree builder, Appendix E flattener, diagnostics |
| `tests/stacking-context.test.ts` | 22 tests: 11 formation-rule unit tests, single-context identity/no-mutation checks, Appendix E ordering (negative-z placement, positive-z deferral, ascending sort, stable ties, nested-group integrity, opacity promotion, z=0 interleaving), 2 full cross-file audits (sessions 1–5) |
| `doc/2026-08-25-pipeline-session5-stacking-context.md` | This change log |

## Test Results
```
npx vitest run tests/stacking-context.test.ts
  Test Files  1 passed (1)
       Tests  22 passed (22)

npx tsc --noEmit          → no output (0 errors)

npx vitest run            (full suite)
  Test Files  201 passed (201)
       Tests  9027 passed (9027)
```

## Verification Steps Taken
1. Checked for regenerated `new/` staging folder first — absent, wrote fresh.
2. TDD: initial run exposed 4 failures → root causes 1–3 above diagnosed via temporary debug test (deleted afterward).
3. Targeted suite 22/22; `tsc --noEmit` clean; full suite 201/201 files, 9027/9027 tests.
4. Confirmed flattening reuses command objects (`toBe` identity check) and does not mutate the input list.

## Architecture Notes
- Output type is unchanged from session 4 (`PaintCommand[]`) — session 6 (compositor) can consume either the flat ordered list or the `StackingNode` tree directly.
- Negative-z groups paint *after* the owning context's own background/borders but before that context's remaining content, matching Appendix E steps 1–4.
- Nested subtrees keep group integrity: a positive-z descendant inside a negative-z ancestor stays inside the ancestor's band (verified by dedicated test).
