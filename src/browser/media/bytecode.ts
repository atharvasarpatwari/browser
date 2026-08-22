import type { IDisposable } from '../../app/dependency-container';

interface IBytecodeService extends IDisposable {
  compile(source: string, filename?: string): CompileResult;
  disassemble(bytecode: CompiledBytecode): string;
  getOpcodes(): readonly OpcodeDef[];
  getStats(): BytecodeStats;
  reset(): void;
  onEvent(handler: BytecodeEventHandler): () => void;
}

interface OpcodeDef {
  readonly opcode: number;
  readonly name: string;
  readonly operands: number;
  readonly stackEffect: number;
}

interface CompiledBytecode {
  readonly version: number;
  readonly functions: CompiledFunction[];
  readonly constants: readonly unknown[];
  readonly sourceMap?: Map<number, number>;
}

interface CompiledFunction {
  readonly name: string;
  readonly params: number;
  readonly locals: number;
  readonly bytecode: Uint8Array;
  readonly constants: readonly unknown[];
  readonly lineMap: Map<number, number>;
}

interface CompileResult {
  success: boolean;
  bytecode?: CompiledBytecode;
  errors?: CompileError[];
  functionCount?: number;
  instructionCount?: number;
}

interface CompileError {
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

interface BytecodeStats {
  totalCompilations: number;
  totalFunctions: number;
  totalInstructions: number;
  successRate: number;
  averageFunctionSize: number;
  cacheSize: number;
}

type BytecodeEventKind = 'compiled' | 'error' | 'cached' | 'evicted' | 'reset';
type BytecodeEventHandler = (event: BytecodeEvent) => void;

interface BytecodeEvent {
  readonly kind: BytecodeEventKind;
  readonly data?: Record<string, unknown>;
}

const OPCodes: OpcodeDef[] = [
  { opcode: 0, name: 'NOP', operands: 0, stackEffect: 0 },
  { opcode: 1, name: 'PUSH_CONST', operands: 1, stackEffect: 1 },
  { opcode: 2, name: 'PUSH_UNDEFINED', operands: 0, stackEffect: 1 },
  { opcode: 3, name: 'PUSH_NULL', operands: 0, stackEffect: 1 },
  { opcode: 4, name: 'PUSH_TRUE', operands: 0, stackEffect: 1 },
  { opcode: 5, name: 'PUSH_FALSE', operands: 0, stackEffect: 1 },
  { opcode: 6, name: 'POP', operands: 0, stackEffect: -1 },
  { opcode: 7, name: 'DUP', operands: 0, stackEffect: 1 },
  { opcode: 8, name: 'ADD', operands: 0, stackEffect: -1 },
  { opcode: 9, name: 'SUB', operands: 0, stackEffect: -1 },
  { opcode: 10, name: 'MUL', operands: 0, stackEffect: -1 },
  { opcode: 11, name: 'DIV', operands: 0, stackEffect: -1 },
  { opcode: 12, name: 'MOD', operands: 0, stackEffect: -1 },
  { opcode: 13, name: 'NEG', operands: 0, stackEffect: 0 },
  { opcode: 14, name: 'BIT_AND', operands: 0, stackEffect: -1 },
  { opcode: 15, name: 'BIT_OR', operands: 0, stackEffect: -1 },
  { opcode: 16, name: 'BIT_XOR', operands: 0, stackEffect: -1 },
  { opcode: 17, name: 'SHL', operands: 0, stackEffect: -1 },
  { opcode: 18, name: 'SHR', operands: 0, stackEffect: -1 },
  { opcode: 19, name: 'USHR', operands: 0, stackEffect: -1 },
  { opcode: 20, name: 'EQ', operands: 0, stackEffect: -1 },
  { opcode: 21, name: 'NEQ', operands: 0, stackEffect: -1 },
  { opcode: 22, name: 'STRICT_EQ', operands: 0, stackEffect: -1 },
  { opcode: 23, name: 'STRICT_NEQ', operands: 0, stackEffect: -1 },
  { opcode: 24, name: 'LT', operands: 0, stackEffect: -1 },
  { opcode: 25, name: 'GT', operands: 0, stackEffect: -1 },
  { opcode: 26, name: 'LTE', operands: 0, stackEffect: -1 },
  { opcode: 27, name: 'GTE', operands: 0, stackEffect: -1 },
  { opcode: 28, name: 'NOT', operands: 0, stackEffect: 0 },
  { opcode: 29, name: 'AND', operands: 0, stackEffect: -1 },
  { opcode: 30, name: 'OR', operands: 0, stackEffect: -1 },
  { opcode: 31, name: 'JUMP', operands: 1, stackEffect: 0 },
  { opcode: 32, name: 'JUMP_IF_FALSE', operands: 1, stackEffect: -1 },
  { opcode: 33, name: 'JUMP_IF_TRUE', operands: 1, stackEffect: -1 },
  { opcode: 34, name: 'LOAD_LOCAL', operands: 1, stackEffect: 1 },
  { opcode: 35, name: 'STORE_LOCAL', operands: 1, stackEffect: -1 },
  { opcode: 36, name: 'LOAD_GLOBAL', operands: 1, stackEffect: 1 },
  { opcode: 37, name: 'STORE_GLOBAL', operands: 1, stackEffect: -1 },
  { opcode: 38, name: 'LOAD_UPVALUE', operands: 1, stackEffect: 1 },
  { opcode: 39, name: 'STORE_UPVALUE', operands: 1, stackEffect: -1 },
  { opcode: 40, name: 'MAKE_FUNCTION', operands: 1, stackEffect: 1 },
  { opcode: 41, name: 'CALL', operands: 1, stackEffect: 0 },
  { opcode: 42, name: 'RETURN', operands: 0, stackEffect: -1 },
  { opcode: 43, name: 'NEW', operands: 1, stackEffect: 0 },
  { opcode: 44, name: 'MAKE_ARRAY', operands: 1, stackEffect: 0 },
  { opcode: 45, name: 'MAKE_OBJECT', operands: 1, stackEffect: 0 },
  { opcode: 46, name: 'LOAD_PROP', operands: 1, stackEffect: 0 },
  { opcode: 47, name: 'STORE_PROP', operands: 1, stackEffect: -2 },
  { opcode: 48, name: 'TYPEOF', operands: 0, stackEffect: 0 },
  { opcode: 49, name: 'DELETE', operands: 0, stackEffect: 0 },
  { opcode: 50, name: 'THROW', operands: 0, stackEffect: -1 },
  { opcode: 51, name: 'TRY', operands: 1, stackEffect: 0 },
  { opcode: 52, name: 'END_TRY', operands: 0, stackEffect: 0 },
  { opcode: 53, name: 'MAKE_CLASS', operands: 1, stackEffect: 1 },
  { opcode: 54, name: 'IMPORT', operands: 2, stackEffect: 1 },
  { opcode: 55, name: 'YIELD', operands: 0, stackEffect: 0 },
  { opcode: 56, name: 'AWAIT', operands: 0, stackEffect: 0 },
  { opcode: 57, name: 'SPREAD', operands: 1, stackEffect: 0 },
  { opcode: 58, name: 'OPTIONAL_CHAIN', operands: 1, stackEffect: 0 },
  { opcode: 59, name: 'HALT', operands: 0, stackEffect: 0 },
];

class BytecodeService implements IBytecodeService {
  private _compilations = 0;
  private _errors = 0;
  private _cache = new Map<string, CompiledBytecode>();
  private _maxCacheSize = 64;
  private _handlers = new Set<BytecodeEventHandler>();
  private _version = 1;

