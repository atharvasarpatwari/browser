import type { IDisposable } from '../../app/dependency-container';

interface ICallStackService extends IDisposable {
  get depth(): number;
  push(frame: CallFrame): void;
  pop(): CallFrame | undefined;
  peek(): CallFrame | undefined;
  clear(): void;
  getStack(): readonly CallFrame[];
  getStackTrace(): string;
  onEvent(handler: CallStackEventHandler): () => void;
}

interface CallFrame {
  readonly functionName: string;
  readonly fileName?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
  readonly args?: readonly unknown[];
  readonly timestamp: number;
}

type CallStackEventKind = 'push' | 'pop' | 'clear' | 'error';
type CallStackEventHandler = (event: CallStackEvent) => void;

interface CallStackEvent {
  readonly kind: CallStackEventKind;
  readonly data?: Record<string, unknown>;
}

class CallStackService implements ICallStackService {
  private _stack: CallFrame[] = [];
  private _maxDepth = 1000;
  private _handlers = new Set<CallStackEventHandler>();

  get depth(): number {
    return this._stack.length;
  }

  push(frame: CallFrame): void {
    if (this._stack.length >= this._maxDepth) {
      this.emit({ kind: 'error', data: { message: 'Maximum call stack size exceeded' } });
      throw new RangeError('Maximum call stack size exceeded');
    }
    this._stack.push(frame);
    this.emit({ kind: 'push', data: { functionName: frame.functionName } });
  }

  pop(): CallFrame | undefined {
    const frame = this._stack.pop();
    if (frame) {
      this.emit({ kind: 'pop', data: { functionName: frame.functionName } });
    }
    return frame;
  }

  peek(): CallFrame | undefined {
    return this._stack[this._stack.length - 1];
  }

  clear(): void {
    this._stack = [];
    this.emit({ kind: 'clear' });
  }

  getStack(): readonly CallFrame[] {
    return [...this._stack];
  }

  getStackTrace(): string {
    return this._stack
      .map(f => {
        const loc = [f.fileName, f.lineNumber, f.columnNumber].filter(Boolean).join(':');
        return `    at ${f.functionName}${loc ? ` (${loc})` : ''}`;
      })
      .join('\n');
  }

  onEvent(handler: CallStackEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CallStackEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._stack = [];
  }
}

export { CallStackService };
export type { ICallStackService, CallFrame, CallStackEvent, CallStackEventKind, CallStackEventHandler };
