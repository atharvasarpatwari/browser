import type { IDisposable } from '../../app/dependency-container';
import { WebGLRenderingContext, type IWebGLRenderingContext, type WebGLCanvas, type WebGLBuffer, type WebGLTexture, type WebGLProgram, type WebGLShader, type WebGLFramebuffer, type WebGLUniformLocation, type WebGLEvent, type WebGLEventKind, type WebGLEventHandler } from './webgl';

interface IWebGL2RenderingContext extends IWebGLRenderingContext {
  readonly MAX_CLIENT_WAIT_TIMEOUT_WEBGL: number;
  createVertexArray(): WebGLVertexArrayObject | null;
  bindVertexArray(vao: WebGLVertexArrayObject | null): void;
  deleteVertexArray(vao: WebGLVertexArrayObject | null): void;
  createSampler(): WebGLSampler | null;
  bindSampler(unit: number, sampler: WebGLSampler | null): void;
  createTransformFeedback(): WebGLTransformFeedback | null;
  bindTransformFeedback(target: number, tf: WebGLTransformFeedback | null): void;
  createQuery(): WebGLQuery | null;
  beginQuery(target: number, query: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(query: WebGLQuery, pname: number): unknown;
  uniform1uiv(location: WebGLUniformLocation | null, value: Uint32Array): void;
  uniformBlockBinding(program: WebGLProgram, uniformBlockIndex: number, uniformBlockBinding: number): void;
  getUniformBlockIndex(program: WebGLProgram, name: string): number;
  bindBufferBase(target: number, index: number, buffer: WebGLBuffer | null): void;
  drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void;
  drawElementsInstanced(mode: number, count: number, type: number, offset: number, instanceCount: number): void;
  vertexAttribDivisor(index: number, divisor: number): void;
  texStorage2D(target: number, levels: number, internalformat: number, width: number, height: number): void;
  texSubImage2D(target: number, level: number, xoffset: number, yoffset: number, width: number, height: number, format: number, type: number, pixels: ArrayBufferView | null): void;
  blitFramebuffer(srcX0: number, srcY0: number, srcX1: number, srcY1: number, dstX0: number, dstY0: number, dstX1: number, dstY1: number, mask: number, filter: number): void;
  readBuffer(src: number): void;
  drawBuffers(buffers: number[]): void;
  getInternalformatParameter(target: number, internalformat: number, pname: number): Int32Array;
  readonly RGBA8: number;
  readonly READ_FRAMEBUFFER: number;
  readonly DRAW_FRAMEBUFFER: number;
}

interface WebGLVertexArrayObject { readonly id: number }
interface WebGLSampler { readonly id: number }
interface WebGLTransformFeedback { readonly id: number }
interface WebGLQuery { readonly id: number }

let _objectId2 = 1;

class WebGL2RenderingContext extends WebGLRenderingContext implements IWebGL2RenderingContext {
  readonly MAX_CLIENT_WAIT_TIMEOUT_WEBGL = 0x9247;
  readonly RGBA8 = 0x8058;
  readonly READ_FRAMEBUFFER = 0x8CA8;
  readonly DRAW_FRAMEBUFFER = 0x8CA9;

  private _vaos = new Map<number, WebGLVertexArrayObject>();
  private _samplers = new Map<number, WebGLSampler>();
  private _tfs = new Map<number, WebGLTransformFeedback>();
  private _queries = new Map<number, WebGLQuery>();

  constructor(canvas?: WebGLCanvas) {
    super(canvas);
  }

  createVertexArray(): WebGLVertexArrayObject | null {
    const id = _objectId2++;
    const vao: WebGLVertexArrayObject = { id };
    this._vaos.set(id, vao);
    return vao;
  }

  bindVertexArray(_vao: WebGLVertexArrayObject | null): void { }

  deleteVertexArray(vao: WebGLVertexArrayObject | null): void {
    if (vao) this._vaos.delete(vao.id);
  }

  createSampler(): WebGLSampler | null {
    const id = _objectId2++;
    const sampler: WebGLSampler = { id };
    this._samplers.set(id, sampler);
    return sampler;
  }

  bindSampler(_unit: number, _sampler: WebGLSampler | null): void { }

  createTransformFeedback(): WebGLTransformFeedback | null {
    const id = _objectId2++;
    const tf: WebGLTransformFeedback = { id };
    this._tfs.set(id, tf);
    return tf;
  }

  bindTransformFeedback(_target: number, _tf: WebGLTransformFeedback | null): void { }

  createQuery(): WebGLQuery | null {
    const id = _objectId2++;
    const query: WebGLQuery = { id };
    this._queries.set(id, query);
    return query;
  }

  beginQuery(_target: number, _query: WebGLQuery): void { }
  endQuery(_target: number): void { }

  getQueryParameter(_query: WebGLQuery, _pname: number): unknown {
    return 0;
  }

  uniform1uiv(_location: WebGLUniformLocation | null, _value: Uint32Array): void { }
  uniformBlockBinding(_program: WebGLProgram, _uniformBlockIndex: number, _uniformBlockBinding: number): void { }

  getUniformBlockIndex(_program: WebGLProgram, _name: string): number {
    return 0;
  }

  bindBufferBase(_target: number, _index: number, _buffer: WebGLBuffer | null): void { }

  drawArraysInstanced(_mode: number, _first: number, _count: number, _instanceCount: number): void { }

  drawElementsInstanced(_mode: number, _count: number, _type: number, _offset: number, _instanceCount: number): void { }

  vertexAttribDivisor(_index: number, _divisor: number): void { }

  texStorage2D(_target: number, _levels: number, _internalformat: number, _width: number, _height: number): void { }

  texSubImage2D(_target: number, _level: number, _xoffset: number, _yoffset: number, _width: number, _height: number, _format: number, _type: number, _pixels: ArrayBufferView | null): void { }

  blitFramebuffer(_srcX0: number, _srcY0: number, _srcX1: number, _srcY1: number, _dstX0: number, _dstY0: number, _dstX1: number, _dstY1: number, _mask: number, _filter: number): void { }

  readBuffer(_src: number): void { }

  drawBuffers(_buffers: number[]): void { }

  getInternalformatParameter(_target: number, _internalformat: number, _pname: number): Int32Array {
    return new Int32Array([1]);
  }

  dispose(): void {
    this._vaos.clear();
    this._samplers.clear();
    this._tfs.clear();
    this._queries.clear();
    super.dispose();
  }
}

export { WebGL2RenderingContext };
export type { IWebGL2RenderingContext, WebGLVertexArrayObject, WebGLSampler, WebGLTransformFeedback, WebGLQuery };
