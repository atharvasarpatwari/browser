import type { IDisposable } from '../../app/dependency-container';

interface IAsyncService extends IDisposable {
  start(fn: string, args?: unknown[]): AsyncOperationHandle;
  await(operationId: number): AwaitResult;
  resolve(operationId: number, value?: unknown): void;
  reject(operationId: number, reason?: string): void;
  getOperation(operationId: number): AsyncOperation | undefined;
  getPending(): readonly AsyncOperation[];
  getStats(): AsyncStats;
  clear(): void;
  setScheduler(scheduler: AsyncScheduler): void;
  onEvent(handler: AsyncEventHandler): () => void;
}

type AsyncOperationStatus = 'pending' | 'awaiting' | 'resolved' | 'rejected';
type AsyncScheduler = (fn: () => void) => void;

interface AsyncOperation {
  readonly id: number;
  readonly fn: string;
  readonly args: readonly unknown[];
  readonly started: number;
  status: AsyncOperationStatus;
  result?: unknown;
  error?: string;
  awaitCount: number;
}

interface AsyncOperationHandle {
  readonly id: number;
  readonly fn: string;
  readonly status: AsyncOperationStatus;
}

interface AwaitResult {
  success: boolean;
  value?: unknown;
  error?: string;
  status: AsyncOperationStatus;
  waitTime: number;
}

interface AsyncStats {
  totalStarted: number;
  totalResolved: number;
  totalRejected: number;
  pending: number;
  averageWaitTime: number;
  totalAwaitCount: number;
}

type AsyncEventKind = 'started' | 'awaiting' | 'resolved' | 'rejected' | 'scheduled';
type AsyncEventHandler = (event: AsyncEvent) => void;

interface AsyncEvent {
  readonly kind: AsyncEventKind;
  readonly data?: Record<string, unknown>;
}

function defaultScheduler(fn: () => void): void {
  Promise.resolve().then(fn);
}

class AsyncService implements IAsyncService {
  private _nextId = 1;
  private _operations = new Map<number, AsyncOperation & { _totalWaitTime: number }>();
  private _scheduler: AsyncScheduler = defaultScheduler;
  private _totalStarted = 0;
  private _totalResolved = 0;
  private _totalRejected = 0;
  private _handlers = new Set<AsyncEventHandler>();

  setScheduler(scheduler: AsyncScheduler): void {
    this._scheduler = scheduler;
  }

  start(fn: string, args?: unknown[]): AsyncOperationHandle {
    const id = this._nextId++;
    this._totalStarted++;
    const op = { id, fn, args: [...(args ?? [])], started: Date.now(), status: 'pending' as const, result: undefined, error: undefined, awaitCount: 0, _totalWaitTime: 0 };
    this._operations.set(id, op);

    this.emit({ kind: 'started', data: { id, fn, args: args ?? [] } });

    this._scheduler(() => {
      if (op.status === 'pending') {
        op.status = 'resolved';
        op.result = `${fn} completed`;
        this._totalResolved++;
        this.emit({ kind: 'resolved', data: { id, fn, result: op.result } });
      }
    });

    return { id, fn, status: op.status };
  }

  await(operationId: number): AwaitResult {
    const op = this._operations.get(operationId);
    if (!op) return { success: false, error: 'Operation not found', status: 'rejected', waitTime: 0 };

    const waitStart = Date.now();
    op.awaitCount++;

    this.emit({ kind: 'awaiting', data: { id: operationId, fn: op.fn, awaitCount: op.awaitCount } });

    if (op.status === 'resolved') {
      const waitTime = Date.now() - waitStart;
      op._totalWaitTime += waitTime;
      return { success: true, value: op.result, status: op.status, waitTime };
    }
    if (op.status === 'rejected') {
      const waitTime = Date.now() - waitStart;
      op._totalWaitTime += waitTime;
      return { success: false, error: op.error, status: op.status, waitTime };
    }

    const waitTime = Date.now() - waitStart;
    op._totalWaitTime += waitTime;
    return { success: true, value: undefined, status: op.status, waitTime };
  }

  resolve(operationId: number, value?: unknown): void {
    const op = this._operations.get(operationId);
    if (!op || op.status !== 'pending') return;
    op.status = 'resolved';
    op.result = value;
    this._totalResolved++;
    this.emit({ kind: 'resolved', data: { id: operationId, fn: op.fn, value } });
  }

  reject(operationId: number, reason?: string): void {
    const op = this._operations.get(operationId);
    if (!op || op.status !== 'pending') return;
    op.status = 'rejected';
    op.error = reason ?? 'Operation rejected';
    this._totalRejected++;
    this.emit({ kind: 'rejected', data: { id: operationId, fn: op.fn, reason: reason ?? 'rejected' } });
  }

  getOperation(operationId: number): AsyncOperation | undefined {
    const op = this._operations.get(operationId);
    if (!op) return undefined;
    const { _totalWaitTime, ...rest } = op;
    return rest;
  }

  getPending(): readonly AsyncOperation[] {
    const pending: AsyncOperation[] = [];
    for (const op of this._operations.values()) {
      if (op.status === 'pending' || op.status === 'awaiting') {
        const { _totalWaitTime, ...rest } = op;
        pending.push(rest);
      }
    }
    return pending;
  }

  getStats(): AsyncStats {
    let totalWait = 0;
    let totalAwait = 0;
    let pending = 0;
    for (const op of this._operations.values()) {
      totalWait += op._totalWaitTime;
      totalAwait += op.awaitCount;
      if (op.status === 'pending' || op.status === 'awaiting') pending++;
    }
    return {
      totalStarted: this._totalStarted,
      totalResolved: this._totalResolved,
      totalRejected: this._totalRejected,
      pending,
      averageWaitTime: totalAwait > 0 ? totalWait / totalAwait : 0,
      totalAwaitCount: totalAwait,
    };
  }

  clear(): void {
    this._operations.clear();
    this._totalStarted = 0;
    this._totalResolved = 0;
    this._totalRejected = 0;
  }

  onEvent(handler: AsyncEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: AsyncEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._operations.clear();
    this._totalStarted = 0;
    this._totalResolved = 0;
    this._totalRejected = 0;
  }
}

export { AsyncService };
export type { IAsyncService, AsyncOperationStatus, AsyncScheduler, AsyncOperation, AsyncOperationHandle, AwaitResult, AsyncStats, AsyncEvent, AsyncEventKind, AsyncEventHandler };
