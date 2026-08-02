# Nova Engine Renders on Android — Blank Canvas Debug & Fixes

**Date:** 2026-08-02
**Session:** Diagnose why the Nova engine painted a blank white canvas after navigating to `https://example.com/` in the Android WebView host, then fix the render pipeline.
**Status:** Completed

---

## Summary

The engine's full render pipeline (HTML parse → DOM → style → layout → paint → rasterize) was verified working on device, but the composited frame came out pure white. Two independent engine bugs caused it: `vw`/`vh` CSS units were not resolved during layout (page collapsed to a 60×24 box), and the GPU rasterizer's synchronous `rasterize()` returned a stale, never-rendered software buffer whenever GPU mode was active. Both are fixed; the page now renders correctly on device (body `#eee` background, heading, paragraphs, link, 3px borders all visible).

## Root Causes

### 1. `vw`/`vh` viewport units not resolved in the layout engine

**File:** `src/browser/rendering/layout-engine.ts` (also `src/browser/rendering/positioning.ts`)
**Problem:** The fetched test page styles the body with `width:60vw; margin:15vh auto`. `LayoutEngine.resolveLength()` only handled `px`/`em`/`rem`/`%`, then fell through to `parseFloat(raw)` — so `60vw` became **60px** and `15vh` became **15px**. The body laid out as a 60×24 box at the top-left; the paint commands were correct, but the content occupied a sliver of the 1920×1080 frame. Diagnostic dumps showed the body background `fillRect` at `[0,162,1152,24]` only after the fix (pre-fix it was `[0,15,60,24]`).
**Fix:** Added `vmin`/`vmax`/`vw`/`vh` handling to `LayoutEngine.resolveLength()` using the engine's configured `viewportWidth`/`viewportHeight`:

```ts
if (value.endsWith('vmin')) {
  const n = parseFloat(value);
  const v = Math.min(this.config.viewportWidth, this.config.viewportHeight);
  return isFinite(n) ? (n / 100) * v : 0;
}
if (value.endsWith('vw')) {
  const n = parseFloat(value);
  return isFinite(n) ? (n / 100) * this.config.viewportWidth : 0;
}
if (value.endsWith('vh')) {
  const n = parseFloat(value);
  return isFinite(n) ? (n / 100) * this.config.viewportHeight : 0;
}
```

`positioning.ts:parseLength()` treats `vw`/`vh` as `{ kind: 'percent' }` against the caller-supplied containing size so positioned-element offsets also resolve (the css5 `used-style.ts` resolver already handled `vw`/`vh`).

### 2. GPU rasterizer sync `rasterize()` returned a stale white buffer

**File:** `src/browser/rendering/gpu/gpu-rasterizer.ts`
**Problem:** `PaintEngine` is registered with `hardwareAcceleration` from `AppConfig.processModel.enableGpuAcceleration` (default `true`, `main.ts:471-477`). In the WebView WebGPU is available, so `GpuRasterizer.useGpu` became `true`. Its synchronous `rasterize()` encoded GPU compute commands but then returned `this.softwareFallback.getImageData()` — the software pixel buffer, which is **only ever written by the software fallback and stays at its initial white fill**. Since `NavigationFetcher.renderFromEngine` calls `paintEngine.rasterize()` (sync, `navigation-fetcher.ts`), every frame was white even though `compositeFrame()` produced 65 valid commands (fills, borders, text). Debug proof: `compositeFrame cmds=65` with `fillRect` for `#eee` body background, yet the rasterizer output was `255,255,255,255` everywhere.
**Fix:** The sync path cannot await `mapAsync` GPU→CPU readback, so it must always render the current frame through the software fallback (never return a stale buffer). The GPU commands are still submitted (keeping the async/double-buffer pipeline warm), and the software fallback renders the same command list so the returned `ImageData` is correct:

```ts
rasterize(commands: readonly PaintCommand[]): ImageData {
  if (!this.useGpu || !this.device || !this.computeOps || !this.doubleBuffer) {
    return this.softwareFallback.rasterize(commands);
  }
  const buf = this.doubleBuffer.getCurrentBuffer();
  if (!buf) return this.softwareFallback.rasterize(commands);

  const encoder = this.device.createCommandEncoder();
  for (const cmd of commands) {
    this.execGpu(cmd, buf, encoder);
  }
  this.doubleBuffer.copyToStaging(encoder);
  this.submitEncoder(encoder);
  this.doubleBuffer.swap();

  // Also render synchronously into the software fallback so sync callers
  // receive correct pixels (mapAsync can't be awaited in the sync path).
  return this.softwareFallback.rasterize(commands);
}
```

