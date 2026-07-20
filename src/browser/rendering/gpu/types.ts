import type { RGBA } from '../rasterizer';

// ─────────────────────────────────────────────────────────────────────────────
// GPU DEVICE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GpuDeviceCapabilities {
  readonly maxBufferSize: number;
  readonly maxTextureSize: number;
  readonly maxComputeWorkgroupSize: number;
  readonly maxComputeWorkgroupsPerDimension: number;
  readonly maxStorageBuffersPerShaderStage: number;
  readonly maxStorageTexturesPerShaderStage: number;
  readonly maxBindingsPerBindGroup: number;
}

export interface GpuDeviceState {
  readonly isAvailable: boolean;
  readonly adapterName: string;
  readonly capabilities: GpuDeviceCapabilities | null;
  readonly device: GPUDevice | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUFFER TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GpuBufferDescriptor {
  readonly size: number;
  readonly usage: GPUBufferUsageFlags;
  readonly mappedAtCreation?: boolean;
}

export interface GpuBufferEntry {
  readonly buffer: GPUBuffer;
  readonly size: number;
  readonly usage: GPUBufferUsageFlags;
  lastUsed: number;
  refCount: number;
}

export interface GpuBufferStats {
  readonly totalBuffers: number;
  readonly totalAllocatedBytes: number;
  readonly activeBuffers: number;
  readonly pooledBuffers: number;
  readonly hits: number;
  readonly misses: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHADER TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GpuShaderModule {
  readonly module: GPUShaderModule;
  readonly code: string;
  readonly entryPoints: readonly string[];
}

export interface GpuComputePipelineDescriptor {
  readonly module: GPUShaderModule;
  readonly entryPoint: string;
  readonly bindGroupLayouts: readonly GPUBindGroupLayout[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RASTERIZER TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GpuRasterizerConfig {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio?: number;
  readonly backgroundColor?: string;
  readonly enableDebug?: boolean;
}

export interface GpuRasterOperation {
  readonly type: 'fillRect' | 'clearRect' | 'drawImage' | 'fillText' | 'composite';
  readonly params: readonly unknown[];
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE SHADER TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface FillRectUniforms {
  x: number;
  y: number;
  width: number;
  height: number;
  color: RGBA;
  viewportWidth: number;
  viewportHeight: number;
}

export interface CompositeUniforms {
  viewportWidth: number;
  viewportHeight: number;
  operation: number; // 0 = source-over, 1 = source-in, 2 = source-out, etc.
}

export interface DrawImageUniforms {
  srcX: number;
  srcY: number;
  srcWidth: number;
  srcHeight: number;
  dstX: number;
  dstY: number;
  dstWidth: number;
  dstHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const GPU_BUFFER_ALIGNMENT = 256;
export const GPU_WORKGROUP_SIZE = 8;
export const GPU_MAX_BUFFER_SIZE = 256 * 1024 * 1024; // 256 MB
export const GPU_BUFFER_POOL_MAX_AGE_MS = 5000; // 5 seconds
export const GPU_BUFFER_POOL_MAX_IDLE = 10; // Max idle buffers per size class
