import type { IDisposable } from '../../app/dependency-container';

interface IZoomManager extends IDisposable {
  getZoom(): number;
  setZoom(level: number): boolean;
  zoomIn(): number;
  zoomOut(): number;
  reset(): void;
  get minZoom(): number;
  get maxZoom(): number;
  get step(): number;
  onEvent(handler: ZoomEventHandler): () => void;
}

type ZoomEventKind = 'changed' | 'reset';
interface ZoomEvent {
  readonly kind: ZoomEventKind;
  readonly zoom: number;
}

type ZoomEventHandler = (event: ZoomEvent) => void;

const MIN_ZOOM = 25;
const MAX_ZOOM = 300;
const ZOOM_STEP = 10;
const DEFAULT_ZOOM = 100;

class ZoomManager implements IZoomManager {
  private _zoom = DEFAULT_ZOOM;
  private handlers = new Set<ZoomEventHandler>();

  get minZoom(): number { return MIN_ZOOM; }
  get maxZoom(): number { return MAX_ZOOM; }
  get step(): number { return ZOOM_STEP; }

  getZoom(): number {
    return this._zoom;
  }

  setZoom(level: number): boolean {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(level)));
    if (clamped === this._zoom) return false;
    this._zoom = clamped;
    this.emit({ kind: 'changed', zoom: this._zoom });
    return true;
  }

  zoomIn(): number {
    const newZoom = Math.min(this._zoom + ZOOM_STEP, MAX_ZOOM);
    this.setZoom(newZoom);
    return this._zoom;
  }

  zoomOut(): number {
    const newZoom = Math.max(this._zoom - ZOOM_STEP, MIN_ZOOM);
    this.setZoom(newZoom);
    return this._zoom;
  }

  reset(): void {
    if (this._zoom === DEFAULT_ZOOM) return;
    this._zoom = DEFAULT_ZOOM;
    this.emit({ kind: 'reset', zoom: this._zoom });
  }

  onEvent(handler: ZoomEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: ZoomEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.handlers.clear();
    this._zoom = DEFAULT_ZOOM;
  }
}

export { ZoomManager, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP, DEFAULT_ZOOM };
export type { IZoomManager, ZoomEvent, ZoomEventKind, ZoomEventHandler };
