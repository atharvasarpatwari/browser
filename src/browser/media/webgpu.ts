import type { IDisposable } from '../../app/dependency-container';

interface IGPUCanvasContext extends IDisposable {
  readonly canvas: WebGPUCanvas | null;
  configure(config: GPUCanvasConfiguration): void;
  getCurrentTexture(): GPUTexture;
  onEvent(handler: GPUEventHandler): () => void;
}

interface IGPUAdapter extends IDisposable {
  readonly name: string;
  readonly features: string[];
  readonly limits: GPULimits;
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<IGPUDevice>;
}

interface IGPUDevice extends IDisposable {
  readonly adapter: IGPUAdapter;
  readonly features: string[];
  readonly limits: GPULimits;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
  createCommandEncoder(): GPUCommandEncoder;
  createQuerySet(descriptor: GPUQuerySetDescriptor): GPUQuerySet;
  readonly queue: IGPUQueue;
  onEvent(handler: GPUEventHandler): () => void;
  destroy(): void;
}

interface IGPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
  writeBuffer(buffer: GPUBuffer, bufferOffset: number, data: BufferSource, dataOffset?: number, size?: number): void;
  onSubmittedWorkDone(): Promise<void>;
}

interface GPUCanvasConfiguration {
  device: IGPUDevice;
  format: string;
  usage?: number;
  viewFormats?: string[];
  colorSpace?: string;
  compositingAlphaMode?: string;
}

interface GPULimits {
  maxTextureDimension2D: number;
  maxStorageBufferBindingSize: number;
  maxComputeWorkgroupSizeX: number;
}

interface GPUDeviceDescriptor {
  requiredFeatures?: string[];
  requiredLimits?: Record<string, number>;
}

interface GPUBufferDescriptor {
  size: number;
  usage: number;
  mappedAtCreation?: boolean;
}

interface GPUTextureDescriptor {
  size: { width: number; height: number; depthOrArrayLayers?: number };
  format: string;
  usage: number;
  mipLevelCount?: number;
  sampleCount?: number;
  dimension?: string;
}

interface GPUSamplerDescriptor {
  addressModeU?: string;
  addressModeV?: string;
  minFilter?: string;
  magFilter?: string;
  mipmapFilter?: string;
  lodMinClamp?: number;
  lodMaxClamp?: number;
}

interface GPUShaderModuleDescriptor {
  code: string;
  label?: string;
}

interface GPUBindGroupLayoutDescriptor {
  entries: GPUBindGroupLayoutEntry[];
  label?: string;
}

interface GPUBindGroupLayoutEntry {
  binding: number;
  visibility: number;
  buffer?: { type?: string; hasDynamicOffset?: boolean; minBindingSize?: number };
  texture?: { sampleType?: string; viewDimension?: string; multisampled?: boolean };
  sampler?: { type?: string };
}

interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
  label?: string;
}

interface GPUBindGroupEntry {
  binding: number;
  resource: GPUBufferBinding | GPUTextureView | GPUSampler;
}

interface GPUBufferBinding {
  buffer: GPUBuffer;
  offset?: number;
  size?: number;
}

interface GPUPipelineLayoutDescriptor {
  bindGroupLayouts: GPUBindGroupLayout[];
  label?: string;
}

interface GPURenderPipelineDescriptor {
  vertex: GPUVertexState;
  fragment?: GPUFragmentState;
  layout?: GPUPipelineLayout;
  primitive?: GPUPrimitiveState;
  depthStencil?: GPUDepthStencilState;
  multisample?: GPUMultisampleState;
  label?: string;
}

interface GPUComputePipelineDescriptor {
  compute: GPUProgrammableStage;
  layout?: GPUPipelineLayout;
  label?: string;
}

interface GPUVertexState {
  module: GPUShaderModule;
  entryPoint: string;
  buffers?: GPUVertexBufferLayout[];
}

interface GPUVertexBufferLayout {
  arrayStride: number;
  attributes: GPUVertexAttribute[];
  stepMode?: string;
}

interface GPUVertexAttribute {
  format: string;
  offset: number;
  shaderLocation: number;
}

interface GPUFragmentState {
  module: GPUShaderModule;
  entryPoint: string;
  targets: GPUColorTargetState[];
}

interface GPUColorTargetState {
  format: string;
  blend?: GPUBlendState;
  writeMask?: number;
}

interface GPUBlendState {
  color: GPUBlendComponent;
  alpha: GPUBlendComponent;
}

interface GPUBlendComponent {
  operation?: string;
  srcFactor?: string;
  dstFactor?: string;
}

interface GPUPrimitiveState {
  topology?: string;
  stripIndexFormat?: string;
  frontFace?: string;
  cullMode?: string;
}

interface GPUDepthStencilState {
  format: string;
  depthWriteEnabled?: boolean;
  depthCompare?: string;
}

interface GPUMultisampleState {
  count?: number;
  mask?: number;
  alphaToCoverageEnabled?: boolean;
}

