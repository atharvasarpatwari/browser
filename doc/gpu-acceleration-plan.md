# GPU Acceleration Plan for Nova Browser

**Date:** 2026-07-19
**Session:** GPU Acceleration Design
**Status:** Planned

---

## Summary

Implement optional GPU-accelerated rasterization using WebGPU (Dawn bindings) to improve rendering FPS from ~23 FPS to 60+ FPS at full HD resolution. The GPU rasterizer will replace the CPU-bound software rasterizer for pixel operations while maintaining the existing PaintCommand interface.

---

## Problem Analysis

### Current Bottleneck

The software rasterizer (`src/browser/rendering/rasterizer.ts`) processes all paint commands using per-pixel CPU loops:

- **1920x1080 resolution**: 8.3 million pixels per frame
- **fillRectRaw()**: Nested row/column loops writing RGBA values
- **setPixelRaw()**: Per-pixel alpha compositing with division operations
- **fillText()**: 8x8 bitmap font rendered per-pixel
- **drawImage()**: Nearest-neighbor scaling with per-pixel compositing

### Performance Data

| Benchmark | Resolution | Commands | Mean (ms) | FPS |
|-----------|-----------|----------|-----------|-----|
| Rasterize 1920x1080 | Full HD | 100 cmds | 12.97 | 77.1 |
| Pipeline (200 items) | Full HD | 200+ | 43.45 | **23.0** |

The pipeline benchmark shows 23 FPS at 200 elements, well below the 60 FPS target.

---

## Solution Architecture

### GPU Rasterizer Overview

```
PaintCommand[] (CPU)
    ↓
GPU Rasterizer (WebGPU compute shaders)
    ↓
GPU Texture/Buffer (RGBA pixels)
    ↓
GPU-to-CPU Readback (async buffer copy)
    ↓
ImageData (CPU, ready for display)
```

### Key Components

1. **WebGPU Device Manager** - Initializes and manages GPU device lifecycle
2. **GPU Rasterizer** - Implements same interface as software `Rasterizer`
3. **WGSL Compute Shaders** - GPU kernels for fill, composite, and text operations
4. **Buffer Pool** - Manages GPU buffer reuse for performance
5. **Fallback Handler** - Falls back to software rasterizer if GPU unavailable

---

## Implementation Plan

### Phase 1: WebGPU Infrastructure

**Files to Create:**
- `src/browser/rendering/gpu/device-manager.ts` - WebGPU device initialization
- `src/browser/rendering/gpu/shader-modules.ts` - WGSL shader compilation
- `src/browser/rendering/gpu/buffer-pool.ts` - GPU buffer management

**Files to Modify:**
- `package.json` - Add `webgpu` dependency (Dawn bindings)

**Implementation Details:**

```typescript
// device-manager.ts
export class GpuDeviceManager {
  private device: GPUDevice | null = null;
  
  async initialize(): Promise<boolean> {
    // Check for WebGPU support
    if (!navigator.gpu) return false;
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    
    this.device = await adapter.requestDevice();
    return true;
  }
  
  getDevice(): GPUDevice | null {
    return this.device;
  }
}
```

**Buffer Pool Strategy:**
- Pre-allocate buffers for common sizes (1920x1080, 1280x720, etc.)
- Reuse buffers across frames to avoid allocation overhead
- Track buffer usage with reference counting

### Phase 2: Core GPU Rasterizer

**Files to Create:**
- `src/browser/rendering/gpu/gpu-rasterizer.ts` - Main GPU rasterizer class
- `src/browser/rendering/gpu/compute-ops.ts` - Compute shader operations

**Interface:**

```typescript
export class GpuRasterizer {
  private device: GPUDevice;
  private bufferPool: BufferPool;
  private shaderModules: Map<string, GPUShaderModule>;
  
  constructor(config: RasterConfig, device: GPUDevice);
  
  // Same interface as software Rasterizer
  rasterize(commands: readonly PaintCommand[]): ImageData;
  getImageData(): ImageData;
  getPixels(): Uint8ClampedArray;
  
  // GPU-specific methods
  resize(width: number, height: number): void;
  destroy(): void;
}
```

