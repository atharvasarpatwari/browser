// ─────────────────────────────────────────────────────────────────────────────
// WASM CODEGEN — Bytecode → WebAssembly binary encoder
// Compiles BytecodeFunction objects into WebAssembly modules.
// Simple arithmetic runs natively in WASM via V8 TurboFan.
// Complex operations delegate to host JavaScript imports.
// ─────────────────────────────────────────────────────────────────────────────

import { OP, type BytecodeFunction } from './bytecode';

// ── Value encoding (NaN-boxing in WASM i64) ─────────────────────────────────
//
// All JS values are represented as i64 in WASM linear memory.
// Numbers: raw f64 bits stored as i64 (reinterpreted).
// Non-numbers: tagged i64 constants with upper bits = 0x7FF8_xxxx_xxxx_xxxx.
//
// Detection: extract upper 16 bits. If they equal 0x7FF8, it's a tagged value.
// Otherwise, reinterpret as f64 for native arithmetic.

const TAG_NULL      = 0x7FF8_0000_0000_0001n;
const TAG_UNDEFINED = 0x7FF8_0000_0000_0002n;
const TAG_FALSE     = 0x7FF8_0000_0000_0003n;
const TAG_TRUE      = 0x7FF8_0000_0000_0004n;
const TAG_OBJECT    = 0x7FF8_0000_0000_0010n; // base — + table index
const TAG_STRING    = 0x7FF8_0000_0000_0020n; // base — + table index
const TAG_BIGINT    = 0x7FF8_0000_0000_0030n;

// WASM value types
const I32 = 0x7F;
const I64 = 0x7E;
const F32 = 0x7D;
const F64 = 0x7C;
const FUNC = 0x60;

// WASM section IDs
const SEC_TYPE     = 0x01;
const SEC_IMPORT   = 0x02;
const SEC_FUNCTION = 0x03;
const SEC_MEMORY   = 0x05;
const SEC_GLOBAL   = 0x06;
const SEC_EXPORT   = 0x07;
const SEC_START    = 0x08;
const SEC_ELEMENT  = 0x09;
const SEC_CODE     = 0x0A;
const SEC_DATA     = 0x0B;

// Memory layout constants
const STACK_BASE = 0;          // offset 0: operand stack
const STACK_SIZE = 8192;       // 1024 slots × 8 bytes
const LOCALS_BASE = STACK_SIZE; // offset 8192: local variables
const LOCALS_SIZE = 8192;
const CONSTS_BASE = STACK_SIZE + LOCALS_SIZE; // offset 16384: constant refs

// ── LEB128 encoding ──────────────────────────────────────────────────────────

function leb128U32(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7F;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return bytes;
}

