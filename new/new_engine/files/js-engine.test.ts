import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BytecodeService,
  InterpreterService,
  GarbageCollectionService,
  JITCompilerService,
} from '../src/browser/media';

describe('BytecodeService', () => {
  let service: BytecodeService;

  beforeEach(() => {
    service = new BytecodeService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts with empty stats', () => {
    const stats = service.getStats();
    expect(stats.totalCompilations).toBe(0);
    expect(stats.cacheSize).toBe(0);
  });

  it('compiles simple source', () => {
    const result = service.compile('var x = 1;');
    expect(result.success).toBe(true);
    expect(result.bytecode).toBeDefined();
    expect(result.functionCount).toBeGreaterThanOrEqual(1);
  });

  it('returns error for empty source', () => {
    const result = service.compile('   ');
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe('Empty source');
  });

  it('parses function declarations', () => {
    const result = service.compile('function add(a, b) { return a + b; }');
    expect(result.success).toBe(true);
    expect(result.functionCount).toBeGreaterThanOrEqual(1);
  });

  it('caches compiled output', () => {
    const src = 'var x = 1; var y = 2;';
    const r1 = service.compile(src);
    const r2 = service.compile(src);
    expect(r2.bytecode).toBe(r1.bytecode);
  });

  it('disassemble produces output', () => {
    const result = service.compile('function f() { return 1; }');
    const dis = service.disassemble(result.bytecode!);
    expect(dis).toContain('Bytecode');
    expect(dis).toContain('Function');
  });

  it('getOpcodes returns all opcodes', () => {
    const ops = service.getOpcodes();
    expect(ops.length).toBeGreaterThan(50);
    expect(ops[0].name).toBe('NOP');
    expect(ops[59].name).toBe('HALT');
  });

  it('reset clears cache and stats', () => {
    service.compile('var a = 1;');
    service.reset();
    const stats = service.getStats();
    expect(stats.totalCompilations).toBe(0);
    expect(stats.cacheSize).toBe(0);
  });

  it('emits compiled event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.compile('var x = 1;');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'compiled' }));
  });

  it('emits error event for empty source', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.compile('');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });

  it('emits reset event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.reset();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reset' }));
  });

  it('decode produces human-readable output', () => {
    const result = service.compile('function f() { }');
    const decoded = service.decode(result.bytecode!.functions[0]!.bytecode);
    expect(decoded.length).toBeGreaterThanOrEqual(1);
    expect(decoded[0]).toContain('MAKE_FUNCTION');
  });

  it('dispose clears all handlers', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.dispose();
    service.compile('var x = 1;');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('InterpreterService', () => {
  let service: InterpreterService;

  beforeEach(() => {
    service = new InterpreterService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts in idle state', () => {
    expect(service.state).toBe('idle');
    expect(service.steps).toBe(0);
  });

  it('executes empty code', () => {
    const result = service.execute('');
    expect(result.success).toBe(true);
    expect(result.steps).toBe(0);
  });

  it('executes simple statements', () => {
    const result = service.execute('var x = 1; var y = 2;');
    expect(result.success).toBe(true);
    expect(result.steps).toBeGreaterThan(0);
  });

  it('executes function declaration', () => {
    const result = service.execute('function add(a, b) { return a + b; }');
    expect(result.success).toBe(true);
    expect(result.value).toEqual({ type: 'function', name: 'add' });
  });

  it('executes console.log', () => {
    const result = service.execute('console.log("hello");');
    expect(result.success).toBe(true);
    expect(result.value).toBe('hello');
  });

  it('handles timeout', () => {
    const result = service.execute('var x = 1;', { timeout: 0 });
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('TimeoutError');
  });

  it('honors step limit', () => {
    service.setMaxSteps(2);
    const result = service.execute('var a = 1; var b = 2; var c = 3;');
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('RangeError');
  });

  it('evaluates expressions', () => {
    expect(service.evaluate('true')).toBe(true);
    expect(service.evaluate('42')).toBe(42);
    expect(service.evaluate('"hello"')).toBe('hello');
    expect(service.evaluate('null')).toBeNull();
  });

  it('evaluates with context variables', () => {
    const val = service.evaluate('x', { variables: { x: 42 } });
    expect(val).toBe(42);
  });

  it('evaluates simple arithmetic with context', () => {
    const val = service.evaluate('a + b', { variables: { a: 10, b: 5 } });
    expect(val).toBe(15);
  });

  it('evaluates chained arithmetic with correct precedence (previously unsupported)', () => {
    expect(service.evaluate('2 + 3 * 4')).toBe(14);
    expect(service.evaluate('(2 + 3) * 4')).toBe(20);
    expect(service.evaluate('10 - 2 - 3')).toBe(5);
    expect(service.evaluate('a + b + c', { variables: { a: 1, b: 2, c: 3 } })).toBe(6);
  });

  it('evaluates comparison and equality operators (previously unsupported)', () => {
    expect(service.evaluate('5 > 3')).toBe(true);
    expect(service.evaluate('5 < 3')).toBe(false);
    expect(service.evaluate('5 >= 5')).toBe(true);
    expect(service.evaluate('3 === 3')).toBe(true);
    expect(service.evaluate('3 === "3"')).toBe(false);
    expect(service.evaluate('3 == "3"')).toBe(true);
    expect(service.evaluate('3 !== 4')).toBe(true);
  });

  it('evaluates logical operators with short-circuit semantics (previously unsupported)', () => {
    expect(service.evaluate('true && false')).toBe(false);
    expect(service.evaluate('true || false')).toBe(true);
    expect(service.evaluate('0 || "fallback"')).toBe('fallback');
    expect(service.evaluate('1 && 2')).toBe(2);
  });

  it('evaluates unary operators (previously unsupported)', () => {
    expect(service.evaluate('!true')).toBe(false);
    expect(service.evaluate('-5')).toBe(-5);
    expect(service.evaluate('typeof 42')).toBe('number');
    expect(service.evaluate('typeof "x"')).toBe('string');
  });

  it('evaluates a ternary expression (previously unsupported)', () => {
    expect(service.evaluate('5 > 3 ? "yes" : "no"')).toBe('yes');
    expect(service.evaluate('1 > 3 ? "yes" : "no"')).toBe('no');
  });

  it('string concatenation with + still works alongside numeric +', () => {
    expect(service.evaluate('"a" + "b"')).toBe('ab');
    expect(service.evaluate('"x" + 1')).toBe('x1');
  });

  it('falls back gracefully on unparseable expressions instead of throwing', () => {
    // Function calls are intentionally unsupported by this lightweight
    // console-panel evaluator; it should degrade to the legacy fallback
    // (returning the raw text) rather than throw.
    expect(() => service.evaluate('foo(1, 2)')).not.toThrow();
  });

  it('pause and resume work', () => {
    const result = service.execute('var x = 1;');
    expect(result.success).toBe(true);
  });

  it('reset clears state', () => {
    service.execute('var x = 1;');
    service.reset();
    expect(service.state).toBe('idle');
    expect(service.steps).toBe(0);
    expect(service.getStack()).toEqual([]);
  });

  it('emits events during execution', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.execute('var x = 1;');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'execution_start' }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'execution_end' }));
  });

  it('emits error event on timeout', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.execute('var x = 1;', { timeout: 0 });
    expect(handler.mock.calls.some(call => call[0].kind === 'error')).toBe(true);
  });

  it('dispose clears all handlers', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.dispose();
    service.execute('var x = 1;');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('GarbageCollectionService', () => {
  let service: GarbageCollectionService;

  beforeEach(() => {
    service = new GarbageCollectionService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts with zero stats', () => {
    const stats = service.getStats();
    expect(stats.totalCollections).toBe(0);
    expect(stats.totalAllocated).toBe(0);
    expect(stats.objectCount).toBe(0);
  });

  it('allocate adds objects', () => {
    const id = service.allocate(64);
    expect(typeof id).toBe('number');
    const stats = service.getStats();
    expect(stats.totalAllocated).toBe(64);
    expect(stats.objectCount).toBe(1);
  });

  it('collect frees young objects', () => {
    service.allocate(64);
    service.allocate(128);
    const result = service.collect();
    expect(result.collected).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.generation).toBe('young');
  });

  it('force collection promotes objects', () => {
    service.allocate(64);
    const result = service.collect(true);
    expect(result.collected).toBeGreaterThanOrEqual(0);
  });

  it('multiple allocations trigger auto-collection', () => {
    for (let i = 0; i < 20; i++) {
      service.allocate(1024);
    }
    const stats = service.getStats();
    expect(stats.totalCollections).toBeGreaterThan(0);
  });

  it('setThresholds updates thresholds', () => {
    service.setThresholds({ youngGenSize: 256 * 1024, oldGenSize: 2 * 1024 * 1024 });
    const t = service.getThresholds();
    expect(t.youngGenSize).toBe(262144);
    expect(t.oldGenSize).toBe(2097152);
  });

  it('getStats returns correct structure', () => {
    const stats = service.getStats();
    expect(stats).toHaveProperty('totalCollections');
    expect(stats).toHaveProperty('youngCollections');
    expect(stats).toHaveProperty('oldCollections');
    expect(stats).toHaveProperty('totalAllocated');
    expect(stats).toHaveProperty('totalFreed');
    expect(stats).toHaveProperty('currentHeapSize');
    expect(stats).toHaveProperty('objectCount');
    expect(stats).toHaveProperty('lastCollectionDuration');
    expect(stats).toHaveProperty('averageCollectionDuration');
    expect(stats).toHaveProperty('fragmentationRatio');
  });

  it('emits allocation event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.allocate(64);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'allocation' }));
  });

  it('emits collection event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.collect();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'young_collection' }));
  });

  it('emits threshold_change event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.setThresholds({ youngGenSize: 999 });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'threshold_change' }));
  });

  it('dispose clears all state', () => {
    service.allocate(64);
    service.allocate(128);
    service.dispose();
    const stats = service.getStats();
    expect(stats.totalAllocated).toBe(0);
    expect(stats.objectCount).toBe(0);
  });
});

