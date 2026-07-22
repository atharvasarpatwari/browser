# JIT Compilation — WASM Codegen + Tier Manager

**Date:** 2026-07-22
**Session:** Phase 2 JIT implementation — WASM binary encoder and tier management
**Status:** Completed

---

## Summary

Implemented the JIT compilation infrastructure for the Nova Browser JS engine: a WASM binary encoder that compiles `BytecodeFunction` objects to WebAssembly modules, and a tier manager that profiles function execution and compiles hot functions to WASM. This completes Phase 2 of the JIT plan.

## Architecture

### WASM Codegen (`src/browser/js/wasm-codegen.ts`)

**WasmCompiler** translates `BytecodeFunction` → WebAssembly binary:

- **Value encoding**: NaN-boxing with i64 representation
  - Numbers: raw f64 bits as i64 (native WASM arithmetic)
  - Non-numbers: tagged i64 constants (upper 16 bits = 0x7FF8)
  - Tags: null=0x0001, undefined=0x0002, false=0x0003, true=0x0004, objects=0x0010, strings=0x0020
  - Detection: `(val >> 48) == 0x7FF8` for tagged values

- **Memory layout** (2 pages, 128KB):
  - Offset 0x0000: Operand stack (1024 slots × 8 bytes)
  - Offset 0x2000: Local variables (1024 slots × 8 bytes)
  - Offset 0x4000: Constant pool references

- **WasmBinary**: Low-level binary encoder for WASM sections (type, import, function, memory, global, export, code, data)

- **WasmEmitter**: Instruction emitter (control, variable, memory, numeric, conversion ops)

- **Host imports**: 45+ host functions for complex operations (property access, function calls, globals, etc.)

### JIT Manager (`src/browser/js/jit.ts`)

**JITManager** profiles function execution and manages tier switching:

- **Hot detection**: Functions become "hot" after 100+ calls or 1000+ loop iterations
- **Eligibility**: Checks for async, generators, try/catch, debugger opcodes
- **Compilation**: Async WASM compilation via `WebAssembly.compile()` + `WebAssembly.instantiate()`
- **Cache**: LRU eviction of 64 compiled modules max
- **Fallback**: Automatic deoptimization back to bytecode on WASM execution failure

**TieredExecutor** wraps the VM with JIT-aware execution.

### Binary Format

The WASM module exports:
- `main(argc: i32) → i64` — main entry point
- `memory` — linear memory for stack/locals

All 45+ host functions are imported from the `host` module namespace.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/browser/js/wasm-codegen.ts` | ~1250 | WASM binary encoder (WasmBinary, WasmEmitter, WasmModuleBuilder, WasmCompiler, host imports) |
| `src/browser/js/jit.ts` | ~330 | JIT tier manager (JITManager, TieredExecutor, profiling, hot detection) |
| `tests/jit.test.ts` | ~470 | 37 tests: NaN-boxing, WASM compilation, JIT profiling, VM-JIT integration, performance |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | Export `WasmCompiler`, `createHostImports`, `JITManager`, `TieredExecutor` |

## Test Results

```
JIT tests:             37/37 pass
Bytecode VM tests:    141/141 pass
JS engine tests:      158/158 pass
Full core suite:      336/336 pass (these 3 files)
```

## Verification

1. `npx vitest run tests/jit.test.ts` — 37/37 pass
2. `npx vitest run tests/bytecode-vm.test.ts tests/js-engine.test.ts tests/jit.test.ts` — 336/336 pass
3. NaN-boxing encoding verified: tags have correct upper 16 bits, numbers round-trip
4. WASM binary output has correct magic number (0x0061736D) and version (1)
5. JIT profiling correctly tracks call counts, loop iterations, eligibility, tier status
6. Performance benchmarks pass: tight loop <5s, nested loop <5s, function calls <3s
