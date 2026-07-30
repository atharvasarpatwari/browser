import type { IDisposable } from '../../app/dependency-container';

interface IInterpreterService extends IDisposable {
  execute(code: string, context?: ExecutionContext): ExecutionResult;
  evaluate(expression: string, context?: ExecutionContext): unknown;
  setMaxSteps(steps: number): void;
  get steps(): number;
  get state(): InterpreterState;
  pause(): void;
  resume(): void;
  reset(): void;
  getStack(): readonly CallFrameInfo[];
  onEvent(handler: InterpreterEventHandler): () => void;
}

interface ExecutionContext {
  readonly variables?: Record<string, unknown>;
  readonly timeout?: number;
  readonly filename?: string;
}

interface CallFrameInfo {
  readonly functionName: string;
  readonly pc: number;
  readonly locals: number;
}

interface ExecutionResult {
  success: boolean;
  value?: unknown;
  error?: ExecutionError;
  steps: number;
  duration: number;
}

interface ExecutionError {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
  readonly line?: number;
  readonly column?: number;
}

type InterpreterState = 'idle' | 'running' | 'paused' | 'error';

type InterpreterEventKind = 'execution_start' | 'execution_end' | 'step' | 'error' | 'pause' | 'resume' | 'reset';
type InterpreterEventHandler = (event: InterpreterEvent) => void;

interface InterpreterEvent {
  readonly kind: InterpreterEventKind;
  readonly data?: Record<string, unknown>;
}

const JS_KEYWORDS = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof',
  'new', 'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'class', 'const', 'enum', 'export', 'extends',
  'import', 'super', 'implements', 'interface', 'let', 'package', 'private',
  'protected', 'public', 'static', 'yield', 'await', 'async', 'of',
]);

class InterpreterService implements IInterpreterService {
  private _state: InterpreterState = 'idle';
  private _steps = 0;
  private _maxSteps = 100000;
  private _callStack: CallFrameInfo[] = [];
  private _paused = false;
  private _handlers = new Set<InterpreterEventHandler>();

  execute(code: string, context?: ExecutionContext): ExecutionResult {
    const startTime = performance.now();
    this._state = 'running';
    this._steps = 0;
    this._callStack = [];
    this.emit({ kind: 'execution_start', data: { filename: context?.filename ?? '<eval>' } });

    try {
      const trimmed = code.trim();
      if (!trimmed) {
        const result: ExecutionResult = { success: true, value: undefined, steps: 0, duration: 0 };
        this._state = 'idle';
        this.emit({ kind: 'execution_end', data: { success: true, steps: 0 } });
        return result;
      }

      const timeout = context?.timeout ?? 5000;
      const deadline = Date.now() + timeout;
      let i = 0;
      const tokens = this.tokenize(trimmed);
      let value: unknown = undefined;

      while (i < tokens.length) {
        if (this._paused) {
          this._state = 'paused';
          this.emit({ kind: 'pause' });
          while (this._paused) {
            if (Date.now() > deadline) break;
          }
          if (!this._paused) {
            this.emit({ kind: 'resume' });
          }
        }

        if (this._steps >= this._maxSteps) {
          const result: ExecutionResult = { success: false, error: { type: 'RangeError', message: 'Execution step limit exceeded' }, steps: this._steps, duration: performance.now() - startTime };
          this._state = 'error';
          this.emit({ kind: 'error', data: { type: 'RangeError', message: 'Step limit exceeded' } });
          return result;
        }

        if (Date.now() >= deadline) {
          const result: ExecutionResult = { success: false, error: { type: 'TimeoutError', message: 'Execution timed out' }, steps: this._steps, duration: performance.now() - startTime };
          this._state = 'error';
          this.emit({ kind: 'error', data: { type: 'TimeoutError', message: 'Timed out' } });
          return result;
        }

        const token = tokens[i]!;
        this._steps++;

        if (token.type === 'keyword' && token.value === 'function') {
          const name = tokens[i + 1]?.value ?? '<anonymous>';
          this._callStack.push({ functionName: name, pc: i, locals: 0 });
          i += 2;
          let depth = 1;
          while (i < tokens.length && depth > 0) {
            if (tokens[i]?.value === '{') depth++;
            if (tokens[i]?.value === '}') depth--;
            this._steps++;
            i++;
          }
          this._callStack.pop();
          value = { type: 'function', name };
        } else if (token.type === 'keyword' && token.value === 'return') {
          i++;
          const exprTokens: string[] = [];
          while (i < tokens.length && tokens[i]?.value !== ';' && tokens[i]?.value !== '}') {
            exprTokens.push(tokens[i]!.value);
            this._steps++;
            i++;
          }
          value = { type: 'return', value: exprTokens.join(' ') || undefined };
        } else if (token.value === ';' || token.value === '{' || token.value === '}') {
          i++;
          continue;
        } else if (token.type === 'identifier' && token.value === 'console') {
          i++;
          if (tokens[i]?.value === '.') {
            const method = tokens[i + 1]?.value;
            i += 2;
            if (tokens[i]?.value === '(') {
              let depth = 1;
              i++;
              const args: string[] = [];
              while (i < tokens.length && depth > 0) {
                if (tokens[i]?.value === '(') depth++;
                if (tokens[i]?.value === ')') depth--;
                if (depth > 0) args.push(tokens[i]!.value);
                this._steps++;
                i++;
              }
              if (method === 'log' || method === 'info' || method === 'warn' || method === 'error') {
                value = args.join(' ');
              }
            }
          }
        } else {
          if (context?.variables && token.type === 'identifier' && token.value in context.variables) {
            value = context.variables[token.value];
          }
          i++;
          continue;
        }
        i++;
      }

      this._state = 'idle';
      const duration = performance.now() - startTime;
      this.emit({ kind: 'execution_end', data: { success: true, steps: this._steps, duration } });
      return { success: true, value, steps: this._steps, duration };
    } catch (e) {
      this._state = 'error';
      const err = e instanceof Error ? e : new Error(String(e));
      const duration = performance.now() - startTime;
      this.emit({ kind: 'error', data: { type: err.name, message: err.message } });
      return { success: false, error: { type: err.name, message: err.message, stack: err.stack }, steps: this._steps, duration };
    }
  }

