/**
 * GPU Acceleration Module
 *
 * Provides GPU-accelerated rasterization using WebGPU compute shaders.
 * Falls back to software rendering when GPU is unavailable.
 *
 * @example
 * ```typescript
 * import { GpuDeviceManager, GpuRasterizer } from './gpu';
 *
 * const rasterizer = new GpuRasterizer({
 *   width: 1920,
 *   height: 1080,
 *   backgroundColor: '#ffffff',
 * });
 *
 * const imageData = rasterizer.rasterize(paintCommands);
 * ```
 */

export { GpuDeviceManager, getGpuDeviceManager, resetGpuDeviceManager } from './device-manager';
export { BufferPool } from './buffer-pool';
export { ShaderModules } from './shader-modules';
export { ComputeOps } from './compute-ops';
export { GpuRasterizer } from './gpu-rasterizer';
export type {
  GpuDeviceCapabilities,
  GpuDeviceState,
  GpuBufferDescriptor,
  GpuBufferEntry,
  GpuBufferStats,
  GpuShaderModule,
  GpuComputePipelineDescriptor,
  GpuRasterizerConfig,
  GpuRasterOperation,
  FillRectUniforms,
  CompositeUniforms,
  DrawImageUniforms,
} from './types';
export {
  GPU_BUFFER_ALIGNMENT,
  GPU_WORKGROUP_SIZE,
  GPU_MAX_BUFFER_SIZE,
  GPU_BUFFER_POOL_MAX_AGE_MS,
  GPU_BUFFER_POOL_MAX_IDLE,
} from './types';
