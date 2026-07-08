import type { IDisposable } from '../../app/dependency-container';
import type { HtmlDocument } from '../rendering/html-parser';

type ScriptLoadState = 'unloaded' | 'loading' | 'loaded' | 'error';

interface ScriptInfo {
  readonly url: string | null;
  readonly source: string;
  readonly async: boolean;
  readonly defer: boolean;
  readonly module: boolean;
  readonly state: ScriptLoadState;
  readonly error: string | null;
}

interface ConsoleEntry {
  readonly level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  readonly args: readonly unknown[];
  readonly timestamp: number;
}

interface RuntimeError {
  readonly message: string;
  readonly stack: string | null;
  readonly lineNumber: number;
  readonly columnNumber: number;
  readonly sourceUrl: string;
}

type RuntimeEventType = 'evaluationStart' | 'evaluationEnd' | 'error' | 'console';

interface RuntimeEvent {
  readonly kind: RuntimeEventType;
}

interface EvaluationStartEvent extends RuntimeEvent {
  readonly kind: 'evaluationStart';
  readonly scriptUrl: string | null;
}

interface EvaluationEndEvent extends RuntimeEvent {
  readonly kind: 'evaluationEnd';
  readonly scriptUrl: string | null;
  readonly durationMs: number;
}

interface RuntimeErrorEvent extends RuntimeEvent {
  readonly kind: 'error';
  readonly error: RuntimeError;
}

interface ConsoleEvent extends RuntimeEvent {
  readonly kind: 'console';
  readonly entry: ConsoleEntry;
}

type RuntimeEventUnion =
  | EvaluationStartEvent
  | EvaluationEndEvent
  | RuntimeErrorEvent
  | ConsoleEvent;

interface IJsRuntimeBridge extends IDisposable {
  readonly name: string;
  initialize(context: RuntimeContext): Promise<void>;
  evaluateScript(source: string, url?: string): Promise<unknown>;
  callFunction(functionName: string, ...args: unknown[]): Promise<unknown>;
  setGlobalProperty(name: string, value: unknown): void;
  getGlobalProperty(name: string): unknown;
  getConsoleLog(): readonly ConsoleEntry[];
  clearConsole(): void;
  isModuleSupported(): boolean;
  on(type: RuntimeEventType, handler: (event: RuntimeEventUnion) => void): void;
  off(type: RuntimeEventType, handler: (event: RuntimeEventUnion) => void): void;
}

interface RuntimeContext {
  readonly document: HtmlDocument;
  readonly origin: string;
  readonly url: string;
  readonly userAgent: string;
  readonly sandboxed: boolean;
}

class JsRuntimeBridge implements IJsRuntimeBridge {
  readonly name = 'JsRuntimeBridge';

  private readonly globals = new Map<string, unknown>();
  private readonly consoleLog: ConsoleEntry[] = [];
  private readonly eventListeners = new Map<RuntimeEventType, Set<(e: RuntimeEventUnion) => void>>();
  private _initialized = false;
  private _moduleSupported = false;

  initialize(context: RuntimeContext): Promise<void> {
    this._initialized = true;
    this._moduleSupported = typeof eval !== 'undefined';
    return Promise.resolve();
  }

  async evaluateScript(source: string, url?: string): Promise<unknown> {
    this.emit({ kind: 'evaluationStart', scriptUrl: url ?? null });
    const start = Date.now();

    try {
      const result = eval(source);
      const durationMs = Date.now() - start;
      this.emit({ kind: 'evaluationEnd', scriptUrl: url ?? null, durationMs });
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      this.emit({ kind: 'evaluationEnd', scriptUrl: url ?? null, durationMs });
      const error: RuntimeError = {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? (err.stack ?? null) : null,
        lineNumber: 0,
        columnNumber: 0,
        sourceUrl: url ?? '',
      };
      this.emit({ kind: 'error', error });
      throw err;
    }
  }

  async callFunction(functionName: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.globals.get(functionName);
    if (typeof fn !== 'function') {
      throw new Error(`Function "${functionName}" is not defined in the runtime context`);
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
  }

  setGlobalProperty(name: string, value: unknown): void {
    this.globals.set(name, value);
  }

  getGlobalProperty(name: string): unknown {
    return this.globals.get(name);
  }

  getConsoleLog(): readonly ConsoleEntry[] {
    return [...this.consoleLog];
  }

  clearConsole(): void {
    this.consoleLog.length = 0;
  }

  isModuleSupported(): boolean {
    return this._moduleSupported;
  }

  on(type: RuntimeEventType, handler: (event: RuntimeEventUnion) => void): void {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
    this.eventListeners.get(type)!.add(handler);
  }

  off(type: RuntimeEventType, handler: (event: RuntimeEventUnion) => void): void {
    this.eventListeners.get(type)?.delete(handler);
  }

  private emit(event: RuntimeEventUnion): void {
    const handlers = this.eventListeners.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[JsRuntimeBridge] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void {
    this.globals.clear();
    this.consoleLog.length = 0;
    this.eventListeners.clear();
    this._initialized = false;
  }
}

export { JsRuntimeBridge };
export type { IJsRuntimeBridge, ScriptInfo, ConsoleEntry, RuntimeError, RuntimeContext, RuntimeEventUnion, RuntimeEventType };
