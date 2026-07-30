import type { IDisposable } from '../../app/dependency-container';

interface IClosureService extends IDisposable {
  createClosure(fn: string, capturedVars: string[], env?: Record<string, unknown>): number;
  invoke(closureId: number, args?: unknown[]): ClosureResult;
  captureVariable(closureId: number, name: string, value: unknown): boolean;
  updateCaptured(closureId: number, name: string, value: unknown): boolean;
  getClosure(closureId: number): ClosureInfo | undefined;
  getCaptured(closureId: number): Record<string, unknown>;
  getStats(): ClosureStats;
  clear(): void;
  onEvent(handler: ClosureEventHandler): () => void;
}

interface ClosureInfo {
  readonly id: number;
  readonly fn: string;
  readonly capturedVars: readonly string[];
  readonly createdAt: number;
  invokeCount: number;
  isAlive: boolean;
}

interface ClosureResult {
  success: boolean;
  value?: unknown;
  error?: string;
  duration: number;
}

interface ClosureStats {
  totalClosures: number;
  aliveClosures: number;
  totalInvocations: number;
  totalCapturedVars: number;
  averageInvokeTime: number;
}

type ClosureEventKind = 'created' | 'invoked' | 'captured' | 'updated' | 'collected';
type ClosureEventHandler = (event: ClosureEvent) => void;

interface ClosureEvent {
  readonly kind: ClosureEventKind;
  readonly data?: Record<string, unknown>;
}

class ClosureService implements IClosureService {
  private _nextId = 1;
  private _closures = new Map<number, {
    fn: string; capturedVars: string[]; capturedEnv: Map<string, unknown>;
    createdAt: number; invokeCount: number; isAlive: boolean; totalInvokeTime: number;
  }>();
  private _handlers = new Set<ClosureEventHandler>();

  createClosure(fn: string, capturedVars: string[], env?: Record<string, unknown>): number {
    const id = this._nextId++;
    const capturedEnv = new Map<string, unknown>();
    if (env) {
      for (const key of capturedVars) {
        if (key in env) capturedEnv.set(key, env[key]);
      }
    }
    this._closures.set(id, {
      fn, capturedVars: [...capturedVars], capturedEnv,
      createdAt: Date.now(), invokeCount: 0, isAlive: true, totalInvokeTime: 0,
    });
    this.emit({ kind: 'created', data: { id, fn, capturedCount: capturedVars.length } });
    return id;
  }

  invoke(closureId: number, args?: unknown[]): ClosureResult {
    const closure = this._closures.get(closureId);
    if (!closure) return { success: false, error: 'Closure not found', duration: 0 };
    if (!closure.isAlive) return { success: false, error: 'Closure has been collected', duration: 0 };

    const startTime = performance.now();
    closure.invokeCount++;

    try {
      const env = Object.fromEntries(closure.capturedEnv);
      let value: unknown = `${closure.fn}(${(args ?? []).join(', ')})`;

      if (args && args.length >= closure.capturedVars.length) {
        const merged = { ...env };
        closure.capturedVars.forEach((v, i) => {
          if (i < (args?.length ?? 0)) merged[v] = args![i];
        });
        value = merged;
      } else if (closure.capturedEnv.size > 0) {
        value = env;
      }

      const duration = performance.now() - startTime;
      closure.totalInvokeTime += duration;
      this.emit({ kind: 'invoked', data: { id: closureId, fn: closure.fn, args, duration } });

      return { success: true, value, duration };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      closure.totalInvokeTime += performance.now() - startTime;
      return { success: false, error: msg, duration: performance.now() - startTime };
    }
  }

  captureVariable(closureId: number, name: string, value: unknown): boolean {
    const closure = this._closures.get(closureId);
    if (!closure || !closure.isAlive) return false;
    if (!closure.capturedVars.includes(name)) return false;
    closure.capturedEnv.set(name, value);
    this.emit({ kind: 'captured', data: { id: closureId, name, value } });
    return true;
  }

  updateCaptured(closureId: number, name: string, value: unknown): boolean {
    const closure = this._closures.get(closureId);
    if (!closure || !closure.isAlive) return false;
    if (!closure.capturedEnv.has(name)) return false;
    closure.capturedEnv.set(name, value);
    this.emit({ kind: 'updated', data: { id: closureId, name, value } });
    return true;
  }

  getClosure(closureId: number): ClosureInfo | undefined {
    const c = this._closures.get(closureId);
    if (!c) return undefined;
    return { id: closureId, fn: c.fn, capturedVars: [...c.capturedVars], createdAt: c.createdAt, invokeCount: c.invokeCount, isAlive: c.isAlive };
  }

  getCaptured(closureId: number): Record<string, unknown> {
    const c = this._closures.get(closureId);
    if (!c) return {};
    return Object.fromEntries(c.capturedEnv);
  }

  getStats(): ClosureStats {
    let alive = 0;
    let totalCaptured = 0;
    let totalTime = 0;
    let totalInvokes = 0;
    for (const c of this._closures.values()) {
      if (c.isAlive) alive++;
      totalCaptured += c.capturedVars.length;
      totalTime += c.totalInvokeTime;
      totalInvokes += c.invokeCount;
    }
    return {
      totalClosures: this._closures.size,
      aliveClosures: alive,
      totalInvocations: totalInvokes,
      totalCapturedVars: totalCaptured,
      averageInvokeTime: totalInvokes > 0 ? totalTime / totalInvokes : 0,
    };
  }

  clear(): void {
    for (const id of this._closures.keys()) {
      this.emit({ kind: 'collected', data: { id } });
    }
    this._closures.clear();
  }

  onEvent(handler: ClosureEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: ClosureEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._closures.clear();
  }
}

export { ClosureService };
export type { IClosureService, ClosureInfo, ClosureResult, ClosureStats, ClosureEvent, ClosureEventKind, ClosureEventHandler };
