# WebRTC Subsystem Hardening

**Date:** 2026-08-27
**Session:** Correctness/bug fixes, cleanup/refactor, and test additions for the WebRTC Phase 1 subsystem (STUN client, ICE agent, reliable data channel), following verification.
**Status:** Completed

---

## Summary

Hardened the WebRTC subsystem after its first real verification run. Fixed two crash-prone dgram error-handling gaps (STUN socket error and ICE bind failure), corrected retry counting in the STUN client, removed a duplicated cookie buffer and an unused helper, corrected a reliable-channel ACK sequence check, and added three deterministic regression tests. Full suite green: 208 files / 9108 tests.

## Root Causes

### 1. STUN request socket-error crash
**File:** `src/browser/networking/stun-client.ts`
**Problem:** The dgram socket in `stunBindingRequest` had no `'error'` listener. A runtime socket error (e.g. ECONNREFUSED) with no listener throws as an _uncaught exception_, crashing the process instead of rejecting the request promise.
**Fix:** Added an `onSocketError` listener that rejects the pending promise with a `StunError`, and removed it (along with the message listener) in `settle()` so sockets are never leaked.

### 2. ICE bind-failure crash + dirty state
**File:** `src/browser/networking/ice-agent.ts`
**Problem:** (a) `socket.on('error')` was not handled during gather, so a bind failure (`EADDRINUSE`) with no listener also threw uncaught. (b) On bind failure the `bindResult` was captured in a closure variable (`let bindError: Error | null`) that TypeScript narrowed to `never` after the `await`, making the failure branch unreachable in the type checker's view and leaving the agent half-bound.
**Fix:** Registered a persistent `socket.on('error', ...)` swallow handler (prevents the uncaught crash). Changed the closure capture to `const bindResult = await new Promise<Error | null>(...)` that resolves with the bind error — TS-friendly, no narrowing bug. On failure: call `this.close()` for clean state, then `throw new IceError(...)`. Split into separate `if (bindResult)` / `if (!this.boundPort)` blocks (fixes the `never` narrowing).

### 3. STUN retry counting off-by-one
**File:** `src/browser/networking/stun-client.ts`
**Problem:** The retry counter incremented before `socket.send`, so the error message understated the effort and the count didn't reflect actual packets transmitted.
**Fix:** `sends` is incremented _after_ each `socket.send`; the timeout error now honestly reports "timed out after N retries" (N+1 packets total). Stale timers are cleared by the existing `settle()` on settle.

### 4. Reliable-channel ACK matched wrong sequence
**File:** `src/browser/js/rtc-api.ts`
**Problem:** The ACK/message match compared against `this.sendSeq - 1`, which is fragile when pending frames sequence differently.
**Fix:** Compare the ACK against `this.pendingSend.frame.readUInt32BE(1)` (the actual sequence embedded in the pending frame).

## Refactors
- `stun-client.ts`: extracted shared `MAGIC_COOKIE_BYTES` buffer, used by both `encodeXorMappedAddress` and `parseMappedAddress` (removed duplicated per-call cookie buffers).
- `ice-agent.ts`: removed the unused `ip_of()` helper; srflx candidate `relatedAddress` now derived via `candidates.find((c) => c.type === 'host')?.ip ?? '0.0.0.0'`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/networking/stun-client.ts` | error listener, retry counting, shared cookie buffer |
| `src/browser/networking/ice-agent.ts` | bind-failure clean state, persistent error handler, removed `ip_of` |
| `src/browser/js/rtc-api.ts` | ACK matches pending frame seq |
| `tests/stun-client.test.ts` | +2 tests (socket-error rejection, retry packet count) |
| `tests/ice-agent.test.ts` | +1 test (bind-failure clean state via injected dgram mock) |
| `doc/README.md` | indexed this change log |

## Test Results
```
# typecheck
npx tsc --noEmit                          -> exit 0

# lint (touched source + test files)
npx eslint src/browser/networking/stun-client.ts src/browser/networking/ice-agent.ts src/browser/js/rtc-api.ts tests/stun-client.test.ts tests/ice-agent.test.ts
                                          -> 4 warnings (all pre-existing), 0 errors, exit 0

# targeted
npx vitest run tests/stun-client.test.ts tests/ice-agent.test.ts tests/rtc-api.test.ts
                                          -> 3 files passed, 26 tests passed, exit 0

# full suite
npx vitest run                             -> 208 files passed, 9108 tests passed, exit 0
```

Note: an intermediate full-suite run reported 2 worker-pool timeouts ("Timeout waiting for worker to respond") under heavy parallel load; the immediate re-run was fully green (208 files / 9108 tests), confirming that was infrastructure flakiness, not a code regression.

## Verification Steps
1. `npx tsc --noEmit` → 0 errors.
2. ESLint on the 3 touched source files + 2 touched test files → 0 errors (4 pre-existing warnings).
3. Targeted WebRTC tests (stun + ice + rtc-api) → 26/26 pass, including the 3 new regression tests.
4. Full `npx vitest run` → 208 files / 9108 tests pass, exit 0; baseline was 208 files / 9105, so +3 tests from this session, no regressions.
