# JIT Compilation Plan — Nova Browser JS Engine

**Date:** 2026-07-21
**Status:** Planned

---

## Overview

Replace the tree-walking interpreter with a **two-tier execution system**:
1. **Tier 0 — Bytecode VM**: Stack-based bytecode compiler + interpreter. Replaces the 1,337-line tree-walking `Interpreter`.
2. **Tier 1 — JIT Compiler**: Hot bytecode functions are profiled and compiled to **WebAssembly modules**. Node.js/V8 natively compiles WASM to machine code, giving near-native performance for computation-heavy code.

**Why WASM for JIT (not raw x86-64)?**
- Node.js cannot easily allocate executable memory for raw machine code (no VirtualAlloc exposed, ffi-napi is brittle)
- WASM is **genuinely JIT-compiled by V8** to native machine code at near-native speed
- WASM is portable across platforms
- WASM generation from our IR is well-defined (binary format is ~50 opcodes, straightforward encoding)
- WASM gets the same speedups as V8's TurboFan compiler (SSA, register allocation, instruction selection)

## Architecture

```
  Source Code
      │
      ▼
  Lexer → Parser → AST
                      │
                      ▼
              BytecodeCompiler
                      │
                      ▼
              BytecodeFunction (bytecode + constants)
                      │
          ┌───────────┴───────────┐
          │                       │
     Tier 0: VM              Tier 1: JIT
   (bytecode interp)     (WASM compilation)
          │                       │
          │  ← profile data ───→  │
          │                       │
          └───────────┬───────────┘
                      │
                      ▼
                   JSValue
```

## Phase 1: Bytecode VM (~2,000 lines)

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/browser/js/bytecode.ts` | ~300 | Opcodes enum, BytecodeFunction type, BytecodeProgram type |
| `src/browser/js/bytecode-compiler.ts` | ~1,200 | AST → bytecode compiler |
| `src/browser/js/vm.ts` | ~700 | Stack-based bytecode VM executor |
| `tests/bytecode-vm.test.ts` | ~400 | Comprehensive VM tests |

### Bytecode Opcodes (Stack-Based)

```
── Constants ──────────────────────────
PUSH_CONST <idx>    Push constants[idx]
PUSH_NULL           Push null
PUSH_UNDEFINED      Push undefined
PUSH_TRUE           Push true
PUSH_FALSE          Push false
PUSH_ZERO           Push 0
PUSH_ONE            Push 1

── Stack ──────────────────────────────
POP                 Discard top
DUP                 Duplicate top
SWAP                Swap top two

── Variables ──────────────────────────
LOAD_LOCAL <slot>   Push locals[slot]
STORE_LOCAL <slot>  locals[slot] = pop
LOAD_GLOBAL <idx>   Push globals[constants[idx]]
STORE_GLOBAL <idx>  globals[constants[idx]] = pop
DEFINE_VAR <idx> <kind>  Declare variable
LOAD_THIS           Push 'this' from frame

── Arithmetic ─────────────────────────
ADD, SUB, MUL, DIV, MOD, POW
NEGATE              Unary -
PLUS                Unary +

── Comparison ─────────────────────────
EQ, NEQ, SEQ, SNEQ, LT, GT, LTE, GTE
INSTANCEOF, IN

── Logical / Bitwise ──────────────────
NOT, BITNOT
BITAND, BITOR, BITXOR
SHL, SHR, USHR

── Control Flow ───────────────────────
JMP <offset>        Unconditional jump
JMP_IF_FALSE <off>  Jump if !toBoolean(top)
JMP_IF_TRUE <off>   Jump if toBoolean(top)
JMP_IF_NULLISH <off>  Jump if null/undefined (for ??)

── Functions ──────────────────────────
CALL <argc>         Call function with argc args
CALL_METHOD <argc>  Call method (obj is below args)
NEW <argc>          Construct with new
RETURN              Return top of stack
CLOSURE <idx>       Create closure from constants[idx]

