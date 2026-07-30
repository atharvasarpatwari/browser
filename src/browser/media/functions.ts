import type { IDisposable } from '../../app/dependency-container';

interface IFunctionService extends IDisposable {
  define(name: string, params: string[], body: string): number;
  call(functionId: number, thisArg?: unknown, args?: unknown[]): CallResult;
  getInfo(functionId: number): FunctionInfo | undefined;
  getCallStack(): readonly CallEntry[];
  getStats(): FunctionStats;
  remove(functionId: number): boolean;
  clear(): void;
  onEvent(handler: FunctionEventHandler): () => void;
}

interface FunctionInfo {
  readonly id: number;
  readonly name: string;
  readonly params: readonly string[];
  readonly body: string;
  readonly defined: string;
  callCount: number;
  totalTime: number;
  arity: number;
}

interface CallEntry {
  readonly functionId: number;
  readonly name: string;
  readonly args: readonly unknown[];
  readonly timestamp: number;
  readonly depth: number;
}

interface CallResult {
  success: boolean;
  value?: unknown;
  error?: string;
  duration: number;
  depth: number;
}

interface FunctionStats {
  totalDefined: number;
  totalCalls: number;
  activeFunctions: number;
  maxCallDepth: number;
  averageCallTime: number;
  totalTime: number;
}

type FunctionEventKind = 'defined' | 'called' | 'returned' | 'error' | 'removed';
type FunctionEventHandler = (event: FunctionEvent) => void;

interface FunctionEvent {
  readonly kind: FunctionEventKind;
  readonly data?: Record<string, unknown>;
}

class FunctionService implements IFunctionService {
  private _nextId = 1;
  private _functions = new Map<number, FunctionInfo>();
  private _callStack: CallEntry[] = [];
  private _callDepth = 0;
  private _maxDepth = 0;
  private _totalCalls = 0;
  private _totalTime = 0;
  private _handlers = new Set<FunctionEventHandler>();

  define(name: string, params: string[], body: string): number {
    const id = this._nextId++;
    const info: FunctionInfo = {
      id, name, params: [...params], body,
      defined: new Date().toISOString(),
      callCount: 0, totalTime: 0, arity: params.length,
    };
    this._functions.set(id, info);
    this.emit({ kind: 'defined', data: { id, name, arity: params.length } });
    return id;
  }

  call(functionId: number, thisArg?: unknown, args?: unknown[]): CallResult {
    const info = this._functions.get(functionId);
    if (!info) return { success: false, error: 'Function not found', duration: 0, depth: this._callDepth };

    const startTime = performance.now();
    this._callDepth++;
    this._totalCalls++;
    if (this._callDepth > this._maxDepth) this._maxDepth = this._callDepth;
    info.callCount++;

    const callArgs = args ?? [];
    this._callStack.push({ functionId, name: info.name, args: [...callArgs], timestamp: Date.now(), depth: this._callDepth });
    this.emit({ kind: 'called', data: { id: functionId, name: info.name, args: callArgs, depth: this._callDepth } });

    try {
      const body = info.body.trim();
      let value: unknown = undefined;

      if (thisArg !== undefined && typeof thisArg === 'object' && thisArg !== null) {
        value = (thisArg as Record<string, unknown>)[info.name];
      }

      if (body.startsWith('return ')) {
        value = body.slice(7).trim();
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (value === 'null') value = null;
        else if (value === 'undefined') value = undefined;
        else if (/^-?\d+(\.\d+)?$/.test(value as string)) value = parseFloat(value as string);
        else if ((value as string).startsWith('"') || (value as string).startsWith("'")) value = (value as string).slice(1, -1);
      }

      if (callArgs.length > 0 && body.includes('{') && body.includes('}')) {
        value = callArgs.reduce((acc, arg, i) => {
          (acc as Record<string, unknown>)[info.params[i] ?? `arg${i}`] = arg;
          return acc;
        }, {} as Record<string, unknown>);
      }

      const duration = performance.now() - startTime;
      info.totalTime += duration;
      this._totalTime += duration;

      this.emit({ kind: 'returned', data: { id: functionId, name: info.name, value, duration } });
      this._callDepth--;

      return { success: true, value, duration, depth: this._callDepth };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._callDepth--;
      info.totalTime += performance.now() - startTime;
      this.emit({ kind: 'error', data: { id: functionId, name: info.name, error: msg } });
      return { success: false, error: msg, duration: performance.now() - startTime, depth: this._callDepth };
    }
  }

  getInfo(functionId: number): FunctionInfo | undefined {
    return this._functions.get(functionId);
  }

  getCallStack(): readonly CallEntry[] {
    return [...this._callStack];
  }

  getStats(): FunctionStats {
    return {
      totalDefined: this._functions.size,
      totalCalls: this._totalCalls,
      activeFunctions: this._functions.size,
      maxCallDepth: this._maxDepth,
      averageCallTime: this._totalCalls > 0 ? this._totalTime / this._totalCalls : 0,
      totalTime: this._totalTime,
    };
  }

  remove(functionId: number): boolean {
    const info = this._functions.get(functionId);
    if (!info) return false;
    this._functions.delete(functionId);
    this.emit({ kind: 'removed', data: { id: functionId, name: info.name } });
    return true;
  }

  clear(): void {
    this._functions.clear();
    this._callStack = [];
    this._callDepth = 0;
    this._maxDepth = 0;
    this._totalCalls = 0;
    this._totalTime = 0;
  }

  onEvent(handler: FunctionEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: FunctionEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._functions.clear();
    this._callStack = [];
  }
}

export { FunctionService };
export type { IFunctionService, FunctionInfo, CallEntry, CallResult, FunctionStats, FunctionEvent, FunctionEventKind, FunctionEventHandler };