interface GPUProgrammableStage {
  module: GPUShaderModule;
  entryPoint: string;
}

interface GPUCommandEncoder {
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
  beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
  copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number): void;
  finish(): GPUCommandBuffer;
}

interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
  setIndexBuffer(buffer: GPUBuffer, format: string, offset?: number, size?: number): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
  drawIndexed(indexCount: number, instanceCount?: number, firstIndex?: number, baseVertex?: number, firstInstance?: number): void;
  end(): void;
}

interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: number[]): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

interface GPUComputePassDescriptor {
  label?: string;
}

interface GPURenderPassDescriptor {
  colorAttachments: GPURenderPassColorAttachment[];
  depthStencilAttachment?: GPURenderPassDepthStencilAttachment;
  label?: string;
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  clearValue?: GPUColor;
  loadOp: string;
  storeOp: string;
}

interface GPURenderPassDepthStencilAttachment {
  view: GPUTextureView;
  depthClearValue?: number;
  depthLoadOp?: string;
  depthStoreOp?: string;
  stencilClearValue?: number;
  stencilLoadOp?: string;
  stencilStoreOp?: string;
}

type GPUColor = [number, number, number, number];

interface GPUTextureView {
  readonly texture: GPUTexture;
  readonly format: string;
}

interface GPUCommandBuffer {
  readonly label?: string;
}

interface GPUQuerySet {
  readonly type: string;
  readonly count: number;
}

interface GPUQuerySetDescriptor {
  readonly type: 'occlusion' | 'timestamp';
  readonly count: number;
}

interface GPUEvent {
  readonly kind: GPUEventKind;
  readonly data?: Record<string, unknown>;
}

type GPUEventKind = 'lost' | 'error' | 'uncapturederror';

type GPUEventHandler = (event: GPUEvent) => void;

interface WebGPUCanvas {
  width: number;
  height: number;
}

type BufferSource = ArrayBuffer | ArrayBufferView;

let _objectIdGpu = 1;

class GPUCanvasContext implements IGPUCanvasContext {
  readonly canvas: WebGPUCanvas | null;
  private _device: IGPUDevice | null = null;
  private _format = 'bgra8unorm';
  private _texture: GPUTexture | null = null;
  private _handlers = new Set<GPUEventHandler>();

  constructor(canvas?: WebGPUCanvas) {
    this.canvas = canvas ?? null;
  }

  configure(config: GPUCanvasConfiguration): void {
    this._device = config.device;
    this._format = config.format;
    const w = this.canvas?.width ?? 300;
    const h = this.canvas?.height ?? 150;
    this._texture = {
      id: _objectIdGpu++,
      format: this._format,
      width: w,
      height: h,
      depthOrArrayLayers: 1,
      usage: config.usage ?? 0x10,
    };
  }

  getCurrentTexture(): GPUTexture {
    if (!this._texture) {
      const w = this.canvas?.width ?? 300;
      const h = this.canvas?.height ?? 150;
      this._texture = { id: _objectIdGpu++, format: this._format, width: w, height: h, depthOrArrayLayers: 1, usage: 0x10 };
    }
    return this._texture;
  }

  get format(): string { return this._format; }

  onEvent(handler: GPUEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: GPUEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._device = null;
    this._texture = null;
  }
}

interface GPUTexture {
  readonly id: number;
  format: string;
  width: number;
  height: number;
  depthOrArrayLayers: number;
  usage: number;
}

interface GPUBuffer {
  readonly id: number;
  readonly size: number;
  readonly usage: number;
  destroy(): void;
}

interface GPUSampler {
  readonly id: number;
}

interface GPUShaderModule {
  readonly id: number;
  readonly code: string;
}

interface GPUBindGroupLayout {
  readonly id: number;
}

interface GPUBindGroup {
  readonly id: number;
}

interface GPUPipelineLayout {
  readonly id: number;
}

interface GPURenderPipeline {
  readonly id: number;
}

interface GPUComputePipeline {
  readonly id: number;
}

async function requestAdapter(): Promise<IGPUAdapter | null> {
  return {
    name: 'WebGPU Software Adapter',
    features: ['shader-f16', 'bgra8unorm-storage'],
    limits: { maxTextureDimension2D: 16384, maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupSizeX: 256 },
    async requestDevice(descriptor?: GPUDeviceDescriptor): Promise<IGPUDevice> {
      return new GPUDevice(this, descriptor);
    },
    dispose() { },
    onEvent(_handler: GPUEventHandler): () => void { return () => {}; },
  } as IGPUAdapter;
}

class GPUDevice implements IGPUDevice {
  readonly adapter: IGPUAdapter;
  readonly features: string[];
  readonly limits: GPULimits;
  readonly queue: IGPUQueue;
  private _handlers = new Set<GPUEventHandler>();
  private _destroyed = false;

