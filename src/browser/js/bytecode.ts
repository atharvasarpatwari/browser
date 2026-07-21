// ─────────────────────────────────────────────────────────────────────────────
// BYTECODE — Opcodes, BytecodeFunction, and BytecodeProgram types
// Stack-based bytecode VM for the Nova Browser JS engine.
// ─────────────────────────────────────────────────────────────────────────────

import type { JSValue } from './values';

// ── Opcodes ──────────────────────────────────────────────────────────────────

export const enum OP {
  // Constants
  PUSH_CONST       = 0x00,  // idx: u16
  PUSH_NULL        = 0x01,
  PUSH_UNDEFINED   = 0x02,
  PUSH_TRUE        = 0x03,
  PUSH_FALSE       = 0x04,
  PUSH_ZERO        = 0x05,
  PUSH_ONE         = 0x06,
  PUSH_NEG_ONE     = 0x07,

  // Stack manipulation
  POP              = 0x10,
  DUP              = 0x11,
  SWAP             = 0x12,
  POP_N            = 0x13,  // count: u8

  // Variables
  LOAD_LOCAL        = 0x20,  // slot: u16
  STORE_LOCAL       = 0x21,  // slot: u16
  LOAD_GLOBAL       = 0x22,  // idx: u16 (constant pool → name string)
  STORE_GLOBAL      = 0x23,  // idx: u16
  DEFINE_VAR        = 0x24,  // idx: u16, kind: u8 (0=var, 1=let, 2=const)
  LOAD_THIS         = 0x25,
  LOAD_ARGUMENTS    = 0x26,

  // Arithmetic
  ADD              = 0x30,
  SUB              = 0x31,
  MUL              = 0x32,
  DIV              = 0x33,
  MOD              = 0x34,
  POW              = 0x35,
  NEGATE           = 0x36,
  PLUS             = 0x37,

  // Comparison
  EQ               = 0x40,
  NEQ              = 0x41,
  SEQ              = 0x42,  // ===
  SNEQ             = 0x43,  // !==
  LT               = 0x44,
  GT               = 0x45,
  LTE              = 0x46,
  GTE              = 0x47,
  INSTANCEOF       = 0x48,
  IN               = 0x49,

  // Logical / Bitwise
  NOT              = 0x50,
  BITNOT           = 0x51,
  BITAND           = 0x52,
  BITOR            = 0x53,
  BITXOR           = 0x54,
  SHL              = 0x55,
  SHR              = 0x56,
  USHR             = 0x57,

  // Control flow
  JMP              = 0x60,  // offset: u16 (absolute target)
  JMP_IF_FALSE     = 0x61,  // offset: u16
  JMP_IF_TRUE      = 0x62,  // offset: u16
  JMP_IF_NULLISH   = 0x63,  // offset: u16 (for ?? operator)

  // Functions
  CALL             = 0x70,  // argc: u16
  CALL_METHOD      = 0x71,  // argc: u16
  NEW              = 0x72,  // argc: u16
  RETURN           = 0x73,
  CLOSURE          = 0x74,  // idx: u16 (constant pool → BytecodeFunction)
  SPREAD_CALL      = 0x75,  // argc: u16 (last arg is array to spread)

  // Objects / Arrays
  OBJECT_CREATE    = 0x80,  // count: u16 (number of key-value pairs on stack)
  ARRAY_CREATE     = 0x81,  // count: u16
  PROP_GET         = 0x82,  // obj, key on stack → value
  PROP_SET         = 0x83,  // obj, key, val on stack → val
  COMPUTED_GET     = 0x84,  // same but computed
  COMPUTED_SET     = 0x85,
  PROP_GET_NAME    = 0x86,  // idx: u16 (constant pool → property name string)
  PROP_SET_NAME    = 0x87,  // idx: u16

  // Special
  TYPEOF           = 0x90,
  VOID_OP          = 0x91,
  THROW            = 0x92,
  TRY              = 0x93,  // handler_offset: u16
  END_TRY          = 0x94,
  BREAK            = 0x95,  // offset: u16
  CONTINUE         = 0x96,  // offset: u16
  AWAIT            = 0x97,
  YIELD            = 0x98,
  DEBUGGER         = 0x99,

  // Sequence / spread
  SEQUENCE         = 0xA0,  // count: u16 (pop count values, keep top)
  SPREAD_ARRAY     = 0xA1,  // Spread top array into individual values
  SPREAD_ARGS      = 0xA2,  // Spread top array into args on the stack

  // Template literals
  TEMPLATE_LITERAL = 0xB0,  // quasiCount: u16

  // Arrow function (expression body)
  ARROW_EXPR       = 0xC0,  // closure_idx: u16

  HALT             = 0xFF,
}