  compile(source: string, filename = '<anonymous>'): CompileResult {
    this._compilations++;
    const trimmed = source.trim();
    if (!trimmed) {
      this._errors++;
      const result: CompileResult = { success: false, errors: [{ line: 1, column: 1, message: 'Empty source' }] };
      this.emit({ kind: 'error', data: { filename, error: 'Empty source' } });
      return result;
    }

    const cached = this._cache.get(trimmed);
    if (cached) {
      this.emit({ kind: 'cached', data: { filename } });
      return { success: true, bytecode: cached, functionCount: cached.functions.length, instructionCount: this.countInstructions(cached) };
    }

    const functions: CompiledFunction[] = [];
    const constants: unknown[] = [];
    const lines = trimmed.split('\n');
    const bytecode: number[] = [];
    let instructionCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith('//')) continue;
      if (line.startsWith('function ') || line.startsWith('function* ') || line.startsWith('async function ')) {
        const name = line.match(/function[*\s]*(\w+)/)?.[1] ?? '<anonymous>';
        const fn: CompiledFunction = {
          name,
          params: (line.match(/,/g) || []).length + 1,
          locals: 0,
          bytecode: new Uint8Array([1, 2, 42]),
          constants: [],
          lineMap: new Map([[0, i + 1]]),
        };
        functions.push(fn);
        bytecode.push(40, functions.length - 1);
        instructionCount += 3;
      } else if (line.includes('var ') || line.includes('let ') || line.includes('const ')) {
        bytecode.push(36, bytecode.length);
        instructionCount++;
      } else if (line.includes('if') || line.includes('else')) {
        bytecode.push(32, 0);
        instructionCount++;
      } else if (line.includes('for') || line.includes('while') || line.includes('do')) {
        bytecode.push(31, 0);
        instructionCount++;
      } else if (line.includes('return')) {
        bytecode.push(42);
        instructionCount++;
      } else if (line.includes('try')) {
        bytecode.push(51, 0);
        instructionCount++;
      } else if (line.includes('throw')) {
        bytecode.push(50);
        instructionCount++;
      } else if (line.includes('class ')) {
        bytecode.push(53, 0);
        instructionCount++;
      }
      bytecode.push(1, 0);
      instructionCount++;
    }

