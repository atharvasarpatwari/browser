# Test Suite Green — 8642/8642 Passing, 0 Errors

**Date:** 2026-08-07
**Session:** Full test-suite debugging — make every app test pass with no unhandled errors
**Status:** Completed

---

## Summary

Ran the full Vitest suite and fixed the three blockers that kept it from exiting cleanly: a worker OOM caused by an ignored heap-size config (Vitest 4 migration), a 60s timeout caused by Vitest's `toBe` deep-equality diagnostics exploding on large rendering objects, and an unhandled happy-dom `fetch` rejection. Suite now: **188/188 files, 8642/8642 tests, 0 errors, 0 unhandled, exit 0** (198.7s).

## Root Causes

### 1. Worker OOM — `poolOptions` removed in Vitest 4
**File:** `vitest.config.ts`
**Problem:** Config set `poolOptions.forks.execArgv: ['--max-old-space-size=6144']`. Vitest 4 removed `test.poolOptions` (warning: *"All previous poolOptions are now top-level options"*), so the 6 GB heap bump was silently ignored and fork workers ran at the ~2 GB V8 default. During the paint-engine deep-equality work (see #2) a worker blew the heap and exited — surfaced as `Unhandled Error: Worker exited unexpectedly`.
**Fix:** Move `execArgv` to the top level:
```ts
environment: 'happy-dom',
testTimeout: 60_000,
execArgv: ['--max-old-space-size=6144'],
```
(dropped the whole `poolOptions` block).

### 2. Test timeout — `@vitest/expect` `toBe` deep-equality diagnostics
**File:** `tests/crash-recovery-isolation.test.ts` (test `each tab has isolated rendering pipeline`, line 811)
**Problem:** `expect(tab1.paintEngine).not.toBe(tab2.paintEngine)` timed out after 60s even though the test body completed. Root cause is in `node_modules/@vitest/expect/dist/index.js` (~L1248): the `toBe` matcher runs deep-equality diagnostics (`equals()` with iterable equality) whenever `Object.is(actual, expected)` fails — **including on passing `.not.toBe` assertions**. `PaintEngine` holds a `Rasterizer` (`pixels = new Uint8ClampedArray(width*height*4)`, rasterizer.ts:447), a `LayerCompositor` framebuffer, a layer tree and command maps; element-wise deep comparison of those multi-MB buffers is catastrophic. A minimal repro confirmed `not.toBe`/`not.toStrictEqual` on `paintEngine` hangs while boolean identity comparison passes instantly.
**Fix:** Compare references explicitly so no deep-equality path runs:
```ts
expect(tab1.domTree === tab2.domTree).toBe(false);
expect(tab1.layoutEngine === tab2.layoutEngine).toBe(false);
expect(tab1.paintEngine === tab2.paintEngine).toBe(false);
expect(tab1.eventLoop === tab2.eventLoop).toBe(false);
```

### 3. Unhandled rejection — orphaned `fetch()` promise in happy-dom
**File:** `tests/wpt/networking-apis.test.ts` (test `fetch returns a Promise`)
**Problem:** `const result = fetch('https://example.com');` was never awaited, never given an abort signal, and never `.catch()`ed (the `AbortController` created after it was unused). happy-dom's fetch tried a real request, was CORS-blocked, and rejected with `NetworkError: Cross-Origin Request Blocked...` — an unhandled rejection that Vitest reported as "Vitest caught 1 unhandled error", with false-positive risk.
**Fix:** Pass the abort signal to `fetch` and handle the rejection, matching the GET/POST tests below it:
```ts
const controller = new AbortController();
const result = fetch('https://example.com', {
  signal: controller.signal,
}).catch(() => null);
expect(result).toBeInstanceOf(Promise);
controller.abort();
return expect(result).resolves.toBe(null);
```

## Files Modified
| File | Change |
|------|--------|
| `vitest.config.ts` | Vitest 4 migration: `poolOptions.forks.execArgv` → top-level `execArgv` |
| `tests/crash-recovery-isolation.test.ts` | Replaced `.not.toBe(...)` pipeline checks with boolean identity comparisons (L815–818) |
| `tests/wpt/networking-apis.test.ts` | `fetch returns a Promise` test now aborts via signal + `.catch(() => null)` to settle the rejection |

## Files Deleted
| File | Purpose |
|------|---------|
| `tests/_repro-hang.test.ts` | Temporary minimal repro used for bisection (not part of the repo suite) |

## Test Results
```
# Full suite (npx vitest run)
Test Files  188 passed (188)
Tests       8642 passed (8642)
Errors      0
Duration    198.72s

# Targeted verification
npx vitest run tests/crash-recovery-isolation.test.ts  → 105 passed (105)
npx vitest run tests/wpt/networking-apis.test.ts       → 111 passed (111), no unhandled errors
```

## Verification Steps
1. Confirmed config fix effective: `poolOptions` deprecation warning no longer printed at run start.
2. Confirmed `crash-recovery-isolation.test.ts` no longer times out (105/105, ~10s).
3. Confirmed networking-apis run produces no "Unhandled Errors" section.
4. Full `npx vitest run` completes with 188/188 files, 8642/8642 tests, exit code 0.
