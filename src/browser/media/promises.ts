import type { IDisposable } from '../../app/dependency-container';

interface IPromiseService extends IDisposable {
  create(executor?: PromiseExecutor): PromiseHandle;
  resolve(value?: unknown): PromiseHandle;
  reject(reason?: unknown): PromiseHandle;
  then(promiseId: number, onFulfilled?: FulfillmentHandler, onRejected?: ErrorHandler): PromiseHandle;
  all(promiseIds: number[]): PromiseHandle;
  allSettled(promiseIds: number[]): PromiseHandle;
  race(promiseIds: number[]): PromiseHandle;
  any(promiseIds: number[]): PromiseHandle;
  getState(promiseId: number): PromiseState;
  getResult(promiseId: number): unknown;
  getStats(): PromiseStats;
  clear(): void;
  onEvent(handler: PromiseEventHandler): () => void;
}

type PromiseState = 'pending' | 'fulfilled' | 'rejected';
type PromiseExecutor = (resolve: (value?: unknown) => void, reject: (reason?: unknown) => void) => void;
type FulfillmentHandler = (value?: unknown) => unknown;
type ErrorHandler = (reason?: unknown) => unknown;

interface PromiseHandle {
  readonly id: number;
  readonly state: PromiseState;
}

interface PromiseEntry {
  id: number;
  state: PromiseState;
  value?: unknown;
  reason?: unknown;
  fulfillmentHandlers: Array<{ handler: FulfillmentHandler; targetId: number }>;
  rejectionHandlers: Array<{ handler: ErrorHandler; targetId: number }>;
  settled: boolean;
  parentId?: number;
}

interface PromiseStats {
  totalCreated: number;
  pending: number;
  fulfilled: number;
  rejected: number;
  totalReactions: number;
  chainDepth: number;
}

type PromiseEventKind = 'created' | 'fulfilled' | 'rejected' | 'chained' | 'settled';
type PromiseEventHandler = (event: PromiseEvent) => void;

interface PromiseEvent {
  readonly kind: PromiseEventKind;
  readonly data?: Record<string, unknown>;
}

class PromiseService implements IPromiseService {
  private _nextId = 1;
  private _promises = new Map<number, PromiseEntry>();
  private _totalCreated = 0;
  private _totalReactions = 0;
  private _maxChainDepth = 0;
  private _handlers = new Set<PromiseEventHandler>();

  create(executor?: PromiseExecutor): PromiseHandle {
    const id = this._nextId++;
    this._totalCreated++;
    const entry: PromiseEntry = {
      id, state: 'pending', fulfillmentHandlers: [], rejectionHandlers: [], settled: false,
    };
    this._promises.set(id, entry);
    this.emit({ kind: 'created', data: { id } });

    if (executor) {
      try {
        executor(
          (value?: unknown) => this.fulfill(id, value),
          (reason?: unknown) => this.rejectById(id, reason),
        );
      } catch (e) {
        this.rejectById(id, e);
      }
    }

    return { id, state: 'pending' };
  }

  resolve(value?: unknown): PromiseHandle {
    if (value && typeof value === 'object' && (value as PromiseHandle).id !== undefined) {
      return value as PromiseHandle;
    }
    const id = this._nextId++;
    this._totalCreated++;
    const entry: PromiseEntry = { id, state: 'fulfilled', value, fulfillmentHandlers: [], rejectionHandlers: [], settled: true };
    this._promises.set(id, entry);
    this.emit({ kind: 'created', data: { id } });
    this.emit({ kind: 'fulfilled', data: { id, value } });
    return { id, state: 'fulfilled' };
  }

  reject(reason?: unknown): PromiseHandle {
    const id = this._nextId++;
    this._totalCreated++;
    const entry: PromiseEntry = { id, state: 'rejected', reason, fulfillmentHandlers: [], rejectionHandlers: [], settled: true };
    this._promises.set(id, entry);
    this.emit({ kind: 'created', data: { id } });
    this.emit({ kind: 'rejected', data: { id, reason } });
    return { id, state: 'rejected' };
  }

  then(promiseId: number, onFulfilled?: FulfillmentHandler, onRejected?: ErrorHandler): PromiseHandle {
    const promise = this._promises.get(promiseId);
    if (!promise) return this.reject(new Error('Promise not found'));

    const resultId = this._nextId++;
    this._totalCreated++;
    const resultEntry: PromiseEntry = {
      id: resultId, state: 'pending', fulfillmentHandlers: [], rejectionHandlers: [], settled: false,
      parentId: promiseId,
    };
    this._promises.set(resultId, resultEntry);

    if (onFulfilled) {
      promise.fulfillmentHandlers.push({ handler: onFulfilled, targetId: resultId });
    }
    if (onRejected) {
      promise.rejectionHandlers.push({ handler: onRejected, targetId: resultId });
    }
    this._totalReactions++;
    this.emit({ kind: 'chained', data: { parentId: promiseId, childId: resultId } });

    if (promise.state === 'fulfilled' && onFulfilled) {
      this.fulfill(resultId, onFulfilled(promise.value));
    } else if (promise.state === 'rejected' && onRejected) {
      this.fulfill(resultId, onRejected(promise.reason));
    }

    return { id: resultId, state: 'pending' };
  }

