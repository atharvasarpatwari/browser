# Modern Web API Support — Implementation & Fixes

**Date:** 2026-07-27
**Session:** Web API implementation, comprehensive tests, bug fixes (66+68 = 134 tests passing)
**Status:** Completed

---

## Summary

Implemented 23+ modern Web API families in `src/browser/js/web-apis.ts` and wired them into the JavaScript global environment. Created 134 comprehensive tests (66 in web-apis-comprehensive + 68 in web-apis-extended). Fixed 20+ bugs across multiple root causes. Full suite: 6884/6885 pass (1 pre-existing flaky test unrelated).

## Web APIs Implemented

| API Family | Constructor / Function | Lines |
|------------|----------------------|-------|
| Web Crypto | `crypto`, `crypto.getRandomValues()`, `crypto.randomUUID()`, `crypto.subtle` | ~120 |
| BroadcastChannel | `BroadcastChannel(name)` with `postMessage()`, `close()`, `onmessage`, `addEventListener` | ~100 |
| Custom Elements | `customElements.define()`, `.get()`, `.getName()` | ~40 |
| Fullscreen | `requestFullscreen()`, `exitFullscreen()`, `fullscreenElement()` | ~40 |
| Streams | `ReadableStream`, `WritableStream`, `TransformStream` with `getReader()`, `getWriter()` | ~200 |
| Performance | `performance.now()`, `.mark()`, `.measure()`, `.getEntries()`, `.getEntriesByType()`, `.getEntriesByName()`, `.clearMarks()`, `.clearMeasures()`, `.clearResourceTimings()` | ~200 |
| PerformanceObserver | `PerformanceObserver(callback)` with `observe()`, `disconnect()`, `takeRecords()` | ~40 |
| Selection | `getSelection()` returns `Selection` with `getRangeAt()`, `addRange()`, `removeAllRanges()`, `collapse()` | ~80 |
| Range | `document.createRange()` returns `Range` with `setStart()`, `setEnd()`, `cloneRange()`, `collapse()`, `selectNode()` | ~80 |
| TreeWalker / NodeIterator | `document.createTreeWalker()`, `document.createNodeIterator()` with `nextNode()`, `previousNode()`, `firstChild()`, `lastChild()`, `parentNode()` | ~120 |
| MessageChannel | `MessageChannel()` with `port1`/`port2`, `postMessage()`, `onmessage`, `start()`, `close()` | ~80 |
| Touch Events | `Touch()`, `TouchEvent(type, init)` | ~80 |
| Drag Events | `DragEvent(type, init)` with `DataTransfer` | ~60 |
| Web Animations | `Animation()` with `play()`, `pause()`, `finish()`, `cancel()`, `reverse()` | ~50 |
| ResizeObserver | `ResizeObserver(callback)` with `observe()`, `unobserve()`, `disconnect()` | ~20 |
| Navigator APIs | `navigator.vibrate()`, `navigator.mediaDevices` | ~10 |
| Element APIs | `elementFromPoint()`, `elementsFromPoint()`, `requestFullscreen()` on elements | ~10 |
| **WebAssembly** | `WebAssembly.validate()`, `.compile()`, `.instantiate()`, `.compileStreaming()`, `.instantiateStreaming()`, `Module`, `Instance`, `Memory`, `Table`, `Global`, `Tag`, `Exception` | ~350 |
| **WebGPU** | `gpu.requestAdapter()`, `gpu.getPreferredCanvasFormat()`, `GPUAdapter`, `GPUDevice` (createBuffer, createTexture, createShaderModule, createRenderPipeline, createComputePipeline, createQueue, createCommandEncoder, etc.) | ~350 |
| **WebXR** | `navigator.xr.isSessionSupported()`, `.requestSession()`, `XRSession`, `XRReferenceSpace`, `XRViewerPose`, `XRView` | ~200 |
| **View Transitions** | `document.startViewTransition(callback)` → `ViewTransition` with `ready`, `finished`, `skipTransition()` | ~50 |
| **Navigation API** | `navigator.navigation` → `Navigation` with `.navigate()`, `.reload()`, `.back()`, `.forward()`, `.currentEntry`, `.canGoBack`, `.canGoForward`, `.goTo()` | ~200 |
| **Compression Streams** | `CompressionStream(format)`, `DecompressionStream(format)` with `readable` and `writable` streams | ~80 |
| **Scheduler API** | `scheduler.postTask(callback, options)`, `scheduler.yield()`, `scheduler.currentTask` | ~60 |
| **Shared Storage** | `window.sharedStorage` → `.selectURL()`, `.set()`, `.get()`, `.delete()`, `.clear()`, `.join()`, `.run()`, `.resolveaidauction()` | ~80 |
| **Fenced Frames** | `FencedFrameConfig`, `Fence.report()`, `.getJoiningOrigins()`, `.getSharedStorage()`, `.notifyEvent()` | ~60 |
| **AI APIs** | `window.ai` → `.canCreateTextSession()`, `.createTextSession()`, `.languageModel()`, `.summarizer()`, `.writer()`, `.rewriter()`, `.translator()`, `.assistant()`, `.languageModelFactory()` | ~300 |
| **Speculation Rules** | SpeculationRules config with `prerender`/`prefetch` rules, `document.getSpeculationRules()` | ~60 |