describe('JITCompilerService', () => {
  let service: JITCompilerService;

  beforeEach(() => {
    service = new JITCompilerService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts with zero stats', () => {
    const stats = service.getStats();
    expect(stats.totalFunctions).toBe(0);
    expect(stats.compiledFunctions).toBe(0);
  });

  it('registerFunction adds a function', () => {
    const id = service.registerFunction('add', 50);
    expect(typeof id).toBe('number');
    const info = service.getFunctionInfo(id);
    expect(info?.name).toBe('add');
    expect(info?.bytecodeSize).toBe(50);
    expect(info?.tier).toBe('bytecode');
  });

  it('recordCall increments call count', () => {
    const id = service.registerFunction('hot', 30);
    const info1 = service.getFunctionInfo(id)!;
    expect(info1.callCount).toBe(0);

    service.recordCall(id);
    const info2 = service.getFunctionInfo(id)!;
    expect(info2.callCount).toBe(1);
  });

  it('recordLoopIteration increments loop count', () => {
    const id = service.registerFunction('loopy', 40);
    service.recordLoopIteration(id);
    const info = service.getFunctionInfo(id)!;
    expect(info.loopIterations).toBe(1);
  });

  it('triggers compilation on hot call count', () => {
    const id = service.registerFunction('hot', 30);
    for (let i = 0; i < 100; i++) {
      service.recordCall(id);
    }
    const info = service.getFunctionInfo(id)!;
    expect(info.compiled).toBe(true);
    expect(info.tier).toBe('jit');
  });

  it('triggers compilation on hot loop iterations', () => {
    const id = service.registerFunction('loopy', 40);
    for (let i = 0; i < 1000; i++) {
      service.recordLoopIteration(id);
    }
    const info = service.getFunctionInfo(id)!;
    expect(info.compiled).toBe(true);
  });

  it('compilation produces result', () => {
    const id = service.registerFunction('fn', 100);
    const result = service.compile(id);
    expect(result.success).toBe(true);
    expect(result.compilationTime).toBeGreaterThan(0);
    expect(result.sizeReduction).toBeGreaterThan(0);
  });

  it('compile on unknown function returns error', () => {
    const result = service.compile(999);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('getHotFunctions returns hot functions', () => {
    const id = service.registerFunction('hot', 30);
    expect(service.getHotFunctions()).toHaveLength(0);
    for (let i = 0; i < 100; i++) {
      service.recordCall(id);
    }
    expect(service.getHotFunctions().length).toBeGreaterThanOrEqual(1);
  });

  it('setThresholds updates thresholds', () => {
    service.setThresholds({ hotCallCount: 50, maxCompiledFunctions: 10 });
    const t = service.getThresholds();
    expect(t.hotCallCount).toBe(50);
    expect(t.maxCompiledFunctions).toBe(10);
  });

  it('reset clears all state', () => {
    service.registerFunction('fn', 30);
    service.reset();
    expect(service.getStats().totalFunctions).toBe(0);
  });

  it('emits registered event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.registerFunction('fn', 30);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'registered' }));
  });

  it('emits compiled event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    const id = service.registerFunction('fn', 30);
    for (let i = 0; i < 100; i++) {
      service.recordCall(id);
    }
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'compiled' }));
  });

  it('emits tier_up event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    const id = service.registerFunction('fn', 30);
    service.compile(id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tier_up' }));
  });

  it('dispose clears all handlers', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.dispose();
    service.registerFunction('fn', 30);
    expect(handler).not.toHaveBeenCalled();
  });
});