// ── Bytecode Function ────────────────────────────────────────────────────────

export interface BytecodeFunction {
  bytecode: Uint8Array;
  constants: JSValue[];
  paramCount: number;
  localCount: number;
  name: string;
  isArrow: boolean;
  isAsync: boolean;
  isGenerator: boolean;
  // Upvalue info: captured variables from parent scopes
  upvalues: UpvalueInfo[];
  // Line table: pairs of [bytecode_offset, line_number] for error reporting
  lineTable: Uint16Array;
  // Try/catch handler table: pairs of [start_offset, end_offset, handler_offset]
  tryTable: Uint16Array;
}

export interface UpvalueInfo {
  name: string;
  slotIndex: number;
  isLocal: boolean;  // true = local in parent, false = upvalue in grandparent+
}

// ── Bytecode Program ─────────────────────────────────────────────────────────

export interface BytecodeProgram {
  main: BytecodeFunction;
  allFunctions: BytecodeFunction[];  // all compiled functions for GC/tracking
}

// ── Builder helpers ──────────────────────────────────────────────────────────

export class BytecodeBuilder {
  private ops: number[] = [];
  private constants: JSValue[] = [];
  private lineTable: number[] = [];
  private tryTable: number[] = [];
  private lastLine = -1;
  private patchSites: Map<number, number> = new Map(); // jump target → patch position

  addConst(val: JSValue): number {
    // Deduplicate numbers and strings
    for (let i = 0; i < this.constants.length; i++) {
      if (this.constants[i] === val) return i;
      if (typeof val === 'number' && typeof this.constants[i] === 'number' && this.constants[i] === val) return i;
      if (typeof val === 'string' && typeof this.constants[i] === 'string' && this.constants[i] === val) return i;
    }
    const idx = this.constants.length;
    this.constants.push(val);
    return idx;
  }

  emit(op: OP): number {
    const offset = this.ops.length;
    this.ops.push(op);
    return offset;
  }

  emitU16(op: OP, value: number): number {
    const offset = this.ops.length;
    this.ops.push(op, (value >> 8) & 0xFF, value & 0xFF);
    return offset;
  }

  emitU8(op: OP, value: number): number {
    const offset = this.ops.length;
    this.ops.push(op, value & 0xFF);
    return offset;
  }

  emitU16U8(op: OP, v16: number, v8: number): number {
    const offset = this.ops.length;
    this.ops.push(op, (v16 >> 8) & 0xFF, v16 & 0xFF, v8 & 0xFF);
    return offset;
  }

  emitU16U16(op: OP, a: number, b: number): number {
    const offset = this.ops.length;
    this.ops.push(op, (a >> 8) & 0xFF, a & 0xFF, (b >> 8) & 0xFF, b & 0xFF);
    return offset;
  }

  /** Emit a jump instruction; returns the offset of the jump offset operand (for patching). */
  emitJump(op: OP): number {
    const offset = this.ops.length;
    this.ops.push(op, 0, 0); // placeholder offset
    return offset + 1; // return position of the offset bytes
  }

  /** Patch a jump to point to current position. */
  patchJump(jumpOffsetPos: number): void {
    const target = this.ops.length;
    this.ops[jumpOffsetPos] = (target >> 8) & 0xFF;
    this.ops[jumpOffsetPos + 1] = target & 0xFF;
  }

  /** Patch a jump to point to a specific offset. */
  patchJumpTo(jumpOffsetPos: number, target: number): void {
    this.ops[jumpOffsetPos] = (target >> 8) & 0xFF;
    this.ops[jumpOffsetPos + 1] = target & 0xFF;
  }

  /** Emit line info for the current offset. */
  recordLine(line: number): void {
    if (line === this.lastLine) return;
    this.lastLine = line;
    this.lineTable.push(this.ops.length, line);
  }

  /** Add a try handler entry. */
  addTryHandler(startOffset: number, endOffset: number, handlerOffset: number): void {
    this.tryTable.push(startOffset, endOffset, handlerOffset);
  }

  /** Get current bytecode offset. */
  currentOffset(): number {
    return this.ops.length;
  }

  /** Build the final BytecodeFunction. */
  build(paramCount: number, localCount: number, name: string,
        isArrow: boolean, isAsync: boolean, isGenerator: boolean,
        upvalues: UpvalueInfo[]): BytecodeFunction {
    // Append HALT
    this.ops.push(OP.HALT);

    return {
      bytecode: new Uint8Array(this.ops),
      constants: [...this.constants],
      paramCount,
      localCount,
      name,
      isArrow,
      isAsync,
      isGenerator,
      upvalues,
      lineTable: new Uint16Array(this.lineTable),
      tryTable: new Uint16Array(this.tryTable),
    };
  }
}
