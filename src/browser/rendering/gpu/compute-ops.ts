import type { RGBA } from '../rasterizer';
import type { BufferPool } from './buffer-pool';
import type { ShaderModules } from './shader-modules';
import { GPU_WORKGROUP_SIZE } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-level GPU compute operations for rasterization.
 *
 * Provides methods to dispatch compute shaders for common
 * rendering operations like filling rectangles, compositing,
 * drawing images, and rendering text.
 */
export class ComputeOps {
  private readonly device: GPUDevice;
  private readonly bufferPool: BufferPool;
  private readonly shaders: ShaderModules;

  // Cached pipelines
  private fillRectPipeline: GPUComputePipeline | null = null;
  private clearRectPipeline: GPUComputePipeline | null = null;
  private compositePipeline: GPUComputePipeline | null = null;
  private compositeOffsetPipeline: GPUComputePipeline | null = null;
  private drawImagePipeline: GPUComputePipeline | null = null;
  private fillTextPipeline: GPUComputePipeline | null = null;
  private fontAtlasBuffer: GPUBuffer | null = null;

  // Cached bind group layouts
  private fillRectLayout: GPUBindGroupLayout | null = null;
  private clearRectLayout: GPUBindGroupLayout | null = null;
  private compositeLayout: GPUBindGroupLayout | null = null;
  private compositeOffsetLayout: GPUBindGroupLayout | null = null;
  private drawImageLayout: GPUBindGroupLayout | null = null;
  private fillTextLayout: GPUBindGroupLayout | null = null;

  // Buffers awaiting destruction. They must not be destroyed until after the
  // queue submit that references them completes (WebGPU validation).
  private pendingDestroy: GPUBuffer[] = [];

  /**
   * Defer a buffer's destruction until after the next queue submit that
   * references it has completed. WebGPU validation forbids destroying a buffer
   * while it is still in a submitted command list.
   */
  private deferDestroy(buffer: GPUBuffer): void {
    this.pendingDestroy.push(buffer);
  }

  /**
   * Hand off all pending-destroy buffers (and clear the list) so the submit
   * site can destroy them after the queue completes the work.
   */
  takePendingDestroy(): GPUBuffer[] {
    const pending = this.pendingDestroy;
    this.pendingDestroy = [];
    return pending;
  }

  constructor(device: GPUDevice, bufferPool: BufferPool, shaders: ShaderModules) {
    this.device = device;
    this.bufferPool = bufferPool;
    this.shaders = shaders;
  }

  // ── Fill Rect ───────────────────────────────────────────────────

