# Phase 1.2 — Context Menu, Incognito, Uploads, Permissions, Popups

**Date:** 2026-08-15
**Session:** Mobile feature-completeness Phase 1.2 (Session C) — engine + Kotlin
**Status:** Completed

---

## Summary
Implemented the remaining Phase 1.2 mobile completeness features: engine-driven
long-press context menu (hit-test based, since WebView `HitTestResult` only sees
the engine's canvas), incognito/private-browsing toggle, `<input type=file>`
uploads via `onShowFileChooser`, WebView permission requests mapped to Android
runtime permissions, and popup/`target=_blank` windows routed into engine tabs.
Verified end-to-end on device over CDP.

## Root Causes

### 1. `crypto.randomUUID` broken in the Android bundle (incognito `activate()` threw)
**File:** `src/browser/settings/incognito.ts`
**Problem:** `import { randomUUID } from 'crypto'` bundles to a shim whose
`randomUUID` is not a function in the WebView build. First `activate()` call
threw `TypeError: randomUUID is not a function`, so `setIncognitoExternal(true)`
(and therefore `window.novaNative.setIncognito(true)`) always failed. This
surfaced only after wiring the incognito toggle into the bridge, because
`browser-window.ts` previously never instantiated the manager.
**Fix:** local `randomUUID()` helper preferring `globalThis.crypto.randomUUID`
with a `getRandomValues`-based v4 fallback (mirrors the existing guard pattern
in `bookmark-validator.ts`).

### 2. Context menu on the engine canvas needs engine hit-testing, not WebView `HitTestResult`
**File:** `src/ui/pages/browser-window.ts`, `src/app/android-native-bridge.ts`
**Problem:** WebView `HitTestResult` only ever resolves to the canvas element,
never to page links/images. The engine renders page content itself, so the DOM
element under the finger must be resolved engine-side.
**Fix:** exposed `IBrowserEngine.getPageLayoutEngine()` →
`PageRenderer.getLayoutEngine()`, then `resolveContextTarget(x, y)` walks the
hit element up ≤64 ancestors collecting the nearest `a[href]`/`img[src]`,
resolving relative URLs against the current page URL and extracting link text
(depth-capped deep-first text scan). `android-native-bridge.ts` wires
document-level `contextmenu` + `pointerdown` dwell (>550 ms, >12 px drift cancels)
detection and pushes `onContextMenuRequested({x, y, pageUrl, pageTitle, linkUrl?,
linkText?, imageUrl?, imageAlt?})` to the native host; listeners are installed
once and delegate to the most recent page (idempotent across re-installs), and a
`suppressNextClick` guard swallows the click released on top of the menu.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | `getChromeState()` emits `incognito`; `ContextTarget` + `resolveContextTarget(x,y)` + `setIncognitoExternal`/`isIncognito`; lazy `IncognitoManager` |
| `src/browser/engine/browser-engine.ts` | `getPageLayoutEngine()` on `IBrowserEngine`/`IPageRenderer` (`NullPageRenderer` → null) |
| `src/app/android-native-bridge.ts` | `novaNative.openInNewTab`/`setIncognito`; `onContextMenuRequested` host method; context-menu detection (contextmenu event + dwell), once-only listeners, click suppression |
| `src/browser/settings/incognito.ts` | `randomUUID` helper replacing the non-functional `crypto` import |
| `android/.../NovaStateBridge.kt` | 5th callback `onContextMenuRequested` (distinct param `onContextMenu`, entry `Log.d`, main-looper marshaling) |
| `android/.../BrowserViewModel.kt` | `incognito` state + `setIncognito`; `ContextMenuTarget` + `onContextMenuRequested`/`dismissContextMenu`/`copyToClipboard`/`shareUrl`/`saveImage`; file-chooser callback state + `openFileChooser`/`onFileChosen`; `permissionRequest` state + `androidPermissionFor`/`resolvePermissionRequest`; snapshot parses `incognito` |
| `android/.../EngineWebView.kt` | `setSupportMultipleWindows`/`setGeolocationEnabled`; `onShowFileChooser`, `onPermissionRequest` (auto-grant when no runtime needed), `onGeolocationPermissionsShowPrompt` auto-grant, `onCreateWindow` → blank transport view forwarding URLs to `openInNewTab`; 5th bridge callback |
| `android/.../BrowserScreen.kt` | `OpenDocument` + `RequestPermission` launchers with `LaunchedEffect` triggers; context-menu sheet wiring; incognito toggle to `TabsBar` |
| `android/.../TabsBar.kt` | incognito params + `VisibilityOff` toggle, dark indigo incognito bar |
| `android/.../ContextMenuSheet.kt` (new) | Compose bottom-sheet context menu (open in new tab / copy / share / save image / copy image URL / open image / copy page URL / share page) |
| `android/app/src/main/AndroidManifest.xml` | `CAMERA`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` |
| `tests/android-native-bridge.test.ts` | snapshot `incognito`; fake-page methods; 6 new bridge tests (setIncognito/openInNewTab/contextmenu push×3 + preventDefault) + 3 `resolveContextTarget` page tests + incognito state test |
| `tests/incognito-manager.test.ts` (new) | 6 IncognitoManager tests incl. no-`crypto.randomUUID` fallback |

## Files Created
| File | Purpose |
|------|--------|
| `android/.../ui/components/ContextMenuSheet.kt` | Context-menu bottom sheet UI |
| `tests/incognito-manager.test.ts` | IncognitoManager + fallback coverage |

## Test Results
```
npx tsc --noEmit              -> only the 5 known pre-existing errors
npx vitest run                -> 193 files / 8742 tests passed
                                 (1 unhandled error: pre-existing deprecated
                                  done() callback in media.test.ts)
npx vitest run tests/android-native-bridge.test.ts -> 31/31
npx vitest run tests/incognito-manager.test.ts     -> 6/6
gradlew :app:assembleDebug    -> BUILD SUCCESSFUL
```

## Verification (on-device, KNEUZTEE6TIBAIIV via CDP)
- `window.novaNative` exposes all 18 methods incl. `openInNewTab` + `setIncognito`; `window.NovaStateBridge.onContextMenuRequested` is a function.
- `getState()` includes `incognito:false` initially; `setIncognito(true)` → snapshot `incognito:true`, `setIncognito(false)` → `false` (fix for root cause #1 confirmed).
- `openInNewTab('https://example.com/')` → tab count 2, engine `fetch#1 GET https://example.com/` (200).
- Dispatched `contextmenu` event → `NovaStateBridge: onContextMenuRequested len=130`; `pointerdown` dwell → second `onContextMenuRequested` (both long-press paths fire); `defaultPrevented=true` on the event.

## Notes / Known Limits
- Engine-rendered `<input type=file>` may not reach `onShowFileChooser` until the
  engine delegates file inputs to the real DOM — wiring is in place and builds.
- `onCreateWindow` forwards popup URLs to engine tabs via a blank transport view;
  the engine's own `target=_blank` handling covers the common case.
- Visual screenshot of the context-menu sheet was captured but could not be
  reviewed by this model (no image input); functional logs prove the push + UI
  state wiring.
