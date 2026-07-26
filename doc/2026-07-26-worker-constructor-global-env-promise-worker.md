# Worker Constructor Global Env + Promise in Worker Scope

**Date:** 2026-07-26
**Session:** Wire Worker constructor into global environment and add Promise to worker scope
**Status:** Completed

---

## Summary

Wired the `Worker` constructor into `createGlobalEnv()` so it's available in the main thread global scope, and added `Promise` to the worker's isolated environment. Both were already implemented but not connected to their respective environments.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | Imported `createWorkerConstructor` from `./worker`; added `Worker` to global env via `createWorkerConstructor(eventLoop, platformFetch, stubLoader)` |
| `src/browser/js/worker.ts` | Imported `createPromiseConstructor` from `./promise`; added `env.setLocal('Promise', createPromiseConstructor(this.eventLoop))` to `createWorkerEnv()` |
| `tests/worker.test.ts` | Added 5 new tests: Worker in global env (1), Promise in workers (4: typeof, resolve, reject, chain) |

## Test Results

```
✓ tests/worker.test.ts  (64 tests)
   Test Files  1 passed (1)
   Tests       64 passed (64)
```

## Verification

- Worker constructor is set on global env and retrievable via `env.get('Worker')`
- `Promise` is a function inside worker scope (`typeof Promise === 'function'`)
- `Promise.resolve(42)` resolves correctly inside workers
- `Promise.reject("err")` catch handler works inside workers
- Promise chaining (`.then().then()`) works inside workers
