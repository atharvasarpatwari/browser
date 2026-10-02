# Permission-Prompt UI — Geolocation, Notifications, and Clipboard Are Now Real

**Date:** 2026-09-28
**Session:** Continued the audit-driven roadmap after Forms (Phase 2): planned and implemented "Phase 3 — Permission-prompt UI".
**Status:** Completed (2 root causes fixed)

---

## Summary

The roadmap's next item described this as "wire an existing `promptUser` seam to a UI." Investigation found the real gap was bigger on both ends: it's 7 overlapping permission-manager implementations, not 4, and the one worth keeping (`PermissionGatedWebApis` in `web-apis-permissions.ts`) had zero production importers — nothing in the JS engine bound `navigator.geolocation`, `window.Notification`, or `navigator.clipboard` to scripts at all, so pages couldn't reach any of this regardless of a UI. This session built the whole chain: real JS-engine bindings for all three APIs, a new anchored permission-prompt bar in the browser chrome, and end-to-end wiring from a page script's API call through a real user decision and back. Verified with a real, no-mock `PageRenderer` test pipeline and confirmed live in the running dev-preview app — a page requesting geolocation showed a real "localhost:8846 wants to: Know your location" prompt, and clicking Allow delivered a real position back to the page's own callback.

Also consolidated: deleted 4 confirmed-dead duplicate permission/notification/geolocation classes (zero production importers anywhere) that the wired facade now makes fully redundant.

## Root Causes

1. **No permission-gated Web API was reachable from page scripts at all.** `src/browser/js/web-apis.ts`/`index.ts` had zero bindings for `navigator.geolocation`, `window.Notification`, or `navigator.clipboard` — a page calling any of them hit `undefined is not a function`, not "silently allowed/denied." The actual business logic already existed and was well-tested (`PermissionGatedWebApis`'s `GeolocationAPI`/`NotificationsAPI`/`ClipboardAPI`, all backed by one origin-scoped `PermissionStore`), but nothing in the engine ever constructed or bound it. Fixed by adding a new `src/browser/js/permissions-api.ts` that builds one `PermissionGatedWebApis` per page load and binds its 3 sub-APIs onto `navigator`/`window` inside `createGlobalEnv`, following the exact factory-binding pattern already used for `fetch`. This surfaced two real interpreter bugs along the way, both fixed in the same file: (a) invoking a page-script callback from a *real* host `await` chain (not the interpreter's own synchronous dispatch) throws "No JS interpreter registered," because `_globalCaller` is only set for the duration of a synchronous call — fixed by re-establishing it around each such callback, mirroring `PageRenderer.runDispatch`'s existing try/finally shape; (b) `new Notification(...)` never actually invoked its constructor logic at all, because `evalNew()`'s "callable JSObject" dispatch path (interpreter.ts, the same path `new Promise(...)` uses) reads `.callable`/`.nativeFn` as **direct fields** on the object, not as entries in its `.properties` Map — the existing `createXMLHttpRequestClass` in `xhr.ts` has this exact same latent bug (never caught because nothing constructs `new XMLHttpRequest()` through a real script anywhere in the suite); this session's own `Notification` constructor was fixed to set both as direct fields, `xhr.ts`'s bug was left alone as out of scope.
2. **No UI existed to answer a permission prompt, and no engine seam existed for "page JS blocks and awaits a real host-UI decision" at all** — `alert`/`confirm`/`prompt` don't exist either (a documented gap, `src/common/types/privilege.ts:47`). Fixed by adding a new `PermissionBar` component (`src/ui/components/permission-bar/permission-bar.ts`, modeled directly on the existing `FindBar`'s attach/show/hide/dispose shape, but request/response instead of callback-setters — a second request made while one is visible queues instead of clobbering it), plus a new `setPermissionPromptHandler`/`requestPermissionPrompt` pair on `IBrowserEngine` so `browser-window.ts` (which owns the actual UI) can supply the real prompt to `PageRenderer` (which cannot reach UI directly) — the same "engine exposes a settable handler, chrome wires it" convention already used for `content-renderer.ts`'s dispatch handlers, applied in the opposite direction.

## Notes

