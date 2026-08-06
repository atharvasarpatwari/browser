import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GpuDeviceManager,
  getGpuDeviceManager,
  resetGpuDeviceManager,
  BufferPool,
  ShaderModules,
  ComputeOps,
  GpuRasterizer,
  GPU_BUFFER_ALIGNMENT,
  GPU_WORKGROUP_SIZE,
  GPU_MAX_BUFFER_SIZE,
} from '../../../src/browser/rendering/gpu';
import { PaintEngine } from '../../../src/browser/rendering/paint-engine';

// ─────────────────────────────────────────────────────────────────────────────
// MOCKS
// ─────────────────────────────────────────────────────────────────────────────

function createMockGPUDevice(): any {
  const buffers = new Map<number, any>();
  let bufferId = 0;

  return {
    createBuffer: vi.fn((desc: any) => {
      const id = ++bufferId;
      const buffer = {
        id,
        size: desc.size,
        usage: desc.usage,
        destroy: vi.fn(),
        mapAsync: vi.fn().mockResolvedValue(undefined),
        getMappedRange: vi.fn(() => new ArrayBuffer(desc.size)),
        unmap: vi.fn(),
      };
      buffers.set(id, buffer);
      return buffer;
    }),
    createShaderModule: vi.fn((desc: any) => ({
      code: desc.code,
      label: desc.label,
      getCompilationInfo: vi.fn().mockResolvedValue({ messages: [] }),
    })),
    createComputePipeline: vi.fn((desc: any) => ({
      getBindGroupLayout: vi.fn(() => ({
        entries: [],
      })),
    })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      })),
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
    queue: {
      submit: vi.fn(),
      writeBuffer: vi.fn(),
      onSubmittedWorkDone: vi.fn().mockResolvedValue(undefined),
    },
    destroy: vi.fn(),
    lost: Promise.resolve({ reason: 'destroyed', message: 'test' }),
  };
}