  all(promiseIds: number[]): PromiseHandle {
    const resultId = this._nextId++;
    this._totalCreated++;
    const resultEntry: PromiseEntry = {
      id: resultId, state: 'pending', fulfillmentHandlers: [], rejectionHandlers: [], settled: false,
    };
    this._promises.set(resultId, resultEntry);

    const results: unknown[] = new Array(promiseIds.length);
    let remaining = promiseIds.length;

    if (remaining === 0) {
      resultEntry.state = 'fulfilled';
      resultEntry.value = [];
      resultEntry.settled = true;
      this.emit({ kind: 'fulfilled', data: { id: resultId, value: [] } });
      return { id: resultId, state: 'fulfilled' };
    }

    promiseIds.forEach((pid, i) => {
      const p = this._promises.get(pid);
      if (!p) { this.rejectPromise(resultEntry, new Error('Promise not found')); return; }

      if (p.state === 'rejected') { this.rejectPromise(resultEntry, p.reason); return; }

      const checkDone = () => {
        if (p.state === 'fulfilled') {
          results[i] = p.value;
          remaining--;
          if (remaining === 0) {
            resultEntry.state = 'fulfilled';
            resultEntry.value = results;
            resultEntry.settled = true;
            this.emit({ kind: 'fulfilled', data: { id: resultId, value: results } });
          }
        } else if (p.state === 'rejected') {
          this.rejectPromise(resultEntry, p.reason);
        }
      };

      if (p.state === 'pending') {
        p.fulfillmentHandlers.push({ handler: (v) => { results[i] = v; remaining--; if (remaining === 0) { resultEntry.state = 'fulfilled'; resultEntry.value = results; resultEntry.settled = true; this.emit({ kind: 'fulfilled', data: { id: resultId, value: results } }); } return v; }, targetId: resultId });
        p.rejectionHandlers.push({ handler: (r) => { this.rejectPromise(resultEntry, r); return r; }, targetId: resultId });
      } else {
        checkDone();
      }
    });

    return { id: resultId, state: 'pending' };
  }

  allSettled(promiseIds: number[]): PromiseHandle {
    const resultId = this._nextId++;
    this._totalCreated++;
    const resultEntry: PromiseEntry = {
      id: resultId, state: 'pending', fulfillmentHandlers: [], rejectionHandlers: [], settled: false,
    };
    this._promises.set(resultId, resultEntry);

    const results: Array<{ status: string; value?: unknown; reason?: unknown }> = new Array(promiseIds.length);
    let remaining = promiseIds.length;

    if (remaining === 0) {
      resultEntry.state = 'fulfilled';
      resultEntry.value = [];
      resultEntry.settled = true;
      this.emit({ kind: 'fulfilled', data: { id: resultId, value: [] } });
      return { id: resultId, state: 'fulfilled' };
    }

    promiseIds.forEach((pid, i) => {
      const p = this._promises.get(pid);
      if (!p) { results[i] = { status: 'rejected', reason: 'Promise not found' }; remaining--; if (remaining === 0) finalize(); return; }

      const handler = () => {
        if (p.state === 'fulfilled') results[i] = { status: 'fulfilled', value: p.value };
        else if (p.state === 'rejected') results[i] = { status: 'rejected', reason: p.reason };
        else return;
        remaining--;
        if (remaining === 0) finalize();
      };

      const finalize = () => {
        resultEntry.state = 'fulfilled';
        resultEntry.value = results;
        resultEntry.settled = true;
        this.emit({ kind: 'settled', data: { id: resultId, value: results } });
      };

      if (p.state === 'pending') {
        p.fulfillmentHandlers.push({ handler: () => { handler(); return undefined; }, targetId: resultId });
        p.rejectionHandlers.push({ handler: () => { handler(); return undefined; }, targetId: resultId });
      } else {
        handler();
      }
    });

    return { id: resultId, state: 'pending' };
  }

