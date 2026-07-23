# Process Model Design Report — Multi-process vs Single-process

**Date:** 2026-07-21
**Status:** Informational (architecture decision record)

---

## Executive Summary

Nova Browser currently runs in **single-process (monolith) mode** with comprehensive in-process tab isolation. A full multi-process IPC infrastructure is built and tested but not yet active. This report documents the current architecture, the readiness for multi-process operation, tradeoffs, and the recommended path forward.

---

## 1. Current Architecture: Single-process Monolith

All tabs and browser core services run inside a **single Node.js process**. Tab isolation is achieved through separate object instances (not OS-level process boundaries).

```
┌──────────────────────────────────────────────────────────────┐
│                   Node.js Process (single)                    │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐     │
│  │  TabContext A │   │  TabContext B │   │  TabContext C │     │
│  │  (isolated)   │   │  (isolated)   │   │  (isolated)   │     │
│  │  DomTree      │   │  DomTree      │   │  DomTree      │     │
│  │  LayoutEngine │   │  LayoutEngine │   │  LayoutEngine │     │
│  │  PaintEngine  │   │  PaintEngine  │   │  PaintEngine  │     │
│  │  EventLoop    │   │  EventLoop    │   │  EventLoop    │     │
│  │  ScriptGuard  │   │  ScriptGuard  │   │  ScriptGuard  │     │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘     │
│         │                   │                   │             │
│  ┌──────▼───────────────────▼───────────────────▼──────────┐  │
│  │           InProcessTransport (synchronous)              │  │
│  │           IPC Channel / ServiceProxy                     │  │
│  └──────────────────────────┬──────────────────────────────┘  │
│                             │                                 │
│  ┌──────────────────────────▼──────────────────────────────┐  │
│  │           Main Process (Browser Core)                    │  │
│  │  Navigation + Networking + Security + Storage            │  │
│  │  SandboxManager + OriginIsolator + CrossOriginGuard      │  │
│  │  CSP System + PrivilegeLevels + ResourceQuotaManager     │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Per-tab Isolation (In-process)

Each `TabContext` (`src/browser/engine/tab-context.ts`) owns an independent rendering pipeline:

- **DomTree** — separate DOM for each tab
- **LayoutEngine** — independent layout computation
- **PaintEngine** — separate paint command recording
- **EventLoop** — isolated event loop per tab
- **ScriptGuard** — wall-clock timeout, instruction count limits, stack depth limits per tab

A crash in one tab's JS execution does **not** corrupt other tabs because all mutable state is per-instance.

---

## 2. Multi-process Infrastructure (Built, Not Active)

A complete IPC system is implemented and tested but operates through synchronous in-process calls.

### 2.1 IPC System (`src/common/ipc/` — 7 files, 64 tests)

| Module | File | Purpose |
|--------|------|---------|
| Message Protocol | `message.ts` | Fire-and-forget, request-response, streaming. 40+ named channel constants. |
| Serializer | `serializer.ts` | JSON serialization with tagged wrappers (Date, Map, Set, RegExp, Error, BigInt, ArrayBuffer). |
| Transport | `transport.ts` | Abstract `ITransport` + 2 implementations: `InProcessTransport` (active), `EventEmitterTransport` (built, not wired). |
| Channel | `channel.ts` | Named channel subscriptions, request-response with timeout/correlation, stream requests. |
| Service Proxy | `service-proxy.ts` | Typed remote method invocation over IPC. `ServiceProxy` (client), `ServiceStub` (server). |
| Process Manager | `process-manager.ts` | Renderer lifecycle: spawn, destroy, crash restart (exponential backoff), graceful shutdown. Max 16 processes. |
| Index | `index.ts` | Barrel export. |

**Key design**: The `ProcessManager` accepts a `ProcessFactory` function. Currently the factory creates `InProcessTransport` instances. A multi-process mode would swap in a factory that calls `child_process.fork()`.

### 2.2 Tab-Process Adapter (`src/browser/engine/tab-process-adapter.ts`)

Bridge between tab management and process management:

- Creates a `TabContext` and spawns a renderer process per tab
- Destroys process on tab destruction
- Forwards crash events between process and tab contexts
- Provides unified `ITabProcessManager` API

### 2.3 Security Sandbox (`src/browser/security/` — 12 modules)

| Module | Purpose |
|--------|---------|
| `SandboxManager` | Per-origin sandboxes with configurable permissions (scripts, forms, modals, popups, same-origin, top-navigation). |
| `OriginIsolator` | Maps (scheme, host, port) triples to isolated context IDs. |
| `CrossOriginGuard` | Enforces Same-Origin Policy for DOM, storage, and network access. |
| `PrivilegeLevels` | 4 tiers: sandboxed-content → web-content → trusted-extension → browser-chrome. |
| `ResourceQuotaManager` | Per-tab/per-origin limits: 128MB heap, 50ms CPU/task, 6 concurrent connections/origin. |
| CSP System (8 files) | Full CSP Level 1-3: parser, evaluator, reporter, policy-store, navigation-guard, resource/script/sandbox-enforcers. |
| `PermissionManager` | User-granted permissions per origin (camera, mic, notifications, geolocation). |
| `ThirdPartySecurity` | Iframe policy enforcement with isolated sandbox permission sets. |

---

## 3. Tradeoff Analysis

### 3.1 Comparison Matrix

| Dimension | Single-process (current) | Multi-process (planned) |
|-----------|--------------------------|--------------------------|
| **Complexity** | Low — in-memory function calls | High — IPC serialization, process lifecycle, crash recovery |
| **Performance** | No serialization overhead, no IPC latency | ~0.1-1ms per IPC round-trip, serialization cost for large payloads |
| **Security** | Logical isolation only (same address space) | OS-level process isolation (real sandbox) |
| **Crash containment** | Per-tab via ScriptGuard/ErrorBoundary | Per-tab via OS process boundary |
| **Memory** | Shared heap, lower total footprint | Per-process overhead (~30-50MB per renderer process) |
| **Debugging** | Single stack trace, simple | Distributed traces, harder |
| **Resource sharing** | Direct object references, zero-copy | Must serialize all cross-boundary data |
| **Startup time** | Instant (in-process) | ~100-500ms per new renderer process |
| **When needed** | MVP, development, trusted content | Untrusted web content, production security |

### 3.2 Risk Assessment

| Risk | Single-process | Multi-process |
|------|----------------|---------------|
| Malicious JS crashes browser | Medium (ScriptGuard mitigates) | Low (process crash = tab crash only) |
| Spectre/Meltdown attacks | High (shared address space) | Low (process isolation) |
| Memory leak in one tab affects all | Medium (ResourceQuota mitigates) | Low (per-process memory limits) |
| IPC bottleneck under load | N/A | Medium (needs careful design) |
| Development iteration speed | Fast | Slower (multi-process debugging) |

---

## 4. Readiness Assessment

### What's Complete

- [x] IPC protocol with 40+ named channels
- [x] JSON serializer with tagged-type wrappers
- [x] `InProcessTransport` (active, synchronous)
- [x] `EventEmitterTransport` (ready for `child_process` IPC)
- [x] `ChannelManager` with request-response and streaming
- [x] `ServiceProxy` / `ServiceStub` for typed RPC
- [x] `ProcessManager` with spawn, restart, backoff, shutdown
- [x] `TabProcessAdapter` bridging tabs and processes
- [x] Full security sandbox (SandboxManager, OriginIsolator, CSP, PrivilegeLevels, ResourceQuota)
- [x] Per-tab in-process isolation (separate DomTree, EventLoop, etc.)
- [x] Crash recovery (ScriptGuard, ErrorBoundary, ProcessGuard, CrashReporter, LifecycleManager)

### What's Missing

- [ ] `child_process.fork()` factory (the actual process spawning)
- [ ] `WorkerTransport` (Web Worker / worker_threads)
- [ ] `SocketTransport` (TCP/Unix socket)
- [ ] Channel direction configuration (currently hard-coded `main-to-renderer`)
- [ ] Cross-process DOM synchronization protocol
- [ ] GPU process model
- [ ] Utility process model (network, storage)
- [ ] Process-per-site isolation (planned in `doc/2026-07-19-site-isolation-plan.md`)
- [ ] Config for process model in `config/app.config.json`

---

## 5. Recommended Path Forward

### Phase 1: Stay Single-process (Current — Recommended for MVP)

**Rationale**: The browser is still in active development with rapid iteration cycles. Single-process mode with in-process tab isolation provides:
- Fast development iteration (no IPC debugging overhead)
- Simple testing (all state is in-memory)
- Sufficient crash containment for trusted content
- Lower memory footprint for development

**Action**: Keep `createInProcessManager()` as the default. Continue building features.

### Phase 2: Enable Multi-process for Untrusted Content

**Trigger**: When the browser begins rendering untrusted third-party web content.

**Steps**:
1. Implement `createChildProcessFactory()` using `child_process.fork()`
2. Swap `ProcessManager` factory in `ApplicationBootstrap.wireTabProcessManager()`
3. Add `processModel` config option to `config/app.config.json`
4. Test IPC serialization overhead with realistic page loads
5. Implement cross-process DOM synchronization protocol

**Estimated effort**: ~2 weeks for basic multi-process, ~6 weeks for production-ready.

### Phase 3: Process-per-site Isolation

**Trigger**: When Spectre-class mitigations are required.

**Steps**:
1. Implement site-per-process policy in `OriginIsolator`
2. Cross-origin iframes get separate renderer processes
3. Same-origin iframes may share a process
4. Network/storage remain in main process

**Estimated effort**: ~4 weeks.

---

## 6. Configuration Design (Future)

When multi-process is enabled, the config would look like:

```json
{
  "processModel": {
    "mode": "multi-process",
    "maxRendererProcesses": 16,
    "perSiteIsolation": false,
    "gpuProcess": true,
    "utilityProcess": true,
    "crashRestartBackoff": {
      "initialDelay": 1000,
      "maxDelay": 30000,
      "maxRestarts": 5
    }
  }
}
```

And when in development/monolith mode:

```json
{
  "processModel": {
    "mode": "single-process"
  }
}
```

---

## 7. Key Files Reference

| File | Relevance |
|------|-----------|
| `src/common/ipc/transport.ts` | Transport abstraction — swap factory for multi-process |
| `src/common/ipc/process-manager.ts` | Process lifecycle management |
| `src/browser/engine/tab-process-adapter.ts` | Tab ↔ process bridge |
| `src/browser/security/sandbox-manager.ts` | Per-origin sandbox |
| `src/browser/security/origin-isolator.ts` | Origin → context isolation |
| `src/browser/security/cross-origin-guard.ts` | Same-Origin Policy enforcement |
| `src/browser/security/resource-quota-manager.ts` | Per-tab resource limits |
| `src/browser/security/privilege-levels.ts` | 4-tier privilege model |
| `src/app/main.ts` | Bootstrap wiring (line: `wireTabProcessManager()`) |
| `doc/2026-07-18-ipc-design.md` | IPC system design documentation |
| `doc/2026-07-18-crash-recovery-isolation.md` | Crash recovery documentation |
| `doc/2026-07-19-site-isolation-plan.md` | Future site-per-process plan |
| `doc/2026-07-19-site-isolation.md` | Site isolation module tests |

---

## 8. Conclusion

Nova Browser has a **well-prepared single-process architecture** with a complete but dormant multi-process infrastructure. The IPC system, process manager, security sandbox, and tab-process adapter are all built, tested, and ready for activation. The recommended approach is to remain single-process during active development and enable multi-process mode when untrusted web content rendering becomes a requirement. The transition requires primarily a factory swap in the bootstrap configuration, plus cross-process DOM synchronization.