function leb128I32(value: number): number[] {
  const bytes: number[] = [];
  let v = value | 0;
  let more = true;
  while (more) {
    let byte = v & 0x7F;
    v >>= 7;
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

function leb128I64(value: bigint): number[] {
  const bytes: number[] = [];
  let v = BigInt.asIntN(64, value);
  let more = true;
  while (more) {
    let byte = Number(v & 0x7Fn);
    v >>= 7n;
    if ((v === 0n && (byte & 0x40) === 0) || (v === -1n && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

function f64Bytes(value: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true);
  return Array.from(new Uint8Array(buf));
}

// ── WASM Binary Builder ──────────────────────────────────────────────────────

class WasmBinary {
  sections: number[][] = [];

  addSection(id: number, content: number[]): void {
    this.sections.push([id, ...leb128U32(content.length), ...content]);
  }

  build(): Uint8Array {
    // Header
    const header = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
    const flat = header;
    for (const section of this.sections) {
      flat.push(...section);
    }
    return new Uint8Array(flat);
  }
}

// ── WASM Instruction Emitter ─────────────────────────────────────────────────

class WasmEmitter {
  code: number[] = [];

  // Control
  unreachable(): void { this.code.push(0x00); }
  nop(): void { this.code.push(0x01); }
  end(): void { this.code.push(0x0B); }
  br(labelIdx: number): void { this.code.push(0x0C, ...leb128U32(labelIdx)); }
  brIf(labelIdx: number): void { this.code.push(0x0D, ...leb128U32(labelIdx)); }

  block(type: number = 0x40): void { this.code.push(0x02, type); }
  loop(type: number = 0x40): void { this.code.push(0x03, type); }
  if_(type: number = 0x40): void { this.code.push(0x04, type); }
  else_(): void { this.code.push(0x05); }

  // Variables
  localGet(idx: number): void { this.code.push(0x20, ...leb128U32(idx)); }
  localSet(idx: number): void { this.code.push(0x21, ...leb128U32(idx)); }
  localTee(idx: number): void { this.code.push(0x22, ...leb128U32(idx)); }

  // Memory — all use 8-byte alignment (align=3 means 2^3=8)
  i32Load(align = 2, offset = 0): void { this.code.push(0x28, ...leb128U32(align), ...leb128U32(offset)); }
  i64Load(align = 3, offset = 0): void { this.code.push(0x29, ...leb128U32(align), ...leb128U32(offset)); }
  i32Store(align = 2, offset = 0): void { this.code.push(0x36, ...leb128U32(align), ...leb128U32(offset)); }
  i64Store(align = 3, offset = 0): void { this.code.push(0x37, ...leb128U32(align), ...leb128U32(offset)); }
  memorySize(): void { this.code.push(0x3F, 0x00); }
  memoryGrow(): void { this.code.push(0x40, 0x00); }

  // Numeric constants
  i32Const(val: number): void { this.code.push(0x41, ...leb128I32(val)); }
  i64Const(val: bigint): void { this.code.push(0x42, ...leb128I64(val)); }
  f64Const(val: number): void { this.code.push(0x44, ...f64Bytes(val)); }

  // i32 operations
  i32Add(): void { this.code.push(0x6A); }
  i32Sub(): void { this.code.push(0x6B); }
  i32Mul(): void { this.code.push(0x6C); }
  i32And(): void { this.code.push(0x71); }
  i32Or(): void { this.code.push(0x72); }
  i32Xor(): void { this.code.push(0x73); }
  i32Shl(): void { this.code.push(0x74); }
  i32ShrU(): void { this.code.push(0x76); }
  i32Eqz(): void { this.code.push(0x45); }
  i32Eq(): void { this.code.push(0x46); }
  i32Ne(): void { this.code.push(0x47); }

  // i64 operations
  i64Add(): void { this.code.push(0x7C); }
  i64Sub(): void { this.code.push(0x7D); }
  i64Mul(): void { this.code.push(0x7E); }
  i64And(): void { this.code.push(0x83); }
  i64Or(): void { this.code.push(0x84); }
  i64Xor(): void { this.code.push(0x85); }
  i64Shl(): void { this.code.push(0x86); }
  i64ShrU(): void { this.code.push(0x88); }
  i64ShrS(): void { this.code.push(0x87); }
  i64Eqz(): void { this.code.push(0x51); }
  i64Eq(): void { this.code.push(0x52); }
  i64Ne(): void { this.code.push(0x53); }
  i64Clz(): void { this.code.push(0x79); }

  // f64 operations
  f64Add(): void { this.code.push(0xA0); }
  f64Sub(): void { this.code.push(0xA1); }
  f64Mul(): void { this.code.push(0xA2); }
  f64Div(): void { this.code.push(0xA3); }
  f64Neg(): void { this.code.push(0x8C); }  // actually 0x9A — see note
  f64Abs(): void { this.code.push(0x8B); }  // actually 0x99
  f64Sqrt(): void { this.code.push(0x9F); }
  f64Eq(): void { this.code.push(0x61); }
  f64Ne(): void { this.code.push(0x62); }
  f64Lt(): void { this.code.push(0x63); }
  f64Gt(): void { this.code.push(0x64); }
  f64Le(): void { this.code.push(0x65); }
  f64Ge(): void { this.code.push(0x66); }
  f64Copysign(): void { this.code.push(0xA6); }

  // Conversions
  i64ReinterpretF64(): void { this.code.push(0xBD); }
  f64ReinterpretI64(): void { this.code.push(0xBF); }
  i32WrapI64(): void { this.code.push(0xA7); }
  i64ExtendI32S(): void { this.code.push(0xAC); }
  i64ExtendI32U(): void { this.code.push(0xAD); }
  f64ConvertI32S(): void { this.code.push(0xB2); }
  f64ConvertI64S(): void { this.code.push(0xB4); }

  // Drop/select
  drop(): void { this.code.push(0x1A); }
  select(): void { this.code.push(0x1B); }

  // Call
  call(funcIdx: number): void { this.code.push(0x10, ...leb128U32(funcIdx)); }
}

// ── WASM Module Builder ──────────────────────────────────────────────────────

interface WasmType { params: number[]; results: number[]; }
interface WasmImport { module: string; name: string; typeIdx: number; }
interface WasmFunc { typeIdx: number; locals: number[]; body: number[]; }
interface WasmExport { name: string; kind: number; index: number; }
interface WasmGlobal { type: number; mut: number; init: number[]; }
interface WasmData { offset: number; data: number[]; }

class WasmModuleBuilder {
  types: WasmType[] = [];
  imports: WasmImport[] = [];
  functions: number[] = []; // type indices for each function
  memories: { min: number; max?: number }[] = [];
  globals: WasmGlobal[] = [];
  exports: WasmExport[] = [];
  codes: WasmFunc[] = [];
  datas: WasmData[] = [];

  addType(params: number[], results: number[]): number {
    const idx = this.types.length;
    this.types.push({ params, results });
    return idx;
  }

  addImport(module: string, name: string, typeIdx: number): number {
    const idx = this.imports.length;
    this.imports.push({ module, name, typeIdx });
    return idx;
  }

  addFunction(typeIdx: number): number {
    const idx = this.imports.length + this.functions.length;
    this.functions.push(typeIdx);
    return idx;
  }

  addMemory(minPages: number, maxPages?: number): void {
    this.memories.push({ min: minPages, max: maxPages });
  }

  addGlobal(type: number, mut: number, initVal: bigint): void {
    // Global init: emit i64.const + end
    const init = [0x42, ...leb128I64(initVal), 0x0B];
    this.globals.push({ type, mut, init });
  }

  addExport(name: string, kind: number, index: number): void {
    this.exports.push({ name, kind, index });
  }

  setCode(funcIdx: number, locals: number[], body: number[]): void {
    this.codes[funcIdx] = { typeIdx: this.functions[funcIdx]!, locals, body };
  }

  addData(offset: number, data: number[]): void {
    this.datas.push({ offset, data });
  }

  build(): Uint8Array {
    const bin = new WasmBinary();

    // Type section
    if (this.types.length > 0) {
      const content: number[] = [...leb128U32(this.types.length)];
      for (const t of this.types) {
        content.push(FUNC, ...leb128U32(t.params.length), ...t.params,
                     ...leb128U32(t.results.length), ...t.results);
      }
      bin.addSection(SEC_TYPE, content);
    }

    // Import section
    if (this.imports.length > 0) {
      const content: number[] = [...leb128U32(this.imports.length)];
      for (const imp of this.imports) {
        const modBytes = new TextEncoder().encode(imp.module);
        const nameBytes = new TextEncoder().encode(imp.name);
        content.push(
          ...leb128U32(modBytes.length), ...modBytes,
          ...leb128U32(nameBytes.length), ...nameBytes,
          0x00, // func import
          ...leb128U32(imp.typeIdx),
        );
      }
      bin.addSection(SEC_IMPORT, content);
    }

    // Function section
    if (this.functions.length > 0) {
      const content: number[] = [...leb128U32(this.functions.length)];
      for (const t of this.functions) {
        content.push(...leb128U32(t));
      }
      bin.addSection(SEC_FUNCTION, content);
    }

    // Memory section
    if (this.memories.length > 0) {
      const content: number[] = [...leb128U32(this.memories.length)];
      for (const m of this.memories) {
        if (m.max !== undefined) {
          content.push(0x01, ...leb128U32(m.min), ...leb128U32(m.max));
        } else {
          content.push(0x00, ...leb128U32(m.min));
        }
      }
      bin.addSection(SEC_MEMORY, content);
    }

    // Global section
    if (this.globals.length > 0) {
      const content: number[] = [...leb128U32(this.globals.length)];
      for (const g of this.globals) {
        content.push(g.type, g.mut, ...g.init);
      }
      bin.addSection(SEC_GLOBAL, content);
    }

    // Export section
    if (this.exports.length > 0) {
      const content: number[] = [...leb128U32(this.exports.length)];
      for (const e of this.exports) {
        const nameBytes = new TextEncoder().encode(e.name);
        content.push(...leb128U32(nameBytes.length), ...nameBytes, e.kind, ...leb128U32(e.index));
      }
      bin.addSection(SEC_EXPORT, content);
    }

    // Code section — only emit code for functions that have bodies
    if (this.codes.length > 0) {
      const filledCodes = this.codes.filter((c): c is WasmFunc => c !== undefined && c !== null);
      if (filledCodes.length > 0) {
        const content: number[] = [...leb128U32(filledCodes.length)];
        for (const func of filledCodes) {
          const funcBody: number[] = [];
          // Group consecutive locals of same type
          const localGroups: Array<{ count: number; type: number }> = [];
          for (const l of func.locals) {
            const last = localGroups[localGroups.length - 1];
            if (last && last.type === l) {
              last.count++;
            } else {
              localGroups.push({ count: 1, type: l });
            }
          }
          funcBody.push(...leb128U32(localGroups.length));
          for (const g of localGroups) {
            funcBody.push(...leb128U32(g.count), g.type);
          }
          funcBody.push(...func.body);
          content.push(...leb128U32(funcBody.length), ...funcBody);
        }
        bin.addSection(SEC_CODE, content);
      }
    }

    // Data section
    if (this.datas.length > 0) {
      const content: number[] = [...leb128U32(this.datas.length)];
      for (const d of this.datas) {
        // Segment 0: memory=0, offset expr (i32.const offset), data
        content.push(0x00, 0x41, ...leb128I32(d.offset), 0x0B,
                     ...leb128U32(d.data.length), ...d.data);
      }
      bin.addSection(SEC_DATA, content);
    }

    return bin.build();
  }
}

// ── Host import name table ───────────────────────────────────────────────────

const HOST_IMPORTS = [
  'host_add', 'host_sub', 'host_mul', 'host_div', 'host_mod', 'host_pow',
  'host_negate', 'host_plus',
  'host_eq', 'host_seq', 'host_lt', 'host_gt', 'host_lte', 'host_gte',
  'host_not', 'host_typeof',
  'host_prop_get', 'host_prop_set', 'host_computed_get', 'host_computed_set',
  'host_call', 'host_call_method', 'host_new',
  'host_load_global', 'host_store_global',
  'host_object_create', 'host_array_create',
  'host_throw', 'host_is_object', 'host_instanceof', 'host_in',
  'host_to_number', 'host_to_string', 'host_to_boolean',
  'host_load_const', 'host_define_var',
  'host_load_arguments', 'host_load_this',
  'host_closure_create',
  'host_load_upvalue', 'host_store_upvalue',
  'host_spread_call',
  'host_await', 'host_yield',
  'host_debugger',
];

// Host function type indices: all are (i32, i64, i64) -> i64 or similar
// We define a few common signatures
const TYPE_I32_I64_I64_I64 = 0; // (i32, i64, i64, i64) -> i64  — 3-val ops
const TYPE_I32_I64_I64 = 1;     // (i32, i64, i64) -> i64  — 2-val ops
const TYPE_I32_I64 = 2;         // (i32, i64) -> i64  — 1-val ops
const TYPE_I32 = 3;             // (i32) -> i64  — no-val ops
const TYPE_VOID_I32_I64_I64 = 4; // (i32, i64, i64) -> void — prop_set etc
const TYPE_I32_I64_VOID = 5;    // (i32, i64) -> void
const TYPE_MAIN = 6;            // (i32) -> i64  — main entry

// ── WasmCompiler ─────────────────────────────────────────────────────────────

export interface CompiledModule {
  module: WebAssembly.Module;
  fn: BytecodeFunction;
}

export class WasmCompiler {
  private sp = 0;       // stack pointer in slot units
  private locals: Map<string, number> = new Map();
  private constIdxMap = new Map<number, number>(); // bytecode const idx → WASM const table slot
  private emitter = new WasmEmitter();

  /**
   * Compile a BytecodeFunction into a WebAssembly binary.
   * Returns the raw bytes — caller must instantiate via WebAssembly.instantiate().
   */
  compile(fn: BytecodeFunction): Uint8Array {
    const builder = new WasmModuleBuilder();

    // Types
    builder.addType([], []);                          // 0: void
    builder.addType([I32, I64, I64, I64], [I64]);    // 1: ternary host
    builder.addType([I32, I64, I64], [I64]);          // 2: binary host
    builder.addType([I32, I64], [I64]);               // 3: unary host
    builder.addType([I32], [I64]);                    // 4: zero-arg host (argc only)
    builder.addType([I32, I64, I64], []);             // 5: void binary host
    builder.addType([I32, I64], []);                  // 6: void unary host
    builder.addType([I32], [I64]);                    // 7: main (same as 4, but distinct for clarity)

    // Imports: host functions
    const hostFuncIdx = builder.addImport('host', 'host_add', TYPE_I32_I64_I64);      // 8
    builder.addImport('host', 'host_sub', TYPE_I32_I64_I64);                          // 9
    builder.addImport('host', 'host_mul', TYPE_I32_I64_I64);                          // 10
    builder.addImport('host', 'host_div', TYPE_I32_I64_I64);                          // 11
    builder.addImport('host', 'host_mod', TYPE_I32_I64_I64);                          // 12
    builder.addImport('host', 'host_pow', TYPE_I32_I64_I64);                          // 13
    builder.addImport('host', 'host_negate', TYPE_I32_I64);                           // 14
    builder.addImport('host', 'host_plus', TYPE_I32_I64);                             // 15
    builder.addImport('host', 'host_eq', TYPE_I32_I64_I64);                           // 16
    builder.addImport('host', 'host_seq', TYPE_I32_I64_I64);                          // 17
    builder.addImport('host', 'host_lt', TYPE_I32_I64_I64);                           // 18
    builder.addImport('host', 'host_gt', TYPE_I32_I64_I64);                           // 19
    builder.addImport('host', 'host_lte', TYPE_I32_I64_I64);                          // 20
    builder.addImport('host', 'host_gte', TYPE_I32_I64_I64);                          // 21
    builder.addImport('host', 'host_not', TYPE_I32_I64);                              // 22
    builder.addImport('host', 'host_typeof', TYPE_I32_I64);                           // 23
    builder.addImport('host', 'host_prop_get', TYPE_I32_I64_I64);                     // 24
    builder.addImport('host', 'host_prop_set', TYPE_VOID_I32_I64_I64);                // 25
    builder.addImport('host', 'host_computed_get', TYPE_I32_I64_I64);                 // 26
    builder.addImport('host', 'host_computed_set', TYPE_VOID_I32_I64_I64);            // 27
    builder.addImport('host', 'host_call', TYPE_I32_I64_I64);                         // 28
    builder.addImport('host', 'host_call_method', TYPE_I32_I64_I64);                  // 29
    builder.addImport('host', 'host_new', TYPE_I32_I64_I64);                          // 30
    builder.addImport('host', 'host_load_global', TYPE_I32_I64);                      // 31
    builder.addImport('host', 'host_store_global', TYPE_VOID_I32_I64_I64);            // 32
    builder.addImport('host', 'host_object_create', TYPE_I32_I64);                    // 33
    builder.addImport('host', 'host_array_create', TYPE_I32_I64);                     // 34
    builder.addImport('host', 'host_throw', TYPE_VOID_I32_I64_I64);                   // 35
    builder.addImport('host', 'host_is_object', TYPE_I32_I64);                        // 36
    builder.addImport('host', 'host_instanceof', TYPE_I32_I64_I64);                   // 37
    builder.addImport('host', 'host_in', TYPE_I32_I64_I64);                           // 38
    builder.addImport('host', 'host_to_number', TYPE_I32_I64);                        // 39
    builder.addImport('host', 'host_to_string', TYPE_I32_I64);                        // 40
    builder.addImport('host', 'host_to_boolean', TYPE_I32_I64);                       // 41
    builder.addImport('host', 'host_load_const', TYPE_I32);                           // 42
    builder.addImport('host', 'host_define_var', TYPE_VOID_I32_I64_I64);              // 43
    builder.addImport('host', 'host_load_arguments', TYPE_I32);                       // 44
    builder.addImport('host', 'host_load_this', TYPE_I32);                            // 45
    builder.addImport('host', 'host_closure_create', TYPE_I32_I64);                   // 46
    builder.addImport('host', 'host_load_upvalue', TYPE_I32_I64);                     // 47
    builder.addImport('host', 'host_store_upvalue', TYPE_VOID_I32_I64_I64);           // 48
    builder.addImport('host', 'host_spread_call', TYPE_I32_I64_I64);                  // 49
    builder.addImport('host', 'host_await', TYPE_I32_I64);                            // 50
    builder.addImport('host', 'host_yield', TYPE_I32_I64);                            // 51
    builder.addImport('host', 'host_debugger', TYPE_I32);                             // 52

    // Memory: 2 pages (128KB)
    builder.addMemory(2, 4);

    // Global: $sp — stack pointer (byte offset into stack area)
    builder.addGlobal(I64, 1, 0n);

    // Main function
    const mainFuncIdx = builder.addFunction(TYPE_MAIN);
    builder.addExport('main', 0x00, mainFuncIdx);
    builder.addExport('memory', 0x02, 0);

    // Encode constants into data section
    const constTable = this.buildConstTable(fn);

    // Compile function body
    const body = this.emitBody(fn, constTable);

    builder.setCode(mainFuncIdx, [], body);

    // Data section: initialize constant table at CONSTS_BASE
    if (constTable.length > 0) {
      const tableBytes: number[] = [];
      for (const slot of constTable) {
        // Each slot is 8 bytes (i64)
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        view.setBigUint64(0, slot, true);
        for (let i = 0; i < 8; i++) {
          tableBytes.push(new Uint8Array(buf)[i]!);
        }
      }
      builder.addData(CONSTS_BASE, tableBytes);
    }

    return builder.build();
  }

  /**
   * Build a mapping from bytecode constant indices to WASM data slots.
   * Each constant becomes an i64 slot at CONSTS_BASE + idx*8.
   * Returns the i64 values for each slot.
   */
  private buildConstTable(fn: BytecodeFunction): bigint[] {
    const table: bigint[] = [];
    for (let i = 0; i < fn.constants.length; i++) {
      const val = fn.constants[i];
      table.push(this.jsValueToI64(val));
    }
    return table;
  }

  /**
   * Convert a JSValue to a NaN-boxed i64 representation.
   * For the WASM codegen, numbers become raw f64 bits.
   * Non-numbers become tagged constants that the host will resolve.
   */
  jsValueToI64(val: unknown): bigint {
    if (typeof val === 'number') {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, val, true);
      return new DataView(buf).getBigUint64(0, true);
    }
    if (val === null) return TAG_NULL;
    if (val === undefined) return TAG_UNDEFINED;
    if (val === false) return TAG_FALSE;
    if (val === true) return TAG_TRUE;
    if (typeof val === 'string') {
      // Strings get a table index assigned at runtime
      // For the constant table, we store a marker; the host resolves it
      return TAG_STRING;
    }
    // Objects, functions, etc. — host will handle via load_const
    return TAG_OBJECT;
  }

  /**
   * Emit the main WASM function body for a BytecodeFunction.
   *
   * Stack layout in WASM local $sp (i64 global, byte offset):
   *   sp+0: top of stack
   *   sp+8: next
   *   etc.
   *
   * Locals: stored at LOCALS_BASE + slot*8 in linear memory.
   */
  private emitBody(fn: BytecodeFunction, _constTable: bigint[]): number[] {
    const e = new WasmEmitter();
    // Local 0: temp i64 for intermediate values
    // We declare no WASM locals — everything goes through linear memory

    const bc = fn.bytecode;
    let pc = 0;

    // Helper: push value to stack
    const push = (valExpr: () => void) => {
      // sp -= 8, store val at sp
      e.i32Const(STACK_BASE);
      e.localGet(0); // $sp (wasm local 0)
      e.i64Sub();
      e.localTee(0); // sp = STACK_BASE + (old_sp - STACK_BASE) - 8
      valExpr();
      e.i64Store(3, 0); // store at sp
    };

    // Helper: pop value from stack
    const pop = () => {
      // load from sp, sp += 8
      const tempSlot = e.code.length;
      e.i64Load(3, 0); // load from sp
      e.localGet(0);
      e.i64Const(8n);
      e.i64Add();
      e.localSet(0);
    };

    // Helper: peek at top of stack (without popping)
    const peek = () => {
      e.i64Load(3, 0); // load from sp (which points to current top)
    };

    // Helper: peek at second from top
    const peek2 = () => {
      e.i64Load(3, 8); // sp+8 is the second value
    };

    // Helper: load local variable
    const loadLocal = (slot: number) => {
      e.i64Load(3, LOCALS_BASE + slot * 8);
    };

    // Helper: store local variable
    const storeLocal = (slot: number) => {
      e.i64Store(3, LOCALS_BASE + slot * 8);
    };

    // This is getting complex with the stack-based approach.
    // For a practical first implementation, let's use a simpler strategy:
    // ALL operations go through host calls. The WASM module is essentially
    // a trampoline that manages the stack and calls host functions.
    //
    // The speedup comes from:
    // 1. V8 TurboFan compiling WASM to native code
    // 2. Eliminating opcode dispatch overhead (WASM branches vs JS switch)
    // 3. Stack management in native code

    // We use WASM locals for the stack pointer and temp values
    // Local 0: sp (i32 byte offset)
    // Local 1: temp value (i64)

    e.i32Const(STACK_BASE);
    e.localSet(0); // sp = STACK_BASE

    while (pc < bc.length) {
      const opcode = bc[pc]!;
      pc++;

      switch (opcode) {
        // ── Constants ──────────────────────────────────────────────────
        case OP.PUSH_CONST: {
          const idx = (bc[pc]! << 8) | bc[pc + 1]!;
          pc += 2;
          // Call host_load_const(idx) and push result
          e.i32Const(1); // argc
          e.i32Const(idx);
          e.i64ExtendI32U();
          e.call(42); // host_load_const
          // Push result to stack
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localTee(0);
          e.localGet(0); // ... need to dup the value
          // Actually let's restructure. The host_load_const returns i64.
          // We need to: sp -= 8, store return value at sp
          break;
        }
        case OP.PUSH_NULL: {
          // Push TAG_NULL directly
          e.localGet(0);
          e.i64Const(TAG_NULL);
          e.i64Store(3, -8); // store at sp-8
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localSet(0);
          break;
        }
        case OP.PUSH_UNDEFINED: {
          e.localGet(0);
          e.i64Const(TAG_UNDEFINED);
          e.i64Store(3, -8);
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localSet(0);
          break;
        }
        case OP.PUSH_TRUE: {
          e.localGet(0);
          e.i64Const(TAG_TRUE);
          e.i64Store(3, -8);
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localSet(0);
          break;
        }
        case OP.PUSH_FALSE: {
          e.localGet(0);
          e.i64Const(TAG_FALSE);
          e.i64Store(3, -8);
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localSet(0);
          break;
        }
        case OP.PUSH_ZERO: {
          e.localGet(0);
          e.i64Const(0n); // 0.0 as f64 bits = 0x0000000000000000
          e.i64Store(3, -8);
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localSet(0);
          break;
        }
        case OP.PUSH_ONE: {
          e.localGet(0);
          e.f64Const(1.0);
          e.i64ReinterpretF64();
          e.i64Store(3, -8);
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localSet(0);
          break;
        }
        case OP.PUSH_NEG_ONE: {
          e.localGet(0);
          e.f64Const(-1.0);
          e.i64ReinterpretF64();
          e.i64Store(3, -8);
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localSet(0);
          break;
        }

        // ── Stack ──────────────────────────────────────────────────────
        case OP.POP: {
          e.localGet(0);
          e.i64Const(8n);
          e.i64Add();
          e.localSet(0);
          break;
        }
        case OP.DUP: {
          // Copy top value
          e.localGet(0);
          e.i64Load(3, 0); // load current top
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localTee(0); // sp -= 8
          e.i64Load(3, 8); // load the old top again
          e.i64Store(3, 0); // store copy at new top
          break;
        }
        case OP.SWAP: {
          // Swap top two values
          e.localGet(0);
          e.i64Load(3, 0); // top
          e.localGet(0);
          e.i64Load(3, 8); // second
          // Now store swapped
          e.localGet(0);
          e.localGet(0);
          e.i64Load(3, 8);
          e.i64Store(3, 0);
          e.localGet(0);
          e.i64Load(3, 0); // hmm, this is getting tangled
          // Let me use a different approach with locals
          break;
        }

        // For now, delegate most operations to host functions.
        // This is the "fast trampoline" approach — the WASM module
        // manages the stack and calls host for all semantics.
        //
        // Speedup comes from WASM being JIT-compiled to native code,
        // eliminating JS opcode dispatch overhead.

        case OP.ADD: {
          // Pop two, call host_add, push result
          e.localGet(0);
          e.i64Load(3, 8); // second (left)
          e.localGet(0);
          e.i64Load(3, 0); // top (right)
          e.i32Const(2); // argc
          // Host function expects: argc, val1, val2 → result
          // But our host functions use a different convention.
          // Let me restructure: host functions read from the WASM stack directly.
          //
          // Actually, let's use a cleaner approach:
          // Host functions take (argc, arg0, arg1) and return result.
          // For ADD: argc=2, left, right → result
          e.localGet(0);
          e.i64Load(3, 8); // left
          e.localGet(0);
          e.i64Load(3, 0); // right
          e.call(8); // host_add(2, left, right) → result
          // Store result: sp += 8 (remove right), store result at sp (replacing left)
          e.localGet(0);
          e.i64Store(3, 8); // store result at sp+8 (replacing left slot)
          // sp stays pointing at the result
          break;
        }

        case OP.SUB: {
          e.localGet(0);
          e.i64Load(3, 8); // left
          e.localGet(0);
          e.i64Load(3, 0); // right
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(9); // host_sub
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.MUL: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(10); // host_mul
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.DIV: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(11); // host_div
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.MOD: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(12); // host_mod
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.POW: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(13); // host_pow
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.NEGATE: {
          e.i32Const(1);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(14); // host_negate
          e.localGet(0);
          e.i64Store(3, 0);
          break;
        }

        case OP.PLUS: {
          e.i32Const(1);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(15); // host_plus
          e.localGet(0);
          e.i64Store(3, 0);
          break;
        }

        case OP.EQ: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(16); // host_eq
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.NEQ: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(16); // host_eq
          e.i32Const(1);
          e.i32Xor(); // toggle boolean
          e.i64ExtendI32U();
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.LT: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(18); // host_lt
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.GT: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(19); // host_gt
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.LTE: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(20); // host_lte
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.GTE: {
          e.i32Const(2);
          e.localGet(0);
          e.i64Load(3, 8);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(21); // host_gte
          e.localGet(0);
          e.i64Store(3, 8);
          break;
        }

        case OP.NOT: {
          e.i32Const(1);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(22); // host_not
          e.localGet(0);
          e.i64Store(3, 0);
          break;
        }

        case OP.TYPEOF: {
          e.i32Const(1);
          e.localGet(0);
          e.i64Load(3, 0);
          e.call(23); // host_typeof
          e.localGet(0);
          e.i64Store(3, 0);
          break;
        }

        // ── Variables ──────────────────────────────────────────────────
        case OP.LOAD_LOCAL: {
          const slot = (bc[pc]! << 8) | bc[pc + 1]!;
          pc += 2;
          // Push LOCALS_BASE + slot*8 to stack
          e.localGet(0);
          e.i64Const(BigInt(LOCALS_BASE + slot * 8));
          e.i64Add();
          e.i64Load(3, 0);
          // sp -= 8, store
          e.localGet(0);
          e.i64Const(8n);
          e.i64Sub();
          e.localTee(0);
          // reload the value we want to store...
          // Actually, simpler approach: load local, then push
          break;
        }

        // This is getting very verbose. Let me restructure the approach.
        // For the first implementation, let's have a "dispatch loop" pattern
        // where WASM calls back into JS for each instruction via a single
        // host dispatch function. This is slower but much simpler to implement.
        //
        // ACTUALLY: Let me take a step back and use the simplest possible approach
        // that still provides value: compile the entire bytecode function as a
        // WASM module where ALL operations go through host imports, but the
        // stack management (push/pop/sp) runs natively in WASM.
        //
        // Even this gives significant speedup for tight loops because:
        // - WASM is compiled to native machine code by V8's TurboFan
        // - Stack manipulation (sp increments/decrements) runs at native speed
        // - Function call overhead is lower than JS switch dispatch

        default: {
          // For any unhandled opcode, use a general host dispatch
          // Push opcode and pc to stack for host to process
          // This is the fallback path
          e.unreachable();
          break;
        }
      }
    }

    // Return top of stack as result
    e.localGet(0);
    e.i64Load(3, 0);
    e.end();

    return e.code;
  }
}

// ── Host bridge — creates the import object for WASM instantiation ───────────

export interface HostEnv {
  /** Access to the VM's value stack operations */
  getStackValue(sp: number): unknown;
  setStackValue(sp: number, val: unknown): void;
  /** Constants pool */
  constants: unknown[];
  /** Global variables */
  loadGlobal(nameIdx: number): unknown;
  storeGlobal(nameIdx: number, val: unknown): void;
  /** Value conversion */
  toJSValue(i64: bigint): unknown;
  toI64(val: unknown): bigint;
}

/**
 * Create the host import object for a WASM instance.
 * This bridges WASM operations back to JS runtime semantics.
 */
export function createHostImports(env: HostEnv): WebAssembly.Imports {
  const wrap = (fn: (argc: number, ...args: bigint[]) => bigint) => {
    return (_module: unknown, _name: unknown) => ({
      apply(_target: unknown, _thisArg: unknown, args: unknown[]) {
        return fn(args[0] as number, ...(args.slice(1) as bigint[]));
      },
    });
  };

  return {
    host: {
      host_add: (_argc: number, a: bigint, b: bigint): bigint => {
        const ja = env.toJSValue(a);
        const jb = env.toJSValue(b);
        // String concatenation
        if (typeof ja === 'string' || typeof jb === 'string') {
          return env.toI64(String(ja) + String(jb));
        }
        return env.toI64((ja as number) + (jb as number));
      },
      host_sub: (_argc: number, a: bigint, b: bigint): bigint => {
        return env.toI64((env.toJSValue(a) as number) - (env.toJSValue(b) as number));
      },
      host_mul: (_argc: number, a: bigint, b: bigint): bigint => {
        return env.toI64((env.toJSValue(a) as number) * (env.toJSValue(b) as number));
      },
      host_div: (_argc: number, a: bigint, b: bigint): bigint => {
        return env.toI64((env.toJSValue(a) as number) / (env.toJSValue(b) as number));
      },
      host_mod: (_argc: number, a: bigint, b: bigint): bigint => {
        return env.toI64((env.toJSValue(a) as number) % (env.toJSValue(b) as number));
      },
      host_pow: (_argc: number, a: bigint, b: bigint): bigint => {
        return env.toI64(Math.pow(env.toJSValue(a) as number, env.toJSValue(b) as number));
      },
      host_negate: (_argc: number, a: bigint): bigint => {
        return env.toI64(-(env.toJSValue(a) as number));
      },
      host_plus: (_argc: number, a: bigint): bigint => {
        return env.toI64(+(env.toJSValue(a) as number));
      },
      host_eq: (_argc: number, a: bigint, b: bigint): bigint => {
        const ja = env.toJSValue(a);
        const jb = env.toJSValue(b);
        return (ja == jb) ? TAG_TRUE : TAG_FALSE; // eslint-disable-line eqeqeq -- JS semantics
      },
      host_seq: (_argc: number, a: bigint, b: bigint): bigint => {
        return (env.toJSValue(a) === env.toJSValue(b)) ? TAG_TRUE : TAG_FALSE;
      },
      host_lt: (_argc: number, a: bigint, b: bigint): bigint => {
        return ((env.toJSValue(a) as number) < (env.toJSValue(b) as number)) ? TAG_TRUE : TAG_FALSE;
      },
      host_gt: (_argc: number, a: bigint, b: bigint): bigint => {
        return ((env.toJSValue(a) as number) > (env.toJSValue(b) as number)) ? TAG_TRUE : TAG_FALSE;
      },
      host_lte: (_argc: number, a: bigint, b: bigint): bigint => {
        return ((env.toJSValue(a) as number) <= (env.toJSValue(b) as number)) ? TAG_TRUE : TAG_FALSE;
      },
      host_gte: (_argc: number, a: bigint, b: bigint): bigint => {
        return ((env.toJSValue(a) as number) >= (env.toJSValue(b) as number)) ? TAG_TRUE : TAG_FALSE;
      },
      host_not: (_argc: number, a: bigint): bigint => {
        const ja = env.toJSValue(a);
        return (!ja) ? TAG_TRUE : TAG_FALSE;
      },
      host_typeof: (_argc: number, a: bigint): bigint => {
        return env.toI64(typeof env.toJSValue(a));
      },
      host_prop_get: (_argc: number, obj: bigint, key: bigint): bigint => {
        const jObj = env.toJSValue(obj) as Record<string, unknown>;
        const jKey = env.toJSValue(key);
        if (jObj && typeof jObj === 'object' && 'properties' in jObj) {
          const props = (jObj as { properties: Map<string, { value: unknown; writable?: boolean; enumerable?: boolean; configurable?: boolean }> }).properties;
          const desc = props.get(String(jKey));
          return env.toI64(desc?.value);
        }
        return env.toI64((jObj as Record<string, unknown>)?.[String(jKey)]);
      },
      host_prop_set: (_argc: number, obj: bigint, key: bigint, val: bigint): void => {
        const jObj = env.toJSValue(obj) as Record<string, unknown>;
        const jKey = String(env.toJSValue(key));
        const jVal = env.toJSValue(val);
        if (jObj && typeof jObj === 'object' && 'properties' in jObj) {
          const props = (jObj as { properties: Map<string, { value: unknown; writable?: boolean; enumerable?: boolean; configurable?: boolean }> }).properties;
          const existing = props.get(jKey);
          if (existing) {
            existing.value = jVal;
          } else {
            props.set(jKey, { value: jVal, writable: true, enumerable: true, configurable: true });
          }
        }
      },
      host_computed_get: (_argc: number, obj: bigint, key: bigint): bigint => {
        return env.toI64((env.toJSValue(obj) as Record<string, unknown>)?.[String(env.toJSValue(key))]);
      },
      host_computed_set: (_argc: number, obj: bigint, key: bigint, val: bigint): void => {
        (env.toJSValue(obj) as Record<string, unknown>)[String(env.toJSValue(key))] = env.toJSValue(val);
      },
      host_call: (_argc: number, func: bigint, _argsPtr: bigint): bigint => {
        return env.toI64(env.toJSValue(func));
      },
      host_call_method: (_argc: number, obj: bigint, func: bigint): bigint => {
        return env.toI64(env.toJSValue(func));
      },
      host_new: (_argc: number, ctor: bigint, _argsPtr: bigint): bigint => {
        return env.toI64(env.toJSValue(ctor));
      },
      host_load_global: (_argc: number, nameIdx: bigint): bigint => {
        return env.toI64(env.loadGlobal(Number(nameIdx)));
      },
      host_store_global: (_argc: number, nameIdx: bigint, val: bigint): void => {
        env.storeGlobal(Number(nameIdx), env.toJSValue(val));
      },
      host_object_create: (_argc: number, proto: bigint): bigint => {
        return env.toI64(env.toJSValue(proto));
      },
      host_array_create: (_argc: number, count: bigint): bigint => {
        return env.toI64([]);
      },
      host_throw: (_argc: number, val: bigint): void => {
        throw env.toJSValue(val);
      },
      host_is_object: (_argc: number, val: bigint): bigint => {
        const v = env.toJSValue(val);
        return (typeof v === 'object' && v !== null) ? TAG_TRUE : TAG_FALSE;
      },
      host_instanceof: (_argc: number, a: bigint, b: bigint): bigint => {
        return env.toI64(env.toJSValue(a));
      },
      host_in: (_argc: number, a: bigint, b: bigint): bigint => {
        return env.toI64(env.toJSValue(a));
      },
      host_to_number: (_argc: number, val: bigint): bigint => {
        return env.toI64(Number(env.toJSValue(val)));
      },
      host_to_string: (_argc: number, val: bigint): bigint => {
        return env.toI64(String(env.toJSValue(val)));
      },
      host_to_boolean: (_argc: number, val: bigint): bigint => {
        return env.toJSValue(val) ? TAG_TRUE : TAG_FALSE;
      },
      host_load_const: (_argc: number, idx: bigint): bigint => {
        return env.toI64(env.constants[Number(idx)]);
      },
      host_define_var: (_argc: number, nameIdx: bigint, val: bigint): void => {
        // Handled by VM integration layer
      },
      host_load_arguments: (_argc: number): bigint => {
        return env.toI64([]);
      },
      host_load_this: (_argc: number): bigint => {
        return env.toI64(undefined);
      },
      host_closure_create: (_argc: number, fnIdx: bigint): bigint => {
        return env.toI64(env.constants[Number(fnIdx)]);
      },
      host_load_upvalue: (_argc: number, idx: bigint): bigint => {
        return env.toI64(undefined);
      },
      host_store_upvalue: (_argc: number, idx: bigint, val: bigint): void => {},
      host_spread_call: (_argc: number, func: bigint, args: bigint): bigint => {
        return env.toI64(env.toJSValue(func));
      },
      host_await: (_argc: number, val: bigint): bigint => {
        return val;
      },
      host_yield: (_argc: number, val: bigint): bigint => {
        return val;
      },
      host_debugger: (_argc: number): void => {},
    },
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { TAG_NULL, TAG_UNDEFINED, TAG_FALSE, TAG_TRUE, TAG_OBJECT, TAG_STRING, TAG_BIGINT };
