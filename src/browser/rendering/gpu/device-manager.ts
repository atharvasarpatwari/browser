import type { IDisposable } from '../../../app/dependency-container';
import type { GpuDeviceCapabilities, GpuDeviceState } from './types';
import { GPU_MAX_BUFFER_SIZE } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// GPU DEVICE MANAGER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of the WebGPU device.
 *
 * Responsibilities:
 * - Initialize WebGPU adapter and device
 * - Provide device availability checks
 * - Handle device loss and recovery
 * - Expose device capabilities
 */
export class GpuDeviceManager implements IDisposable {
  private device: GPUDevice | null = null;
  private adapter: GPUAdapter | null = null;
  private capabilities: GpuDeviceCapabilities | null = null;
  private disposed = false;
  private deviceLostHandler: ((reason: GPUDeviceLostReason) => void) | null = null;

  // ── Initialization ──────────────────────────────────────────────

  /**
   * Initialize the GPU device.
   * @returns true if GPU is available and device was created
   */
  async initialize(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.device) return true;

    try {
      // Check for WebGPU support
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        return false;
      }

      // Request adapter
      this.adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!this.adapter) {
        return false;
      }

      // Request device with required features
      this.device = await this.adapter.requestDevice({
        requiredLimits: {
          maxBufferSize: Math.min(
            this.adapter.limits.maxBufferSize,
            GPU_MAX_BUFFER_SIZE,
          ),
          maxStorageBufferBindingSize: Math.min(
            this.adapter.limits.maxStorageBufferBindingSize,
            GPU_MAX_BUFFER_SIZE,
          ),
        },
      });

      // Set up device lost handler
      this.device.lost.then((info) => {
        console.warn(`GPU device lost: ${info.message}`);
        this.device = null;
        this.adapter = null;
        this.capabilities = null;
        if (this.deviceLostHandler) {
          this.deviceLostHandler(info.reason);
        }
      });

      // Capture capabilities
      this.capabilities = this.captureCapabilities();

      return true;
    } catch (error) {
      console.warn('Failed to initialize GPU device:', error);
      this.cleanup();
      return false;
    }
  }

  /**
   * Synchronous check if GPU is available.
   */
  isAvailable(): boolean {
    return this.device !== null && !this.disposed;
  }

  /**
   * Get the GPU device.
   * @returns GPUDevice or null if not available
   */
  getDevice(): GPUDevice | null {
    return this.device;
  }

  /**
   * Get the GPU adapter.
   * @returns GPUAdapter or null if not available
   */
  getAdapter(): GPUAdapter | null {
    return this.adapter;
  }

  /**
   * Get device capabilities.
   */
  getCapabilities(): GpuDeviceCapabilities | null {
    return this.capabilities;
  }

  /**
   * Get device state for diagnostics.
   */
  getState(): GpuDeviceState {
    return {
      isAvailable: this.isAvailable(),
      adapterName: this.adapter?.info?.description ?? 'unknown',
      capabilities: this.capabilities,
      device: this.device,
    };
  }

  // ── Device Loss Handling ────────────────────────────────────────

  /**
   * Register a handler for device loss events.
   */
  onDeviceLost(handler: (reason: GPUDeviceLostReason) => void): void {
    this.deviceLostHandler = handler;
  }

  /**
   * Attempt to reinitialize after device loss.
   */
  async recover(): Promise<boolean> {
    this.cleanup();
    return this.initialize();
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /**
   * Create a command encoder.
   */
  createCommandEncoder(): GPUCommandEncoder | null {
    if (!this.device) return null;
    return this.device.createCommandEncoder();
  }

  /**
   * Submit a command buffer.
   */
  submit(commandBuffer: GPUCommandBuffer): void {
    this.device?.queue.submit([commandBuffer]);
  }

  /**
   * Wait for all operations to complete.
   */
  async waitForIdle(): Promise<void> {
    if (!this.device) return;
    await this.device.queue.onSubmittedWorkDone();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanup();
  }

  // ── Private ─────────────────────────────────────────────────────

  private cleanup(): void {
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
    this.adapter = null;
    this.capabilities = null;
  }

  private captureCapabilities(): GpuDeviceCapabilities | null {
    if (!this.adapter) return null;

    const limits = this.adapter.limits;
    return {
      maxBufferSize: limits.maxBufferSize,
      maxTextureSize: limits.maxTextureDimension2D,
      maxComputeWorkgroupSize: limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
      maxStorageBuffersPerShaderStage: limits.maxStorageBuffersPerShaderStage,
      maxStorageTexturesPerShaderStage: limits.maxStorageTexturesPerShaderStage,
      maxBindingsPerBindGroup: limits.maxBindingsPerBindGroup,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

let _instance: GpuDeviceManager | null = null;

/**
 * Get or create the global GPU device manager.
 */
export function getGpuDeviceManager(): GpuDeviceManager {
  if (!_instance) {
    _instance = new GpuDeviceManager();
  }
  return _instance;
}

/**
 * Reset the global GPU device manager (for testing).
 */
export function resetGpuDeviceManager(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