function createMockGPUAdapter(): any {
  return {
    info: { description: 'Test GPU Adapter' },
    limits: {
      maxBufferSize: GPU_MAX_BUFFER_SIZE,
      maxStorageBufferBindingSize: GPU_MAX_BUFFER_SIZE,
      maxTextureDimension2D: 8192,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupsPerDimension: 65535,
      maxStorageBuffersPerShaderStage: 8,
      maxStorageTexturesPerShaderStage: 4,
      maxBindingsPerBindGroup: 64,
    },
    requestDevice: vi.fn().mockResolvedValue(createMockGPUDevice()),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE MANAGER TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('GpuDeviceManager', () => {
  let manager: GpuDeviceManager;

  beforeEach(() => {
    resetGpuDeviceManager();
    manager = new GpuDeviceManager();
  });

  afterEach(() => {
    manager.dispose();
    resetGpuDeviceManager();
  });

  it('should report unavailable when no WebGPU support', async () => {
    // navigator.gpu is undefined in Node.js test environment
    const available = await manager.initialize();
    expect(available).toBe(false);
    expect(manager.isAvailable()).toBe(false);
    expect(manager.getDevice()).toBeNull();
  });

  it('should return null device before initialization', () => {
    expect(manager.getDevice()).toBeNull();
    expect(manager.getAdapter()).toBeNull();
    expect(manager.getCapabilities()).toBeNull();
  });

  it('should return correct state when unavailable', () => {
    const state = manager.getState();
    expect(state.isAvailable).toBe(false);
    expect(state.adapterName).toBe('unknown');
    expect(state.capabilities).toBeNull();
    expect(state.device).toBeNull();
  });

  it('should handle dispose correctly', () => {
    manager.dispose();
    expect(manager.isAvailable()).toBe(false);
  });

  it('should not initialize after dispose', async () => {
    manager.dispose();
    const available = await manager.initialize();
    expect(available).toBe(false);
  });

  it('should handle recovery attempt', async () => {
    const recovered = await manager.recover();
    expect(recovered).toBe(false);
  });

  it('should handle device lost callback', () => {
    const handler = vi.fn();
    manager.onDeviceLost(handler);
    // Callback is stored but not called without actual device
    expect(handler).not.toHaveBeenCalled();
  });

  it('should return null for command encoder when no device', () => {
    const encoder = manager.createCommandEncoder();
    expect(encoder).toBeNull();
  });
});

describe('GpuDeviceManager singleton', () => {
  beforeEach(() => {
    resetGpuDeviceManager();
  });

  afterEach(() => {
    resetGpuDeviceManager();
  });

  it('should return same instance from getGpuDeviceManager', () => {
    const manager1 = getGpuDeviceManager();
    const manager2 = getGpuDeviceManager();
    expect(manager1).toBe(manager2);
  });

  it('should reset singleton', () => {
    const manager1 = getGpuDeviceManager();
    resetGpuDeviceManager();
    const manager2 = getGpuDeviceManager();
    expect(manager1).not.toBe(manager2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUFFER POOL TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('BufferPool', () => {
  let mockDevice: any;
  let pool: BufferPool;

  beforeEach(() => {
    mockDevice = createMockGPUDevice();
    pool = new BufferPool(mockDevice);
  });

  afterEach(() => {
    pool.dispose();
  });

  it('should allocate a new buffer', () => {
    const entry = pool.acquire(1024, GPUBufferUsage.STORAGE);
    expect(entry).toBeDefined();
    expect(entry.buffer).toBeDefined();
    expect(entry.size).toBe(1024); // Already aligned to 256
    expect(entry.refCount).toBe(1);
  });

  it('should align buffer sizes', () => {
    const entry1 = pool.acquire(100, GPUBufferUsage.STORAGE);
    expect(entry1.size).toBe(GPU_BUFFER_ALIGNMENT); // 100 -> 256

    const entry2 = pool.acquire(300, GPUBufferUsage.STORAGE);
    expect(entry2.size).toBe(GPU_BUFFER_ALIGNMENT * 2); // 300 -> 512

    const entry3 = pool.acquire(256, GPUBufferUsage.STORAGE);
    expect(entry3.size).toBe(GPU_BUFFER_ALIGNMENT); // 256 -> 256

    const entry4 = pool.acquire(1024, GPUBufferUsage.STORAGE);
    expect(entry4.size).toBe(1024); // 1024 is already aligned
  });

  it('should track reference counts', () => {
    const entry = pool.acquire(1024, GPUBufferUsage.STORAGE);
    expect(entry.refCount).toBe(1);

    pool.release(entry);
    expect(entry.refCount).toBe(0);
  });

  it('should return buffer to pool after release', () => {
    const entry = pool.acquire(1024, GPUBufferUsage.STORAGE);
    pool.release(entry);

    const stats = pool.getStats();
    expect(stats.activeBuffers).toBe(0);
    expect(stats.pooledBuffers).toBe(1);
  });

  it('should reuse pooled buffers', () => {
    const entry1 = pool.acquire(1024, GPUBufferUsage.STORAGE);
    pool.release(entry1);

    const entry2 = pool.acquire(1024, GPUBufferUsage.STORAGE);
    expect(entry2).toBe(entry1); // Same buffer reused

    const stats = pool.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('should not reuse buffer with incompatible usage', () => {
    const entry1 = pool.acquire(1024, GPUBufferUsage.STORAGE);
    pool.release(entry1);

    // Different usage flags
    const entry2 = pool.acquire(1024, GPUBufferUsage.UNIFORM);
    expect(entry2).not.toBe(entry1); // New buffer allocated

    const stats = pool.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(2);
  });

  it('should create staging buffer with correct usage', () => {
    const staging = pool.acquireStagingBuffer(1024);
    expect(staging).toBeDefined();
    expect(staging.usage).toBe(GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
  });

  it('should destroy staging buffer', () => {
    const staging = pool.acquireStagingBuffer(1024);
    pool.destroyStagingBuffer(staging);
    expect(staging.destroy).toHaveBeenCalled();
  });

  it('should clean up expired buffers', () => {
    const entry = pool.acquire(1024, GPUBufferUsage.STORAGE);
    pool.release(entry);

    // Mock lastUsed to be old
    entry.lastUsed = Date.now() - 10000;

    pool.cleanup();

    const stats = pool.getStats();
    expect(stats.pooledBuffers).toBe(0);
  });

  it('should dispose all buffers', () => {
    const entry1 = pool.acquire(1024, GPUBufferUsage.STORAGE);
    const entry2 = pool.acquire(2048, GPUBufferUsage.STORAGE);
    pool.release(entry1);
    pool.release(entry2);

    pool.dispose();

    const stats = pool.getStats();
    expect(stats.totalBuffers).toBe(0);
    expect(stats.totalAllocatedBytes).toBe(0);
  });

  it('should report accurate stats', () => {
    const entry1 = pool.acquire(1024, GPUBufferUsage.STORAGE);
    const entry2 = pool.acquire(2048, GPUBufferUsage.STORAGE);

    const stats = pool.getStats();
    expect(stats.activeBuffers).toBe(2);
    expect(stats.totalAllocatedBytes).toBe(1024 + 2048);

    pool.release(entry1);
    pool.release(entry2);

    const statsAfter = pool.getStats();
    expect(statsAfter.activeBuffers).toBe(0);
    expect(statsAfter.pooledBuffers).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHADER MODULES TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('ShaderModules', () => {
  let mockDevice: any;
  let shaders: ShaderModules;

  beforeEach(() => {
    mockDevice = createMockGPUDevice();
    shaders = new ShaderModules(mockDevice);
  });

  it('should create a shader module', () => {
    const code = `
      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        // noop
      }
    `;
    const module = shaders.getOrCreate(code, 'test');
    expect(module).toBeDefined();
    expect(module.module).toBeDefined();
    expect(module.entryPoints).toEqual(['main']);
  });

  it('should cache shader modules', () => {
    const code = `
      @compute @workgroup_size(8, 8)
      fn main() {}
    `;
    const module1 = shaders.getOrCreate(code);
    const module2 = shaders.getOrCreate(code);
    expect(module1).toBe(module2);
    expect(shaders.size()).toBe(1);
  });

  it('should detect different shaders', () => {
    const code1 = `fn main() {}`;
    const code2 = `fn other() {}`;
    shaders.getOrCreate(code1);
    shaders.getOrCreate(code2);
    expect(shaders.size()).toBe(2);
  });

  it('should check if shader is cached', () => {
    const code = `fn main() {}`;
    expect(shaders.has(code)).toBe(false);
    shaders.getOrCreate(code);
    expect(shaders.has(code)).toBe(true);
  });

  it('should clear cache', () => {
    shaders.getOrCreate(`fn a() {}`);
    shaders.getOrCreate(`fn b() {}`);
    expect(shaders.size()).toBe(2);
    shaders.clear();
    expect(shaders.size()).toBe(0);
  });

  it('should extract multiple entry points', () => {
    const code = `
      @compute @workgroup_size(8, 8)
      fn computeMain() {}

      @vertex
      fn vertexMain() {}

      @fragment
      fn fragmentMain() {}
    `;
    const module = shaders.getOrCreate(code);
    expect(module.entryPoints).toContain('computeMain');
    expect(module.entryPoints).toContain('vertexMain');
    expect(module.entryPoints).toContain('fragmentMain');
  });

  it('should return built-in fill-rect shader', () => {
    const shader = shaders.getFillRectShader();
    expect(shader).toBeDefined();
    expect(shader.entryPoints).toContain('main');
  });

  it('should return built-in clear-rect shader', () => {
    const shader = shaders.getClearRectShader();
    expect(shader).toBeDefined();
    expect(shader.entryPoints).toContain('main');
  });

  it('should return built-in composite shader', () => {
    const shader = shaders.getCompositeShader();
    expect(shader).toBeDefined();
    expect(shader.entryPoints).toContain('main');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE OPS TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('ComputeOps', () => {
  let mockDevice: any;
  let bufferPool: BufferPool;
  let shaders: ShaderModules;
  let computeOps: ComputeOps;

  beforeEach(() => {
    mockDevice = createMockGPUDevice();
    bufferPool = new BufferPool(mockDevice);
    shaders = new ShaderModules(mockDevice);
    computeOps = new ComputeOps(mockDevice, bufferPool, shaders);
  });

  afterEach(() => {
    computeOps.dispose();
    bufferPool.dispose();
  });

  it('should fill rect', () => {
    const pixelBuffer = bufferPool.acquire(1920 * 1080 * 4, GPUBufferUsage.STORAGE);
    const encoder = mockDevice.createCommandEncoder();

    computeOps.fillRect(
      pixelBuffer.buffer,
      0, 0, 100, 100,
      { r: 255, g: 0, b: 0, a: 1 },
      1920, 1080,
      encoder,
    );

    expect(encoder.beginComputePass).toHaveBeenCalled();
    // ComputeOps records commands into encoder; queue.submit is caller's responsibility
  });

  it('should clear rect', () => {
    const pixelBuffer = bufferPool.acquire(1920 * 1080 * 4, GPUBufferUsage.STORAGE);
    const encoder = mockDevice.createCommandEncoder();

    computeOps.clearRect(
      pixelBuffer.buffer,
      0, 0, 100, 100,
      1920, 1080,
      encoder,
    );

    expect(encoder.beginComputePass).toHaveBeenCalled();
  });

  it('should composite', () => {
    const dstBuffer = bufferPool.acquire(1920 * 1080 * 4, GPUBufferUsage.STORAGE);
    const srcBuffer = bufferPool.acquire(1920 * 1080 * 4, GPUBufferUsage.STORAGE);
    const encoder = mockDevice.createCommandEncoder();

    computeOps.composite(
      dstBuffer.buffer,
      srcBuffer.buffer,
      1920, 1080,
      encoder,
    );

    expect(encoder.beginComputePass).toHaveBeenCalled();
  });

  it('should dispose cleanly', () => {
    computeOps.dispose();
    // Should not throw
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GPU RASTERIZER TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('GpuRasterizer', () => {
  it('should create with software fallback', () => {
    const rasterizer = new GpuRasterizer({
      width: 800,
      height: 600,
      backgroundColor: '#ffffff',
    });

    expect(rasterizer.width).toBe(800);
    expect(rasterizer.height).toBe(600);
    expect(rasterizer.isGpuActive()).toBe(false); // No GPU in test env
  });

  it('should rasterize using software fallback', () => {
    const rasterizer = new GpuRasterizer({
      width: 100,
      height: 100,
      backgroundColor: '#ffffff',
    });

    const commands = [
      { type: 'setFillStyle' as const, params: ['#ff0000'] },
      { type: 'fillRect' as const, params: [10, 10, 50, 50] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(100);
    expect(imageData.height).toBe(100);
  });

  it('should get image data', () => {
    const rasterizer = new GpuRasterizer({
      width: 100,
      height: 100,
    });

    const imageData = rasterizer.getImageData();
    expect(imageData.width).toBe(100);
    expect(imageData.height).toBe(100);
  });

  it('should get pixels', () => {
    const rasterizer = new GpuRasterizer({
      width: 100,
      height: 100,
    });

    const pixels = rasterizer.getPixels();
    expect(pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(pixels.length).toBe(100 * 100 * 4);
  });

  it('should handle save/restore state', () => {
    const rasterizer = new GpuRasterizer({
      width: 100,
      height: 100,
    });

    const commands = [
      { type: 'setFillStyle' as const, params: ['#ff0000'] },
      { type: 'save' as const, params: [] },
      { type: 'setFillStyle' as const, params: ['#00ff00'] },
      { type: 'restore' as const, params: [] },
      { type: 'fillRect' as const, params: [0, 0, 100, 100] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
  });

  it('should handle clearRect', () => {
    const rasterizer = new GpuRasterizer({
      width: 100,
      height: 100,
      backgroundColor: '#ff0000',
    });

    const commands = [
      { type: 'clearRect' as const, params: [0, 0, 50, 50] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
  });

  it('should dispose cleanly', () => {
    const rasterizer = new GpuRasterizer({
      width: 100,
      height: 100,
    });

    rasterizer.dispose();
    // Should not throw
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('GPU Constants', () => {
  it('should have correct buffer alignment', () => {
    expect(GPU_BUFFER_ALIGNMENT).toBe(256);
  });

  it('should have correct workgroup size', () => {
    expect(GPU_WORKGROUP_SIZE).toBe(8);
  });

  it('should have reasonable max buffer size', () => {
    expect(GPU_MAX_BUFFER_SIZE).toBe(256 * 1024 * 1024); // 256 MB
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHADER MODULES — NEW SHADERS TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('ShaderModules — drawImage and fillText', () => {
  let mockDevice: any;
  let shaders: ShaderModules;

  beforeEach(() => {
    mockDevice = createMockGPUDevice();
    shaders = new ShaderModules(mockDevice);
  });

  it('should create drawImage shader', () => {
    const shader = shaders.getDrawImageShader();
    expect(shader).toBeDefined();
    expect(shader.entryPoints).toContain('main');
    expect(shader.code).toContain('Draw Image Compute Shader');
  });

  it('should create fillText shader', () => {
    const shader = shaders.getFillTextShader();
    expect(shader).toBeDefined();
    expect(shader.entryPoints).toContain('main');
    expect(shader.code).toContain('Fill Text Compute Shader');
  });

  it('should cache drawImage shader', () => {
    const s1 = shaders.getDrawImageShader();
    const s2 = shaders.getDrawImageShader();
    expect(s1).toBe(s2);
  });

  it('should cache fillText shader', () => {
    const s1 = shaders.getFillTextShader();
    const s2 = shaders.getFillTextShader();
    expect(s1).toBe(s2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE OPS — NEW OPERATIONS TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('ComputeOps — drawImage and fillText', () => {
  let mockDevice: any;
  let bufferPool: BufferPool;
  let shaders: ShaderModules;
  let computeOps: ComputeOps;

  beforeEach(() => {
    mockDevice = createMockGPUDevice();
    bufferPool = new BufferPool(mockDevice);
    shaders = new ShaderModules(mockDevice);
    computeOps = new ComputeOps(mockDevice, bufferPool, shaders);
  });

  afterEach(() => {
    computeOps.dispose();
    bufferPool.dispose();
  });

  it('should draw image', () => {
    const pixelBuffer = bufferPool.acquire(100 * 100 * 4, GPUBufferUsage.STORAGE);
    const imageBuffer = bufferPool.acquire(50 * 50 * 4, GPUBufferUsage.STORAGE);
    const encoder = mockDevice.createCommandEncoder();

    computeOps.drawImage(
      pixelBuffer.buffer, imageBuffer.buffer,
      50, 50, // src size
      10, 10, 80, 80, // dst rect
      1.0, // globalAlpha
      100, 100, // viewport
      encoder,
    );

    expect(encoder.beginComputePass).toHaveBeenCalled();
  });

  it('should fill text', () => {
    const pixelBuffer = bufferPool.acquire(100 * 100 * 4, GPUBufferUsage.STORAGE);
    const charBuffer = bufferPool.acquire(5 * 4, GPUBufferUsage.STORAGE); // 5 chars
    const encoder = mockDevice.createCommandEncoder();

    computeOps.fillText(
      pixelBuffer.buffer, charBuffer.buffer, 5,
      10, 20, // position
      16, // fontSize
      0, // textAlign
      { r: 0, g: 0, b: 0, a: 1 }, // color
      1.0, // globalAlpha
      100, 100, // viewport
      encoder,
    );

    expect(encoder.beginComputePass).toHaveBeenCalled();
  });

  it('should defer uniform buffer destruction until after submit', async () => {
    const pixelBuffer = bufferPool.acquire(100 * 100 * 4, GPUBufferUsage.STORAGE);
    const encoder = mockDevice.createCommandEncoder();

    computeOps.fillRect(
      pixelBuffer.buffer, 0, 0, 10, 10,
      { r: 255, g: 0, b: 0, a: 1 },
      100, 100, encoder,
    );

    // Uniform buffer must NOT be destroyed while its work is un-submitted.
    const uniformBuffers = (mockDevice.createBuffer.mock.results as any[])
      .map((r: any) => r.value)
      .filter((b: any) => b.usage & GPUBufferUsage.UNIFORM);
    expect(uniformBuffers.length).toBeGreaterThan(0);
    for (const b of uniformBuffers) {
      expect(b.destroy.mock.calls.length).toBe(0);
    }

    // takePendingDestroy hands the buffers to the submit site; they remain
    // alive through submit and are destroyed only after work-done resolves.
    const pending = computeOps.takePendingDestroy();
    expect(pending.length).toBe(uniformBuffers.length);
    mockDevice.queue.submit([encoder.finish()]);
    await mockDevice.queue.onSubmittedWorkDone();

    for (const b of pending) {
      b.destroy();
    }
    for (const b of pending) {
      expect((b.destroy as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GPU RASTERIZER — FULL COMMAND TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('GpuRasterizer — full command support', () => {
  it('should handle strokeRect', () => {
    const rasterizer = new GpuRasterizer({
      width: 100, height: 100, backgroundColor: '#ffffff',
    });

    const commands = [
      { type: 'setStrokeStyle' as const, params: ['#000000'] },
      { type: 'setLineWidth' as const, params: [2] },
      { type: 'strokeRect' as const, params: [10, 10, 80, 80] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(100);
  });

  it('should handle fillText', () => {
    const rasterizer = new GpuRasterizer({
      width: 200, height: 50, backgroundColor: '#ffffff',
    });

    const commands = [
      { type: 'setFillStyle' as const, params: ['#000000'] },
      { type: 'setFont' as const, params: ['16px monospace'] },
      { type: 'fillText' as const, params: ['Hello', 10, 30] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(200);
  });

  it('should handle strokeText', () => {
    const rasterizer = new GpuRasterizer({
      width: 200, height: 50, backgroundColor: '#ffffff',
    });

    const commands = [
      { type: 'setStrokeStyle' as const, params: ['#000000'] },
      { type: 'setFont' as const, params: ['16px monospace'] },
      { type: 'strokeText' as const, params: ['World', 10, 30] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
  });

  it('should handle drawImage', () => {
    const rasterizer = new GpuRasterizer({
      width: 100, height: 100, backgroundColor: '#ffffff',
    });

    // Create a small source image (4x4 red pixels)
    const imgData = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 4 * 4; i++) {
      imgData[i * 4] = 255;     // R
      imgData[i * 4 + 1] = 0;   // G
      imgData[i * 4 + 2] = 0;   // B
      imgData[i * 4 + 3] = 255; // A
    }

    const commands = [
      { type: 'drawImage' as const, params: [{ data: imgData, width: 4, height: 4 }, 10, 10, 20, 20] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(100);
  });

  it('should handle setGlobalAlpha', () => {
    const rasterizer = new GpuRasterizer({
      width: 100, height: 100, backgroundColor: '#ffffff',
    });

    const commands = [
      { type: 'setGlobalAlpha' as const, params: [0.5] },
      { type: 'setFillStyle' as const, params: ['#ff0000'] },
      { type: 'fillRect' as const, params: [0, 0, 100, 100] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
  });

  it('should handle setTextAlign', () => {
    const rasterizer = new GpuRasterizer({
      width: 200, height: 50, backgroundColor: '#ffffff',
    });

    const commands = [
      { type: 'setTextAlign' as const, params: ['center'] },
      { type: 'setFillStyle' as const, params: ['#000000'] },
      { type: 'setFont' as const, params: ['12px monospace'] },
      { type: 'fillText' as const, params: ['Centered', 100, 30] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
  });

  it('should handle mixed GPU and state commands', () => {
    const rasterizer = new GpuRasterizer({
      width: 100, height: 100, backgroundColor: '#ffffff',
    });

    const commands = [
      { type: 'setFillStyle' as const, params: ['#ff0000'] },
      { type: 'fillRect' as const, params: [0, 0, 50, 50] },
      { type: 'setFillStyle' as const, params: ['#00ff00'] },
      { type: 'fillRect' as const, params: [50, 0, 50, 50] },
      { type: 'setFillStyle' as const, params: ['#0000ff'] },
      { type: 'fillRect' as const, params: [0, 50, 100, 50] },
      { type: 'save' as const, params: [] },
      { type: 'setGlobalAlpha' as const, params: [0.5] },
      { type: 'setFillStyle' as const, params: ['#ffff00'] },
      { type: 'fillRect' as const, params: [25, 25, 50, 50] },
      { type: 'restore' as const, params: [] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAINT ENGINE INTEGRATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('PaintEngine — hardwareAcceleration config', () => {
  it('should accept hardwareAcceleration in config', () => {
    const engine = new PaintEngine({
      width: 100, height: 100,
      hardwareAcceleration: true,
    });

    const config = engine.getConfig();
    expect(config.hardwareAcceleration).toBe(true);
    engine.dispose();
  });

  it('should default hardwareAcceleration to false', () => {
    const engine = new PaintEngine({
      width: 100, height: 100,
    });

    const config = engine.getConfig();
    expect(config.hardwareAcceleration).toBe(false);
    engine.dispose();
  });

  it('should update hardwareAcceleration via updateConfig', () => {
    const engine = new PaintEngine({
      width: 100, height: 100,
    });

    expect(engine.getConfig().hardwareAcceleration).toBe(false);

    engine.updateConfig({ hardwareAcceleration: true });
    expect(engine.getConfig().hardwareAcceleration).toBe(true);
    engine.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC RASTERIZE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('GpuRasterizer — async rasterize', () => {
  it('should support rasterizeAsync returning ImageData', async () => {
    const rasterizer = new GpuRasterizer({
      width: 100, height: 100, backgroundColor: '#ffffff',
    });

    const commands = [
      { type: 'setFillStyle' as const, params: ['#ff0000'] },
      { type: 'fillRect' as const, params: [10, 10, 50, 50] },
    ];

    const imageData = await rasterizer.rasterizeAsync(commands);
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(100);
    expect(imageData.height).toBe(100);
    expect(imageData.data).toBeInstanceOf(Uint8ClampedArray);
    expect(imageData.data.length).toBe(100 * 100 * 4);
    rasterizer.dispose();
  });

  it('rasterizeAsync should resolve even without GPU (software fallback)', async () => {
    const rasterizer = new GpuRasterizer({
      width: 50, height: 50,
    });

    const commands = [
      { type: 'fillRect' as const, params: [0, 0, 50, 50] },
    ];

    const imageData = await rasterizer.rasterizeAsync(commands);
    expect(imageData.width).toBe(50);
    expect(imageData.height).toBe(50);
    rasterizer.dispose();
  });
});

describe('GpuRasterizer — resize', () => {
  it('should resize buffer dimensions', () => {
    const rasterizer = new GpuRasterizer({
      width: 100, height: 100,
    });

    expect(rasterizer.width).toBe(100);
    expect(rasterizer.height).toBe(100);

    rasterizer.resize(200, 150);

    expect(rasterizer.width).toBe(200);
    expect(rasterizer.height).toBe(150);
    rasterizer.dispose();
  });

  it('should handle resize to same dimensions (no-op)', () => {
    const rasterizer = new GpuRasterizer({
      width: 100, height: 100,
    });

    rasterizer.resize(100, 100);
    expect(rasterizer.width).toBe(100);
    expect(rasterizer.height).toBe(100);
    rasterizer.dispose();
  });

  it('should still rasterize after resize', () => {
    const rasterizer = new GpuRasterizer({
      width: 100, height: 100,
    });

    rasterizer.resize(200, 150);

    const commands = [
      { type: 'setFillStyle' as const, params: ['#00ff00'] },
      { type: 'fillRect' as const, params: [0, 0, 200, 150] },
    ];

    const imageData = rasterizer.rasterize(commands);
    expect(imageData.width).toBe(200);
    expect(imageData.height).toBe(150);
    rasterizer.dispose();
  });
});

describe('PaintEngine — rasterizeAsync', () => {
  it('should support rasterizeAsync', async () => {
    const engine = new PaintEngine({
      width: 100, height: 100,
    });

    const imageData = await engine.rasterizeAsync();
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(100);
    expect(imageData.height).toBe(100);
    engine.dispose();
  });

  it('should support rasterizeAsync with hardwareAcceleration enabled', async () => {
    const engine = new PaintEngine({
      width: 100, height: 100,
      hardwareAcceleration: true,
    });

    const imageData = await engine.rasterizeAsync();
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(100);
    expect(imageData.height).toBe(100);
    engine.dispose();
  });
});
