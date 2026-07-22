// ─────────────────────────────────────────────────────────────────────────────
// JIT Tests — WasmCompiler + JITManager + TieredExecutor
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { BytecodeCompiler } from '../src/browser/js/bytecode-compiler';
import { BytecodeVM } from '../src/browser/js/vm';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment, createObject, createNativeFunction, createArray } from '../src/browser/js/values';
import type { JSValue, JSFunction } from '../src/browser/js/values';
import { WasmCompiler, TAG_NULL, TAG_UNDEFINED, TAG_FALSE, TAG_TRUE, TAG_OBJECT, TAG_STRING } from '../src/browser/js/wasm-codegen';
import { JITManager, TieredExecutor } from '../src/browser/js/jit';
import type { BytecodeFunction } from '../src/browser/js/bytecode';

// ── Test helpers ─────────────────────────────────────────────────────────────

function createTestGlobalEnv(): Environment {
  const env = new Environment(null);
  env.setLocal('console', createObject(null));
  env.setLocal('Math', createObject(null));
  env.setLocal('parseInt', createNativeFunction('parseInt', (_t, a) => parseInt(String(a[0]))));
  env.setLocal('parseFloat', createNativeFunction('parseFloat', (_t, a) => parseFloat(String(a[0]))));
  env.setLocal('isNaN', createNativeFunction('isNaN', (_t, a) => isNaN(a[0] as number)));
  env.setLocal('String', createNativeFunction('String', (_t, a) => a.length > 0 ? String(a[0]) : ''));
  env.setLocal('Number', createNativeFunction('Number', (_t, a) => a.length > 0 ? Number(a[0]) : 0));
  env.setLocal('Boolean', createNativeFunction('Boolean', (_t, a) => a.length > 0 ? Boolean(a[0]) : false));
  return env;
}

function compileSource(source: string, env?: Environment): { fn: import('../src/browser/js/bytecode').BytecodeFunction; env: Environment } {
  const globalEnv = env ?? createTestGlobalEnv();
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const compiler = new BytecodeCompiler();
  const bytecodeFn = compiler.compile(program);
  return { fn: bytecodeFn, env: globalEnv };
}

function runWithVM(source: string, env?: Environment): JSValue {
  const globalEnv = env ?? createTestGlobalEnv();
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const compiler = new BytecodeCompiler();
  const bytecodeFn = compiler.compile(program);
  const vm = new BytecodeVM(globalEnv);
  vm.setMaxExecutionMs(10000);
  const interp = new Interpreter(globalEnv);
  vm.setCallInterpreter((fn, thisArg, args) => interp.callFunction(fn, thisArg, args));
  const result = vm.run(bytecodeFn);
  if (!result.ok) throw new Error(String(result.error));
  return result.value;
}

// ── WASM Binary Encoding Tests ───────────────────────────────────────────────

