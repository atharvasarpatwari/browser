import type { IDisposable } from '../../app/dependency-container';

interface IOffscreenCanvas extends IDisposable {
  readonly width: number;
  readonly height: number;
  getContext(contextType: '2d', contextOptions?: OffscreenCanvasRenderingContext2DSettings): OffscreenCanvasRenderingContext2D | null;
  transferToImageBitmap(): ImageBitmap;
  convertToBlob(options?: ImageEncodeOptions): Promise<Blob>;
  onEvent(handler: OffscreenCanvasEventHandler): () => void;
}

interface OffscreenCanvasRenderingContext2DSettings {
  alpha?: boolean;
  desynchronized?: boolean;
  willReadFrequently?: boolean;
  colorSpace?: string;
}

interface ImageEncodeOptions {
  type?: string;
  quality?: number;
}

interface ImageBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

interface OffscreenCanvasEvent {
  readonly kind: OffscreenCanvasEventKind;
  readonly data?: Record<string, unknown>;
}

type OffscreenCanvasEventKind = 'contextlost' | 'contextrestored';

type OffscreenCanvasEventHandler = (event: OffscreenCanvasEvent) => void;

class OffscreenCanvasRenderingContext2D {
  private _width: number;
  private _height: number;
  readonly canvas: OffscreenCanvas;

  constructor(canvas: OffscreenCanvas, width: number, height: number) {
    this.canvas = canvas;
    this._width = width;
    this._height = height;
  }

  get width(): number { return this._width; }
  get height(): number { return this._height; }

  clearRect(x: number, y: number, w: number, h: number): void { }
  fillRect(x: number, y: number, w: number, h: number): void { }
  strokeRect(x: number, y: number, w: number, h: number): void { }

  fillStyle: string = '#000';
  strokeStyle: string = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  font = '10px sans-serif';
  textAlign: string = 'start';
  textBaseline: string = 'alphabetic';

  getImageData(x: number, y: number, w: number, h: number): ImageData {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h, colorSpace: 'srgb' };
  }

  putImageData(_imagedata: ImageData, _dx: number, _dy: number): void { }

  save(): void { }
  restore(): void { }
  translate(_x: number, _y: number): void { }
  rotate(_angle: number): void { }
  scale(_x: number, _y: number): void { }
}

interface ImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: string;
}

class OffscreenCanvas implements IOffscreenCanvas {
  private _width: number;
  private _height: number;
  private _ctx: OffscreenCanvasRenderingContext2D | null = null;
  private _handlers = new Set<OffscreenCanvasEventHandler>();

  constructor(width: number, height: number) {
    this._width = Math.max(1, Math.floor(width));
    this._height = Math.max(1, Math.floor(height));
  }

  get width(): number { return this._width; }
  get height(): number { return this._height; }

  getContext(contextType: '2d', _contextOptions?: OffscreenCanvasRenderingContext2DSettings): OffscreenCanvasRenderingContext2D | null {
    if (contextType !== '2d') return null;
    if (!this._ctx) {
      this._ctx = new OffscreenCanvasRenderingContext2D(this, this._width, this._height);
    }
    return this._ctx;
  }

  transferToImageBitmap(): ImageBitmap {
    const bitmap: ImageBitmap = {
      width: this._width,
      height: this._height,
      close() { },
    };
    return bitmap;
  }

  async convertToBlob(options?: ImageEncodeOptions): Promise<Blob> {
    const type = options?.type ?? 'image/png';
    const header = type === 'image/png' ? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) : new Uint8Array(0);
    return new Blob([header], { type });
  }

  onEvent(handler: OffscreenCanvasEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: OffscreenCanvasEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._ctx = null;
  }
}

export { OffscreenCanvas, OffscreenCanvasRenderingContext2D };
export type { IOffscreenCanvas, OffscreenCanvasRenderingContext2DSettings, ImageEncodeOptions, ImageBitmap, ImageData, OffscreenCanvasEvent, OffscreenCanvasEventKind, OffscreenCanvasEventHandler };