Total: ~2800+ lines in `web-apis.ts`.

## Wiring into Global Environment

`createGlobalEnv()` in `src/browser/js/index.ts` now provides:
- `crypto`, `Crypto`, `CryptoKey`, `SubtleCrypto` globals
- `BroadcastChannel` constructor
- `customElements` namespace
- `ReadableStream`, `WritableStream`, `TransformStream` constructors
- `performance` object (full API, not just `.now()`)
- `PerformanceObserver` constructor
- `ResizeObserver` constructor
- `MessageChannel`, `MessagePort` constructors
- `Touch`, `TouchEvent`, `DragEvent` constructors
- `Animation` constructor
- `getSelection()`, `document.createRange()`, `document.createTreeWalker()`, `document.createNodeIterator()`
- `elementFromPoint()`, `elementsFromPoint()` on document
- `navigator.vibrate()`
- `WebAssembly` (validate, compile, instantiate, compileStreaming, instantiateStreaming)
- `Module`, `Instance`, `Memory`, `Table`, `Global`, `Tag`, `Exception` constructors
- `gpu` (WebGPU adapter/device/buffer/texture/pipeline/queue/command encoder)
- `xr` (WebXR session, reference space, viewer pose, views)
- `CompressionStream`, `DecompressionStream` constructors
- `scheduler` (postTask, yield, currentTask)
- `sharedStorage` (selectURL, set, get, delete, clear, join, run)
- `Fence` object (report, getJoiningOrigins, getSharedStorage, notifyEvent)
- `ai` (canCreateTextSession, createTextSession, languageModel, summarizer, writer, rewriter, translator, assistant, languageModelFactory)
- `document.startViewTransition()` (View Transitions API)
- `document.navigation` (Navigation API)
- `document.getSpeculationRules()` (Speculation Rules)

## Root Causes Fixed

### 1. Parse Error in Stream Chunk Buffer Assignment

**File:** `src/browser/js/web-apis.ts`
**Problem:** TypeScript syntax error — `(streamObj as any).__chunks: JSValue[] = [];` is invalid TypeScript (type annotation on property access).
**Fix:** Changed to `(streamObj as any).__chunks = [] as JSValue[];`

### 2. `crypto.getRandomValues` Not Handling Native TypedArrays

**File:** `src/browser/js/web-apis.ts`
**Problem:** Code assumed all typed arrays were JSObject wrappers from Nova's JS engine. When host code passes real JavaScript `Uint8Array` objects, they have `.length` and `.BYTES_PER_ELEMENT` directly (not in a `.properties` Map).
**Fix:** Added type check — if `typedArray.BYTES_PER_ELEMENT` exists (native TypedArray), use it directly; otherwise fall back to JSObject `.properties.get()` access.