  fillRect(
    pixelBuffer: GPUBuffer,
    x: number, y: number, width: number, height: number,
    color: RGBA,
    viewportWidth: number, viewportHeight: number,
    encoder: GPUCommandEncoder,
  ): void {
    const pipeline = this.getFillRectPipeline();
    const layout = this.getFillRectLayout();

    const uniformData = new ArrayBuffer(40);
    const view = new DataView(uniformData);
    view.setUint32(0, x, true);
    view.setUint32(4, y, true);
    view.setUint32(8, width, true);
    view.setUint32(12, height, true);
    view.setUint32(16, color.r, true);
    view.setUint32(20, color.g, true);
    view.setUint32(24, color.b, true);
    view.setUint32(28, color.a * 255 | 0, true);
    view.setUint32(32, viewportWidth, true);
    view.setUint32(36, viewportHeight, true);

    const uniformBuffer = this.createUniformBuffer(uniformData);
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: pixelBuffer } },
        { binding: 1, resource: { buffer: uniformBuffer } },
      ],
    });

    this.dispatchCompute(encoder, pipeline, bindGroup,
      Math.ceil(width / GPU_WORKGROUP_SIZE), Math.ceil(height / GPU_WORKGROUP_SIZE));
    this.deferDestroy(uniformBuffer);
  }

  // ── Clear Rect ──────────────────────────────────────────────────

  clearRect(
    pixelBuffer: GPUBuffer,
    x: number, y: number, width: number, height: number,
    viewportWidth: number, viewportHeight: number,
    encoder: GPUCommandEncoder,
  ): void {
    const pipeline = this.getClearRectPipeline();
    const layout = this.getClearRectLayout();

    const uniformData = new ArrayBuffer(24);
    const view = new DataView(uniformData);
    view.setUint32(0, x, true);
    view.setUint32(4, y, true);
    view.setUint32(8, width, true);
    view.setUint32(12, height, true);
    view.setUint32(16, viewportWidth, true);
    view.setUint32(20, viewportHeight, true);

    const uniformBuffer = this.createUniformBuffer(uniformData);
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: pixelBuffer } },
        { binding: 1, resource: { buffer: uniformBuffer } },
      ],
    });

    this.dispatchCompute(encoder, pipeline, bindGroup,
      Math.ceil(width / GPU_WORKGROUP_SIZE), Math.ceil(height / GPU_WORKGROUP_SIZE));
    this.deferDestroy(uniformBuffer);
  }

  // ── Composite ───────────────────────────────────────────────────

  composite(
    dstBuffer: GPUBuffer, srcBuffer: GPUBuffer,
    width: number, height: number,
    encoder: GPUCommandEncoder,
  ): void {
    const pipeline = this.getCompositePipeline();
    const layout = this.getCompositeLayout();

    const uniformData = new ArrayBuffer(8);
    const view = new DataView(uniformData);
    view.setUint32(0, width, true);
    view.setUint32(4, height, true);

    const uniformBuffer = this.createUniformBuffer(uniformData);
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: dstBuffer } },
        { binding: 1, resource: { buffer: srcBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    this.dispatchCompute(encoder, pipeline, bindGroup,
      Math.ceil(width / GPU_WORKGROUP_SIZE), Math.ceil(height / GPU_WORKGROUP_SIZE));
    this.deferDestroy(uniformBuffer);
  }

  /**
   * Composite with offset and per-layer opacity.
   * Used by the layer compositor for GPU-accelerated layer blending.
   */
  compositeWithOffset(
    dstBuffer: GPUBuffer,
    srcBuffer: GPUBuffer,
    dstWidth: number, dstHeight: number,
    srcWidth: number, srcHeight: number,
    offsetX: number, offsetY: number,
    opacity: number,
    encoder: GPUCommandEncoder,
  ): void {
    const pipeline = this.getCompositeOffsetPipeline();
    const layout = this.getCompositeOffsetLayout();

    const uniformData = new ArrayBuffer(28);
    const view = new DataView(uniformData);
    view.setUint32(0, dstWidth, true);
    view.setUint32(4, dstHeight, true);
    view.setUint32(8, srcWidth, true);
    view.setUint32(12, srcHeight, true);
    view.setInt32(16, offsetX, true);
    view.setInt32(20, offsetY, true);
    view.setFloat32(24, opacity, true);

    const uniformBuffer = this.createUniformBuffer(uniformData);
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: dstBuffer } },
        { binding: 1, resource: { buffer: srcBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    this.dispatchCompute(encoder, pipeline, bindGroup,
      Math.ceil(srcWidth / GPU_WORKGROUP_SIZE), Math.ceil(srcHeight / GPU_WORKGROUP_SIZE));
    this.deferDestroy(uniformBuffer);
  }

  // ── Draw Image ──────────────────────────────────────────────────

  /**
   * Draw an image from a source buffer onto the pixel buffer with nearest-neighbor scaling.
   */
  drawImage(
    pixelBuffer: GPUBuffer,
    imageBuffer: GPUBuffer,
    imageWidth: number, imageHeight: number,
    dx: number, dy: number, dw: number, dh: number,
    globalAlpha: number,
    viewportWidth: number, viewportHeight: number,
    encoder: GPUCommandEncoder,
  ): void {
    const pipeline = this.getDrawImagePipeline();
    const layout = this.getDrawImageLayout();

    // Uniforms: dx, dy, dw, dh, imageW, imageH, viewportW, viewportH, globalAlpha
    const uniformData = new ArrayBuffer(36);
    const view = new DataView(uniformData);
    view.setUint32(0, dx, true);
    view.setUint32(4, dy, true);
    view.setUint32(8, dw, true);
    view.setUint32(12, dh, true);
    view.setUint32(16, imageWidth, true);
    view.setUint32(20, imageHeight, true);
    view.setUint32(24, viewportWidth, true);
    view.setUint32(28, viewportHeight, true);
    view.setFloat32(32, globalAlpha, true);

    const uniformBuffer = this.createUniformBuffer(uniformData);
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: pixelBuffer } },
        { binding: 1, resource: { buffer: imageBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    this.dispatchCompute(encoder, pipeline, bindGroup,
      Math.ceil(dw / GPU_WORKGROUP_SIZE), Math.ceil(dh / GPU_WORKGROUP_SIZE));
    this.deferDestroy(uniformBuffer);
  }

  // ── Fill Text ───────────────────────────────────────────────────

  /**
   * Render bitmap font text onto the pixel buffer.
   */
  fillText(
    pixelBuffer: GPUBuffer,
    textBuffer: GPUBuffer,
    charCount: number,
    x: number, y: number,
    fontSize: number,
    textAlign: number,
    color: RGBA,
    globalAlpha: number,
    viewportWidth: number, viewportHeight: number,
    encoder: GPUCommandEncoder,
  ): void {
    const pipeline = this.getFillTextPipeline();
    const layout = this.getFillTextLayout();

    const fontAtlas = this.ensureFontAtlas();

    // Uniforms: x, y, charCount, fontSize, textAlign, colorRGBA, globalAlpha, viewportW, viewportH
    const uniformData = new ArrayBuffer(48);
    const view = new DataView(uniformData);
    view.setUint32(0, x, true);
    view.setUint32(4, y, true);
    view.setUint32(8, charCount, true);
    view.setFloat32(12, fontSize, true);
    view.setUint32(16, textAlign, true); // 0=start, 1=center, 2=right/end
    view.setUint32(20, color.r, true);
    view.setUint32(24, color.g, true);
    view.setUint32(28, color.b, true);
    view.setUint32(32, color.a * 255 | 0, true);
    view.setFloat32(36, globalAlpha, true);
    view.setUint32(40, viewportWidth, true);
    view.setUint32(44, viewportHeight, true);

    const uniformBuffer = this.createUniformBuffer(uniformData);
    const bindGroup = this.device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: pixelBuffer } },
        { binding: 1, resource: { buffer: textBuffer } },
        { binding: 2, resource: { buffer: uniformBuffer } },
        { binding: 3, resource: { buffer: fontAtlas } },
      ],
    });

    this.dispatchCompute(encoder, pipeline, bindGroup,
      Math.ceil(charCount / GPU_WORKGROUP_SIZE));
    this.deferDestroy(uniformBuffer);
  }

  // ── Font Atlas ──────────────────────────────────────────────────

  private ensureFontAtlas(): GPUBuffer {
    if (this.fontAtlasBuffer) return this.fontAtlasBuffer;

    // 95 printable ASCII chars * 8 rows * 8 bits = 640 bytes packed as 95*8 = 760 u32s
    // Each char is 8 rows, each row is a u32 (8 bits used, MSB = leftmost pixel)
    const CHAR_COUNT = 95; // ASCII 32..126
    const atlasSize = CHAR_COUNT * 8 * 4; // 95 * 8 bytes per char = 760 bytes

    // Build font atlas from the FONT_DATA constant
    const atlasData = new Uint8Array(atlasSize);
    // The font data is embedded in rasterizer.ts; we replicate the first 760 bytes here
    const FONT_DATA = buildFontData();
    atlasData.set(FONT_DATA);

    this.fontAtlasBuffer = this.device.createBuffer({
      size: atlasSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.fontAtlasBuffer, 0, atlasData);
    return this.fontAtlasBuffer;
  }

  // ── Dispose ─────────────────────────────────────────────────────

  dispose(): void {
    this.fontAtlasBuffer?.destroy();
    this.fontAtlasBuffer = null;
    for (const buffer of this.pendingDestroy) {
      buffer.destroy();
    }
    this.pendingDestroy = [];
    this.fillRectPipeline = null;
    this.clearRectPipeline = null;
    this.compositePipeline = null;
    this.compositeOffsetPipeline = null;
    this.drawImagePipeline = null;
    this.fillTextPipeline = null;
    this.fillRectLayout = null;
    this.clearRectLayout = null;
    this.compositeLayout = null;
    this.compositeOffsetLayout = null;
    this.drawImageLayout = null;
    this.fillTextLayout = null;
  }

  // ── Private Helpers ─────────────────────────────────────────────

  private createUniformBuffer(data: ArrayBuffer): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: Math.ceil(data.byteLength / 4) * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  private dispatchCompute(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    x: number, y = 1, z = 1,
  ): void {
    // WebGPU dispatchWorkgroups args must be finite unsigned longs in
    // [0, 2^32-1]. Hostile/large layout dimensions (e.g. from scripted CSS)
    // can produce non-finite or out-of-range values that would make
    // beginComputePass/dispatchWorkgroups throw a validation error.
    const toCount = (v: number): number =>
      Number.isFinite(v) ? Math.max(0, Math.min(0xFFFFFFFF, Math.floor(v))) : 0;

    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(toCount(x), toCount(y), toCount(z));
    pass.end();
  }

  // ── Pipeline Accessors ──────────────────────────────────────────

  private getFillRectPipeline(): GPUComputePipeline {
    if (!this.fillRectPipeline) {
      this.fillRectPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.shaders.getFillRectShader().module, entryPoint: 'main' },
      });
    }
    return this.fillRectPipeline;
  }

  private getFillRectLayout(): GPUBindGroupLayout {
    if (!this.fillRectLayout) {
      this.fillRectLayout = this.getFillRectPipeline().getBindGroupLayout(0);
    }
    return this.fillRectLayout;
  }

  private getClearRectPipeline(): GPUComputePipeline {
    if (!this.clearRectPipeline) {
      this.clearRectPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.shaders.getClearRectShader().module, entryPoint: 'main' },
      });
    }
    return this.clearRectPipeline;
  }

  private getClearRectLayout(): GPUBindGroupLayout {
    if (!this.clearRectLayout) {
      this.clearRectLayout = this.getClearRectPipeline().getBindGroupLayout(0);
    }
    return this.clearRectLayout;
  }

  private getCompositePipeline(): GPUComputePipeline {
    if (!this.compositePipeline) {
      this.compositePipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.shaders.getCompositeShader().module, entryPoint: 'main' },
      });
    }
    return this.compositePipeline;
  }

  private   getCompositeLayout(): GPUBindGroupLayout {
    if (!this.compositeLayout) {
      this.compositeLayout = this.getCompositePipeline().getBindGroupLayout(0);
    }
    return this.compositeLayout;
  }

  private getCompositeOffsetPipeline(): GPUComputePipeline {
    if (!this.compositeOffsetPipeline) {
      this.compositeOffsetPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.shaders.getCompositeOffsetShader().module, entryPoint: 'main' },
      });
    }
    return this.compositeOffsetPipeline;
  }

  private getCompositeOffsetLayout(): GPUBindGroupLayout {
    if (!this.compositeOffsetLayout) {
      this.compositeOffsetLayout = this.getCompositeOffsetPipeline().getBindGroupLayout(0);
    }
    return this.compositeOffsetLayout;
  }

  private getDrawImagePipeline(): GPUComputePipeline {
    if (!this.drawImagePipeline) {
      this.drawImagePipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.shaders.getDrawImageShader().module, entryPoint: 'main' },
      });
    }
    return this.drawImagePipeline;
  }

  private getDrawImageLayout(): GPUBindGroupLayout {
    if (!this.drawImageLayout) {
      this.drawImageLayout = this.getDrawImagePipeline().getBindGroupLayout(0);
    }
    return this.drawImageLayout;
  }

  private getFillTextPipeline(): GPUComputePipeline {
    if (!this.fillTextPipeline) {
      this.fillTextPipeline = this.device.createComputePipeline({
        layout: 'auto',
        compute: { module: this.shaders.getFillTextShader().module, entryPoint: 'main' },
      });
    }
    return this.fillTextPipeline;
  }

  private getFillTextLayout(): GPUBindGroupLayout {
    if (!this.fillTextLayout) {
      this.fillTextLayout = this.getFillTextPipeline().getBindGroupLayout(0);
    }
    return this.fillTextLayout;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FONT DATA BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildFontData(): Uint8Array {
  // 8x8 bitmap font for printable ASCII (32–126)
  // Each char = 8 bytes; each byte = one row, MSB = leftmost pixel
  const FONT_DATA: number[] = [
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00, // 32 (space)
    0x18,0x18,0x18,0x18,0x18,0x00,0x18,0x00, // 33 !
    0x6C,0x6C,0x6C,0x00,0x00,0x00,0x00,0x00, // 34 "
    0x6C,0xFE,0x6C,0x6C,0xFE,0x6C,0x00,0x00, // 35 #
    0x18,0x7E,0xC0,0x7C,0x06,0xFC,0x18,0x00, // 36 $
    0x00,0xC6,0xCC,0x18,0x30,0x66,0xC6,0x00, // 37 %
    0x38,0x6C,0x38,0x76,0xDC,0xCC,0x76,0x00, // 38 &
    0x18,0x18,0x30,0x00,0x00,0x00,0x00,0x00, // 39 '
    0x0C,0x18,0x30,0x30,0x30,0x18,0x0C,0x00, // 40 (
    0x30,0x18,0x0C,0x0C,0x0C,0x18,0x30,0x00, // 41 )
    0x00,0x66,0x3C,0xFF,0x3C,0x66,0x00,0x00, // 42 *
    0x00,0x18,0x18,0x7E,0x18,0x18,0x00,0x00, // 43 +
    0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x30, // 44 ,
    0x00,0x00,0x00,0x7E,0x00,0x00,0x00,0x00, // 45 -
    0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00, // 46 .
    0x06,0x0C,0x18,0x30,0x60,0xC0,0x00,0x00, // 47 /
    0x7C,0xC6,0xCE,0xDE,0xF6,0xE6,0x7C,0x00, // 48 0
    0x18,0x38,0x78,0x18,0x18,0x18,0x7E,0x00, // 49 1
    0x7C,0xC6,0x06,0x1C,0x30,0x66,0xFE,0x00, // 50 2
    0x7C,0xC6,0x06,0x3C,0x06,0xC6,0x7C,0x00, // 51 3
    0x1C,0x3C,0x6C,0xCC,0xFE,0x0C,0x1E,0x00, // 52 4
    0xFE,0xC0,0xFC,0x06,0x06,0xC6,0x7C,0x00, // 53 5
    0x38,0x60,0xC0,0xFC,0xC6,0xC6,0x7C,0x00, // 54 6
    0xFE,0xC6,0x0C,0x18,0x30,0x30,0x30,0x00, // 55 7
    0x7C,0xC6,0xC6,0x7C,0xC6,0xC6,0x7C,0x00, // 56 8
    0x7C,0xC6,0xC6,0x7E,0x06,0x0C,0x78,0x00, // 57 9
    0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x00, // 58 :
    0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x30, // 59 ;
    0x0C,0x18,0x30,0x60,0x30,0x18,0x0C,0x00, // 60 <
    0x00,0x00,0x7E,0x00,0x00,0x7E,0x00,0x00, // 61 =
    0x60,0x30,0x18,0x0C,0x18,0x30,0x60,0x00, // 62 >
    0x7C,0xC6,0x0C,0x18,0x18,0x00,0x18,0x00, // 63 ?
    0x00,0x7C,0xC6,0xDE,0xDE,0xDE,0x7C,0x00, // 64 @
    0x38,0x6C,0xC6,0xC6,0xFE,0xC6,0xC6,0x00, // 65 A
    0xFC,0xC6,0xC6,0xFC,0xC6,0xC6,0xFC,0x00, // 66 B
    0x7C,0xC6,0xC0,0xC0,0xC0,0xC6,0x7C,0x00, // 67 C
    0xF8,0xCC,0xC6,0xC6,0xC6,0xCC,0xF8,0x00, // 68 D
    0xFE,0xC0,0xC0,0xFC,0xC0,0xC0,0xFE,0x00, // 69 E
    0xFE,0xC0,0xC0,0xFC,0xC0,0xC0,0xC0,0x00, // 70 F
    0x7C,0xC6,0xC0,0xC0,0xCE,0xC6,0x7E,0x00, // 71 G
    0xC6,0xC6,0xC6,0xFE,0xC6,0xC6,0xC6,0x00, // 72 H
    0x7E,0x18,0x18,0x18,0x18,0x18,0x7E,0x00, // 73 I
    0x06,0x06,0x06,0x06,0x06,0xC6,0x7C,0x00, // 74 J
    0xCC,0xD8,0xF0,0xE0,0xF0,0xD8,0xCC,0x00, // 75 K
    0xC0,0xC0,0xC0,0xC0,0xC0,0xC0,0xFE,0x00, // 76 L
    0xC6,0xEE,0xFE,0xFE,0xD6,0xC6,0xC6,0x00, // 77 M
    0xC6,0xE6,0xF6,0xDE,0xCE,0xC6,0xC6,0x00, // 78 N
    0x7C,0xC6,0xC6,0xC6,0xC6,0xC6,0x7C,0x00, // 79 O
    0xFC,0xC6,0xC6,0xFC,0xC0,0xC0,0xC0,0x00, // 80 P
    0x7C,0xC6,0xC6,0xC6,0xD6,0xCC,0x76,0x00, // 81 Q
    0xFC,0xC6,0xC6,0xFC,0xD8,0xCC,0xC6,0x00, // 82 R
    0x7C,0xC6,0xC0,0x7C,0x06,0xC6,0x7C,0x00, // 83 S
    0xFE,0x18,0x18,0x18,0x18,0x18,0x18,0x00, // 84 T
    0xC6,0xC6,0xC6,0xC6,0xC6,0xC6,0x7C,0x00, // 85 U
    0xC6,0xC6,0xC6,0xC6,0x6C,0x38,0x10,0x00, // 86 V
    0xC6,0xC6,0xD6,0xFE,0xFE,0xEE,0xC6,0x00, // 87 W
    0xC6,0x6C,0x38,0x38,0x6C,0xC6,0xC6,0x00, // 88 X
    0xC6,0xC6,0x6C,0x38,0x18,0x18,0x18,0x00, // 89 Y
    0xFE,0x0C,0x18,0x30,0x60,0xC0,0xFE,0x00, // 90 Z
    0x3C,0x30,0x30,0x30,0x30,0x30,0x3C,0x00, // 91 [
    0xC0,0x60,0x30,0x18,0x0C,0x06,0x00,0x00, // 92 backslash
    0x3C,0x0C,0x0C,0x0C,0x0C,0x0C,0x3C,0x00, // 93 ]
    0x10,0x38,0x6C,0xC6,0x00,0x00,0x00,0x00, // 94 ^
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF, // 95 _
    0x30,0x18,0x0C,0x00,0x00,0x00,0x00,0x00, // 96 `
    0x00,0x00,0x7C,0x06,0x7E,0xC6,0x7E,0x00, // 97 a
    0xC0,0xC0,0xFC,0xC6,0xC6,0xC6,0xFC,0x00, // 98 b
    0x00,0x00,0x7C,0xC6,0xC0,0xC6,0x7C,0x00, // 99 c
    0x06,0x06,0x7E,0xC6,0xC6,0xC6,0x7E,0x00, // 100 d
    0x00,0x00,0x7C,0xC6,0xFE,0xC0,0x7C,0x00, // 101 e
    0x1C,0x36,0x30,0x7C,0x30,0x30,0x30,0x00, // 102 f
    0x00,0x00,0x7E,0xC6,0xC6,0x7E,0x06,0x7C, // 103 g
    0xC0,0xC0,0xFC,0xC6,0xC6,0xC6,0xC6,0x00, // 104 h
    0x18,0x00,0x38,0x18,0x18,0x18,0x3C,0x00, // 105 i
    0x06,0x00,0x0E,0x06,0x06,0x06,0xC6,0x7C, // 106 j
    0xC0,0xC0,0xD8,0xF0,0xF0,0xD8,0xCC,0x00, // 107 k
    0x38,0x18,0x18,0x18,0x18,0x18,0x3C,0x00, // 108 l
    0x00,0x00,0xEC,0xFE,0xD6,0xD6,0xD6,0x00, // 109 m
    0x00,0x00,0xFC,0xC6,0xC6,0xC6,0xC6,0x00, // 110 n
    0x00,0x00,0x7C,0xC6,0xC6,0xC6,0x7C,0x00, // 111 o
    0x00,0x00,0xFC,0xC6,0xC6,0xFC,0xC0,0xC0, // 112 p
    0x00,0x00,0x7E,0xC6,0xC6,0x7E,0x06,0x06, // 113 q
    0x00,0x00,0xDC,0xE6,0xC0,0xC0,0xC0,0x00, // 114 r
    0x00,0x00,0x7E,0xC0,0x7C,0x06,0xFC,0x00, // 115 s
    0x30,0x30,0x7C,0x30,0x30,0x36,0x1C,0x00, // 116 t
    0x00,0x00,0xC6,0xC6,0xC6,0xC6,0x7E,0x00, // 117 u
    0x00,0x00,0xC6,0xC6,0xC6,0x6C,0x38,0x00, // 118 v
    0x00,0x00,0xC6,0xD6,0xD6,0xFE,0x6C,0x00, // 119 w
    0x00,0x00,0xC6,0x6C,0x38,0x6C,0xC6,0x00, // 120 x
    0x00,0x00,0xC6,0xC6,0xC6,0x7E,0x06,0x7C, // 121 y
    0x00,0x00,0xFE,0x0C,0x38,0x60,0xFE,0x00, // 122 z
    0x0E,0x18,0x18,0x70,0x18,0x18,0x0E,0x00, // 123 {
    0x18,0x18,0x18,0x00,0x18,0x18,0x18,0x00, // 124 |
    0x70,0x18,0x18,0x0E,0x18,0x18,0x70,0x00, // 125 }
    0x76,0xDC,0x00,0x00,0x00,0x00,0x00,0x00, // 126 ~
  ];
  return new Uint8Array(FONT_DATA);
}
