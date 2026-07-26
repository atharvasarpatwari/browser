/**
 * @file canvas/canvas-element.ts
 * HTMLCanvasElement — the <canvas> DOM element with 2D context support.
 */

import { CanvasRenderingContext2D } from './canvas-context';

export class HTMLCanvasElement {
  private _width: number;
  private _height: number;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _attributes: Map<string, string> = new Map();

  constructor(width = 300, height = 150) {
    this._width = width;
    this._height = height;
  }

  // ── Dimension properties ──

  get width(): number { return this._width; }
  set width(v: number) {
    if (v <= 0) return;
    this._width = v;
    // Reset context when dimensions change (per spec)
    this._ctx = null;
  }

  get height(): number { return this._height; }
  set height(v: number) {
    if (v <= 0) return;
    this._height = v;
    this._ctx = null;
  }

  get clientWidth(): number { return this._width; }
  get clientHeight(): number { return this._height; }

  // ── Context ──

  getContext(contextId: string, options?: any): CanvasRenderingContext2D | null {
    if (contextId === '2d') {
      if (!this._ctx) {
        this._ctx = new CanvasRenderingContext2D(this._width, this._height);
      }
      return this._ctx;
    }
    return null;
  }

  // ── Attributes ──

  getAttribute(name: string): string | null {
    if (name === 'width') return String(this._width);
    if (name === 'height') return String(this._height);
    return this._attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this._attributes.set(name, value);
    if (name === 'width') {
      const v = parseInt(value, 10);
      if (!isNaN(v) && v > 0) this.width = v;
    }
    if (name === 'height') {
      const v = parseInt(value, 10);
      if (!isNaN(v) && v > 0) this.height = v;
    }
  }

  removeAttribute(name: string): void {
    this._attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this._attributes.has(name);
  }

  // ── Export ──

  toDataURL(type?: string, quality?: number): string {
    if (!this._ctx) {
      // Create a blank canvas context for export
      this._ctx = new CanvasRenderingContext2D(this._width, this._height);
    }
    return this._ctx.toDataURL(type, quality);
  }

  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void {
    if (!this._ctx) {
      this._ctx = new CanvasRenderingContext2D(this._width, this._height);
    }
    this._ctx.toBlob(callback, type, quality);
  }

  // ── Raw pixel data access ──

  /** Get the raw pixel buffer (RGBA Uint8ClampedArray). */
  getPixelData(): Uint8ClampedArray {
    if (!this._ctx) {
      this._ctx = new CanvasRenderingContext2D(this._width, this._height);
    }
    return this._ctx._data;
  }
}