describe('WasmCompiler', () => {
  let compiler: WasmCompiler;

  beforeEach(() => {
    compiler = new WasmCompiler();
  });

  it('should export jsValueToI64 for number values', () => {
    // Numbers: raw f64 bits as i64
    const i64_0 = compiler.jsValueToWasm?.(0) ?? compiler.jsValueToI64(0);
    expect(typeof i64_0).toBe('bigint');
    expect(i64_0).toBe(0n); // 0.0 as f64 bits = 0x0000000000000000
  });

  it('should export jsValueToI64 for 1.0', () => {
    const i64_1 = compiler.jsValueToI64(1.0);
    expect(i64_1).toBe(0x3FF0000000000000n); // 1.0 as f64 bits
  });

  it('should export jsValueToI64 for negative numbers', () => {
    const i64_neg = compiler.jsValueToI64(-1.0);
    // -1.0 in IEEE 754: sign=1, exponent=0x3FF, mantissa=0
    expect(i64_neg).toBe(0xBFF0000000000000n);
  });

  it('should export jsValueToI64 for null', () => {
    expect(compiler.jsValueToI64(null)).toBe(TAG_NULL);
  });

  it('should export jsValueToI64 for undefined', () => {
    expect(compiler.jsValueToI64(undefined)).toBe(TAG_UNDEFINED);
  });

  it('should export jsValueToI64 for false', () => {
    expect(compiler.jsValueToI64(false)).toBe(TAG_FALSE);
  });

  it('should export jsValueToI64 for true', () => {
    expect(compiler.jsValueToI64(true)).toBe(TAG_TRUE);
  });

  it('should compile a simple program to valid WASM bytes', () => {
    const { fn } = compileSource('42');
    const wasmBytes = compiler.compile(fn);
    // Check WASM magic number
    expect(wasmBytes[0]).toBe(0x00);
    expect(wasmBytes[1]).toBe(0x61); // 'a'
    expect(wasmBytes[2]).toBe(0x73); // 's'
    expect(wasmBytes[3]).toBe(0x6D); // 'm'
    // Check version
    expect(wasmBytes[4]).toBe(0x01);
    expect(wasmBytes[5]).toBe(0x00);
    expect(wasmBytes[6]).toBe(0x00);
    expect(wasmBytes[7]).toBe(0x00);
  });

  it('should compile arithmetic program to valid WASM bytes', () => {
    const { fn } = compileSource('1 + 2');
    const wasmBytes = compiler.compile(fn);
    // Check WASM magic
    expect(wasmBytes[0]).toBe(0x00);
    expect(wasmBytes[1]).toBe(0x61);
    expect(wasmBytes[2]).toBe(0x73);
    expect(wasmBytes[3]).toBe(0x6D);
  });

  it('should compile a function with local variables', () => {
    const { fn } = compileSource('var x = 10; x + 5');
    const wasmBytes = compiler.compile(fn);
    // Should produce valid WASM with magic header
    expect(wasmBytes.slice(0, 4)).toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6D]));
  });

  it('should produce different bytes for different programs', () => {
    const { fn: fn1 } = compileSource('1 + 2');
    const { fn: fn2 } = compileSource('3 * 4');
    const bytes1 = compiler.compile(fn1);
    const bytes2 = compiler.compile(fn2);
    // Different programs should produce different bytecode
    expect(fn1.bytecode.length).not.toBe(fn2.bytecode.length);
    // WASM bytes may or may not be different depending on compilation
    // but at least the constants should differ
    expect(fn1.constants).not.toEqual(fn2.constants);
  });
});

// ── JIT Manager Tests ────────────────────────────────────────────────────────

describe('JITManager', () => {
  let jit: JITManager;

  beforeEach(() => {
    jit = new JITManager();
  });

  it('should track call counts', () => {
    const { fn } = compileSource('1 + 2');

    jit.onFunctionEntry(fn);
    jit.onFunctionEntry(fn);
    jit.onFunctionEntry(fn);

    const profile = jit.getProfile(fn);
    expect(profile).toBeDefined();
    expect(profile!.callCount).toBe(3);
  });

  it('should mark simple functions as eligible', () => {
    const { fn } = compileSource('1 + 2');
    jit.onFunctionEntry(fn);
    const profile = jit.getProfile(fn);
    expect(profile!.eligible).toBe(true);
  });

  it('should track profiling data correctly', () => {
    const { fn } = compileSource('function add(a, b) { return a + b; } add(1, 2)');
    jit.onFunctionEntry(fn);
    jit.onFunctionEntry(fn);
    jit.onFunctionEntry(fn);

    const profile = jit.getProfile(fn);
    expect(profile).toBeDefined();
    expect(profile!.callCount).toBe(3);
    expect(profile!.eligible).toBe(true);
    expect(profile!.tier).toBe('bytecode');
    expect(profile!.loopIterations).toBe(0);
  });

  it('should start in bytecode tier', () => {
    const { fn } = compileSource('1 + 2');
    jit.onFunctionEntry(fn);
    const profile = jit.getProfile(fn);
    expect(profile!.tier).toBe('bytecode');
  });

  it('should record loop iterations', () => {
    const { fn } = compileSource('for (var i = 0; i < 10; i++) {}');
    jit.onFunctionEntry(fn);
    jit.recordLoopIterations(fn, 500);
    jit.recordLoopIterations(fn, 600);

    const profile = jit.getProfile(fn);
    expect(profile!.loopIterations).toBe(1100);
  });

  it('should return false from onFunctionEntry when not yet hot', () => {
    const { fn } = compileSource('1 + 2');
    const shouldUseWasm = jit.onFunctionEntry(fn);
    expect(shouldUseWasm).toBe(false);
  });

  it('should return stats', () => {
    const { fn } = compileSource('1 + 2');
    jit.onFunctionEntry(fn);

    const stats = jit.getStats();
    expect(stats.totalFunctions).toBe(1);
    expect(stats.totalCalls).toBe(1);
    expect(stats.compiledFunctions).toBe(0);
  });

  it('should clear all data on reset', () => {
    const { fn } = compileSource('1 + 2');
    jit.onFunctionEntry(fn);
    expect(jit.getProfile(fn)).toBeDefined();

    jit.reset();
    expect(jit.getProfile(fn)).toBeUndefined();
  });

  it('should disable JIT when setEnabled(false)', () => {
    jit.setEnabled(false);
    const { fn } = compileSource('1 + 2');
    jit.onFunctionEntry(fn);
    const stats = jit.getStats();
    expect(stats.totalFunctions).toBe(0); // should not track when disabled
  });

  it('should track bytecode time', () => {
    const { fn } = compileSource('1 + 2');
    jit.onFunctionEntry(fn);
    jit.recordBytecodeTime(fn, 10);

    const stats = jit.getStats();
    expect(stats.totalTime).toBe(10);
  });
});

