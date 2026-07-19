# Application Bootstrap Wiring & External Script Execution

**Date:** 2026-07-18
**Session:** Wire all subsystems into main.ts DI, firewall integration, external script fetching
**Status:** Completed

---

## Summary

Wired all previously-implemented subsystems into the application bootstrap (`main.ts`), created a firewall-guarded networking adapter, and implemented external `<script src>` fetching and execution with defer/async support. 73 test files, 2867 tests — all passing.

## Changes Made

### 1. Firewall Integration (`networking-setup.ts`)

Created `src/browser/netwroking/networking-setup.ts` — a factory that composes the `Firewall` with `firewallGuardedOpenSocket` for easy wiring into `establishConnection()`. Applies baseline rules by default and exposes `guardSocket()` to wrap any `openSocket` callback.

### 2. Application Bootstrap DI (`main.ts`)

Added 11 new DI tokens and registrations:

| Token | Class | Lifetime |
|-------|-------|----------|
| `ScriptGuard` | `ScriptGuard` | Singleton |
| `ErrorBoundary` | `ErrorBoundary` | Singleton |
| `CrashReporter` | `CrashReporter` | Singleton |
| `ProcessGuard` | `ProcessGuard` | Singleton |
| `TabContextManager` | `TabContextManager` | Singleton |
| `TabProcessManager` | `TabProcessManager` (async-created) | Singleton |
| `Firewall` | `Firewall` with baseline rules | Singleton |
| `FirewallGuardedNetworking` | `createFirewallGuardedNetworking()` | Singleton |

### 3. TabProcessManager Wiring

`wireTabProcessManager()` is called during `registerSharedServices()`. It:
- Creates a `TabProcessManager` via `createTabProcessManager()` (async, uses in-process IPC)
- Registers it in the DI container
- Subscribes to `tabProcessCrashed` events and forwards them to `CrashReporter`

### 4. External Script Execution Pipeline

Replaced `executeInlineScripts()` with `executeAllScripts()` which handles all three script types per the WHATWG spec:

1. **Blocking scripts** (no `defer`/`async`): fetched via `ResourceLoader.loadScript()` then executed synchronously in document order
2. **Defer scripts**: fetched during parsing, executed after DOM construction in document order
3. **Async scripts**: fetched and fired immediately upon download completion (best-effort)

The `resolveUrl()` utility resolves relative URLs against the page's base URL.

### 5. Tests

Created `tests/networking-setup.test.ts` — 14 tests covering:
- Firewall creation with/without baseline rules
- Firewall option passthrough
- `guardSocket()` returning correct function type
- Connection allow/block based on rules
- mDNS, NetBIOS, SSDP blocking with baseline rules
- HTTP/HTTPS port allowance
- Private network address blocking on non-standard ports
- Integration with `establishConnection` pattern

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/netwroking/networking-setup.ts` | Firewall-guarded networking factory (~70 lines) |
| `tests/networking-setup.test.ts` | 14 tests for firewall-guarded networking |

## Files Modified

| File | Change |
|------|--------|
| `src/app/main.ts` | Added 11 DI tokens, 7 service registrations, `wireTabProcessManager()`, replaced `executeInlineScripts()` with `executeAllScripts()` supporting external script fetch + defer/async, added `resolveUrl()` utility |

## Test Results

```
73 test files — 2867 tests — all passing

New tests:
  tests/networking-setup.test.ts: 14 tests
    - createFirewallGuardedNetworking: 8 tests
    - guardSocket behavior: 6 tests

No regressions in any existing test file.
```

## Verification

1. `npx vitest run tests/networking-setup.test.ts` — 14/14 pass
2. `npx vitest run` — 2867/2867 pass (73 files)
3. All existing tests continue to pass
