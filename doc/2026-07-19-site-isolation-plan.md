# Full Site Isolation — Plan

**Date:** 2026-07-19
**Status:** Planned

---

## Summary

Implement Chromium-like full site isolation for Nova Browser. Five modules enforce origin-based isolation, cross-origin boundaries, user permissions, resource quotas, and privilege separation between browser chrome and web content.

## Scope

### 1. OriginIsolator (`src/browser/security/origin-isolator.ts`)
- Maps each (scheme, host, port) triple to an isolated context ID
- Tabs navigating to different origins get separate DomTree/EventLoop contexts
- Same-origin tabs can share contexts (optional, for efficiency)
- Tracks active origins, context counts, cross-origin navigations
- Integrates with TabContextManager for context creation/teardown

### 2. CrossOriginGuard (`src/browser/security/cross-origin-guard.ts`)
- Enforces Same-Origin Policy for DOM access (postMessage, iframe contentWindow)
- Blocks cross-origin storage access (localStorage, sessionStorage, IndexedDB, cookies)
- Intercepts cross-origin network requests (fetch/XHR) and validates CORS-like headers
- Provides `canAccess(targetOrigin, requesterOrigin)` decision API
- Integrates with NavigationGuard for frame navigation checks

### 3. PermissionManager (`src/browser/security/permission-manager.ts`)
- Central store for user-granted permissions per origin
- Permission types: camera, microphone, notifications, geolocation, persistent-storage, midi, sensors, clipboard-read, clipboard-write, payment-handler
- States: prompt (default), granted, denied
- Per-origin expiration (optional TTL)
- Query API: `query(origin, permission)`, `request(origin, permission)`, `revoke(origin, permission)`
- Integrates with CSP sandbox enforcer for allow-modals, allow-popups, etc.

### 4. ResourceQuotaManager (`src/browser/security/resource-quota-manager.ts`)
- Per-tab/per-origin resource limits:
  - Memory: max heap per tab (default 128MB), eviction on breach
  - CPU: max execution time per task (default 50ms), integrates with ScriptGuard
  - Network: max concurrent connections per origin (default 6), max total bandwidth share
- Quota tracking: current usage per origin, peak usage, historical averages
- Eviction policies: LRU (memory), timeout (CPU), queue (network)
- Event emission on quota breach for UI notification

### 5. PrivilegeLevels (`src/browser/security/privilege-levels.ts`)
- Defines privilege tiers: `browser-chrome`, `trusted-extension`, `web-content`, `sandboxed-content`
- API surface control:哪些 APIs are available at each tier
  - `browser-chrome`: full access (file system, process management, native APIs)
  - `trusted-extension`: limited native APIs, storage, networking
  - `web-content`: standard web APIs (DOM, fetch, storage, workers)
  - `sandboxed-content`: restricted (no scripts unless allow-scripts, no forms unless allow-forms)
- Integrates with SandboxManager permissions for iframe sandboxing
- `checkPrivilege(currentLevel, requiredLevel)` decision API

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                 PrivilegeLevels                       │
│  chrome → extension → web-content → sandboxed        │
│  API surface control per tier                         │
└────────────────────┬────────────────────────────────┘
                     │ checkPrivilege()
┌────────────────────▼────────────────────────────────┐
│                 OriginIsolator                        │
│  origin → context mapping                            │
│  cross-tab isolation enforcement                      │
└───┬──────────────────────────────────────┬──────────┘
    │                                      │
    ▼                                      ▼
┌──────────────────┐            ┌─────────────────────┐
│ CrossOriginGuard │            │  PermissionManager   │
│ SOP enforcement  │            │  per-origin perms   │
│ DOM/storage/net  │            │  camera/mic/etc     │
└──────────────────┘            └─────────────────────┘
                     │
                     ▼
          ┌─────────────────────┐
          │ ResourceQuotaManager│
          │ memory/CPU/network  │
          │ per-origin caps     │
          └─────────────────────┘
```

## Integration Points

| Existing Module | Integration |
|-----------------|-------------|
| TabContextManager | OriginIsolator creates/destroys contexts per origin |
| ScriptGuard | ResourceQuotaManager extends CPU limits |
| CSP SandboxEnforcer | PrivilegeLevels reads SandboxPermissions for tier |
| NavigationController | CrossOriginGuard registered as INavigationGuard |
| CSP PolicyStore | PermissionManager reads CSP sandbox flags |
| ProcessGuard | ResourceQuotaManager reports quota breaches to CrashReporter |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/security/origin-isolator.ts` | Origin → context mapping, cross-tab isolation |
| `src/browser/security/cross-origin-guard.ts` | Same-Origin Policy enforcement |
| `src/browser/security/permission-manager.ts` | Per-origin user permission store |
| `src/browser/security/resource-quota-manager.ts` | Per-tab memory/CPU/network quotas |
| `src/browser/security/privilege-levels.ts` | Chrome vs content privilege separation |
| `tests/site-isolation.test.ts` | Comprehensive tests for all 5 modules |

## Test Targets

- OriginIsolator: ~25 tests (context mapping, isolation, cross-origin nav, disposal)
- CrossOriginGuard: ~20 tests (DOM, storage, network, CORS, integration)
- PermissionManager: ~25 tests (grant, deny, revoke, query, expiration, events)
- ResourceQuotaManager: ~25 tests (memory, CPU, network, eviction, events)
- PrivilegeLevels: ~15 tests (tiers, API surface, sandbox integration, checkPrivilege)
- **Total: ~110 tests**

## Estimated Test Suite After

79 existing + 1 new = **80 test files, ~3370+ tests**
