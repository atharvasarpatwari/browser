# Future Scope Plan & Stabilization Fixes

**Date:** 2026-08-08
**Session:** Dev-proxy stabilization fixes + multi-phase future scope plan for Nova Browser
**Status:** Completed (Phase 0 fixes) / In Progress (Phase 1+ plan)

---

## Summary

Fixed the last 5 failing tests and the last TypeScript error in the repo, verified the full 8,655-test suite and both Electron e2e specs green, and documented the agreed future-scope roadmap (Phases 0–5 with priorities 0 → 1 → 3, native Rust as a parallel track).

## Root Causes

### 1. `res.on is not a function` (5 test timeouts)
**File:** `vite-plugins/nova-dev-proxy.ts:145`, `tests/dev-proxy-http-client.test.ts`
**Problem:** Commit `c8eeae5 "New change23"` added abort-on-disconnect wiring: `proxyRequest()` calls `res.on('close', ...)`. The test harness `invokeMiddleware()` built its mock `res` as a plain object without `.on()`, so every proxy round-trip threw inside the `req.on('end')` handler, never calling `res.end()`, and each test died on the 60s timeout.
**Fix:** Made the mock `res` a real `EventEmitter` (matching `ServerResponse`), with `statusCode/statusMessage/headersSent/writableEnded/setHeader/getHeader/end` assigned onto it:

```ts
const res = new EventEmitter() as EventEmitter & {
  statusCode: number;
  statusMessage: string;
  headersSent: boolean;
  writableEnded: boolean;
  setHeader: (k: string, v: unknown) => void;
  getHeader: (k: string) => unknown;
  end: (c?: Buffer | string) => void;
};
res.statusCode = 200;
res.statusMessage = '';
res.headersSent = false;
res.writableEnded = false;
res.setHeader = (k, v) => { headers[k.toLowerCase()] = v; };
res.getHeader = (k) => headers[k.toLowerCase()];
res.end = (c) => {
  if (c !== undefined) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  if (!settled) { settled = true; done(); }
};
```

### 2. TypeScript TS2554 on `middlewares.use`
**File:** `vite-plugins/nova-dev-proxy.ts:128`
**Problem:** The inline type for `server.middlewares.use` was `(path: string, handler) => void`, but the plugin mounts the middleware with a single argument (`use(createNovaDevProxyMiddleware())`) to avoid connect stripping the mount path from `req.url`.
**Fix:** Overloaded the `use` signature to accept both connect forms:

```ts
use: {
  (path: string, handler: NovaProxyMiddleware): void;
  (handler: NovaProxyMiddleware): void;
};
```

## Future Scope Plan (agreed)

Priorities: **0 → 1 → 3** · Native Rust: **parallel track** · Effort: **qualitative only**

| Phase | Scope | Effort |
|-------|-------|--------|
| 0 Stabilization | dev-proxy fixes (DONE this session), CI gating, native toolchain repair (parallel) | Low |
| 1 Engine Integration & Persistence | Wire PageLoader/PageRenderer into BrowserEngine (TODO #1, #11), persistent IndexedDB/localStorage adapters for 6 `InMemory*` stores, image decoding into paint `drawImage`, microtask queue, sticky font-size, stacking-context triggers, pluggable FontMetricsProvider | High |
| 2 Multi-Process (parked) | Activate `child_process.fork()` transport in `ProcessManager`; per-tab/domain process models; OS-level crash isolation | — |
| 3 Native & Android | Full Nova engine rendering inside Android WebView, Rust `nova-net` networking wired into JS layer (parallel), WASM build fallback | High |
| 4 Product Shipping | Electron packaging/auto-update/DevTools protocol; Android Play-ready; multi-platform release CI | — |
| 5 Modern Web Platform | Service Workers/PWA, WebRTC, WASM execution, CSS containment/subgrid/scroll-snap, JIT tiering | — |

## Files Modified

| File | Change |
|------|--------|
| `vite-plugins/nova-dev-proxy.ts` | Overloaded `middlewares.use` type (TS2554 fix) |
| `tests/dev-proxy-http-client.test.ts` | Mock `res` converted to `EventEmitter` with `ServerResponse`-like surface (`.on` fix) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-08-08-future-scope-plan.md` | This change log + roadmap |

## Test Results

```
$ npx vitest run tests/dev-proxy-http-client.test.ts
Test Files  1 passed (1)
     Tests  13 passed (13)

$ npm run typecheck   # tsc --noEmit
(no output — clean)

$ npm test
Test Files  189 passed (189)
     Tests  8655 passed (8655)

$ npx playwright test --config=playwright-electron.config.cjs
✓ Nova Browser launches in Electron and renders content (5.0s)
✓ Nova Browser stays open and responsive via the health probe (9.9s)
2 passed (16.6s)
```

**Verification steps:** targeted dev-proxy file → typecheck → full vitest suite → Electron e2e (smoke + keep-alive). All green.