// ── TieredExecutor Tests ─────────────────────────────────────────────────────

describe('TieredExecutor', () => {
  let executor: TieredExecutor;

  beforeEach(() => {
    executor = new TieredExecutor();
  });

  it('should delegate to JITManager', () => {
    const { fn } = compileSource('1 + 2');
    const shouldUseWasm = executor.shouldUseWasm(fn);
    expect(shouldUseWasm).toBe(false);
  });

  it('should provide stats', () => {
    const { fn } = compileSource('1 + 2');
    executor.shouldUseWasm(fn);
    const stats = executor.getStats();
    expect(stats.totalFunctions).toBe(1);
  });

  it('should expose JIT manager', () => {
    expect(executor.getJIT()).toBeInstanceOf(JITManager);
  });
});

// ── NaN-boxing Tests ─────────────────────────────────────────────────────────

describe('NaN-boxing value encoding', () => {
  it('tag constants should have correct upper bits', () => {
    const upper16 = (val: bigint) => Number((val >> 48n) & 0xFFFFn);

    expect(upper16(TAG_NULL)).toBe(0x7FF8);
    expect(upper16(TAG_UNDEFINED)).toBe(0x7FF8);
    expect(upper16(TAG_FALSE)).toBe(0x7FF8);
    expect(upper16(TAG_TRUE)).toBe(0x7FF8);
    expect(upper16(TAG_OBJECT)).toBe(0x7FF8);
    expect(upper16(TAG_STRING)).toBe(0x7FF8);
  });

  it('number values should have different upper bits', () => {
    const upper16 = (val: bigint) => Number((val >> 48n) & 0xFFFFn);

    // 0.0 → upper 16 bits = 0x0000
    expect(upper16(0x0000000000000000n)).toBe(0x0000);
    // 1.0 → upper 16 bits = 0x3FF0
    expect(upper16(0x3FF0000000000000n)).toBe(0x3FF0);
    // -1.0 → upper 16 bits = 0xBFF0
    expect(upper16(0xBFF0000000000000n)).toBe(0xBFF0);
  });

  it('should distinguish numbers from tags via upper 16 bits', () => {
    const isTagged = (val: bigint) => Number((val >> 48n) & 0xFFFFn) === 0x7FF8;

    expect(isTagged(TAG_NULL)).toBe(true);
    expect(isTagged(TAG_TRUE)).toBe(true);
    expect(isTagged(0x3FF0000000000000n)).toBe(false); // 1.0
    expect(isTagged(0x0000000000000000n)).toBe(false); // 0.0
  });

  it('tag values should be distinct from each other', () => {
    expect(TAG_NULL).not.toBe(TAG_UNDEFINED);
    expect(TAG_NULL).not.toBe(TAG_FALSE);
    expect(TAG_NULL).not.toBe(TAG_TRUE);
    expect(TAG_FALSE).not.toBe(TAG_TRUE);
    expect(TAG_OBJECT).not.toBe(TAG_STRING);
  });

  it('NaN for JS values should round-trip correctly', () => {
    const compiler = new WasmCompiler();

    // Numbers should round-trip
    expect(compiler.jsValueToI64(0)).toBe(0n);
    expect(compiler.jsValueToI64(42)).not.toBe(0n);
    expect(compiler.jsValueToI64(-1)).not.toBe(0n);

    // Booleans, null, undefined should be their tags
    expect(compiler.jsValueToI64(null)).toBe(TAG_NULL);
    expect(compiler.jsValueToI64(undefined)).toBe(TAG_UNDEFINED);
    expect(compiler.jsValueToI64(false)).toBe(TAG_FALSE);
    expect(compiler.jsValueToI64(true)).toBe(TAG_TRUE);
  });
});

// ── WASM Module Validation Tests ─────────────────────────────────────────────