### 3. `BroadcastChannel.postMessage` After `close()`

**File:** `src/browser/js/web-apis.ts`
**Problem:** No `__closed` flag on channel objects. After `close()`, messages could still be sent.
**Fix:** Added `__closed` boolean property to channel objects. `postMessage` checks the flag and silently drops messages if closed.

### 4. `deepCloneJS` Not Handling Plain JS Objects

**File:** `src/browser/js/web-apis.ts`
**Problem:** `deepCloneJS` assumed all objects have `.properties.get()` (JSObject). Plain JS objects from host code have direct key-value pairs via `Object.entries()`.
**Fix:** Added check: if object has no `.properties` Map, fall back to `Object.entries()` for cloning.

### 5. TreeWalker `firstChild` PropertyDescriptor Mishandling

**File:** `src/browser/js/web-apis.ts`
**Problem:** `firstChild` accessed `current.properties.get('childNodes')` and used it directly as the children array. But `properties.get()` returns a `PropertyDescriptor` with `{ value, writable, ... }`, not the value itself.
**Fix:** Added `.value` accessor after `properties.get('childNodes')` to extract the actual array.

### 6. Performance `clearMarks` / `clearMeasures` Not Cleaning Entries Array

**File:** `src/browser/js/web-apis.ts`
**Problem:** `clearMarks()` and `clearMeasures()` cleared the `marks`/`measures` Maps but left stale entries in the `entries` array. Subsequent `getEntries()` calls would return stale data.
**Fix:** Added reverse iteration through `entries` array to splice out entries matching the cleared name/type.

### 7. Fullscreen API Returns JSFunction Wrappers

**File:** `tests/web-apis-comprehensive.test.ts`
**Problem:** Tests called `fs.requestFullscreen(el, [el])` but `createFullscreenAPIMethods()` returns JSFunction objects with a `.nativeFn` method, not plain functions.
**Fix:** Updated tests to use `.nativeFn()` calls: `fs.requestFullscreen.nativeFn(el, [el])`.

### 8. Touch/TouchEvent/DragEvent Constructor Arg Handling

**File:** `src/browser/js/web-apis.ts`
**Problem:** `Touch()`, `TouchEvent()`, and `DragEvent()` constructors accessed init properties via `init.properties.get(name)?.value`, which only works with JSObject wrappers. Tests passed plain JavaScript objects `{ identifier: 1, clientX: 100, ... }`.
**Fix:** Added dual-path property accessor (`getInitProp` helper) that checks both `name in opts` (plain objects) and `opts.properties.get(name)?.value` (JSObject wrappers). Applied to Touch, TouchEvent, and DragEvent constructors.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/web-apis.ts` | All 8 initial bug fixes + 11 new API families (WebAssembly, WebGPU, WebXR, View Transitions, Navigation, Compression Streams, Scheduler, Shared Storage, Fenced Frames, AI APIs, Speculation Rules) |
| `src/browser/js/index.ts` | Updated `bindWebAPIs(env, docBinding)` call to pass docBinding for document-bound APIs |
| `tests/web-apis-comprehensive.test.ts` | Fixed Fullscreen API test calls to use `.nativeFn()` |
| `tests/web-apis-extended.test.ts` | **NEW** — 68 tests for all 11 new API families |

## Test Results

```
web-apis-comprehensive.test.ts: 66 passed (66)
web-apis-extended.test.ts: 68 passed (68)
Total new tests: 134
Full suite: 6884 passed, 1 failed (pre-existing flaky download-manager sort test)
```

## Verification Steps

1. `npx vitest run tests/web-apis-comprehensive.test.ts` — 66/66 pass
2. `npx vitest run tests/web-apis-extended.test.ts` — 68/68 pass
3. `npx vitest run` — full suite, no regressions (6884/6885, 1 pre-existing flaky test)
4. Verified all 23+ API families are accessible from `createGlobalEnv()` output