  evaluate(expression: string, context?: ExecutionContext): unknown {
    const trimmed = expression.trim();
    if (!trimmed) return undefined;

    if (context?.variables) {
      for (const [key, val] of Object.entries(context.variables)) {
        if (trimmed === key) return val;
      }
    }

    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed === 'undefined') return undefined;
    if (/^-?\d+\.?\d*$/.test(trimmed)) return parseFloat(trimmed);
    if (/^(["`]).*\1$/.test(trimmed)) return trimmed.slice(1, -1);

    if (context?.variables) {
      const match = trimmed.match(/^(\w+)\s*([+\-*/])\s*(\w+)$/);
      if (match) {
        const left = context.variables[match[1]!] ?? parseFloat(match[1]!);
        const right = context.variables[match[3]!] ?? parseFloat(match[3]!);
        if (typeof left === 'number' && typeof right === 'number') {
          switch (match[2]) {
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': return left / right;
          }
        }
      }
    }

    return trimmed;
  }

  setMaxSteps(steps: number): void {
    this._maxSteps = Math.max(1, steps);
  }

  get steps(): number {
    return this._steps;
  }

  get state(): InterpreterState {
    return this._state;
  }

  pause(): void {
    this._paused = true;
    if (this._state === 'running') {
      this._state = 'paused';
      this.emit({ kind: 'pause' });
    }
  }

  resume(): void {
    this._paused = false;
    if (this._state === 'paused') {
      this._state = 'running';
      this.emit({ kind: 'resume' });
    }
  }

  reset(): void {
    this._state = 'idle';
    this._steps = 0;
    this._callStack = [];
    this._paused = false;
    this.emit({ kind: 'reset' });
  }

  getStack(): readonly CallFrameInfo[] {
    return [...this._callStack];
  }

  private tokenize(code: string): Array<{ type: string; value: string }> {
    const tokens: Array<{ type: string; value: string }> = [];
    let i = 0;
    while (i < code.length) {
      if (/\s/.test(code[i]!)) { i++; continue; }
      if (code[i] === '/' && code[i + 1] === '/') {
        while (i < code.length && code[i] !== '\n') i++;
        continue;
      }
      if (code[i] === '/' && code[i + 1] === '*') {
        i += 2;
        while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      if (/^[\[\]{}();,.:\=+\-*/%!<>&|^~?@]$/.test(code[i]!)) {
        tokens.push({ type: 'punctuation', value: code[i]! });
        i++;
        continue;
      }
      if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
        const quote = code[i]!;
        let str = '';
        i++;
        while (i < code.length && code[i] !== quote) {
          if (code[i] === '\\') { str += code[i + 1] ?? ''; i += 2; }
          else { str += code[i]!; i++; }
        }
        i++;
        tokens.push({ type: 'string', value: str });
        continue;
      }
      const identMatch = code.slice(i).match(/^[a-zA-Z_$][\w$]*/);
      if (identMatch) {
        const word = identMatch[0];
        tokens.push({ type: JS_KEYWORDS.has(word) ? 'keyword' : 'identifier', value: word });
        i += word.length;
        continue;
      }
      const numMatch = code.slice(i).match(/^\d+(\.\d+)?/);
      if (numMatch) {
        tokens.push({ type: 'number', value: numMatch[0] });
        i += numMatch[0].length;
        continue;
      }
      i++;
    }
    return tokens;
  }

  onEvent(handler: InterpreterEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: InterpreterEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._callStack = [];
    this._state = 'idle';
    this._paused = false;
  }
}

export { InterpreterService };
export type { IInterpreterService, ExecutionContext, CallFrameInfo, ExecutionResult, ExecutionError, InterpreterState, InterpreterEvent, InterpreterEventKind, InterpreterEventHandler };
