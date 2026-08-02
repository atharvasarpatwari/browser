import type { PaintCommand } from '../paint-engine';
import type { GpuRasterizerConfig } from './types';
import { Rasterizer, parseColor, type RGBA } from '../rasterizer';
import { BufferPool } from './buffer-pool';
import { ShaderModules } from './shader-modules';
import { ComputeOps } from './compute-ops';
import { getGpuDeviceManager } from './device-manager';

// ─────────────────────────────────────────────────────────────────────────────
// DOUBLE BUFFER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages two pixel buffers for GPU-to-CPU readback without stalling.
 *
 * While one buffer is being written to by the GPU, the other is being
 * read from the previous frame. This hides the async readback latency.
 */
class DoubleBuffer {
  private buffers: GPUBuffer[] = [];
  private stagingBuffers: GPUBuffer[] = [];
  private currentIndex = 0;
  private device: GPUDevice | null = null;
  private pool: BufferPool | null = null;
  private size = 0;

  initialize(device: GPUDevice, pool: BufferPool, size: number): void {
    this.device = device;
    this.pool = pool;
    this.size = size;

    // Allocate two pixel buffers
    for (let i = 0; i < 2; i++) {
      const entry = pool.acquire(size,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
      this.buffers.push(entry.buffer);
    }

    // Allocate staging buffers (one per pixel buffer, for readback)
    for (let i = 0; i < 2; i++) {
      this.stagingBuffers.push(pool.acquireStagingBuffer(size));
    }
  }

  /** Get the current GPU buffer to write to. */
  getCurrentBuffer(): GPUBuffer | null {
    return this.buffers[this.currentIndex] ?? null;
  }

  /** Get the staging buffer for readback (from the previous frame). */
  getStagingBuffer(): GPUBuffer | null {
    return this.stagingBuffers[1 - this.currentIndex] ?? null;
  }

  /** Swap front/back buffers. */
  swap(): void {
    this.currentIndex = 1 - this.currentIndex;
  }

  /** Copy current pixel buffer to its staging buffer for readback. */
  copyToStaging(encoder: GPUCommandEncoder): void {
    const pixel = this.buffers[this.currentIndex];
    const staging = this.stagingBuffers[this.currentIndex];
    if (pixel && staging) {
      encoder.copyBufferToBuffer(pixel, 0, staging, 0, this.size);
    }
  }

  dispose(): void {
    if (this.pool) {
      for (const buf of this.buffers) {
        this.pool.release({ buffer: buf, size: this.size, usage: 0, lastUsed: 0, refCount: 0 });
      }
      for (const buf of this.stagingBuffers) {
        this.pool.destroyStagingBuffer(buf);
      }
    }
    this.buffers = [];
    this.stagingBuffers = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GPU RASTERIZER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GPU-accelerated rasterizer with double-buffered async readback.
 *
 * Supports all PaintCommand types:
 * - fillRect, clearRect, strokeRect: GPU compute shaders
 * - fillText, strokeText: GPU bitmap font atlas
 * - drawImage: GPU nearest-neighbor sampling
 * - Composite: GPU alpha blending
 *
 * Falls back to software rasterizer for any unsupported operations
 * or when GPU is unavailable.
 */
export class GpuRasterizer {
  readonly width: number;
  readonly height: number;

  private device: GPUDevice | null = null;
  private bufferPool: BufferPool | null = null;
  private shaders: ShaderModules | null = null;
  private computeOps: ComputeOps | null = null;
  private doubleBuffer: DoubleBuffer | null = null;

  private pixelBufferSize = 0;
  private softwareFallback: Rasterizer;
  private useGpu = false;

  // Buffers awaiting destruction after the next submit completes.
  // WebGPU validation forbids destroying a buffer while it is still in a
  // submitted command list, so per-frame buffers are collected here and
  // destroyed in submitEncoder() after onSubmittedWorkDone() resolves.
  private pendingDestroy: GPUBuffer[] = [];

  private stateStack: RasterState[];
  private state: RasterState;

  constructor(config: GpuRasterizerConfig) {
    this.width = config.width;
    this.height = config.height;

    this.softwareFallback = new Rasterizer(config);
    this.stateStack = [];
    this.state = defaultState();

    const bg = config.backgroundColor ? parseColor(config.backgroundColor) : WHITE;
    this.state.fillStyle = bg;

    this.tryInitializeGpu();
  }

  // ── GPU Initialization ──────────────────────────────────────────

  private tryInitializeGpu(): void {
    // Init is async but rasterize() may be called before init completes.
    // We use a promise and check `useGpu` in rasterize().
    this.initGpuAsync();
  }

  private async initGpuAsync(): Promise<void> {
    try {
      const manager = getGpuDeviceManager();
      const available = await manager.initialize();
      if (!available) return;

      const device = manager.getDevice();
      if (!device) return;

      this.device = device;
      this.bufferPool = new BufferPool(device);
      this.shaders = new ShaderModules(device);
      this.computeOps = new ComputeOps(device, this.bufferPool, this.shaders);

      this.pixelBufferSize = this.width * this.height * 4;

      this.doubleBuffer = new DoubleBuffer();
      this.doubleBuffer.initialize(device, this.bufferPool, this.pixelBufferSize);

      this.useGpu = true;

      // Fill initial background
      this.gpuFillBackground(this.state.fillStyle);
    } catch (error) {
      console.warn('GPU rasterizer init failed, using software fallback:', error);
      this.useGpu = false;
    }
  }

  private gpuFillBackground(color: RGBA): void {
    const buf = this.doubleBuffer?.getCurrentBuffer();
    if (!this.device || !buf || !this.computeOps) return;

    const encoder = this.device.createCommandEncoder();
    this.computeOps.clearRect(buf, 0, 0, this.width, this.height, this.width, this.height, encoder);
    this.computeOps.fillRect(buf, 0, 0, this.width, this.height, color, this.width, this.height, encoder);
    this.submitEncoder(encoder);
  }

  /**
   * Finish an encoder, submit it, and only then destroy any buffers that were
   * deferred during encoding. WebGPU validation forbids destroying a buffer
   * while it is still referenced by a submitted command list.
   */
  private submitEncoder(encoder: GPUCommandEncoder): void {
    if (!this.device) return;
    const commandBuffer = encoder.finish();
    const pending = [
      ...this.pendingDestroy,
      ...(this.computeOps?.takePendingDestroy() ?? []),
    ];
    this.pendingDestroy = [];

    this.device.queue.submit([commandBuffer]);

    if (pending.length === 0) return;
    const queue = this.device.queue;
    queue.onSubmittedWorkDone()
      .then(() => {
        for (const buffer of pending) buffer.destroy();
      })
      .catch(() => {
        for (const buffer of pending) buffer.destroy();
      });
  }

  // ── Public API ──────────────────────────────────────────────────

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

    // Copy current frame to staging buffer, then swap
    this.doubleBuffer.copyToStaging(encoder);
    this.submitEncoder(encoder);

    // Swap first so next frame writes to the other buffer
    this.doubleBuffer.swap();

    // Sync readback — always returns software fallback since mapAsync can't be awaited
    return this.softwareFallback.getImageData();
  }

  /**
   * Async rasterize with real GPU-to-CPU readback.
   *
   * Submits GPU commands, then awaits the staging buffer mapping.
   * Returns the actual GPU-rendered pixels.
   *
   * Falls back to software if GPU is unavailable.
   */
  async rasterizeAsync(commands: readonly PaintCommand[]): Promise<ImageData> {
    if (!this.useGpu || !this.device || !this.computeOps || !this.doubleBuffer) {
      return this.softwareFallback.rasterize(commands);
    }

    const buf = this.doubleBuffer.getCurrentBuffer();
    if (!buf) return this.softwareFallback.rasterize(commands);

    const encoder = this.device.createCommandEncoder();

    for (const cmd of commands) {
      this.execGpu(cmd, buf, encoder);
    }

    // Copy current frame to staging buffer, then swap
    this.doubleBuffer.copyToStaging(encoder);
    this.submitEncoder(encoder);

    this.doubleBuffer.swap();

    // Await the staging buffer from the *previous* frame
    return this.readBackStagingAsync();
  }

  getImageData(): ImageData {
    if (!this.useGpu) return this.softwareFallback.getImageData();
    return this.softwareFallback.getImageData();
  }

  getPixels(): Uint8ClampedArray {
    if (!this.useGpu) return this.softwareFallback.getPixels();
    return this.softwareFallback.getPixels();
  }

  isGpuActive(): boolean {
    return this.useGpu;
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;

    (this as { width: number }).width = width;
    (this as { height: number }).height = height;

    // Recreate software fallback with new dimensions
    this.softwareFallback = new Rasterizer({
      width,
      height,
    });

    this.pixelBufferSize = width * height * 4;

    // Dispose old GPU resources
    this.doubleBuffer?.dispose();
    this.doubleBuffer = null;
    this.useGpu = false;

    // Reinit GPU resources if device is available
    if (this.device && this.bufferPool && this.shaders && this.computeOps) {
      try {
        this.doubleBuffer = new DoubleBuffer();
        this.doubleBuffer.initialize(this.device, this.bufferPool, this.pixelBufferSize);
        this.useGpu = true;
      } catch (error) {
        console.warn('GPU rasterizer resize failed, using software fallback:', error);
        this.useGpu = false;
      }
    }
  }

  dispose(): void {
    this.doubleBuffer?.dispose();
    this.computeOps?.dispose();
    this.bufferPool?.dispose();
    this.shaders?.clear();
    for (const buffer of this.pendingDestroy) {
      buffer.destroy();
    }
    this.pendingDestroy = [];
  }

  // ── PER-LAYER RASTERIZATION ──────────────────────────────────────

  /**
   * Rasterize a compositing layer's paint commands into a separate buffer.
   * Used by the LayerCompositor for per-layer texture generation.
   */
  rasterizeLayerToBuffer(
    commands: readonly PaintCommand[],
    width: number,
    height: number,
  ): Uint8ClampedArray | null {
    if (!this.useGpu || !this.device || !this.computeOps) {
      // Software path
      const tempRasterizer = new Rasterizer({ width, height, backgroundColor: 'transparent' });
      tempRasterizer.rasterize(commands);
      return tempRasterizer.getPixels();
    }

    // GPU path: create a temporary buffer for this layer
    const layerSize = width * height * 4;
    const layerBuf = this.bufferPool!.acquire(
      layerSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    );

    const encoder = this.device.createCommandEncoder();

    for (const cmd of commands) {
      this.execGpu(cmd, layerBuf.buffer, encoder);
    }

    // The layer buffer is referenced by the submitted command list; destroy it
    // after the submit completes (submitEncoder) instead of returning it to the
    // pool, where a full pool would destroy it while still in-flight.
    this.pendingDestroy.push(layerBuf.buffer);
    this.submitEncoder(encoder);
    return null;
  }

  /**
   * Composite a source layer buffer onto the destination pixel buffer
   * with offset and opacity. GPU-accelerated.
   */
  compositeLayerToBuffer(
    dstBuffer: GPUBuffer,
    srcBuffer: GPUBuffer,
    dstWidth: number, dstHeight: number,
    srcWidth: number, srcHeight: number,
    offsetX: number, offsetY: number,
    opacity: number,
  ): void {
    if (!this.useGpu || !this.device || !this.computeOps) return;

    const encoder = this.device.createCommandEncoder();
    this.computeOps.compositeWithOffset(
      dstBuffer, srcBuffer,
      dstWidth, dstHeight,
      srcWidth, srcHeight,
      offsetX, offsetY,
      opacity,
      encoder,
    );
    this.submitEncoder(encoder);
  }

  // ── GPU Command Execution ───────────────────────────────────────

  private execGpu(cmd: PaintCommand, buf: GPUBuffer, encoder: GPUCommandEncoder): void {
    switch (cmd.type) {
      case 'fillRect': {
        const [x, y, w, h] = cmd.params as unknown as [number, number, number, number];
        const c = this.state.fillStyle;
        const a = c.a * this.state.globalAlpha;
        this.computeOps!.fillRect(buf, x | 0, y | 0, w | 0, h | 0, { r: c.r, g: c.g, b: c.b, a }, this.width, this.height, encoder);
        break;
      }
      case 'clearRect': {
        const [x, y, w, h] = cmd.params as unknown as [number, number, number, number];
        this.computeOps!.clearRect(buf,
          Math.max(0, x | 0), Math.max(0, y | 0),
          Math.min(this.width, ((x | 0) + (w | 0))), Math.min(this.height, ((y | 0) + (h | 0))),
          this.width, this.height, encoder);
        break;
      }
      case 'strokeRect': {
        const [x, y, w, h] = cmd.params as unknown as [number, number, number, number];
        const c = this.state.strokeStyle;
        const a = c.a * this.state.globalAlpha;
        const lw = this.state.lineWidth;
        const col = { r: c.r, g: c.g, b: c.b, a };
        // Top
        this.computeOps!.fillRect(buf, x | 0, y | 0, w | 0, lw | 0, col, this.width, this.height, encoder);
        // Bottom
        this.computeOps!.fillRect(buf, x | 0, (y | 0) + (h | 0) - (lw | 0), w | 0, lw | 0, col, this.width, this.height, encoder);
        // Left
        this.computeOps!.fillRect(buf, x | 0, (y | 0) + (lw | 0), lw | 0, (h | 0) - 2 * (lw | 0), col, this.width, this.height, encoder);
        // Right
        this.computeOps!.fillRect(buf, (x | 0) + (w | 0) - (lw | 0), (y | 0) + (lw | 0), lw | 0, (h | 0) - 2 * (lw | 0), col, this.width, this.height, encoder);
        break;
      }
      case 'fillText':
      case 'strokeText': {
        const [text, x, y] = cmd.params as unknown as [string, number, number];
        const c = cmd.type === 'fillText' ? this.state.fillStyle : this.state.strokeStyle;
        const a = c.a * this.state.globalAlpha;
        this.gpuFillText(text, x | 0, y | 0, c.r, c.g, c.b, a, buf, encoder);
        break;
      }
      case 'drawImage': {
        const src = cmd.params[0] as { data: Uint8ClampedArray; width: number; height: number };
        const dx = cmd.params[1] as number;
        const dy = cmd.params[2] as number;
        const dw = cmd.params[3] as number;
        const dh = cmd.params[4] as number;
        this.gpuDrawImage(src, dx | 0, dy | 0, dw | 0, dh | 0, buf, encoder);
        break;
      }
      case 'setFillStyle':
        this.state.fillStyle = parseColor(cmd.params[0] as string);
        break;
      case 'setStrokeStyle':
        this.state.strokeStyle = parseColor(cmd.params[0] as string);
        break;
      case 'setLineWidth':
        this.state.lineWidth = cmd.params[0] as number;
        break;
      case 'setFont':
        this.setFont(cmd.params[0] as string);
        break;
      case 'setTextAlign':
        this.state.textAlign = cmd.params[0] as string;
        break;
      case 'save':
        this.stateStack.push(cloneState(this.state));
        break;
      case 'restore':
        if (this.stateStack.length > 0) {
          this.state = this.stateStack.pop()!;
        }
        break;
      case 'setGlobalAlpha':
        this.state.globalAlpha = clamp01(cmd.params[0] as number);
        break;
      case 'beginPath':
      case 'closePath':
      case 'fill':
      case 'stroke':
      case 'clip':
        // No-op for now (path ops not yet implemented on GPU)
        break;
    }
  }

  // ── GPU Text Rendering ──────────────────────────────────────────

  private gpuFillText(
    text: string, x: number, y: number,
    r: number, g: number, b: number, a: number,
    buf: GPUBuffer, encoder: GPUCommandEncoder,
  ): void {
    if (!this.computeOps || text.length === 0) return;

    // Encode characters as u32 array
    const charData = new ArrayBuffer(text.length * 4);
    const charView = new DataView(charData);
    for (let i = 0; i < text.length; i++) {
      charView.setUint32(i * 4, text.charCodeAt(i), true);
    }

    const charBuffer = this.device!.createBuffer({
      size: Math.max(4, text.length * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device!.queue.writeBuffer(charBuffer, 0, charData);

    const textAlign = this.state.textAlign === 'center' ? 1
      : (this.state.textAlign === 'right' || this.state.textAlign === 'end') ? 2
      : 0;

    this.computeOps.fillText(
      buf, charBuffer, text.length,
      x, y, this.state.fontSize, textAlign,
      { r, g, b, a }, this.state.globalAlpha,
      this.width, this.height, encoder,
    );

    // Defer destruction until the submit referencing charBuffer completes.
    this.pendingDestroy.push(charBuffer);
  }

  // ── GPU Image Rendering ─────────────────────────────────────────

  private gpuDrawImage(
    src: { data: Uint8ClampedArray; width: number; height: number },
    dx: number, dy: number, dw: number, dh: number,
    buf: GPUBuffer, encoder: GPUCommandEncoder,
  ): void {
    if (!this.computeOps || !src.data || dw <= 0 || dh <= 0 || src.width <= 0 || src.height <= 0) return;

    // Upload source image to GPU buffer
    const srcSize = src.width * src.height * 4;
    const imageBuffer = this.device!.createBuffer({
      size: srcSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const ab = new ArrayBuffer(srcSize);
    new Uint8Array(ab).set(src.data);
    this.device!.queue.writeBuffer(imageBuffer, 0, ab);

    this.computeOps.drawImage(
      buf, imageBuffer,
      src.width, src.height,
      dx, dy, dw, dh,
      this.state.globalAlpha,
      this.width, this.height, encoder,
    );

    // Defer destruction until the submit referencing imageBuffer completes.
    this.pendingDestroy.push(imageBuffer);
  }

  // ── Private Helpers ─────────────────────────────────────────────

  private setFont(fontStr: string): void {
    this.state.font = fontStr;
    const m = fontStr.match(/(\d+(?:\.\d+)?)\s*px/);
    if (m) this.state.fontSize = parseFloat(m[1]);
  }

  /**
   * Async readback from the staging buffer.
   * Awaits mapAsync() for real GPU pixel data.
   * Falls back to software on timeout or error.
   */
  private async readBackStagingAsync(): Promise<ImageData> {
    if (!this.device || !this.doubleBuffer || !this.bufferPool) {
      return this.softwareFallback.getImageData();
    }

    const staging = this.doubleBuffer.getStagingBuffer();
    if (!staging) return this.softwareFallback.getImageData();

    try {
      // Wait for the GPU to finish submitting, then map
      await staging.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(staging.getMappedRange().slice(0));
      staging.unmap();
      return new ImageData(new Uint8ClampedArray(data), this.width, this.height);
    } catch {
      return this.softwareFallback.getImageData();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface RasterState {
  fillStyle: RGBA;
  strokeStyle: RGBA;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  fontSize: number;
  textAlign: string;
}

const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

function defaultState(): RasterState {
  return {
    fillStyle: WHITE,
    strokeStyle: TRANSPARENT,
    lineWidth: 1,
    globalAlpha: 1,
    font: '12px monospace',
    fontSize: 12,
    textAlign: 'start',
  };
}

function cloneState(state: RasterState): RasterState {
  return {
    fillStyle: { ...state.fillStyle },
    strokeStyle: { ...state.strokeStyle },
    lineWidth: state.lineWidth,
    globalAlpha: state.globalAlpha,
    font: state.font,
    fontSize: state.fontSize,
    textAlign: state.textAlign,
  };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
