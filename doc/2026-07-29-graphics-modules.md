# Graphics Modules — Canvas 2D, SVG, WebGL, WebGL2, WebGPU, OffscreenCanvas

**Date:** 2026-07-29
**Session:** Implement 6 graphics Web API modules under `src/browser/media/`
**Status:** Completed

---

## Summary

Implemented six graphics/rendering Web API modules: CanvasElement (wrapping existing software-rasterized Canvas 2D), SVGDocument (SVG DOM tree with XML serialization), WebGLRenderingContext (simulated OpenGL ES 2.0 context), WebGL2RenderingContext (VAOs, samplers, TFOs, queries), GPUCanvasContext + GPUDevice (WebGPU canvas integration with adapter/device/pipeline/encoder chain), and OffscreenCanvas (worker-friendly canvas with transferToImageBitmap/convertToBlob). All modules follow the `IDisposable` + `onEvent` pattern.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/media/canvas.ts` | CanvasElement — wraps existing `CanvasRenderingContext2D` from `rendering/canvas/` with resize, toDataURL, toBlob, event system |
| `src/browser/media/svg.ts` | SVGDocument — SVG DOM tree with element creation, append/remove, attribute system, getBBox, XML serialization via `render()` |
| `src/browser/media/webgl.ts` | WebGLRenderingContext — simulated GL context with buffer/texture/program/shader/framebuffer objects, shader compile/link, clear/draw/viewport |
| `src/browser/media/webgl2.ts` | WebGL2RenderingContext — extends WebGL with VertexArrayObject, Sampler, TransformFeedback, Query, instanced drawing, texStorage2D, blitFramebuffer |
| `src/browser/media/webgpu.ts` | GPUCanvasContext + GPUDevice — WebGPU adapter/device, buffer/texture/sampler/shader module/bind group/pipeline creation, command encoder with render/compute passes |
| `src/browser/media/offscreen-canvas.ts` | OffscreenCanvas — worker-context canvas with 2D rendering context stub, transferToImageBitmap, convertToBlob, ImageBitmap |
| `tests/graphics.test.ts` | 119 tests across all 6 modules |

## Architecture Decisions

- **Canvas 2D wrapper**: `CanvasElement` wraps the existing `HTMLCanvasElement` from `rendering/canvas/` rather than duplicating the full rasterizer. The existing `CanvasRenderingContext2D` is returned directly from `getContext('2d')`.
- **WebGL/WebGL2 simulation**: GL state (buffers, programs, shaders, textures) is tracked in Maps with auto-incrementing IDs. Shader compilation succeeds unless source contains `#error`. Program linking requires two compiled shaders. No real GPU calls — draws are no-ops.
- **WebGPU simulation**: Full adapter → device → pipeline → encoder → pass chain with no-op draw/dispatch. `requestAdapter()` returns a software adapter. `GPUDevice` implements all object creation methods returning simple objects with IDs.
- **OffscreenCanvas**: Minimal implementation with stub `OffscreenCanvasRenderingContext2D` (getImageData returns empty data, draw ops are no-ops). `transferToImageBitmap` returns a correctly-sized `ImageBitmap`.
- **SVG**: Tree-based DOM with `createElement`/`append`/`remove`, attribute system, and `render()` producing `<?xml?>`-wrapped SVG string output.

## Test Results

```
✓ tests/graphics.test.ts (119 tests)
Test Files  1 passed (1)
     Tests  119 passed (119)
```

| Module | Tests | Key Coverage |
|--------|-------|--------------|
| CanvasElement | 16 | resize, getContext('2d'), fillRect, save/restore, transforms, drawImage, toDataURL/toBlob, events, dispose |
| SVGDocument | 12 | tree construction, element creation, append/remove, attributes, getBBox, render XML output, viewBox |
| createSVGElement | 1 | standalone element factory |
| elementToSVGString | 2 | flat and nested serialization |
| WebGLRenderingContext | 25 | canvas ref, getParameter, extensions, buffer/texture/program/shader creation, compile/link success/fail, useProgram, attrib/uniform locations, clearColor, viewport, drawArrays/Elements, getError, enable/disable, uniforms |
| WebGL2RenderingContext | 17 | VAO, sampler, TFO, query lifecycle, instanced drawing, texStorage2D, blitFramebuffer, getInternalformatParameter, dispose |
| GPUCanvasContext | 5 | construct (with/without canvas), configure, events, dispose |
| GPUDevice | 20 | adapter ref, createBuffer/Texture/Sampler/ShaderModule/BindGroupLayout/BindGroup/PipelineLayout/RenderPipeline/ComputePipeline/CommandEncoder, render/compute passes, queue submit/writeBuffer, querySet, copyBufferToBuffer, events, destroy |
| requestAdapter | 2 | adapter resolution, requestDevice |
| OffscreenCanvas | 16 | size clamping/flooring, getContext('2d'), context state, save/restore, getImageData, transferToImageBitmap, convertToBlob, events, dispose |

## Bug Fixes

### 1. SVG `element` reference error
**File:** `src/browser/media/svg.ts:52`
**Problem:** `append()` referenced `element` (undefined), causing `ReferenceError` — the object literal couldn't reference itself during construction.
**Fix:** Changed to use a variable `const self: SVGElement = { ... }` and referenced `self` inside `append`/`remove`.

### 2. Canvas drawImage test source
**File:** `tests/graphics.test.ts` 
**Problem:** Passing `CanvasElement` (cast as `any`) to `drawImage` caused `TypeError` because it was passed as an `any` type but `data` was undefined. The existing `CanvasRenderingContext2D.drawImage` expects `CanvasImageSource` with `width`, `height`, and `data` properties.
**Fix:** Changed test to pass an object literal with `width: 50, height: 50, data: new Uint8ClampedArray(10000)`.

## Verification Steps

1. `npx vitest run tests/graphics.test.ts` — 119/119 pass
2. `npx vitest run tests/media.test.ts` — 103/103 pass (regression check against barrel file changes)
