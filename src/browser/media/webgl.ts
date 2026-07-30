import type { IDisposable } from '../../app/dependency-container';

interface IWebGLRenderingContext extends IDisposable {
  readonly canvas: WebGLCanvas | null;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
  getParameter(pname: number): unknown;
  getExtension(name: string): object | null;
  getSupportedExtensions(): string[];
  createBuffer(): WebGLBuffer | null;
  createTexture(): WebGLTexture | null;
  createProgram(): WebGLProgram | null;
  createShader(type: number): WebGLShader | null;
  createFramebuffer(): WebGLFramebuffer | null;
  createRenderbuffer(): WebGLRenderbuffer | null;
  shaderSource(shader: WebGLShader, source: string): void;
  compileShader(shader: WebGLShader): void;
  getShaderParameter(shader: WebGLShader, pname: number): unknown;
  getShaderInfoLog(shader: WebGLShader): string;
  attachShader(program: WebGLProgram, shader: WebGLShader): void;
  linkProgram(program: WebGLProgram): void;
  getProgramParameter(program: WebGLProgram, pname: number): unknown;
  getProgramInfoLog(program: WebGLProgram): string;
  useProgram(program: WebGLProgram | null): void;
  getAttribLocation(program: WebGLProgram, name: string): number;
  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;
  uniform1f(location: WebGLUniformLocation | null, x: number): void;
  uniform2f(location: WebGLUniformLocation | null, x: number, y: number): void;
  uniform3f(location: WebGLUniformLocation | null, x: number, y: number, z: number): void;
  uniform4f(location: WebGLUniformLocation | null, x: number, y: number, z: number, w: number): void;
  uniform1i(location: WebGLUniformLocation | null, x: number): void;
  uniformMatrix4fv(location: WebGLUniformLocation | null, transpose: boolean, value: Float32Array): void;
  bindBuffer(target: number, buffer: WebGLBuffer | null): void;
  bufferData(target: number, data: BufferSource | number, usage: number): void;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void;
  drawArrays(mode: number, first: number, count: number): void;
  drawElements(mode: number, count: number, type: number, offset: number): void;
  clear(mask: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  viewport(x: number, y: number, w: number, h: number): void;
  enable(cap: number): void;
  disable(cap: number): void;
  blendFunc(sfactor: number, dfactor: number): void;
  pixelStorei(pname: number, param: number): void;
  activeTexture(texture: number): void;
  bindTexture(target: number, texture: WebGLTexture | null): void;
  texImage2D(target: number, level: number, internalformat: number, width: number, height: number, border: number, format: number, type: number, pixels: ArrayBufferView | null): void;
  texParameteri(target: number, pname: number, param: number): void;
  getError(): number;
  onEvent(handler: WebGLEventHandler): () => void;
}

interface WebGLCanvas {
  width: number;
  height: number;
}

interface WebGLBuffer { readonly id: number }
interface WebGLTexture { readonly id: number }
interface WebGLProgram { readonly id: number }
interface WebGLShader { readonly id: number; type: number }
interface WebGLFramebuffer { readonly id: number }
interface WebGLRenderbuffer { readonly id: number }
interface WebGLUniformLocation { readonly id: number; readonly name: string }

type BufferSource = ArrayBuffer | ArrayBufferView;

interface WebGLEvent {
  readonly kind: WebGLEventKind;
  readonly data?: Record<string, unknown>;
}
type WebGLEventKind = 'contextlost' | 'contextrestored';
type WebGLEventHandler = (event: WebGLEvent) => void;

const NO_ERROR = 0;
const INVALID_ENUM = 0x0500;
const INVALID_VALUE = 0x0501;
const INVALID_OPERATION = 0x0502;

let _objectId = 1;

class WebGLRenderingContext implements IWebGLRenderingContext {
  readonly canvas: WebGLCanvas | null;
  drawingBufferWidth = 0;
  drawingBufferHeight = 0;
  private _error = NO_ERROR;
  private _program: WebGLProgram | null = null;
  private _shaders = new Map<number, WebGLShader>();
  private _programs = new Map<number, WebGLProgram>();
  private _buffers = new Map<number, WebGLBuffer>();
  private _textures = new Map<number, WebGLTexture>();
  private _clearColor: [number, number, number, number] = [0, 0, 0, 0];
  private _handlers = new Set<WebGLEventHandler>();

  constructor(canvas?: WebGLCanvas) {
    this.canvas = canvas ?? null;
    if (canvas) {
      this.drawingBufferWidth = canvas.width;
      this.drawingBufferHeight = canvas.height;
    }
  }

  getParameter(pname: number): unknown {
    if (pname === 0x84E8) return 4096;
    if (pname === 0x84E9) return 16;
    if (pname === 0x8869) return 16;
    if (pname === 0x8872) return 32;
    if (pname === 0x8DF8) return 'WebGL 1.0';
    if (pname === 0x1F00) return this._clearColor;
    return null;
  }

  getExtension(_name: string): object | null { return null; }

  getSupportedExtensions(): string[] {
    return ['EXT_texture_filter_anisotropic', 'WEBGL_lose_context'];
  }

  createBuffer(): WebGLBuffer {
    const id = _objectId++;
    const buf: WebGLBuffer = { id };
    this._buffers.set(id, buf);
    return buf;
  }