── Objects ────────────────────────────
OBJECT_CREATE <n>   Create object from 2n stack values
ARRAY_CREATE <n>    Create array from n stack values
PROP_GET            obj.key = pop, push obj[key]
PROP_SET            obj.key.val from stack
COMP_GET            Same but computed key
COMP_SET            Same but computed key

── Special ────────────────────────────
TYPEOF              Unary typeof
THROW               Throw top value
TRY <handler_off>   Push exception handler
END_TRY             Pop exception handler
BREAK <offset>      Break out of loop
CONTINUE <offset>   Continue loop
SPREAD_ARGS         Spread top array into individual args
AWAIT               Await top value
```

### BytecodeFunction Structure

```typescript
interface BytecodeFunction {
  bytecode: Uint8Array;       // Instruction stream
  constants: JSValue[];       // Constant pool (numbers, strings, sub-functions)
  paramCount: number;         // Number of parameters
  localCount: number;         // Number of local slots (params + locals)
  name: string;               // Function name
  isArrow: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  upvalues: UpvalueInfo[];    // Captured closure variables
  lineTable: Uint32Array;     // [bytecode_offset, line] pairs for errors
}
```

### BytecodeCompiler Design

The compiler walks the AST and emits bytecode:

1. **Scope resolution**: Assign local slot numbers to variables during compilation. Track depth for block scoping.
2. **Function compilation**: Each function body is compiled to a separate `BytecodeFunction`. Nested functions reference parent scope via upvalues.
3. **Control flow**: `if`/`while`/`for` compiled with forward/backward jumps. `break`/`continue` resolved via jump patch list.
4. **Constants**: Literals (numbers, strings) stored in constant pool, referenced by index.
5. **Try/catch**: Compiled with exception handler table (bytecode offset → handler offset).
6. **Closures**: Variables that escape their declaring scope are marked as upvalues. `CLOSURE` instruction captures them.

### VM Design

```
Stack Machine:
┌──────────────────────────────┐
│         Value Stack          │  ← sp (stack pointer)
│   [... args ... locals ...]  │
└──────────────────────────────┘

Call Frame Stack:
┌──────────────────────────────┐
│  Frame: { func, ip, bp }    │  ← fp (frame pointer)
│  Frame: { func, ip, bp }    │
│  Frame: { func, ip, bp }    │
└──────────────────────────────┘
```

Execution loop:
```typescript
while (ip < bytecode.length) {
  const opcode = bytecode[ip++];
  switch (opcode) {
    case OP.PUSH_CONST: stack[sp++] = constants[readU16()]; break;
    case OP.ADD: { const b = stack[--sp]; const a = stack[--sp]; stack[sp++] = a + b; break; }
    case OP.JMP: { ip = readU16(); break; }
    case OP.JMP_IF_FALSE: { ip = toBoolean(stack[--sp]) ? ip + 2 : readU16(); break; }
    // ... etc
  }
}
```

## Phase 2: WASM JIT Compiler (~1,500 lines)

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/browser/js/wasm-codegen.ts` | ~1,000 | Bytecode → WASM binary encoder |
| `src/browser/js/jit.ts` | ~500 | JIT tier manager, profiling, compilation |
| `tests/jit.test.ts` | ~300 | JIT tests + benchmarks |

### How WASM JIT Works

1. **Profiling**: Track call count and loop iteration count for each `BytecodeFunction`.
2. **Hot detection**: When a function exceeds threshold (100 calls or 1,000 loop iterations), trigger WASM compilation.
3. **WASM codegen**: Translate the bytecode function's hot path into a WASM module.
4. **Execution**: `WebAssembly.instantiate()` compiles WASM to native machine code via V8's TurboFan.
5. **Deoptimization**: If WASM execution encounters unsupported operations (eval, with, try/catch with complex handlers), fall back to bytecode VM.

### WASM Module Structure

Each JIT-compiled function becomes a WASM module with:

