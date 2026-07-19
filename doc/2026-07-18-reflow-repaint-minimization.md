# Reflow & Repaint Minimization

**Date:** 2026-07-18
**Session:** Damage region tracking, coalesced frame scheduling, dirty flag infrastructure
**Status:** Completed — 22 tests passing

---

## Summary

Implemented infrastructure to minimize layout and paint work by tracking damage regions and coalescing frame updates. DOM nodes carry dirty flags (`_dirtyLayout`, `_dirtyPaint`) for incremental layout and partial repaint.

## Key Implementations

### Damage Tracker (`damage-tracker.ts`)

Tracks rectangular regions that need repainting:

```typescript
class DamageTracker {
  addRegion(x, y, width, height): void
  getDirtyRegions(): DamageRegion[]
  compact(): void  // merge overlapping regions
  clear(): void
}
```

### Frame Scheduler (`frame-scheduler.ts`)

Coalesces multiple update requests into a single animation frame:

```typescript
class FrameScheduler {
  schedule(callback: () => void): void
  cancel(): void
}
```

Multiple `schedule()` calls produce a single callback — prevents redundant layout/paint per frame.

### Dirty Flags on DomNode

```typescript
interface DomNode {
  _dirtyLayout: boolean;  // needs re-layout
  _dirtyPaint: boolean;   // needs repaint
}
```

- All nodes initialized as dirty (`true`)
- `layoutNode` clears `_dirtyLayout` after computing layout
- `paint()` clears `_dirtyPaint` after rendering

### Incremental Layout

```typescript
function layoutIncremental(root: DomNode, viewport: ViewportSize): void
```

Only re-lays-out subtrees where `_dirtyLayout === true`. After layout completes, dirty flag is cleared recursively for the subtree.

### Incremental Paint

```typescript
function paintIncremental(root: DomNode, damageRegions: DamageRegion[]): void
```

Only repaints regions that intersect with the damage regions. After paint, `_dirtyPaint` is cleared.

### Mutation Integration

When the DOM mutates (via JS engine or parser), dirty flags propagate up the tree:

```typescript
function processMutations(mutations: Mutation[]): void
// For each mutation: markDirty(node, 'layout') or markDirty(node, 'paint')
```

## Files Created

| File | Purpose |
|------|---------|
| `damage-tracker.ts` | DamageTracker — region tracking |
| `frame-scheduler.ts` | FrameScheduler — coalesced frame callbacks |

## Files Modified

| File | Change |
|------|--------|
| `dom-tree.ts` | `_dirtyLayout`, `_dirtyPaint` flags on DomNode |
| `layout-engine.ts` | `layoutIncremental()` — incremental layout |
| `paint-engine.ts` | `paintIncremental()` — partial repaint, `clearAllPaintDirty()` |

## Test Results

```
reflow-repaint.test.ts: 22 tests ✓
  - DamageTracker region tracking and compaction
  - FrameScheduler coalescing
  - Dirty flag propagation from mutations
  - Incremental layout (only dirty subtrees)
  - Incremental paint (only damage regions)
  - Full repaint clears all dirty flags
```
