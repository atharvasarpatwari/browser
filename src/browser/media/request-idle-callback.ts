import type { IDisposable } from '../../app/dependency-container';

interface IIdleCallbackService extends IDisposable {
  request(callback: IdleCallback, options?: IdleCallbackOptions): number;
  cancel(id: number): void;
  cancelAll(): void;
  runPending(now?: number): number;
  get pending(): number;
  setTimeoutOverride(timeout: number): void;
  onEvent(handler: IdleCallbackEventHandler): () => void;
}

interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallback = (deadline: IdleDeadline) => void;

interface IdleCallbackOptions {
  timeout?: number;
}

type IdleCallbackEventKind = 'requested' | 'cancelled' | 'executed' | 'timeout';
type IdleCallbackEventHandler = (event: IdleCallbackEvent) => void;

interface IdleCallbackEvent {
  readonly kind: IdleCallbackEventKind;
  readonly data?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT = 50;

class IdleDeadlineImpl implements IdleDeadline {
  readonly didTimeout: boolean;
  private _startTime: number;
  private _remaining: number;

  constructor(didTimeout: boolean, remaining: number) {
    this.didTimeout = didTimeout;
    this._startTime = performance.now();
    this._remaining = remaining;
  }

  timeRemaining(): number {
    const elapsed = performance.now() - this._startTime;
    return Math.max(0, this._remaining - elapsed);
  }
}

class IdleCallbackService implements IIdleCallbackService {
  private _nextId = 1;
  private _callbacks = new Map<number, { cb: IdleCallback; timeout: number; requestedAt: number }>();
  private _timeoutOverride = DEFAULT_TIMEOUT;
  private _handlers = new Set<IdleCallbackEventHandler>();

  request(callback: IdleCallback, options?: IdleCallbackOptions): number {
    const id = this._nextId++;
    const timeout = options?.timeout ?? this._timeoutOverride;
    this._callbacks.set(id, { cb: callback, timeout, requestedAt: Date.now() });
    this.emit({ kind: 'requested', data: { id, timeout } });
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

    for (const [id, entry] of entries) {
      const elapsed = now - entry.requestedAt;
      const didTimeout = elapsed >= entry.timeout;
      const remaining = Math.max(0, entry.timeout - elapsed);

      try {
        entry.cb(new IdleDeadlineImpl(didTimeout, remaining));
        count++;
        this.emit({ kind: didTimeout ? 'timeout' : 'executed', data: { id, didTimeout, elapsed } });
      } catch { }
    }

    return count;
  }

  get pending(): number {
    return this._callbacks.size;
  }

  setTimeoutOverride(timeout: number): void {
    this._timeoutOverride = timeout;
  }

  onEvent(handler: IdleCallbackEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: IdleCallbackEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._callbacks.clear();
  }
}

export { IdleCallbackService, IdleDeadlineImpl };
export type { IIdleCallbackService, IdleCallback, IdleDeadline, IdleCallbackOptions, IdleCallbackEvent, IdleCallbackEventKind, IdleCallbackEventHandler };