  constructor(adapter: IGPUAdapter, descriptor?: GPUDeviceDescriptor) {
    this.adapter = adapter;
    this.features = descriptor?.requiredFeatures ?? adapter.features;
    this.limits = {
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
    };
    this.queue = {
      submit(_commandBuffers: GPUCommandBuffer[]): void { },
      writeBuffer(_buffer: GPUBuffer, _bufferOffset: number, _data: BufferSource, _dataOffset?: number, _size?: number): void { },
      async onSubmittedWorkDone(): Promise<void> { },
    };
  }

  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    const buf: GPUBuffer = { id: _objectIdGpu++, size: descriptor.size, usage: descriptor.usage, destroy() {} };
    if (descriptor.mappedAtCreation) { }
    return buf;
  }

  createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
    return { id: _objectIdGpu++, format: descriptor.format, width: descriptor.size.width, height: descriptor.size.height, depthOrArrayLayers: descriptor.size.depthOrArrayLayers ?? 1, usage: descriptor.usage };
  }

  createSampler(_descriptor?: GPUSamplerDescriptor): GPUSampler {
    return { id: _objectIdGpu++ };
  }

  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
    return { id: _objectIdGpu++, code: descriptor.code };
  }

  createBindGroupLayout(_descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout {
    return { id: _objectIdGpu++ };
  }

  createBindGroup(_descriptor: GPUBindGroupDescriptor): GPUBindGroup {
    return { id: _objectIdGpu++ };
  }

  createPipelineLayout(_descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout {
    return { id: _objectIdGpu++ };
  }

  createRenderPipeline(_descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    return { id: _objectIdGpu++ };
  }

  createComputePipeline(_descriptor: GPUComputePipelineDescriptor): GPUComputePipeline {
    return { id: _objectIdGpu++ };
  }

  createCommandEncoder(): GPUCommandEncoder {
    return {
      beginRenderPass(_descriptor: GPURenderPassDescriptor): GPURenderPassEncoder {
        return { setPipeline(_pipeline: GPURenderPipeline): void { }, setVertexBuffer(_slot: number, _buffer: GPUBuffer, _offset?: number, _size?: number): void { }, setIndexBuffer(_buffer: GPUBuffer, _format: string, _offset?: number, _size?: number): void { }, draw(_vertexCount: number, _instanceCount?: number, _firstVertex?: number, _firstInstance?: number): void { }, drawIndexed(_indexCount: number, _instanceCount?: number, _firstIndex?: number, _baseVertex?: number, _firstInstance?: number): void { }, end(): void { } };
      },
      beginComputePass(_descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder {
        return { setPipeline(_pipeline: GPUComputePipeline): void { }, setBindGroup(_index: number, _bindGroup: GPUBindGroup, _dynamicOffsets?: number[]): void { }, dispatchWorkgroups(_x: number, _y?: number, _z?: number): void { }, end(): void { } };
      },
      copyBufferToBuffer(_source: GPUBuffer, _sourceOffset: number, _destination: GPUBuffer, _destinationOffset: number, _size: number): void { },
      finish(): GPUCommandBuffer { return {}; },
    };
  }

  createQuerySet(descriptor: GPUQuerySetDescriptor): GPUQuerySet {
    return { type: descriptor.type, count: descriptor.count };
  }

  onEvent(handler: GPUEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: GPUEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  destroy(): void {
    this._destroyed = true;
    this._handlers.clear();
  }

  dispose(): void {
    this.destroy();
  }
}

export { GPUCanvasContext, GPUDevice, requestAdapter };
export type { IGPUCanvasContext, IGPUAdapter, IGPUDevice, IGPUQueue, GPUCanvasConfiguration, GPULimits, GPUDeviceDescriptor, GPUBufferDescriptor, GPUTextureDescriptor, GPUSamplerDescriptor, GPUShaderModuleDescriptor, GPUBindGroupLayoutDescriptor, GPUBindGroupDescriptor, GPUPipelineLayoutDescriptor, GPURenderPipelineDescriptor, GPUComputePipelineDescriptor, GPUCommandEncoder, GPURenderPassEncoder, GPUComputePassEncoder, GPURenderPassDescriptor, GPUComputePassDescriptor, GPUTexture, GPUBuffer, GPUSampler, GPUShaderModule, GPUBindGroupLayout, GPUBindGroup, GPUPipelineLayout, GPURenderPipeline, GPUComputePipeline, GPUCommandBuffer, GPUTextureView, GPUQuerySet, GPUColor, WebGPUCanvas, GPUEvent, GPUEventKind, GPUEventHandler, GPUBufferBinding, GPUVertexState, GPUVertexBufferLayout, GPUVertexAttribute, GPUFragmentState, GPUColorTargetState, GPUBlendState, GPUBlendComponent, GPUPrimitiveState, GPUDepthStencilState, GPUMultisampleState, GPUProgrammableStage, GPUBindGroupLayoutEntry, GPUBindGroupEntry, GPURenderPassColorAttachment, GPURenderPassDepthStencilAttachment, GPUQuerySetDescriptor };
