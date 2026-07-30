# Layout Enhanced Table Parser Fix

**Date:** 2026-07-29
**Session:** Fix HTML5 parser table auto-insertion to unblock table layout tests
**Status:** Completed

---

## Summary

Fixed the HTML5 tree builder's table-parsing logic so that `<tr>`/`<td>`/`<th>` tokens encountered inside `<table>` without a wrapping `<tbody>` are correctly inserted as descendants of `<table>` rather than foster-parented to `<body>`. This unblocks the "should layout a simple table" integration test.

## Root Causes

### 1. Table element popped from open-elements stack

**File:** `src/browser/rendering/html5/modes/table.ts` — `handleInTable()`

**Problem:** The `handleInTable` mode handler for `tbody`/`thead`/`tfoot`/`tr`/`td`/`th` start tags called `popCurrentNodeUntil('table')` before switching insertion mode and reprocessing the token. This removed the `<table>` element from the open-elements stack. When the token was then processed in `IN_TABLE_BODY` or `IN_ROW` mode, the current node was `<body>`, so `insertHTMLElement` appended table-child elements to `<body>` instead of `<table>`.

**Fix:** Removed `popCurrentNodeUntil('table')` for these cases. The `<table>` element stays on the open-elements stack, so `appendToCurrentNode` correctly appends children to `<table>` (or its descendants).

Before:
```typescript
case 'tbody':
case 'tfoot':
case 'thead':
    ctx.popCurrentNodeUntil('table');
    ctx.setMode(Im.IN_TABLE_BODY);
    ctx.processToken(token);
    return;
case 'tr':
    ctx.popCurrentNodeUntil('table');
    ctx.setMode(Im.IN_TABLE_BODY);
    ctx.processToken(token);
    return;
case 'td': case 'th':
    ctx.popCurrentNodeUntil('table');
    ctx.setMode(Im.IN_ROW);
    ctx.processToken(token);
    return;
```

After:
```typescript
case 'tbody':
case 'tfoot':
case 'thead':
    ctx.setMode(Im.IN_TABLE_BODY);
    ctx.processToken(token);
    return;
case 'tr':
    ctx.setMode(Im.IN_TABLE_BODY);
    ctx.processToken(token);
    return;
case 'td': case 'th':
    ctx.setMode(Im.IN_ROW);
    ctx.processToken(token);
    return;
```

### 2. Auto-insertion of `<tbody>` not pushing onto stack

**File:** `src/browser/rendering/html5/modes/table.ts` — `handleInTableBody()`

**Problem:** The existing auto-insertion logic for `tr`/`th`/`td` in `handleInTableBody` called `insertHTMLElement` for the synthetic `<tbody>` token, then immediately called `popCurrentNode()` to pop the auto-inserted `<tbody>`. This meant the `<tr>` was appended to the current node after `<tbody>` was popped — i.e., back to `<table>`. But `<tr>` should be a child of `<tbody>`, not `<table>`.

**Fix:** Removed the `popCurrentNode()` call after auto-inserting `<tbody>`, so the `<tbody>` element remains on the stack and becomes the parent for the subsequent `<tr>` insertion.

Before:
```typescript
if (!ctx.isInTableScope('tbody') && !ctx.isInTableScope('thead') && !ctx.isInTableScope('tfoot')) {
    const tbodyToken: Token = { kind: 'open', tagName: 'tbody', attrs: new Map(), offset: token.offset };
    ctx.insertHTMLElement(tbodyToken);
    ctx.popCurrentNode(); // <-- wrong: pops tbody before tr is inserted
}
ctx.insertHTMLElement(token);
```

After:
```typescript
if (!ctx.isInTableScope('tbody') && !ctx.isInTableScope('thead') && !ctx.isInTableScope('tfoot')) {
    const tbodyToken: Token = { kind: 'open', tagName: 'tbody', attrs: new Map(), offset: token.offset };
    ctx.insertHTMLElement(tbodyToken);
}
ctx.insertHTMLElement(token);
```

### 3. `<tbody>`/`<thead>`/`<tfoot>` tokens dropped when not in scope

**File:** `src/browser/rendering/html5/modes/table.ts` — `handleInTableBody()`

**Problem:** When `handleInTable` reprocessed a `<tbody>` token in `IN_TABLE_BODY` mode, the `handleInTableBody` handler checked `isInTableScope('tbody')`, which returned `false` (since no `<tbody>` had been inserted yet). The handler then emitted a parse error and returned without inserting the element.

**Fix:** When the scope check fails for `tbody`/`thead`/`tfoot`, insert the element directly into the table structure (this is the initial insertion, not a close-and-reopen).

Before:
```typescript
case 'caption': case 'col': case 'colgroup':
case 'tbody': case 'tfoot': case 'thead':
    if (!ctx.isInTableScope(token.tagName!)) {
        ctx.parseError(token);
        return;
    }
    ...
```

After:
```typescript
case 'caption': case 'col': case 'colgroup':
case 'tbody': case 'tfoot': case 'thead':
    if (!ctx.isInTableScope(token.tagName!)) {
        // Not in scope: this is the initial insertion (reprocessed from handleInTable).
        // Insert the element directly into the table structure.
        ctx.insertHTMLElement(token);
        return;
    }
    ...
```

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/html5/modes/table.ts` | Removed `popCurrentNodeUntil('table')` in `handleInTable`; removed `popCurrentNode()` after auto-inserting `<tbody>` in `handleInTableBody`; changed `tbody`/`thead`/`tfoot` not-in-scope behavior from parse-error+drop to insert |
| `tests/layout-enhanced.test.ts` | Cleaned up test to use single tree, removed stale workaround comments and debug logging |

## Files Created

| File | Purpose |
|------|---------|
| (none) | - |

## Test Results

```
✓ tests/layout-enhanced.test.ts (22 tests)
✓ tests/formatting-contexts.test.ts (68 tests)
90 passed (2 test files)
```

All 22 layout-enhanced tests pass, including the previously-failing "should layout a simple table" test. All 68 formatting-contexts tests pass with no regressions.

## Verification Steps

1. Ran `npx vitest run tests/layout-enhanced.test.ts` — 22/22 passed
2. Ran `npx vitest run tests/formatting-contexts.test.ts tests/layout-enhanced.test.ts` — 90/90 passed
3. Confirmed debug output shows:
   - `<tbody> auto-inserted as child of <table>` (via `appendToCurrentNode tag: tbody currentNode: table`)
   - `<tr> inserted as child of <tbody>` (via `appendToCurrentNode tag: tr currentNode: tbody`)
   - `<td> inserted as child of <tr>` (via `appendToCurrentNode tag: td currentNode: tr`)
   - `tbl.children.length === 1` (contains auto-inserted `<tbody>`)
   - `tableBox.height > 0`
