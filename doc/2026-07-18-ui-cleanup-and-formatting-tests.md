# UI Listener Cleanup & Formatting Context Tests

**Date:** 2026-07-18
**Session:** UI disposal audit + formatting context test coverage
**Status:** Completed

---

## Summary

Audited all 12 UI view/controller classes for listener leaks. Found and fixed a leak in `tab-strip.ts` where 5 `ITabManager` event subscriptions were never unsubscribed on dispose. Added 67 new tests for formatting context modules covering margin collapsing, anonymous block generation, inline formatting context, vertical alignment, box model resolution, and float context.

## Root Causes

### 1. TabStrip manager listener leak

**File:** `src/ui/components/tab-strip/tab-strip.ts`
**Problem:** `wireManagerEvents()` registered 5 anonymous arrow functions via `manager.on(...)` but `dispose()` only called `this.bus.dispose()`. Since handlers were anonymous, they couldn't be removed after the fact — leaking subscriptions to the TabManager's event bus.
**Fix:** Store handler references in a `_managerUnsubs` array; in `dispose()`, iterate and call `manager.off(...)` for each.

```typescript
// Before
private wireManagerEvents(): void {
  this.manager.on('tabCreated', () => { this.syncWithManager(); });
  // ... 4 more anonymous handlers
}
dispose(): void { this.bus.dispose(); }

// After
private readonly _managerUnsubs: Array<() => void> = [];
private wireManagerEvents(): void {
  const onCreated = () => { this.syncWithManager(); };
  this.manager.on('tabCreated', onCreated);
  // ... store refs
  this._managerUnsubs.push(() => this.manager.off('tabCreated', onCreated));
}
dispose(): void {
  for (const unsub of this._managerUnsubs) unsub();
  this._managerUnsubs.length = 0;
  this.bus.dispose();
}
```

## Files Modified

| File | Change |
|------|--------|
| `src/ui/components/tab-strip/tab-strip.ts` | Store manager listener refs in `_managerUnsubs`, unsubscribe in `dispose()` |

## Files Created

| File | Purpose |
|------|--------|
| `tests/formatting-contexts.test.ts` | 67 tests for formatting context modules |

## Test Results

```
66 test files, 2498 tests — all passing
New test file: tests/formatting-contexts.test.ts — 67 tests
  classifyDisplay: 8 tests
  isBlockLevel: 2 tests
  classifyChildren (anonymous blocks): 9 tests
  collapseMargins: 6 tests
  isMarginCollapseBlocked: 6 tests
  InlineFormattingContext: 5 tests
  resolveVerticalAlign: 13 tests
  resolveBoxModel: 7 tests
  FloatContext: 11 tests
```

## Verification

- All 12 UI files audited: only `tab-strip.ts` had leaks
- All other UI views clean up via `innerHTML = ''` (DOM listeners) or `bus.dispose()` (self-contained buses)
- Full test suite passes with zero regressions