### Phase 3: WGSL Compute Shaders

**Files to Create:**
- `src/browser/rendering/gpu/shaders/fill-rect.wgsl`
- `src/browser/rendering/gpu/shaders/composite.wgsl`
- `src/browser/rendering/gpu/shaders/draw-text.wgsl`
- `src/browser/rendering/gpu/shaders/draw-image.wgsl`

**Shader Examples:**

```wgsl
// fill-rect.wgsl
@group(0) @binding(0) var<storage, read_write> pixels: array<u32>;
@group(0) @binding(1) var<uniform> rect: vec4<f32>; // x, y, w, h
@group(0) @binding(2) var<uniform> color: vec4<f32>; // r, g, b, a

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;
  
  if (x >= u32(rect.z) || y >= u32(rect.w)) {
    return;
  }
  
  let px = u32(rect.x) + x;
  let py = u32(rect.y) + y;
  let idx = py * 1920u + px; // Assume 1920 width
  
  // Pack RGBA into single u32
  let r = u32(color.r * 255.0);
  let g = u32(color.g * 255.0);
  let b = u32(color.b * 255.0);
  let a = u32(color.a * 255.0);
  pixels[idx] = (a << 24u) | (b << 16u) | (g << 8u) | r;
}
```

### Phase 4: GPU-to-CPU Readback

**Implementation Pattern:**

```typescript
async readBackPixels(): Promise<ImageData> {
  // Create staging buffer for readback
  const stagingBuffer = this.device.createBuffer({
    size: this.pixelBuffer.size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  
  // Copy GPU buffer to staging buffer
  const encoder = this.device.createCommandEncoder();
  encoder.copyBufferToBuffer(
    this.pixelBuffer, 0,
    stagingBuffer, 0,
    this.pixelBuffer.size
  );
  this.device.queue.submit([encoder.finish()]);
  
  // Map staging buffer (async)
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const data = new Uint8Array(stagingBuffer.getMappedRange().slice(0));
  stagingBuffer.unmap();
  stagingBuffer.destroy();
  
  return new ImageData(data, this.width, this.height);
}
```

### Phase 5: Integration with PaintEngine

**Files to Modify:**
- `src/browser/rendering/paint-engine.ts` - Use GPU rasterizer when enabled
- `src/browser/rendering/reflow-repaint-controller.ts` - Initialize GPU context
- `config/app.config.json` - Update `hardwareAcceleration` documentation

**Integration Code:**

```typescript
// paint-engine.ts
class PaintEngine implements IPaintEngine {
  private rasterizer: Rasterizer | GpuRasterizer;
  
  constructor(config?: Partial<PaintConfig>) {
    // ... existing code ...
    
    if (this.config.hardwareAcceleration && gpuDeviceManager.isAvailable()) {
      this.rasterizer = new GpuRasterizer(this.config, gpuDeviceManager.getDevice()!);
    } else {
      this.rasterizer = new Rasterizer(this.config);
    }
  }
  
  rasterize(): ImageData {
    return this.rasterizer.rasterize(this.compositeFrame());
  }
}
```

### Phase 6: Fallback and Error Handling

**Fallback Strategy:**

```typescript
// gpu-rasterizer.ts
export class GpuRasterizer {
  private softwareFallback: Rasterizer;
  private gpuAvailable = false;
  
  constructor(config: RasterConfig, device: GPUDevice | null) {
    this.softwareFallback = new Rasterizer(config);
    
    if (device) {
      this.device = device;
      this.gpuAvailable = true;
      this.initializeGpuResources(config);
    }
  }
  
  rasterize(commands: readonly PaintCommand[]): ImageData {
    if (!this.gpuAvailable) {
      return this.softwareFallback.rasterize(commands);
    }
    
    try {
      return this.gpuRasterize(commands);
    } catch (error) {
      console.warn('GPU rasterization failed, falling back to software:', error);
      this.gpuAvailable = false;
      return this.softwareFallback.rasterize(commands);
    }
  }
}
```

---

## Performance Expectations

### Target Metrics