### 3. (Cleanup) Temporary diagnostics removed

**File:** `src/browser/engine/page-renderer.ts`, `android/bridge/nova-bridge.js`
**Problem:** During the debug session the render pipeline was instrumented with `[diag]` console logs and the bridge stored debug globals + body-head logging.
**Fix:** All `[diag]` instrumentation removed (`page-renderer.ts` is back to a net-zero diff). The bridge keeps its concise `fetch#/resolve#` lifecycle logs (by design) but the `body#` head dump and `window.__lastBridge*` globals were removed.

## Known Limitation (not blocking)

- **Auto-height block doesn't grow to fit its in-flow child:** on the test page the `<div>` laid out at 180px tall but the `<body>` box stayed at 24px, so the `#eee` body background only paints a short strip. Content (text/borders) renders correctly below. Follow-up: block height propagation for `height:auto` in normal flow in `layout-engine.ts`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | `resolveLength()` now resolves `vw`/`vh`/`vmin`/`vmax` against the configured viewport. |
| `src/browser/rendering/positioning.ts` | `parseLength()` treats `vw`/`vh` as percentage-of-containing-block for positioned offsets. |
| `src/browser/rendering/gpu/gpu-rasterizer.ts` | Sync `rasterize()` renders via software fallback so it never returns a stale buffer. |
| `android/bridge/nova-bridge.js` | Removed debug body-head log and `window.__lastBridge*` globals (fetch/resolve lifecycle logs kept). |

Files from the broader Android host work (already covered in `2026-08-02-nova-android-native-browser.md`): `MainActivity.kt`, `NovaFetchBridge.kt`, `AndroidManifest.xml`, `build.gradle`, `package.json`, `android/scripts/copy-web.mjs`, `android/bridge/nova-bridge.js`.

## Files Created

| File | Purpose |
|------|---------|
| `C:\Users\athar\AppData\Local\Temp\opencode\cdp-eval.cjs` | CDP `Runtime.evaluate` helper to inspect WebView page state (canvas pixels, DOM, globals) via `webview_devtools_remote`. |

## Test Results

```
npx tsc --noEmit
  -> only pre-existing errors (src/browser/js/interpreter.ts, values.ts, vm.ts,
     web-apis.ts, websocket-api.ts, tests/browser/rendering/gpu-rasterizer.test.ts)
  -> NO errors in layout-engine.ts / positioning.ts / gpu-rasterizer.ts / page-renderer.ts

npx vitest run tests/browser/rendering/gpu-rasterizer.test.ts
  Test Files  1 passed (1)
  Tests       68 passed (68)

npx vitest run tests/layout
  Test Files  2 passed (2)
  Tests       58 passed (58)

npm run build:web  -> ✓ built in ~1s
node android/scripts/copy-web.mjs  -> Bridge injected; assets copied
gradlew :app:assembleDebug --no-daemon  -> BUILD SUCCESSFUL
adb install -r app-debug.apk; am start -> app launches

Device E2E (CDP drive: tap address bar, type example.com, ENTER):
  [nova-bridge] fetch#1 GET https://example.com/
  [nova-bridge] resolve#1 status=200 textLen=559 b64Len=0
  address input -> https://example.com/, secure lock shown
  canvas 1920x1080 bbox of non-white pixels: (0,162)-(1150,341), 24911 samples
  body background at (100,175) = 238,238,238,255 (#eee, opaque)
  canvas displayed at CSS rect (0,68)-(423,761), chrome (status bar/address/nav) intact
```

## Verification Steps

1. `npm run build:web` + `node android/scripts/copy-web.mjs` + `gradlew :app:assembleDebug` — clean build.
2. Installed APK on RMX5264, launched, attached CDP via `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`.
3. Drove the real user path (tap address input at ~101,47 → `input text example.com` → keyevent 66).
4. Confirmed bridge fetch/resolve lifecycle logs and `#browser-app` chrome state via `Runtime.evaluate`.
5. Scanned the rendered canvas pixels — non-white content present, `#eee` body background confirmed.
6. Rebuilt clean (diagnostics removed) and re-verified end-to-end: same render, no diag spam, no body-head debug logs.
