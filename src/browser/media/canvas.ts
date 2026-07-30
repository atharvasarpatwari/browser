import type { IDisposable } from '../../app/dependency-container';
import { HTMLCanvasElement as InternalCanvas } from '../rendering/canvas/canvas-element';
import { CanvasRenderingContext2D } from '../rendering/canvas/canvas-context';

interface ICanvasElement extends IDisposable {
  readonly width: number;
  readonly height: number;
  resize(w: number, h: number): void;
  getContext(contextId: '2d', options?: CanvasOptions): CanvasRenderingContext2D | null;
  toDataURL(type?: string, quality?: number): string;
  toBlob(type?: string, quality?: number): Blob | null;
  onEvent(handler: CanvasEventHandler): () => void;
}

interface CanvasOptions {
  alpha?: boolean;
  desynchronized?: boolean;
  willReadFrequently?: boolean;
  colorSpace?: string;
}

interface CanvasEvent {
  readonly kind: CanvasEventKind;
  readonly data?: Record<string, unknown>;
}

type CanvasEventKind = 'resize' | 'contextlost' | 'contextrestored';

type CanvasEventHandler = (event: CanvasEvent) => void;

class CanvasElement implements ICanvasElement {
  private _canvas: InternalCanvas;
  private _contextId: string | null = null;
  private _handlers = new Set<CanvasEventHandler>();

  constructor(width = 300, height = 150) {
    this._canvas = new InternalCanvas(width, height);
  }

  get width(): number { return this._canvas.width; }
  get height(): number { return this._canvas.height; }

  resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this._canvas.width = w;
    this._canvas.height = h;
    this.emit({ kind: 'resize', data: { width: w, height: h } });
  }

  getContext(contextId: '2d', _options?: CanvasOptions): CanvasRenderingContext2D | null {
    if (contextId !== '2d') return null;
    this._contextId = contextId;
    return this._canvas.getContext('2d');
  }

  toDataURL(type = 'image/png', quality?: number): string {
    const ctx = this._canvas.getContext('2d');
    if (!ctx) return '';
    return ctx.toDataURL(type, quality);
  }

  toBlob(type?: string, quality?: number): Blob | null {
    const dataUrl = this.toDataURL(type, quality);
    if (!dataUrl) return null;
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: type ?? 'image/png' });
  }

  onEvent(handler: CanvasEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CanvasEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._canvas = new InternalCanvas(0, 0);
  }
}

export { CanvasElement };
export type { ICanvasElement, CanvasEvent, CanvasEventKind, CanvasEventHandler, CanvasOptions };
