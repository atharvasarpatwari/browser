# Sandboxing and Process Isolation Implementation

**Date:** 2026-07-26
**Session:** Phase 1-6 of sandboxing plan — Capability-based renderer isolation
**Status:** Completed

---

## Summary

Implemented a complete 6-phase sandboxing and process isolation system for Nova Browser. The system restricts renderer processes to capability-based access, gates IPC communication, enforces resource quotas, provides a preload bridge pattern, isolates processes per origin, and proxies all network traffic.

## Architecture

The sandboxing system consists of 6 layers, each with a single responsibility:

### Phase 1: Renderer Capability Restriction
**File:** `src/browser/security/renderer-sandbox.ts`

Defines 29 renderer capabilities (dom, canvas-2d, fetch-proxy, etc.) and maps them to 4 privilege tiers (sandboxed-content, web-content, trusted-extension, browser-chrome). Includes environment scrubbing, Node.js flag safety, and module allowlisting.

### Phase 2: Capability-Based IPC Enforcement
**File:** `src/common/ipc/capability-gate.ts`

Gates every IPC operation based on the sender's privilege level. Maps IPC channels to API surfaces (e.g., `dom` channel → `dom` surface, `fetch` channel → `fetch` surface). Supports channel overrides, extra capabilities, and denial tracking. Browser-chrome gets everything; sandboxed-content only gets basic DOM.

### Phase 3: Sandbox-Enforced Process Communication
**File:** `src/browser/security/sandbox-enforcer.ts`

Integrates SandboxManager, PrivilegeLevels, and CapabilityGate into a single enforcement point. Every IPC request from a renderer passes through the enforcer before dispatch. Applies sandbox permission overrides (e.g., allowScripts, allowTopNavigation) per-origin.

### Phase 4: Preload Script / Capability Broker
**Files:** `src/browser/security/preload.ts`, `src/process/renderer-entry-sandboxed.ts`

Preload script runs BEFORE any user JavaScript in sandboxed renderers. Creates a `window.__nova` bridge that exposes only allowed APIs. All calls are forwarded via IPC to the main process. The sandboxed renderer entry point builds a restricted `window` object with limited globals — no `process`, no `require`, no `fs`.

### Phase 5: Process Isolation Hardening
**Files:** `src/browser/security/process-isolator.ts`, `src/browser/security/network-proxy.ts`

ProcessIsolator enforces per-process resource quotas (memory, CPU, file descriptors, timers, promises). Tracks processes by origin for same-origin isolation. Emits quota violation events and crash detection. NetworkProxy intercepts all network requests from sandboxed renderers — blocks localhost, file:// scheme, and enforces per-process concurrent request limits.

### Phase 6: Integration Tests
**File:** `tests/sandbox-integration.test.ts`

End-to-end tests verifying the full pipeline: register process → enforce IPC → track isolation → proxy network. Tests cross-origin isolation, quota violations, network blocking, and privilege alignment.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/browser/security/renderer-sandbox.ts` | ~520 | Renderer capability definitions and env scrubbing |
| `src/common/ipc/capability-gate.ts` | ~490 | IPC channel/method capability checking |
| `src/browser/security/sandbox-enforcer.ts` | ~460 | IPC enforcement integration point |
| `src/browser/security/preload.ts` | ~370 | Preload bridge for sandboxed renderers |
| `src/process/renderer-entry-sandboxed.ts` | ~310 | Sandboxed renderer process entry point |
| `src/browser/security/process-isolator.ts` | ~370 | Resource quotas and process isolation |
| `src/browser/security/network-proxy.ts` | ~290 | Network request proxying |
| `tests/capability-gate.test.ts` | ~300 | 46 tests for capability gate |
| `tests/preload.test.ts` | ~240 | 23 tests for preload bridge |
| `tests/process-isolator.test.ts` | ~340 | 41 tests for isolator + network proxy |
| `tests/sandbox-integration.test.ts` | ~370 | 19 integration tests |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/security/sandbox-enforcer.ts` | Fixed `checkSandboxPermissions` — was checking ALL permission fields against every request; now only checks permissions relevant to the requested channel/method |

## Test Results

```
tests/capability-gate.test.ts     46 passed
tests/preload.test.ts             23 passed
tests/process-isolator.test.ts    41 passed
tests/sandbox-integration.test.ts 19 passed
────────────────────────────────────────
Total                            129 passed, 0 failed
```

## Key Bug Fixed

### SandboxEnforcer Over-Blocking

**File:** `src/browser/security/sandbox-enforcer.ts`

**Problem:** The `checkSandboxPermissions` method checked ALL sandbox permission fields (allowScripts, allowPopups, allowTopNavigation, allowPointerLock) against EVERY IPC request. Since `allowPopups` defaults to `false` for web-content, every request — including `dom` channel access — was denied with "Sandbox permission denied 'popup'".

**Fix:** Changed to a targeted check that only evaluates permissions relevant to the requested channel:
```typescript
// Before: checked ALL permissions against ALL requests
for (const { surface, allowed } of checks) {
  if (!allowed && gateCheck.allowed) { return denied; }
}

// After: only checks permissions when channel matches
const permissionChecks = [
  { channel: 'script', permission: perms.allowScripts, surface: 'eval' },
  { channel: 'navigation', permission: perms.allowTopNavigation, surface: 'navigation-top' },
];
for (const check of permissionChecks) {
  if (!check.permission && context.channel === check.channel) { return denied; }
}
```

## Verification

1. All 129 new tests pass (4 test files)
2. Full existing test suite passes (0 regressions)
3. End-to-end pipeline verified: register → enforce → isolate → proxy
