import type { IDisposable } from '../../app/dependency-container';

interface IAnimationFrameService extends IDisposable {
  request(callback: (timestamp: number) => void): number;
  cancel(id: number): void;
  cancelAll(): void;
  runPending(now?: number): number;
  get pending(): number;
  get fps(): number;
  setFPS(fps: number): void;
  onEvent(handler: AnimationFrameEventHandler): () => void;
}

type AnimationFrameEventKind = 'requested' | 'cancelled' | 'executed';
type AnimationFrameEventHandler = (event: AnimationFrameEvent) => void;

interface AnimationFrameEvent {
  readonly kind: AnimationFrameEventKind;
  readonly data?: Record<string, unknown>;
}

class AnimationFrameService implements IAnimationFrameService {
  private _nextId = 1;
  private _callbacks = new Map<number, (timestamp: number) => void>();
  private _fps = 60;
  private _handlers = new Set<AnimationFrameEventHandler>();

  request(callback: (timestamp: number) => void): number {
    const id = this._nextId++;
    this._callbacks.set(id, callback);
    this.emit({ kind: 'requested', data: { id } });
    return id;
  }

  cancel(id: number): void {
    this._callbacks.delete(id);
    this.emit({ kind: 'cancelled', data: { id } });
  }

  cancelAll(): void {
    this._callbacks.clear();
  }

  runPending(now: number = Date.now()): number {
    const entries = [...this._callbacks.entries()];
    this._callbacks.clear();
    let count = 0;
    for (const [id, cb] of entries) {
      try {
        cb(now);
        count++;
        this.emit({ kind: 'executed', data: { id, timestamp: now } });
      } catch { }
    }
    return count;
  }

  get pending(): number {
    return this._callbacks.size;
  }

  get fps(): number {
    return this._fps;
  }

  setFPS(fps: number): void {
    this._fps = Math.max(1, Math.min(120, fps));
  }

  onEvent(handler: AnimationFrameEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: AnimationFrameEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._callbacks.clear();
  }
}

export { AnimationFrameService };
export type { IAnimationFrameService, AnimationFrameEvent, AnimationFrameEventKind, AnimationFrameEventHandler };