```
(module
  ;; Linear memory for operand stack (page 0 = stack, page 1 = locals)
  (memory (export "memory") 1)
  
  ;; Global: stack pointer
  (global $sp (mut i32) (i32.const 0))
  
  ;; Imported host functions (for operations too complex for WASM)
  (import "host" "prop_get" (func $prop_get (param i32 i32) (result i32)))
  (import "host" "prop_set" (func $prop_set (param i32 i32 i32)))
  (import "host" "call_func" (func $call_func (param i32 i32) (result i32)))
  (import "host" "new_obj" (func $new_obj (param i32) (result i32)))
  (import "host" "typeof_val" (func $typeof_val (param i32) (result i32)))
  (import "host" "to_number" (func $to_number (param i32) (result f64)))
  ;; ... etc
  
  ;; Main function
  (func $main (export "main") (result i32)
    ;; Stack operations via linear memory
    ;; Arithmetic runs natively in WASM
    ;; Complex ops call host imports
  )
)
```

### What Runs in WASM (fast, native speed)
- All arithmetic (`+`, `-`, `*`, `/`, `%`, `**`)
- All comparisons (`===`, `!==`, `<`, `>`, `<=`, `>=`)
- All bitwise operations
- Local variable load/store
- Control flow (if/else, while, for loops)
- Type checks (typeof, instanceof)
- Constant loading
- Array index access

### What Calls Back to Host (slower, but complex)
- Property access on objects (`obj.key`)
- Function calls (need full VM machinery)
- `new` expressions
- Destructuring
- `eval()`
- `try/catch`
- `for-in` / `for-of`
- Template literals

### Value Representation in WASM

All JS values are boxed as tagged pointers in WASM linear memory:
- **NaN-boxing**: Use the NaN bits of f64 to store tagged values
  - Number: raw f64
  - `null`: i32 tag 0
  - `undefined`: i32 tag 1
  - `false`: i32 tag 2
  - `true`: i32 tag 3
  - Object: i32 tag 4 + pointer into memory
  - String: i32 tag 5 + pointer into memory

### Memory Layout (per WASM instance)
```
Offset 0x00000: Operand Stack (64KB = 8K slots)
Offset 0x10000: Local Variables (4KB = 512 slots)
Offset 0x11000: Constant Pool References
```

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/interpreter.ts` | Add `useVM` mode flag; `run()` dispatches to VM or tree-walker |
| `src/browser/js/values.ts` | Add `BytecodeFunction` to `JSFunction.body` type; update `callJSFunction` to route to VM |
| `src/browser/js/index.ts` | Export new modules |
| `package.json` | No new dependencies (WASM is built into Node.js) |

## Test Strategy

### Bytecode VM Tests (`tests/bytecode-vm.test.ts`)
All 158 existing JS engine tests run through the VM, verifying identical behavior:
- Each existing `evalJS()` test duplicated with a `evalJSViaVM()` variant
- Additional VM-specific tests: compilation errors, bytecode format validation
- Performance benchmarks: VM vs tree-walker

### JIT Tests (`tests/jit.test.ts`)
- Hot function detection: verify functions get compiled after threshold
- WASM compilation: verify hot functions produce valid WASM
- Execution correctness: JIT-compiled functions produce same results as VM
- Deoptimization: verify fallback to VM on unsupported operations
- Performance benchmarks: JIT vs VM vs tree-walker

## Expected Performance

| Tier | Mechanism | Expected Speedup |
|------|-----------|-----------------|
| Tree-walker (current) | Direct AST evaluation | 1x (baseline) |
| Bytecode VM | Stack-based dispatch | 2-5x |
| WASM JIT | V8 TurboFan native | 10-50x |

The largest gains come from:
- Eliminating AST node traversal overhead (VM)
- Native arithmetic in WASM (JIT)
- Eliminating Environment map lookups via slot-based locals (VM + JIT)

## Verification

1. All 158 existing JS engine tests pass via both VM and JIT paths
2. New tests for VM compilation, execution, and JIT compilation
3. Full test suite: 89/90 test files, 3948+ tests
4. Performance benchmark showing measurable speedup
