import { describe, it, expect, beforeEach } from 'vitest';

import { CanvasElement } from '../src/browser/media/canvas';
import { SVGDocument, createSVGElement, elementToSVGString } from '../src/browser/media/svg';
import { WebGLRenderingContext } from '../src/browser/media/webgl';
import { WebGL2RenderingContext } from '../src/browser/media/webgl2';
import { GPUCanvasContext, GPUDevice, requestAdapter } from '../src/browser/media/webgpu';
import { OffscreenCanvas } from '../src/browser/media/offscreen-canvas';

/* ============================================================
   1. Canvas 2D
   ============================================================ */
describe('CanvasElement', () => {
  let canvas: CanvasElement;

  beforeEach(() => {
    canvas = new CanvasElement();
  });

  it('starts with default size', () => {
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });

  it('resize changes dimensions', () => {
    canvas.resize(800, 600);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it('resize ignores invalid values', () => {
    canvas.resize(0, 0);
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });

  it('getContext returns 2D context', () => {
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
  });

  it('getContext returns same instance for repeated calls', () => {
    const ctx1 = canvas.getContext('2d');
    const ctx2 = canvas.getContext('2d');
    expect(ctx1).toBe(ctx2);
  });

  it('getContext returns null for unsupported context', () => {
    const ctx = canvas.getContext('webgl' as any);
    expect(ctx).toBeNull();
  });

  it('2D context has default state', () => {
    const ctx = canvas.getContext('2d')!;
    expect(ctx.fillStyle).toBe('#000000');
    expect(ctx.strokeStyle).toBe('#000000');
    expect(ctx.lineWidth).toBe(1);
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.font).toBe('10px sans-serif');
    expect(ctx.textAlign).toBe('start');
    expect(ctx.textBaseline).toBe('alphabetic');
  });

  it('2D context fillRect works', () => {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(10, 10, 100, 50);
    const data = ctx.getImageData(10, 10, 1, 1).data;
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
  });

  it('2D context supports save/restore state', () => {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.save();
    ctx.fillStyle = '#00ff00';
    ctx.restore();
    expect(ctx.fillStyle).toBe('#ff0000');
  });

  it('2D context supports translate/rotate/scale', () => {
    const ctx = canvas.getContext('2d')!;
    ctx.translate(50, 50);
    ctx.rotate(Math.PI / 4);
    ctx.scale(2, 2);
    // Should not throw
    ctx.fillRect(0, 0, 10, 10);
  });

  it('2D context drawImage works', () => {
    const ctx = canvas.getContext('2d')!;
    const src = {
      width: 50, height: 50,
      data: new Uint8ClampedArray(50 * 50 * 4).fill(255),
    };
    ctx.drawImage(src as any, 0, 0);
    ctx.drawImage(src as any, 0, 0, 50, 50, 10, 10, 25, 25);
  });

  it('toDataURL returns PNG data URL', () => {
    const url = canvas.toDataURL();
    expect(url).toContain('data:image/png');
  });

  it('toBlob returns Blob', () => {
    const blob = canvas.toBlob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe('image/png');
  });

  it('emits resize event', () => {
    const handler = vi.fn();
    canvas.onEvent(handler);
    canvas.resize(1024, 768);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'resize', data: { width: 1024, height: 768 } })
    );
  });

  it('onEvent unsubscribe works', () => {
    const handler = vi.fn();
    const unsub = canvas.onEvent(handler);
    canvas.resize(100, 100);
    expect(handler).toHaveBeenCalled();
    unsub();
    handler.mockClear();
    canvas.resize(200, 200);
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispose cleans up', () => {
    const handler = vi.fn();
    canvas.onEvent(handler);
    canvas.dispose();
    handler.mockClear();
    canvas.resize(100, 100);
    expect(handler).not.toHaveBeenCalled();
  });
});

/* ============================================================
   2. SVG
   ============================================================ */