- **Vibration was deliberately left alone.** `navigator.vibrate` already correctly hardcodes `return false` (desktop has no vibration hardware) — that's already spec-correct behavior, so routing it through a permission prompt would only add a confusing prompt for a capability that can never work regardless of the answer.
- **Geolocation uses a fixed default position** (no real GPS/IP-geolocation on desktop) — marked with a `ponytail:` comment naming the upgrade path (an IP-based lookup or OS location API) if real geolocation is ever needed.
- **Clipboard reuses the real DOM Web Clipboard API directly** (`navigator.clipboard.readText/writeText`) rather than a new IPC channel — confirmed `PageRenderer`/the JS engine run in the same Electron renderer process as the rest of the app (no `contextIsolation` boundary at this layer), the same approach the host chrome itself already uses for "copy link address."
- **Consolidation was scoped conservatively.** Of the 7 overlapping permission-manager-shaped classes found, only the 4 with zero production importers or instantiation *anywhere* (only their own barrel export and/or their own dead test coverage) were deleted. Two broader, DI-registered-but-never-resolved implementations (`src/browser/security/permission-manager.ts`, and `PermissionManagerService` embedded inside `SecurityLayer`) were left alone — they cover a different, wider permission surface (camera/mic/screen-capture/payment-handler/etc.) this phase doesn't implement, and untangling `SecurityLayer`'s coupling to the latter is independent cleanup that doesn't block this feature.
- Getting a permission-prompt test working end-to-end required understanding a subtlety of this engine's async model: a real `await` chain in host TypeScript code (like `PermissionStore.request()`) settles on a real Node microtask, completely outside the interpreter's own synthetic event loop — so a test dispatching a click/script and immediately asserting DOM state sees nothing until a real macrotask flush (`await new Promise(r => setTimeout(r, 0))`) lets the pending chain finish.

## Files Modified

| File | Change |
|------|--------|
| `src/app/main.ts` | Wired `onPermissionRequest: (origin, name) => engine.requestPermissionPrompt(origin, name)` into `PageRenderer` construction |
| `src/browser/engine/browser-engine.ts` | Added `setPermissionPromptHandler`/`requestPermissionPrompt` to `IBrowserEngine`/`BrowserEngine` (denies by default when no UI is wired) |
| `src/browser/engine/page-renderer.ts` | Added `onPermissionRequest` to `PageRendererDependencies`; threaded it into the `createGlobalEnv()` call |
| `src/browser/js/index.ts` | `createGlobalEnv` builds one `PermissionGatedWebApis` per page load and binds `navigator.geolocation`/`navigator.clipboard`/`window.Notification` |
| `src/browser/media/index.ts` | Removed barrel exports for the 4 deleted dead classes |
| `src/ui/pages/browser-window.ts` | Instantiates/attaches a `PermissionBar` alongside `FindBar`; wires it as the real prompt handler whenever a tab's engine is (re)assigned |
| `tests/web-apis.test.ts` | Removed the `NotificationService`/`PermissionService`/`GeolocationService`/`PushManager` describe blocks and their imports (dead-code coverage for the classes deleted below); left all other blocks in this shared file untouched |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/js/permissions-api.ts` | Real JS-engine bindings (geolocation/clipboard/Notification) over the existing `PermissionGatedWebApis` facade |
| `src/ui/components/permission-bar/permission-bar.ts` | The real permission-prompt UI (origin + permission copy, Allow/Block, request queueing) |
| `tests/page-renderer-permissions.test.ts` | Real-pipeline (no mocks) coverage: geolocation grant/deny, Notification request/permission/throw-when-denied, clipboard write grant/deny, safe-default-deny when unwired |
| `tests/permission-bar.test.ts` | Unit coverage for `PermissionBar`: copy per permission, Allow/Block resolution, request queueing, dispose-resolves-pending |
| `doc/2026-09-28-permission-prompt-ui-implemented.md` | This change log |

## Files Deleted

| File | Purpose |
|------|--------|
| `src/browser/media/geolocation.ts` | Dead duplicate (`GeolocationService`) — zero production importers, superseded by the wired facade |
| `src/browser/media/notifications.ts` | Dead duplicate (`NotificationService`) — zero production importers, superseded by the wired facade |
| `src/browser/media/permissions.ts` | Dead duplicate (`PermissionService`) — zero production importers, superseded by the wired facade |
| `src/browser/media/push-api.ts` | Dead duplicate (`PushManager`) — zero production importers; Push API isn't part of the target facade and was already 100% unreachable from any page |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 235/235 files, 9363/9363 tests (net -15: +11 new across 2 new files, -26 dead-code tests removed from tests/web-apis.test.ts)
```

## Verification Steps

1. Real-pipeline tests (no mocks): rendered real HTML through the actual `PageRenderer`, called `navigator.geolocation.getCurrentPosition`/`Notification.requestPermission`/`navigator.clipboard.writeText` from real `<script>` tags with a fake `onPermissionRequest`, and asserted on the resulting DOM/callback state for both the granted and denied paths.
2. Live-verified in the dev preview end to end: clicked a real "Get Location" button on a real test page, confirmed the permission bar appeared reading "localhost:8846 wants to: Know your location," clicked Allow, and confirmed the page's own success callback received the real default position (`lat=37.7749 lon=-122.4194`). Repeated for Notifications with a Block click, confirming `Notification.requestPermission()` resolved `'denied'` and the page reflected it.
3. Ran the full suite (`npx tsc --noEmit -p .`, `npx vitest run`) after every change — 0 regressions across all 235 files / 9363 tests. Two unrelated test timeouts seen on one earlier full-suite run (`tests/ipc.test.ts`, `tests/password-manager.test.ts`) were confirmed as resource-contention flakes, not regressions, by re-running both files in isolation (140/140 passing).