| Metric | Current (CPU) | Target (GPU) | Improvement |
|--------|---------------|--------------|-------------|
| Rasterize 1920x1080 | 12.97ms | <2ms | 6-8x |
| Pipeline (200 items) | 43.45ms | <10ms | 4-5x |
| FPS (200 elements) | 23 FPS | 60+ FPS | 2.6x |

### GPU vs CPU Advantages

1. **Parallelism**: Thousands of GPU cores vs single CPU thread
2. **Memory Bandwidth**: GPU memory bandwidth is 10-20x higher than CPU
3. **Alpha Compositing**: GPU hardware-accelerated blending units
4. **Texture Sampling**: Hardware bilinear/trilinear filtering for images

---

## Configuration

### Config File

```json
{
  "hardwareAcceleration": true,
  "gpuAcceleration": {
    "enabled": true,
    "preferredBackend": "auto",
    "maxBufferSize": "256MB",
    "enableDebug": false
  }
}
```

### Backend Options

- `auto` - Try Dawn first, fall back to software
- `dawn` - Use Google Dawn backend
- `software` - Force software rendering

---

## Testing Strategy

### Unit Tests

- GPU rasterizer produces identical output to software rasterizer
- Fallback works correctly when GPU unavailable
- Buffer pool reuse works correctly
- Async readback returns correct pixel data

### Performance Tests

- Benchmark GPU vs CPU rasterization at various resolutions
- Measure frame time consistency (jitter)
- Test memory usage with buffer pool

### Integration Tests

- Full pipeline test with GPU acceleration enabled
- Test with various PaintCommand combinations
- Verify ImageData correctness for complex pages

---

## Risk Assessment

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Dawn binary size (50-150MB) | High | Consider wgpu alternative (2-5MB) |
| Async readback latency | Medium | Implement double-buffering |
| GPU driver compatibility | Medium | Extensive fallback testing |
| Buffer alignment requirements | Low | Handle 256-byte row padding |

### Mitigation Strategies

1. **Lazy Loading**: Only initialize GPU when `hardwareAcceleration: true`
2. **Graceful Degradation**: Always fall back to software rasterizer
3. **Buffer Pooling**: Reuse GPU buffers to minimize allocation overhead
4. **Double Buffering**: Use two pixel buffers to hide readback latency

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/browser/rendering/gpu/device-manager.ts` | WebGPU device lifecycle |
| `src/browser/rendering/gpu/gpu-rasterizer.ts` | GPU-accelerated rasterizer |
| `src/browser/rendering/gpu/buffer-pool.ts` | GPU buffer management |
| `src/browser/rendering/gpu/shader-modules.ts` | WGSL shader compilation |
| `src/browser/rendering/gpu/compute-ops.ts` | Compute shader operations |
| `src/browser/rendering/gpu/shaders/fill-rect.wgsl` | Fill rectangle shader |
| `src/browser/rendering/gpu/shaders/composite.wgsl` | Alpha compositing shader |
| `src/browser/rendering/gpu/shaders/draw-text.wgsl` | Text rendering shader |
| `src/browser/rendering/gpu/shaders/draw-image.wgsl` | Image rendering shader |
| `tests/browser/rendering/gpu-rasterizer.test.ts` | GPU rasterizer tests |

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `webgpu` dependency |
| `config/app.config.json` | Update `hardwareAcceleration` docs |
| `src/browser/rendering/paint-engine.ts` | Use GPU rasterizer when enabled |
| `src/browser/rendering/reflow-repaint-controller.ts` | Initialize GPU context |
| `src/benchmark/suites/paint-raster.ts` | Add GPU vs CPU benchmarks |

---

## Test Results

```
<test output placeholder>
```

---

## Verification Steps

1. Install `webgpu` dependency and verify Dawn initialization
2. Implement basic fillRect GPU shader and verify output matches CPU
3. Add alpha compositing shader and test transparency
4. Implement text rendering and verify bitmap output
5. Add image rendering with texture sampling
6. Integrate with PaintEngine and run full pipeline tests
7. Run performance benchmarks and verify 60+ FPS target
8. Test fallback behavior with GPU disabled