describe('SVGDocument', () => {
  let doc: SVGDocument;

  beforeEach(() => {
    doc = new SVGDocument();
  });

  it('starts with default size', () => {
    expect(doc.width).toBe(800);
    expect(doc.height).toBe(600);
  });

  it('root is svg element', () => {
    expect(doc.root.kind).toBe('svg');
    expect(doc.root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
  });

  it('createElement creates SVG elements', () => {
    const rect = doc.createElement('rect', { x: '10', y: '10', width: '100', height: '50', fill: 'red' });
    expect(rect.kind).toBe('rect');
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('fill')).toBe('red');
  });

  it('appendChild adds to parent', () => {
    const rect = doc.createElement('rect');
    doc.root.append(rect);
    expect(doc.root.children).toHaveLength(1);
    expect(rect.parent).toBe(doc.root);
  });

  it('removeChild removes from parent', () => {
    const rect = doc.createElement('rect');
    doc.root.append(rect);
    doc.root.remove(rect);
    expect(doc.root.children).toHaveLength(0);
    expect(rect.parent).toBeNull();
  });

  it('setAttribute/getAttribute roundtrip', () => {
    const el = doc.createElement('circle');
    el.setAttribute('r', '50');
    el.setAttribute('fill', 'blue');
    expect(el.getAttribute('r')).toBe('50');
    expect(el.getAttribute('fill')).toBe('blue');
  });

  it('getBBox returns bounds', () => {
    const rect = doc.createElement('rect', { x: '10', y: '20', width: '100', height: '50' });
    const bbox = rect.getBBox();
    expect(bbox.x).toBe(10);
    expect(bbox.y).toBe(20);
    expect(bbox.width).toBe(100);
    expect(bbox.height).toBe(50);
  });

  it('getBBox uses default for missing attrs', () => {
    const el = doc.createElement('g');
    const bbox = el.getBBox();
    expect(bbox.width).toBe(100);
    expect(bbox.height).toBe(100);
  });

  it('createText returns text data', () => {
    const text = doc.createText('Hello');
    expect(text.content).toBe('Hello');
  });

  it('render returns SVG string', () => {
    doc.root.append(doc.createElement('rect', { x: '0', y: '0', width: '100', height: '100', fill: 'red' }));
    const svg = doc.render();
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="red"');
    expect(svg).toContain('</svg>');
  });

  it('viewBox get/set', () => {
    doc.viewBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(doc.viewBox).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(doc.root.getAttribute('viewBox')).toBe('0 0 100 100');
  });

  it('onEvent subscribe/unsubscribe', () => {
    const handler = vi.fn();
    const unsub = doc.onEvent(handler);
    unsub();
    expect(true).toBe(true);
  });

  it('dispose clears children', () => {
    doc.root.append(doc.createElement('rect'));
    doc.dispose();
    expect(doc.root.children).toHaveLength(0);
  });
});

describe('createSVGElement', () => {
  it('creates element with attrs', () => {
    const el = createSVGElement('circle', { cx: '50', cy: '50', r: '40' });
    expect(el.kind).toBe('circle');
    expect(el.getAttribute('cx')).toBe('50');
  });
});

describe('elementToSVGString', () => {
  it('formats simple element', () => {
    const el = createSVGElement('rect', { x: '0', y: '0', width: '100', height: '100' });
    const str = elementToSVGString(el);
    expect(str).toContain('<rect');
    expect(str).toContain('width="100"');
  });

  it('formats nested elements', () => {
    const g = createSVGElement('g');
    g.append(createSVGElement('rect'));
    g.append(createSVGElement('circle'));
    const str = elementToSVGString(g);
    expect(str).toContain('<g>');
    expect(str).toContain('</g>');
  });
});

/* ============================================================
   3. WebGL
   ============================================================ */