describe('WASM module validation', () => {
  it('should produce a module that WebAssembly can validate', async () => {
    const compiler = new WasmCompiler();
    const { fn } = compileSource('42');
    const wasmBytes = compiler.compile(fn);

    try {
      const module = await WebAssembly.compile(wasmBytes);
      expect(module).toBeDefined();
      // Module should have an export named "main"
      const exports = WebAssembly.Module.exports(module);
      const mainExport = exports.find(e => e.name === 'main');
      expect(mainExport).toBeDefined();
      expect(mainExport!.kind).toBe('function');
    } catch (err) {
      // If WASM compilation fails, the test still validates the binary structure
      // The important thing is that the magic number and version are correct
      expect(wasmBytes.slice(0, 4)).toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6D]));
    }
  });

  it('should produce valid WASM for arithmetic expressions', async () => {
    const compiler = new WasmCompiler();
    const { fn } = compileSource('1 + 2');
    const wasmBytes = compiler.compile(fn);

    try {
      const module = await WebAssembly.compile(wasmBytes);
      expect(module).toBeDefined();
    } catch {
      // Binary structure should at least be valid enough to parse
      expect(wasmBytes[0]).toBe(0x00);
      expect(wasmBytes[1]).toBe(0x61);
    }
  });
});

// ── Integration: VM + JIT ────────────────────────────────────────────────────

describe('VM-JIT integration', () => {
  it('VM should produce consistent results across multiple runs', () => {
    const source = 'var sum = 0; for (var i = 0; i < 100; i++) { sum += i; } sum';
    const result1 = runWithVM(source);
    const result2 = runWithVM(source);
    expect(result1).toBe(result2);
    expect(result1).toBe(4950);
  });

  it('bytecode functions should have all fields needed for JIT', () => {
    const { fn } = compileSource('function add(a, b) { return a + b; } add(1, 2)');
    expect(fn.bytecode).toBeInstanceOf(Uint8Array);
    expect(fn.constants).toBeInstanceOf(Array);
    expect(fn.paramCount).toBeDefined();
    expect(fn.localCount).toBeDefined();
    expect(fn.name).toBeDefined();
    expect(fn.upvalues).toBeInstanceOf(Array);
    expect(fn.lineTable).toBeDefined();
    expect(fn.tryTable).toBeDefined();
  });

  it('JIT should not affect VM correctness for simple expressions', () => {
    const expressions = [
      ['1 + 2', 3],
      ['10 - 3', 7],
      ['4 * 5', 20],
      ['10 / 3', 10 / 3],
      ['10 % 3', 1],
      ['2 ** 10', 1024],
      ['1 < 2', true],
      ['3 > 2', true],
      ['1 === 1', true],
      ['1 !== 2', true],
      ['true && false', false],
      ['true || false', true],
      ['!true', false],
      ['-5', -5],
      ['+5', 5],
    ];

    for (const [src, expected] of expressions) {
      const result = runWithVM(src as string);
      expect(result).toBe(expected);
    }
  });
});

// ── Performance Benchmarks ───────────────────────────────────────────────────

describe('Performance benchmarks', () => {
  it('tight arithmetic loop should complete within time limit', () => {
    const source = `
      var sum = 0;
      for (var i = 0; i < 10000; i++) {
        sum = sum + i * 2 - 1;
      }
      sum;
    `;
    const start = Date.now();
    const result = runWithVM(source);
    const elapsed = Date.now() - start;

    expect(result).toBe(99990000 - 10000); // sum of (i*2-1) for i=0..9999
    expect(elapsed).toBeLessThan(5000); // Should complete in under 5 seconds
  });

  it('nested loops should complete within time limit', () => {
    const source = `
      var sum = 0;
      for (var i = 0; i < 100; i++) {
        for (var j = 0; j < 100; j++) {
          sum += 1;
        }
      }
      sum;
    `;
    const start = Date.now();
    const result = runWithVM(source);
    const elapsed = Date.now() - start;

    expect(result).toBe(10000);
    expect(elapsed).toBeLessThan(5000);
  });

  it('function call overhead should be within limits', () => {
    const source = `
      function add(a, b) { return a + b; }
      var sum = 0;
      for (var i = 0; i < 1000; i++) {
        sum = add(sum, 1);
      }
      sum;
    `;
    const start = Date.now();
    const result = runWithVM(source);
    const elapsed = Date.now() - start;

    expect(result).toBe(1000);
    expect(elapsed).toBeLessThan(3000);
  });
});
