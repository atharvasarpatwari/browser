# Session: Permission-Gated Web APIs — Geolocation, Notifications, Clipboard, Vibration

**Date:** 2026-07-26
**Session:** Permission-gated web APIs implementation
**Status:** Completed

---

## Summary

Implemented a shared permission model and five browser-facing web APIs that sit on top of it: Geolocation, Notifications, Clipboard, Vibration, and a unified Permissions Query system. All APIs share one `PermissionStore` for consistent prompt/grant/deny flow, and delegate actual OS interactions to engine-supplied backends.

## Architecture

### Permission Model (`PermissionStore`)
- Per-origin permission storage (`origin → permission → state`)
- States: `'prompt'` (default), `'granted'`, `'denied'`
- `query()`: non-prompting lookup
- `request()`: prompts user if state is `'prompt'`, returns immediately if already granted/denied
- Emits `'change'` events for reactive UI updates
- Engine supplies a `PermissionPrompt` function that shows real UI

### API Design Principles
- **No DOM reliance**: Uses `MiniEmitter` instead of `EventTarget`; works in Node/Vitest
- **Backend injection**: Each API receives an engine-supplied backend for actual OS access
- **Fully testable**: All APIs work with mock backends, no real GPS/clipboard/vibration needed
- **Per-origin isolation**: Permissions are scoped to the requesting origin

### APIs Implemented

| API | Methods | Permission | Notes |
|-----|---------|-----------|-------|
| **Geolocation** | `getCurrentPosition`, `watchPosition`, `clearWatch` | `geolocation` | Position caching with `maximumAge`, timeout via `Promise.race` |
| **Notifications** | `requestPermission`, `create`, `closeAll` | `notifications` | Tag-based replacement, max 3 active, `simulateClick()` for testing |
| **Clipboard** | `readText`, `writeText` | `clipboard-read` / `clipboard-write` | Separate read/write permissions |
| **Vibration** | `vibrate`, `cancel` | `vibrate` | Pattern normalization (floor/negatives), zero-pattern → cancel |
| **Permissions** | `query`, `request` | (all) | Generic per-origin permission state management |

### Facade Pattern (`PermissionGatedWebApis`)
Single entry point that wires all sub-APIs to one shared `PermissionStore`:
```typescript
const apis = new PermissionGatedWebApis({ origin, promptUser, ... });
await apis.geolocation.getCurrentPosition(success, error);
```

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/web-apis/web-apis-permissions.ts` | Full implementation: MiniEmitter, PermissionStore, GeolocationAPI, NotificationsAPI, ClipboardAPI, VibrationAPI, PermissionGatedWebApis facade |
| `tests/web-apis-permissions.test.ts` | 40 tests covering all APIs |

## Test Results

```
Test Files  1 passed (1)
Tests      40 passed (40)
```

- PermissionStore: 6 tests (defaults, prompt-only-once, persistence, per-origin isolation, change events, setState override)
- GeolocationAPI: 8 tests (success, denied, source failure, timeout, cache, cache bypass, watchPosition, clearWatch)
- NotificationsAPI: 10 tests (permission states, create/show, close, idempotent close, tag replacement, eviction, closeAll, simulateClick)
- ClipboardAPI: 5 tests (read/write granted, read/write denied, independent permissions)
- VibrationAPI: 6 tests (single/pattern vibration, denied, zero cancel, negative clamping, cancel permissionless)
- Facade: 3 tests (shared store, independent permissions, instance types)

## Verification Steps

1. All 40 tests pass
2. PermissionStore correctly prompts only once per permission per origin
3. Geolocation timeout works via `Promise.race` (never-resolving source + timer)
4. Geolocation caching respects `maximumAge` parameter
5. Notifications tag replacement closes old notification
6. Notifications eviction at MAX_ACTIVE_NOTIFICATIONS (3)
7. Vibration pattern normalization (floor negatives, clamp)
8. Facade wires all sub-APIs to single shared PermissionStore
