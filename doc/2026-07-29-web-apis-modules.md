# Web APIs Modules — 14 Browser API Wrappers

**Date:** 2026-07-29
**Session:** Implement 14 Web API modules under `src/browser/media/`
**Status:** Completed

---

## Summary

Implemented 14 browser Web API modules as wrappers/simulations following the `IDisposable` + `onEvent` pattern: FetchClient, XHRClient, HistoryService, LocationService, NavigatorService, ClipboardService, NotificationService, PermissionService, GeolocationService, WebSocketClient, RTCPeerConnection, BroadcastChannelService, ServiceWorkerContainer, and PushManager. Each module provides a clean interface for its respective browser API.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/media/fetch.ts` | FetchClient — wraps native `fetch()` with `get`/`post`/`put`/`patch`/`delete`/`head` convenience methods, timeout, request/response/error events |
| `src/browser/media/xml-http-request.ts` | XHRClient — wraps native `XMLHttpRequest` with `get`/`post`/`put`/`delete`, loadstart/progress/load/error/abort/timeout/loadend events |
| `src/browser/media/history.ts` | HistoryService — in-memory session history with `pushState`/`replaceState`/`go`/`back`/`forward`, popstate/hashchange/push/replace/go events |
| `src/browser/media/location.ts` | LocationService — URL manipulation (href/origin/protocol/host/hostname/port/pathname/search/hash), `assign`/`replace`/`reload`, navigate/hashchange/reload events |
| `src/browser/media/navigator.ts` | NavigatorService — userAgent/platform/language/vendor/cookieEnabled/onLine/hardwareConcurrency, `vibrate()`, `getBattery()`, connection info, online/offline events |
| `src/browser/media/clipboard.ts` | ClipboardService — `readText`/`writeText`/`read`/`write`, delegates to `navigator.clipboard` with in-memory fallback, copy/cut/paste events |
| `src/browser/media/notifications.ts` | NotificationService — `requestPermission`/`show`/`closeAll`, permission lifecycle, show/click/close/error/permission events |
| `src/browser/media/permissions.ts` | PermissionService — `query`/`request`/`revoke` for 17 permission names, in-memory permission store, change/grant/deny events |
| `src/browser/media/geolocation.ts` | GeolocationService — `getCurrentPosition`/`watchPosition`/`clearWatch`, mocked SF coordinates with random jitter, position/error/watch events |
| `src/browser/media/websocket.ts` | WebSocketClient — wraps native `WebSocket`, connect/send/close, open/message/error/close events |
| `src/browser/media/webrtc.ts` | RTCPeerConnection — simulated WebRTC with SDP offer/answer, ICE candidate/connection state machine, signaling/ICE events |
| `src/browser/media/broadcast-channel.ts` | BroadcastChannelService — wraps native `BroadcastChannel`, postMessage/close, message/messageerror events |
| `src/browser/media/service-workers.ts` | ServiceWorkerContainer — simulated SW lifecycle (installing→installed→activating→activated), register/getRegistration/getRegistrations, statechange/controllerchange events |
| `src/browser/media/push-api.ts` | PushManager — simulated push subscription with key generation (p256dh/auth), subscribe/getSubscription/permissionState, subscribe/unsubscribe/push events |
| `tests/web-apis.test.ts` | 87 tests across all 14 modules |

## Architecture Decisions

- **Wrapper vs Simulation**: Existing JS bindings (Fetch, XHR, WebSocket, BroadcastChannel) are wrapped. Completely absent APIs (WebRTC, Service Workers, Push) are simulated. Engine-side-but-not-wired APIs (Clipboard, Notifications, Permissions, Geolocation) have standalone implementations.
- **No real network in tests**: Fetch and XHR tests avoid real network calls to prevent CORS errors in happy-dom test environment. API surface and event patterns are tested instead.
- **Service Worker lifecycle**: Simulated with timeouts (50/100/150ms for installing→installed→activating→activated), matching the real SW lifecycle timing pattern.

## Test Results

```
✓ tests/web-apis.test.ts (87 tests)
Test Files  1 passed (1)
     Tests  87 passed (87)
```

| Module | Tests | Key Coverage |
|--------|-------|--------------|
| FetchClient | 3 | request promise, convenience methods, dispose |
| XHRClient | 2 | request methods, dispose |
| HistoryService | 9 | pushState/replaceState, go/back/forward, clamp, popstate/push events, dispose |
| LocationService | 9 | URL parsing, hash setter, assign/replace/reload, toString, href setter, navigate/hashchange/reload events, dispose |
| NavigatorService | 6 | basic properties, vibrate, getBattery, connection, online/offline events, dispose |
| ClipboardService | 2 | writeText/readText roundtrip, dispose |
| NotificationService | 7 | permission default/request, permission event, show with/without permission, closeAll, dispose |
| PermissionService | 6 | query default, request grants, deny persistence, revoke, change event, dispose |
| GeolocationService | 5 | getCurrentPosition (success/denied), watchPosition cancel, clearWatch, dispose |
| WebSocketClient | 5 | url/readyState, connect, close, send (no connection), dispose |
| RTCPeerConnection | 9 | initial state, createOffer/Answer, setLocalDescription ICE, setRemoteDescription signaling, addIceCandidate, close, signalingstatechange/icecandidate events, dispose |
| BroadcastChannelService | 4 | name, postMessage, close, dispose |
| ServiceWorkerContainer | 10 | no controller, ready promise, register (create/dedup), lifecycle states, ready resolution, getRegistration (found/missing), getRegistrations, unregister, dispose |
| PushManager | 6 | permissionState, getSubscription null, subscribe, getKey, unsubscribe, subscribe event, dispose |

## Verification Steps

1. `npx vitest run tests/web-apis.test.ts` — 87/87 pass
2. `npx vitest run tests/media.test.ts tests/graphics.test.ts` — 222/222 pass (regression check)