    if (bytecode.length === 0) {
      bytecode.push(0);
      instructionCount++;
    }

    const mainFn: CompiledFunction = {
      name: '<main>',
      params: 0,
      locals: 0,
      bytecode: new Uint8Array(bytecode),
      constants: [],
      lineMap: new Map(),
    };
    functions.unshift(mainFn);
    instructionCount += mainFn.bytecode.length;

    const compiled: CompiledBytecode = {
      version: this._version,
      functions,
      constants,
      sourceMap: new Map([[0, 0]]),
    };

    if (this._cache.size >= this._maxCacheSize) {
      const key = this._cache.keys().next().value!;
      this._cache.delete(key);
      this.emit({ kind: 'evicted', data: { key } });
    }
    this._cache.set(trimmed, compiled);

    this.emit({ kind: 'compiled', data: { filename, functions: functions.length, instructions: instructionCount } });
    return { success: true, bytecode: compiled, functionCount: functions.length, instructionCount };
  }

  disassemble(bytecode: CompiledBytecode): string {
    const lines: string[] = [];
    lines.push(`; Bytecode v${bytecode.version}`);
    lines.push(`; Functions: ${bytecode.functions.length}`);
    lines.push(`; Constants: ${bytecode.constants.length}`);
    lines.push('');
    for (const fn of bytecode.functions) {
      lines.push(`;; Function: ${fn.name} (params=${fn.params}, locals=${fn.locals})`);
      const ops = this.decode(fn.bytecode);
      for (const op of ops) {
        lines.push(`  ${op}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  decode(bytecode: Uint8Array): string[] {
    const ops: string[] = [];
    let i = 0;
    while (i < bytecode.length) {
      const op = bytecode[i]!;
      const def = OPCodes[op];
      if (!def) { ops.push(`; unknown opcode ${op}`); i++; continue; }
      const addr = i;
      i++;
      const args: number[] = [];
      for (let j = 0; j < def.operands; j++) {
        args.push(bytecode[i++] ?? 0);
      }
      ops.push(`${addr.toString(16).padStart(4, '0')}  ${def.name}${args.length > 0 ? ' ' + args.join(', ') : ''}`);
    }
    return ops;
  }

  getOpcodes(): readonly OpcodeDef[] {
    return OPCodes;
  }

  getStats(): BytecodeStats {
    const total = this._compilations;
    return {
      totalCompilations: total,
      totalFunctions: 0,
      totalInstructions: 0,
      successRate: total > 0 ? (total - this._errors) / total : 1,
      averageFunctionSize: 0,
      cacheSize: this._cache.size,
    };
  }

  reset(): void {
    this._cache.clear();
    this._compilations = 0;
    this._errors = 0;
    this.emit({ kind: 'reset' });
  }

  private countInstructions(bc: CompiledBytecode): number {
    return bc.functions.reduce((sum, fn) => sum + fn.bytecode.length, 0);
  }

  onEvent(handler: BytecodeEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: BytecodeEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._cache.clear();
  }
}

export { BytecodeService, OPCodes };
export type { IBytecodeService, OpcodeDef, CompiledBytecode, CompiledFunction, CompileResult, CompileError, BytecodeStats, BytecodeEvent, BytecodeEventKind, BytecodeEventHandler };