  race(promiseIds: number[]): PromiseHandle {
    const resultId = this._nextId++;
    this._totalCreated++;
    const resultEntry: PromiseEntry = {
      id: resultId, state: 'pending', fulfillmentHandlers: [], rejectionHandlers: [], settled: false,
    };
    this._promises.set(resultId, resultEntry);
    let settled = false;

    for (const pid of promiseIds) {
      const p = this._promises.get(pid);
      if (!p) continue;

      const handler = () => {
        if (settled) return;
        settled = true;
        if (p.state === 'fulfilled') {
          resultEntry.state = 'fulfilled';
          resultEntry.value = p.value;
          resultEntry.settled = true;
          this.emit({ kind: 'fulfilled', data: { id: resultId, value: p.value } });
        } else if (p.state === 'rejected') {
          this.rejectPromise(resultEntry, p.reason);
        }
      };

      if (p.state === 'pending') {
        p.fulfillmentHandlers.push({ handler: () => { handler(); return undefined; }, targetId: resultId });
        p.rejectionHandlers.push({ handler: () => { handler(); return undefined; }, targetId: resultId });
      } else {
        handler();
      }
    }

    return { id: resultId, state: 'pending' };
  }

  any(promiseIds: number[]): PromiseHandle {
    const resultId = this._nextId++;
    this._totalCreated++;
    const resultEntry: PromiseEntry = {
      id: resultId, state: 'pending', fulfillmentHandlers: [], rejectionHandlers: [], settled: false,
    };
    this._promises.set(resultId, resultEntry);
    let fulfilled = false;
    let rejections = 0;

    for (const pid of promiseIds) {
      const p = this._promises.get(pid);
      if (!p) { rejections++; continue; }

      const handler = () => {
        if (fulfilled) return;
        if (p.state === 'fulfilled') {
          fulfilled = true;
          resultEntry.state = 'fulfilled';
          resultEntry.value = p.value;
          resultEntry.settled = true;
          this.emit({ kind: 'fulfilled', data: { id: resultId, value: p.value } });
        } else if (p.state === 'rejected') {
          rejections++;
          if (rejections === promiseIds.length) {
            this.rejectPromise(resultEntry, 'All promises rejected');
          }
        }
      };

      if (p.state === 'pending') {
        p.fulfillmentHandlers.push({ handler: () => { handler(); return undefined; }, targetId: resultId });
        p.rejectionHandlers.push({ handler: () => { handler(); return undefined; }, targetId: resultId });
      } else {
        handler();
      }
    }

    return { id: resultId, state: 'pending' };
  }

  getState(promiseId: number): PromiseState {
    return this._promises.get(promiseId)?.state ?? 'rejected';
  }

  getResult(promiseId: number): unknown {
    const p = this._promises.get(promiseId);
    return p?.value ?? p?.reason;
  }

  getStats(): PromiseStats {
    let pending = 0;
    let fulfilled = 0;
    let rejected = 0;
    for (const p of this._promises.values()) {
      if (p.state === 'pending') pending++;
      else if (p.state === 'fulfilled') fulfilled++;
      else if (p.state === 'rejected') rejected++;
    }
    return {
      totalCreated: this._totalCreated,
      pending, fulfilled, rejected,
      totalReactions: this._totalReactions,
      chainDepth: this._maxChainDepth,
    };
  }

  clear(): void {
    this._promises.clear();
    this._totalCreated = 0;
    this._totalReactions = 0;
  }

  private fulfill(id: number, value?: unknown): void {
    const p = this._promises.get(id);
    if (!p || p.state !== 'pending') return;
    p.state = 'fulfilled';
    p.value = value;
    p.settled = true;
    this.emit({ kind: 'fulfilled', data: { id, value } });

    for (const { handler, targetId } of p.fulfillmentHandlers) {
      try {
        const result = handler(value);
        const target = this._promises.get(targetId);
        if (target && target.state === 'pending') this.fulfill(targetId, result);
      } catch (e) {
        this.rejectById(targetId, e);
      }
    }
  }

  private rejectPromise(entry: PromiseEntry, reason?: unknown): void {
    if (entry.state !== 'pending') return;
    entry.state = 'rejected';
    entry.reason = reason;
    entry.settled = true;
    this.emit({ kind: 'rejected', data: { id: entry.id, reason } });

    for (const { handler, targetId } of entry.rejectionHandlers) {
      try {
        const result = handler(reason);
        this.fulfill(targetId, result);
      } catch (e) {
        this.rejectById(targetId, e);
      }
    }
  }

  private rejectById(id: number, reason?: unknown): void {
    const p = this._promises.get(id);
    if (!p) return;
    this.rejectPromise(p, reason);
  }

  onEvent(handler: PromiseEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: PromiseEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._promises.clear();
    this._totalCreated = 0;
    this._totalReactions = 0;
    this._maxChainDepth = 0;
  }
}

export { PromiseService };
export type { IPromiseService, PromiseState, PromiseExecutor, FulfillmentHandler, ErrorHandler, PromiseHandle, PromiseEntry, PromiseStats, PromiseEvent, PromiseEventKind, PromiseEventHandler };