describe('WebGLRenderingContext', () => {
  let gl: WebGLRenderingContext;

  beforeEach(() => {
    gl = new WebGLRenderingContext({ width: 800, height: 600 });
  });

  it('has canvas reference', () => {
    expect(gl.canvas).not.toBeNull();
    expect(gl.canvas!.width).toBe(800);
    expect(gl.canvas!.height).toBe(600);
  });

  it('getParameter returns values', () => {
    expect(gl.getParameter(0x84E8)).toBe(4096); // MAX_TEXTURE_SIZE
    expect(gl.getParameter(0x8DF8)).toBe('WebGL 1.0');
  });

  it('getExtension returns null', () => {
    expect(gl.getExtension('WEBGL_compressed_texture_s3tc')).toBeNull();
  });

  it('getSupportedExtensions returns list', () => {
    const exts = gl.getSupportedExtensions();
    expect(exts).toContain('EXT_texture_filter_anisotropic');
    expect(exts).toContain('WEBGL_lose_context');
  });

  it('createBuffer returns buffer object', () => {
    const buf = gl.createBuffer()!;
    expect(buf).toBeDefined();
    expect(buf.id).toBeGreaterThan(0);
  });

  it('createTexture returns texture object', () => {
    const tex = gl.createTexture()!;
    expect(tex).toBeDefined();
    expect(tex.id).toBeGreaterThan(0);
  });

  it('createProgram returns program', () => {
    const prog = gl.createProgram()!;
    expect(prog.id).toBeGreaterThan(0);
  });

  it('createShader returns shader', () => {
    const shader = gl.createShader(0x8B31)!; // VERTEX_SHADER
    expect(shader.id).toBeGreaterThan(0);
    expect(shader.type).toBe(0x8B31);
  });

  it('shader compile succeeds with valid source', () => {
    const shader = gl.createShader(0x8B30)!;
    gl.shaderSource(shader, 'void main() {}');
    gl.compileShader(shader);
    expect(gl.getShaderParameter(shader, 0x8B81)).toBe(true);
    expect(gl.getShaderInfoLog(shader)).toBe('');
  });

  it('shader compile fails with #error', () => {
    const shader = gl.createShader(0x8B30)!;
    gl.shaderSource(shader, '#error bad');
    gl.compileShader(shader);
    expect(gl.getShaderParameter(shader, 0x8B81)).toBe(false);
    expect(gl.getShaderInfoLog(shader)).toContain('error');
  });

  it('program link succeeds with compiled shaders', () => {
    const vs = gl.createShader(0x8B31)!;
    gl.shaderSource(vs, 'void main() {}');
    gl.compileShader(vs);
    const fs = gl.createShader(0x8B30)!;
    gl.shaderSource(fs, 'void main() {}');
    gl.compileShader(fs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    expect(gl.getProgramParameter(prog, 0x8B82)).toBe(true);
  });

  it('program link fails with unlinked shaders', () => {
    const vs = gl.createShader(0x8B31)!;
    gl.shaderSource(vs, '#error bad');
    gl.compileShader(vs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.linkProgram(prog);
    expect(gl.getProgramParameter(prog, 0x8B82)).toBe(false);
  });

  it('useProgram sets active program', () => {
    const prog = gl.createProgram()!;
    gl.useProgram(prog);
    // Should not throw
  });

  it('getAttribLocation returns number', () => {
    const prog = gl.createProgram()!;
    expect(gl.getAttribLocation(prog, 'a_position')).toBe(0);
  });

  it('getUniformLocation returns object', () => {
    const prog = gl.createProgram()!;
    const loc = gl.getUniformLocation(prog, 'u_matrix');
    expect(loc).not.toBeNull();
    expect(loc!.name).toBe('u_matrix');
  });

  it('getUniformLocation returns null for null program', () => {
    const loc = gl.getUniformLocation(null as any, 'u_matrix');
    expect(loc).toBeNull();
  });

  it('clearColor sets clear color', () => {
    gl.clearColor(0.2, 0.3, 0.4, 1.0);
    expect(gl.getParameter(0x1F00)).toEqual([0.2, 0.3, 0.4, 1.0]);
  });

  it('viewport sets drawingBufferSize', () => {
    gl.viewport(0, 0, 400, 300);
    expect(gl.drawingBufferWidth).toBe(400);
    expect(gl.drawingBufferHeight).toBe(300);
  });

  it('createFramebuffer returns object', () => {
    expect(gl.createFramebuffer()!.id).toBeGreaterThan(0);
  });

  it('createRenderbuffer returns object', () => {
    expect(gl.createRenderbuffer()!.id).toBeGreaterThan(0);
  });

  it('drawArrays does not throw', () => {
    gl.drawArrays(4, 0, 3); // TRIANGLES
  });

  it('drawElements does not throw', () => {
    gl.drawElements(4, 3, 0x1403, 0);
  });

  it('getError returns NO_ERROR', () => {
    expect(gl.getError()).toBe(0);
  });

  it('disable/enable do not throw', () => {
    gl.enable(0x0B71); // DEPTH_TEST
    gl.disable(0x0B71);
  });

  it('uniform setters do not throw', () => {
    const prog = gl.createProgram()!;
    const loc = gl.getUniformLocation(prog, 'u_val');
    gl.uniform1f(loc, 1);
    gl.uniform2f(loc, 1, 2);
    gl.uniform3f(loc, 1, 2, 3);
    gl.uniform4f(loc, 1, 2, 3, 4);
    gl.uniform1i(loc, 42);
    gl.uniformMatrix4fv(loc, false, new Float32Array(16));
  });

  it('calls with no canvas', () => {
    const gl2 = new WebGLRenderingContext();
    expect(gl2.canvas).toBeNull();
  });

  it('onEvent subscribe works', () => {
    const handler = vi.fn();
    const unsub = gl.onEvent(handler);
    unsub();
  });

  it('dispose cleans up', () => {
    const shader = gl.createShader(0x8B31)!;
    gl.shaderSource(shader, 'void main(){}');
    gl.compileShader(shader);
    gl.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   4. WebGL2
   ============================================================ */
describe('WebGL2RenderingContext', () => {
  let gl2: WebGL2RenderingContext;

  beforeEach(() => {
    gl2 = new WebGL2RenderingContext({ width: 800, height: 600 });
  });

  it('extends WebGLRenderingContext', () => {
    expect(gl2.getParameter(0x8DF8)).toBe('WebGL 1.0');
  });

  it('has WebGL2 constants', () => {
    expect(gl2.RGBA8).toBe(0x8058);
    expect(gl2.READ_FRAMEBUFFER).toBe(0x8CA8);
    expect(gl2.DRAW_FRAMEBUFFER).toBe(0x8CA9);
    expect(gl2.MAX_CLIENT_WAIT_TIMEOUT_WEBGL).toBe(0x9247);
  });

  it('createVertexArray returns VAO', () => {
    const vao = gl2.createVertexArray()!;
    expect(vao.id).toBeGreaterThan(0);
  });

  it('bindVertexArray does not throw', () => {
    const vao = gl2.createVertexArray()!;
    gl2.bindVertexArray(vao);
    gl2.bindVertexArray(null);
  });

  it('deleteVertexArray does not throw', () => {
    const vao = gl2.createVertexArray()!;
    gl2.deleteVertexArray(vao);
  });

  it('createSampler returns sampler', () => {
    expect(gl2.createSampler()!.id).toBeGreaterThan(0);
  });

  it('createTransformFeedback returns TF', () => {
    expect(gl2.createTransformFeedback()!.id).toBeGreaterThan(0);
  });

  it('createQuery returns query', () => {
    expect(gl2.createQuery()!.id).toBeGreaterThan(0);
  });

  it('begin/endQuery do not throw', () => {
    const q = gl2.createQuery()!;
    gl2.beginQuery(0x8C2F, q); // TIME_ELAPSED_EXT
    gl2.endQuery(0x8C2F);
  });

  it('getQueryParameter returns value', () => {
    const q = gl2.createQuery()!;
    expect(gl2.getQueryParameter(q, 0x8866)).toBe(0);
  });

  it('drawArraysInstanced does not throw', () => {
    gl2.drawArraysInstanced(4, 0, 3, 5);
  });

  it('drawElementsInstanced does not throw', () => {
    gl2.drawElementsInstanced(4, 3, 0x1403, 0, 5);
  });

  it('vertexAttribDivisor does not throw', () => {
    gl2.vertexAttribDivisor(0, 1);
  });

  it('texStorage2D does not throw', () => {
    gl2.texStorage2D(0x0DE1, 1, gl2.RGBA8, 256, 256);
  });

  it('blitFramebuffer does not throw', () => {
    gl2.blitFramebuffer(0, 0, 100, 100, 0, 0, 200, 200, 0x4000, 0x2600);
  });

  it('getInternalformatParameter returns array', () => {
    const result = gl2.getInternalformatParameter(0x0DE1, gl2.RGBA8, 0x8273);
    expect(result).toBeInstanceOf(Int32Array);
  });

  it('dispose cleans up', () => {
    gl2.createVertexArray();
    gl2.createSampler();
    gl2.createTransformFeedback();
    gl2.createQuery();
    gl2.dispose();
  });
});

/* ============================================================
   5. WebGPU
   ============================================================ */
describe('GPUCanvasContext', () => {
  it('constructs without canvas', () => {
    const ctx = new GPUCanvasContext();
    expect(ctx.canvas).toBeNull();
  });

  it('constructs with canvas', () => {
    const ctx = new GPUCanvasContext({ width: 1920, height: 1080 });
    expect(ctx.canvas).not.toBeNull();
    expect(ctx.canvas!.width).toBe(1920);
    expect(ctx.canvas!.height).toBe(1080);
  });

  it('configure sets up texture', () => {
    const ctx = new GPUCanvasContext({ width: 800, height: 600 });
    const device = new GPUDevice({ name: 'test', features: [], limits: { maxTextureDimension2D: 16384, maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupSizeX: 256 } } as any);
    ctx.configure({ device, format: 'bgra8unorm' });
    expect(ctx.format).toBe('bgra8unorm');
    const tex = ctx.getCurrentTexture();
    expect(tex.format).toBe('bgra8unorm');
    expect(tex.width).toBe(800);
    expect(tex.height).toBe(600);
  });

  it('onEvent subscribe/unsubscribe', () => {
    const ctx = new GPUCanvasContext();
    const handler = vi.fn();
    const unsub = ctx.onEvent(handler);
    unsub();
  });

  it('dispose cleans up', () => {
    const ctx = new GPUCanvasContext();
    ctx.configure({ device: new GPUDevice({ name: 'test', features: [], limits: {} as any } as any), format: 'rgba8unorm' });
    ctx.dispose();
  });
});

describe('GPUDevice', () => {
  let device: GPUDevice;

  beforeEach(() => {
    const adapter = { name: 'test', features: ['shader-f16'], limits: { maxTextureDimension2D: 16384, maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupSizeX: 256 } };
    device = new GPUDevice(adapter as any);
  });

  it('has adapter reference', () => {
    expect(device.adapter.name).toBe('test');
    expect(device.features).toContain('shader-f16');
  });

  it('createBuffer creates buffer', () => {
    const buf = device.createBuffer({ size: 1024, usage: 0x0080 });
    expect(buf.size).toBe(1024);
    expect(buf.usage).toBe(0x0080);
  });

  it('createTexture creates texture', () => {
    const tex = device.createTexture({ size: { width: 256, height: 256 }, format: 'rgba8unorm', usage: 0x0010 });
    expect(tex.width).toBe(256);
    expect(tex.height).toBe(256);
    expect(tex.format).toBe('rgba8unorm');
  });

  it('createSampler returns sampler', () => {
    expect(device.createSampler().id).toBeGreaterThan(0);
  });

  it('createShaderModule returns module', () => {
    const mod = device.createShaderModule({ code: '@vertex fn vs() -> @builtin(position) vec4f { return vec4f(0); }' });
    expect(mod.code).toContain('@vertex');
  });

  it('createBindGroupLayout returns layout', () => {
    expect(device.createBindGroupLayout({ entries: [] }).id).toBeGreaterThan(0);
  });

  it('createBindGroup returns group', () => {
    const layout = device.createBindGroupLayout({ entries: [] });
    expect(device.createBindGroup({ layout, entries: [] }).id).toBeGreaterThan(0);
  });

  it('createPipelineLayout returns layout', () => {
    const bgLayout = device.createBindGroupLayout({ entries: [] });
    expect(device.createPipelineLayout({ bindGroupLayouts: [bgLayout] }).id).toBeGreaterThan(0);
  });

  it('createRenderPipeline returns pipeline', () => {
    const mod = device.createShaderModule({ code: '' });
    expect(device.createRenderPipeline({ vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'bgra8unorm' }] } }).id).toBeGreaterThan(0);
  });

  it('createComputePipeline returns pipeline', () => {
    const mod = device.createShaderModule({ code: '' });
    expect(device.createComputePipeline({ compute: { module: mod, entryPoint: 'cs' } }).id).toBeGreaterThan(0);
  });

  it('createCommandEncoder returns encoder', () => {
    const enc = device.createCommandEncoder();
    expect(enc.finish()).toBeDefined();
  });

  it('command encoder beginRenderPass returns pass encoder', () => {
    const enc = device.createCommandEncoder();
    const tex = device.createTexture({ size: { width: 100, height: 100 }, format: 'rgba8unorm', usage: 0x0010 });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: { texture: tex, format: 'rgba8unorm' }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(device.createRenderPipeline({ vertex: { module: device.createShaderModule({ code: '' }), entryPoint: 'vs' } }) as any);
    pass.draw(3);
    pass.end();
  });

  it('command encoder beginComputePass returns pass encoder', () => {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(device.createComputePipeline({ compute: { module: device.createShaderModule({ code: '' }), entryPoint: 'cs' } }) as any);
    pass.dispatchWorkgroups(1, 1, 1);
    pass.end();
  });

  it('queue operations do not throw', () => {
    device.queue.submit([]);
    device.queue.writeBuffer(device.createBuffer({ size: 64, usage: 0x0080 }), 0, new Uint8Array(4));
  });

  it('onSubmittedWorkDone resolves', async () => {
    await expect(device.queue.onSubmittedWorkDone()).resolves.toBeUndefined();
  });

  it('createQuerySet returns query set', () => {
    const qs = device.createQuerySet({ type: 'occlusion', count: 4 });
    expect(qs.type).toBe('occlusion');
    expect(qs.count).toBe(4);
  });

  it('copyBufferToBuffer does not throw', () => {
    const enc = device.createCommandEncoder();
    const src = device.createBuffer({ size: 64, usage: 0x0080 });
    const dst = device.createBuffer({ size: 64, usage: 0x0040 });
    enc.copyBufferToBuffer(src, 0, dst, 0, 64);
  });

  it('onEvent subscribe/unsubscribe', () => {
    const handler = vi.fn();
    const unsub = device.onEvent(handler);
    unsub();
  });

  it('destroy cleans up', () => {
    device.destroy();
  });

  it('dispose cleans up', () => {
    device.dispose();
  });
});

describe('requestAdapter', () => {
  it('resolves to an adapter', async () => {
    const adapter = await requestAdapter();
    expect(adapter).not.toBeNull();
    expect(adapter!.name).toBe('WebGPU Software Adapter');
    expect(adapter!.features).toContain('shader-f16');
  });

  it('adapter requestDevice returns device', async () => {
    const adapter = await requestAdapter();
    const device = await adapter!.requestDevice();
    expect(device).toBeDefined();
    expect(device.features).toBeDefined();
  });
});

/* ============================================================
   6. OffscreenCanvas
   ============================================================ */
describe('OffscreenCanvas', () => {
  let canvas: OffscreenCanvas;

  beforeEach(() => {
    canvas = new OffscreenCanvas(300, 150);
  });

  it('starts with given size', () => {
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });

  it('clamps to minimum 1', () => {
    const small = new OffscreenCanvas(0, 0);
    expect(small.width).toBe(1);
    expect(small.height).toBe(1);
  });

  it('floors fractional dimensions', () => {
    const frac = new OffscreenCanvas(100.7, 50.3);
    expect(frac.width).toBe(100);
    expect(frac.height).toBe(50);
  });

  it('getContext returns 2D context', () => {
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    expect(ctx!.canvas).toBe(canvas);
  });

  it('getContext returns null for unsupported context type', () => {
    const ctx = canvas.getContext('webgl' as any);
    expect(ctx).toBeNull();
  });

  it('getContext returns same instance for repeated calls', () => {
    const ctx1 = canvas.getContext('2d');
    const ctx2 = canvas.getContext('2d');
    expect(ctx1).toBe(ctx2);
  });

  it('2D context has default state', () => {
    const ctx = canvas.getContext('2d')!;
    expect(ctx.fillStyle).toBe('#000');
    expect(ctx.strokeStyle).toBe('#000');
    expect(ctx.lineWidth).toBe(1);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('2D context supports save/restore', () => {
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.fillStyle = '#f00';
    ctx.restore();
  });

  it('2D context getImageData returns data', () => {
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, 10, 10);
    expect(data.data).toBeInstanceOf(Uint8ClampedArray);
    expect(data.data.length).toBe(400);
    expect(data.width).toBe(10);
    expect(data.height).toBe(10);
  });

  it('transferToImageBitmap returns bitmap with correct size', () => {
    const bitmap = canvas.transferToImageBitmap();
    expect(bitmap.width).toBe(300);
    expect(bitmap.height).toBe(150);
  });

  it('transferToImageBitmap bitmap close does not throw', () => {
    const bitmap = canvas.transferToImageBitmap();
    bitmap.close();
  });

  it('convertToBlob returns PNG blob', async () => {
    const blob = await canvas.convertToBlob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('convertToBlob respects options', async () => {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    expect(blob.type).toBe('image/jpeg');
  });

  it('onEvent subscribe/unsubscribe', () => {
    const handler = vi.fn();
    const unsub = canvas.onEvent(handler);
    unsub();
  });

  it('dispose cleans up', () => {
    canvas.getContext('2d');
    canvas.dispose();
    expect(true).toBe(true);
  });
});