  createTexture(): WebGLTexture {
    const id = _objectId++;
    const tex: WebGLTexture = { id };
    this._textures.set(id, tex);
    return tex;
  }

  createProgram(): WebGLProgram {
    const id = _objectId++;
    const prog: WebGLProgram = { id };
    this._programs.set(id, prog);
    return prog;
  }

  createShader(type: number): WebGLShader {
    const id = _objectId++;
    const shader: WebGLShader = { id, type };
    this._shaders.set(id, shader);
    return shader;
  }

  createFramebuffer(): WebGLFramebuffer {
    return { id: _objectId++ };
  }

  createRenderbuffer(): WebGLRenderbuffer {
    return { id: _objectId++ };
  }

  private _shaderSources = new Map<number, string>();
  private _shaderCompiled = new Map<number, boolean>();

  shaderSource(shader: WebGLShader, source: string): void {
    this._shaderSources.set(shader.id, source);
  }

  compileShader(shader: WebGLShader): void {
    const src = this._shaderSources.get(shader.id) ?? '';
    const ok = src.length > 0 && !src.includes('#error');
    this._shaderCompiled.set(shader.id, ok);
  }

  getShaderParameter(shader: WebGLShader, pname: number): unknown {
    if (pname === 0x8B81) return this._shaderCompiled.get(shader.id) ?? false;
    return false;
  }

  getShaderInfoLog(shader: WebGLShader): string {
    return this._shaderCompiled.get(shader.id) ? '' : 'Shader compilation error';
  }

  attachShader(program: WebGLProgram, shader: WebGLShader): void {
    if (!this._programAttachments.has(program.id)) {
      this._programAttachments.set(program.id, []);
    }
    this._programAttachments.get(program.id)!.push(shader);
  }

  private _programAttachments = new Map<number, WebGLShader[]>();
  private _programLinked = new Map<number, boolean>();

  linkProgram(program: WebGLProgram): void {
    const shaders = this._programAttachments.get(program.id) ?? [];
    const allCompiled = shaders.every(s => this._shaderCompiled.get(s.id));
    this._programLinked.set(program.id, allCompiled && shaders.length >= 2);
  }

  getProgramParameter(program: WebGLProgram, pname: number): unknown {
    if (pname === 0x8B82) return this._programLinked.get(program.id) ?? false;
    if (pname === 0x8698) return 0;
    return false;
  }

  getProgramInfoLog(program: WebGLProgram): string {
    return this._programLinked.get(program.id) ? '' : 'Program link error';
  }

  useProgram(program: WebGLProgram | null): void {
    this._program = program;
  }

  getAttribLocation(_program: WebGLProgram, _name: string): number {
    return 0;
  }

  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    if (!program) return null;
    return { id: program.id, name };
  }

  uniform1f(_location: WebGLUniformLocation | null, _x: number): void { }
  uniform2f(_location: WebGLUniformLocation | null, _x: number, _y: number): void { }
  uniform3f(_location: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void { }
  uniform4f(_location: WebGLUniformLocation | null, _x: number, _y: number, _z: number, _w: number): void { }
  uniform1i(_location: WebGLUniformLocation | null, _x: number): void { }
  uniformMatrix4fv(_location: WebGLUniformLocation | null, _transpose: boolean, _value: Float32Array): void { }

  bindBuffer(_target: number, _buffer: WebGLBuffer | null): void { }

  bufferData(_target: number, _data: BufferSource | number, _usage: number): void { }

  enableVertexAttribArray(_index: number): void { }

  vertexAttribPointer(_index: number, _size: number, _type: number, _normalized: boolean, _stride: number, _offset: number): void { }

  drawArrays(_mode: number, _first: number, _count: number): void { }

  drawElements(_mode: number, _count: number, _type: number, _offset: number): void { }

  clear(_mask: number): void { }

  clearColor(r: number, g: number, b: number, a: number): void {
    this._clearColor = [r, g, b, a];
  }

  viewport(x: number, y: number, w: number, h: number): void {
    this.drawingBufferWidth = w;
    this.drawingBufferHeight = h;
  }

  enable(_cap: number): void { }
  disable(_cap: number): void { }
  blendFunc(_sfactor: number, _dfactor: number): void { }
  pixelStorei(_pname: number, _param: number): void { }
  activeTexture(_texture: number): void { }
  bindTexture(_target: number, _texture: WebGLTexture | null): void { }

  texImage2D(_target: number, _level: number, _internalformat: number, _width: number, _height: number, _border: number, _format: number, _type: number, _pixels: ArrayBufferView | null): void { }

  texParameteri(_target: number, _pname: number, _param: number): void { }

  getError(): number {
    const err = this._error;
    this._error = NO_ERROR;
    return err;
  }

  onEvent(handler: WebGLEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: WebGLEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._shaders.clear();
    this._programs.clear();
    this._buffers.clear();
    this._textures.clear();
    this._program = null;
  }
}

export { WebGLRenderingContext, NO_ERROR, INVALID_ENUM, INVALID_VALUE, INVALID_OPERATION };
export type { IWebGLRenderingContext, WebGLCanvas, WebGLBuffer, WebGLTexture, WebGLProgram, WebGLShader, WebGLFramebuffer, WebGLRenderbuffer, WebGLUniformLocation, WebGLEvent, WebGLEventKind, WebGLEventHandler };
