// ─────────────────────────────────────────────────────────────────────────────
// BYTECODE VM — Stack-based interpreter for BytecodeFunction
// Executes bytecode directly without AST traversal.
// ─────────────────────────────────────────────────────────────────────────────

import { OP, type BytecodeFunction } from './bytecode';
import {
  type JSValue, type JSObject, type JSFunction,
  toBoolean, toNumber, toString, getType, instanceofCheck,
  createObject, createArray, createFunction,
  Environment, JSError, UpvalueRef,
  callJSFunction, isReturnSignal, isThrowSignal,
  type ReturnSignal, type ThrowSignal,
} from './values';
import { isPromiseObject, isPromiseFulfilled, getPromiseResult } from './promise';
import type { EventLoop } from './event-loop';

// ── Call Frame ───────────────────────────────────────────────────────────────

export interface CallFrame {
  fn: BytecodeFunction;
  bytecode: Uint8Array;
  constants: JSValue[];
  locals: JSValue[];
  pc: number;
  sp: number;       // base of this frame's stack (locals live above this)
  env: Environment;
  thisArg: JSValue;
  upvalues: UpvalueRef[];  // captured upvalues from parent scopes
  localUpvalueMap: Map<number, UpvalueRef>;  // tracks captured locals for dedup
}

// ── VM Result ────────────────────────────────────────────────────────────────

export type VMResult =
  | { ok: true; value: JSValue }
  | { ok: false; error: JSValue };

// ── VM ───────────────────────────────────────────────────────────────────────

export class BytecodeVM {
  private stack: JSValue[] = [];
  private frames: CallFrame[] = [];
  private sp = 0;
  private env: Environment;
  private executionStartTime = 0;
  private maxExecutionMs = 5000;
  private opCount = 0;
  private static readonly OPS_BETWEEN_CHECKS = 1000;
  /** Ops between GC trigger checks */
  private static readonly OPS_BETWEEN_GC_CHECKS = 2000;

  /** Callback to invoke AST-body functions via the interpreter */
  private callInterpreter: ((fn: JSFunction, thisArg: JSValue, args: JSValue[]) => JSValue) | null = null;

  /** GC collection callback — called at safe points if set */
  private gcCallback: ((vm: BytecodeVM) => void) | null = null;

  /** Event loop for microtask integration (async/await) */
  private eventLoop: EventLoop | null = null;

  constructor(env: Environment) {
    this.env = env;
  }

  setCallInterpreter(fn: (fn: JSFunction, thisArg: JSValue, args: JSValue[]) => JSValue): void {
    this.callInterpreter = fn;
  }

  setMaxExecutionMs(ms: number): void {
    this.maxExecutionMs = ms;
  }

  /** Set the GC callback invoked at safe points */
  setGCCallback(cb: ((vm: BytecodeVM) => void) | null): void {
    this.gcCallback = cb;
  }

  /** Set the event loop for microtask integration (async/await) */
  setEventLoop(eventLoop: EventLoop): void {
    this.eventLoop = eventLoop;
  }

  /** Get the operand stack (for root scanning) */
  getStack(): JSValue[] { return this.stack; }

  /** Get the stack pointer (for root scanning) */
  getSP(): number { return this.sp; }

  /** Get the call frames (for root scanning) */
  getFrames(): CallFrame[] { return this.frames; }

  /** Get the current environment (for root scanning) */
  getEnv(): Environment { return this.env; }

  /** Run a bytecode function from top-level */
  run(fn: BytecodeFunction, thisArg: JSValue = undefined, args: JSValue[] = [], upvalues: UpvalueRef[] = []): VMResult {
    this.executionStartTime = Date.now();
    this.opCount = 0;
    this.stack = [];
    this.frames = [];
    this.sp = 0;

    // Create initial call frame
    this.pushFrame(fn, thisArg, args, this.env, upvalues);

    try {
      const result = this.executeFrame();
      return { ok: true, value: result };
    } catch (err) {
      if (err instanceof JSError) {
        return { ok: false, error: err.value };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Execute the current top frame until it returns */
  private executeFrame(): JSValue {
    const frame = this.frames[this.frames.length - 1]!;
    const { bytecode, constants, locals } = frame;

    while (frame.pc < bytecode.length) {
      this.opCount++;
      if (this.opCount % BytecodeVM.OPS_BETWEEN_CHECKS === 0) {
        const elapsed = Date.now() - this.executionStartTime;
        if (elapsed > this.maxExecutionMs) {
          throw new JSError(`Script execution timed out after ${this.maxExecutionMs}ms`);
        }
      }

      // GC safe point
      if (this.gcCallback && this.opCount % BytecodeVM.OPS_BETWEEN_GC_CHECKS === 0) {
        this.gcCallback(this);
      }

      const op = bytecode[frame.pc++]!;

      switch (op) {
        // ── Constants ─────────────────────────────────────────────────────
        case OP.PUSH_CONST: {
          const idx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          this.stack[this.sp++] = constants[idx];
          break;
        }
        case OP.PUSH_NULL:
          this.stack[this.sp++] = null;
          break;
        case OP.PUSH_UNDEFINED:
          this.stack[this.sp++] = undefined;
          break;
        case OP.PUSH_TRUE:
          this.stack[this.sp++] = true;
          break;
        case OP.PUSH_FALSE:
          this.stack[this.sp++] = false;
          break;
        case OP.PUSH_ZERO:
          this.stack[this.sp++] = 0;
          break;
        case OP.PUSH_ONE:
          this.stack[this.sp++] = 1;
          break;
        case OP.PUSH_NEG_ONE:
          this.stack[this.sp++] = -1;
          break;

        // ── Stack manipulation ────────────────────────────────────────────
        case OP.POP:
          this.sp--;
          break;
        case OP.DUP:
          this.stack[this.sp] = this.stack[this.sp - 1]!;
          this.sp++;
          break;
        case OP.SWAP: {
          const a = this.stack[this.sp - 2]!;
          const b = this.stack[this.sp - 1]!;
          this.stack[this.sp - 2] = b;
          this.stack[this.sp - 1] = a;
          break;
        }
        case OP.POP_N: {
          const count = bytecode[frame.pc++]!;
          this.sp -= count;
          break;
        }

        // ── Variables ─────────────────────────────────────────────────────
        case OP.LOAD_LOCAL: {
          const slot = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          this.stack[this.sp++] = locals[slot];
          break;
        }
        case OP.STORE_LOCAL: {
          const slot = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          locals[slot] = this.stack[this.sp - 1];
          break;
        }
        case OP.LOAD_GLOBAL: {
          const idx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const name = constants[idx] as string;
          this.stack[this.sp++] = frame.env.get(name);
          break;
        }
        case OP.STORE_GLOBAL: {
          const idx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const name = constants[idx] as string;
          const val = this.stack[this.sp - 1];
          if (!frame.env.set(name, val)) {
            frame.env.setLocal(name, val);
          }
          break;
        }
        case OP.DEFINE_VAR: {
          const idx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const _kind = bytecode[frame.pc++]!; // 0=var,1=let,2=const
          const name = constants[idx] as string;
          const val = this.stack[this.sp - 1];
          const kind = _kind === 0 ? 'var' : _kind === 1 ? 'let' : 'const';
          if (kind === 'let' || kind === 'const') {
            frame.env.declareTDZ(name, kind);
            frame.env.initialize(name, val);
          } else {
            frame.env.declare(name, val, kind);
          }
          break;
        }
        case OP.LOAD_THIS:
          this.stack[this.sp++] = frame.thisArg;
          break;
        case OP.LOAD_ARGUMENTS:
          // Push the arguments array stored in locals
          this.stack[this.sp++] = locals[locals.length - 1] ?? createArray([]);
          break;
        case OP.LOAD_UPVALUE: {
          const uvIdx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          this.stack[this.sp++] = frame.upvalues[uvIdx].value;
          break;
        }
        case OP.STORE_UPVALUE: {
          const uvIdx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          frame.upvalues[uvIdx].value = this.stack[this.sp - 1];
          break;
        }

        // ── Arithmetic ────────────────────────────────────────────────────
        case OP.ADD: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = this.jsAdd(left, right);
          break;
        }
        case OP.SUB: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) - toNumber(right);
          break;
        }
        case OP.MUL: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) * toNumber(right);
          break;
        }
        case OP.DIV: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) / toNumber(right);
          break;
        }
        case OP.MOD: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) % toNumber(right);
          break;
        }
        case OP.POW: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = Math.pow(toNumber(left), toNumber(right));
          break;
        }
        case OP.NEGATE:
          this.stack[this.sp - 1] = -toNumber(this.stack[this.sp - 1]);
          break;
        case OP.PLUS:
          this.stack[this.sp - 1] = toNumber(this.stack[this.sp - 1]);
          break;

        // ── Comparison ────────────────────────────────────────────────────
        case OP.EQ: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = left == right;
          break;
        }
        case OP.NEQ: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = left != right;
          break;
        }
        case OP.SEQ: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = left === right;
          break;
        }
        case OP.SNEQ: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = left !== right;
          break;
        }
        case OP.LT: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) < toNumber(right);
          break;
        }
        case OP.GT: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) > toNumber(right);
          break;
        }
        case OP.LTE: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) <= toNumber(right);
          break;
        }
        case OP.GTE: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) >= toNumber(right);
          break;
        }
        case OP.INSTANCEOF: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = instanceofCheck(left, right);
          break;
        }
        case OP.IN: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          const key = toString(left);
          if (typeof right === 'object' && right !== null) {
            this.stack[this.sp - 1] = (right as JSObject).properties.has(key);
          } else {
            this.stack[this.sp - 1] = false;
          }
          break;
        }

        // ── Logical / Bitwise ─────────────────────────────────────────────
        case OP.NOT:
          this.stack[this.sp - 1] = !toBoolean(this.stack[this.sp - 1]);
          break;
        case OP.BITNOT:
          this.stack[this.sp - 1] = ~toNumber(this.stack[this.sp - 1]);
          break;
        case OP.BITAND: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) & toNumber(right);
          break;
        }
        case OP.BITOR: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) | toNumber(right);
          break;
        }
        case OP.BITXOR: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) ^ toNumber(right);
          break;
        }
        case OP.SHL: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) << toNumber(right);
          break;
        }
        case OP.SHR: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) >> toNumber(right);
          break;
        }
        case OP.USHR: {
          const right = this.stack[this.sp - 1]!;
          const left = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = toNumber(left) >>> toNumber(right);
          break;
        }

        // ── Control flow ──────────────────────────────────────────────────
        case OP.JMP: {
          const target = this.readU16(bytecode, frame.pc);
          frame.pc = target;
          break;
        }
        case OP.JMP_IF_FALSE: {
          const target = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const val = this.stack[this.sp - 1];
          if (!toBoolean(val)) {
            frame.pc = target;
          }
          break;
        }
        case OP.JMP_IF_TRUE: {
          const target = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const val = this.stack[this.sp - 1];
          if (toBoolean(val)) {
            frame.pc = target;
          }
          break;
        }
        case OP.JMP_IF_NULLISH: {
          const target = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const val = this.stack[this.sp - 1];
          if (val === null || val === undefined) {
            frame.pc = target;
          }
          break;
        }

        // ── Functions ─────────────────────────────────────────────────────
        case OP.CALL: {
          const argc = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          this.handleCall(argc, false);
          break;
        }
        case OP.CALL_METHOD: {
          const argc = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          this.handleCallMethod(argc);
          break;
        }
        case OP.NEW: {
          const argc = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          this.handleNew(argc);
          break;
        }
        case OP.RETURN: {
          const val = this.stack[this.sp - 1];
          this.sp = frame.sp; // restore stack to frame base
          this.frames.pop();
          return val;
        }
        case OP.CLOSURE: {
          const idx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const fn = constants[idx] as unknown as BytecodeFunction;
          // Capture upvalues from the current frame
          const capturedUpvalues: UpvalueRef[] = [];
          for (const uv of fn.upvalues) {
            if (uv.isLocal) {
              // Capture a reference to the parent frame's local.
              // Reuse existing ref if the same local slot was already captured.
              let ref = frame.localUpvalueMap.get(uv.slotIndex);
              if (!ref) {
                ref = new UpvalueRef(frame.locals[uv.slotIndex]);
                frame.localUpvalueMap.set(uv.slotIndex, ref);
              }
              capturedUpvalues.push(ref);
            } else {
              // Capture from an enclosing function's upvalue
              capturedUpvalues.push(frame.upvalues[uv.slotIndex]);
            }
          }
          // Create a JSFunction wrapping the bytecode function
          const jsFn = createFunction(
            fn.name,
            Array.from({ length: fn.paramCount }, (_, i) => `param${i}`),
            fn,
            frame.env,
            fn.isAsync,
            fn.isArrow,
            fn.isGenerator,
            true, // isBytecode
            capturedUpvalues,
          );
          this.stack[this.sp++] = jsFn;
          break;
        }
        case OP.SPREAD_CALL: {
          const argc = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          this.handleCall(argc, true);
          break;
        }

        // ── Objects / Arrays ──────────────────────────────────────────────
        case OP.OBJECT_CREATE: {
          const count = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const obj = createObject(null);
          // Stack has: key1, val1, key2, val2, ...
          // Pop in reverse order
          for (let i = count - 1; i >= 0; i--) {
            const val = this.stack[this.sp - 1]!;
            const key = toString(this.stack[this.sp - 2]!);
            this.sp -= 2;
            obj.properties.set(key, {
              value: val,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          }
          this.stack[this.sp++] = obj;
          break;
        }
        case OP.ARRAY_CREATE: {
          const count = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const elements: JSValue[] = [];
          for (let i = count - 1; i >= 0; i--) {
            elements.unshift(this.stack[this.sp - 1]!);
            this.sp--;
          }
          this.stack[this.sp++] = createArray(elements);
          break;
        }
        case OP.PROP_GET: {
          const key = this.stack[this.sp - 1]!;
          const obj = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = this.propGet(obj, key);
          break;
        }
        case OP.PROP_SET: {
          const val = this.stack[this.sp - 1]!;
          const key = this.stack[this.sp - 2]!;
          const obj = this.stack[this.sp - 3]!;
          this.sp -= 2;
          this.propSet(obj, key, val);
          this.stack[this.sp - 1] = val;
          break;
        }
        case OP.COMPUTED_GET: {
          const key = this.stack[this.sp - 1]!;
          const obj = this.stack[this.sp - 2]!;
          this.sp--;
          this.stack[this.sp - 1] = this.propGet(obj, key);
          break;
        }
        case OP.COMPUTED_SET: {
          const val = this.stack[this.sp - 1]!;
          const key = this.stack[this.sp - 2]!;
          const obj = this.stack[this.sp - 3]!;
          this.sp -= 2;
          this.propSet(obj, key, val);
          this.stack[this.sp - 1] = val;
          break;
        }
        case OP.PROP_GET_NAME: {
          const idx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const name = constants[idx] as string;
          const obj = this.stack[this.sp - 1];
          this.stack[this.sp - 1] = this.propGet(obj, name);
          break;
        }
        case OP.PROP_SET_NAME: {
          const idx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const name = constants[idx] as string;
          const val = this.stack[this.sp - 1]!;
          const obj = this.stack[this.sp - 2]!;
          this.sp--;
          this.propSet(obj, name, val);
          this.stack[this.sp - 1] = val;
          break;
        }

        // ── Special ───────────────────────────────────────────────────────
        case OP.TYPEOF: {
          const val = this.stack[this.sp - 1];
          this.stack[this.sp - 1] = getType(val);
          break;
        }
        case OP.VOID_OP:
          this.stack[this.sp - 1] = undefined;
          break;
        case OP.THROW: {
          const val = this.stack[this.sp - 1];
          this.sp = frame.sp;
          this.frames.pop();
          if (this.frames.length === 0) {
            throw new JSError(val);
          }
          // Propagate to caller — throw from the recursive call
          throw new JSError(val);
        }
        case OP.TRY: {
          const handlerOffset = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          // TRY just sets up the handler; the tryTable is consulted on exception
          // For now, store the handler offset in the frame
          (frame as any).__tryHandler = handlerOffset;
          break;
        }
        case OP.END_TRY: {
          (frame as any).__tryHandler = undefined;
          break;
        }
        case OP.BREAK: {
          const target = this.readU16(bytecode, frame.pc);
          frame.pc = target;
          break;
        }
        case OP.CONTINUE: {
          const target = this.readU16(bytecode, frame.pc);
          frame.pc = target;
          break;
        }
        case OP.AWAIT: {
          const val = this.stack[this.sp - 1];
          // If value is a pending Promise, we need to handle async suspension
          if (this.eventLoop && typeof val === 'object' && val !== null && isPromiseObject(val)) {
            if (isPromiseFulfilled(val)) {
              // Already fulfilled — extract value and continue
              this.stack[this.sp - 1] = getPromiseResult(val);
            } else {
              // Pending promise — for now, just pass through the Promise object
              // Full async suspension would require saving/restoring VM state
              // which is complex. For now, the Promise object itself is returned.
              // The caller (interpreter callFunction) handles async wrapping.
            }
          }
          break;
        }
        case OP.YIELD: {
          // Basic yield: just pass through the value
          break;
        }
        case OP.DEBUGGER:
          break;

        // ── Sequence / spread ─────────────────────────────────────────────
        case OP.SEQUENCE: {
          const count = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          // Pop count values, keep only the last one
          this.sp -= count;
          break;
        }
        case OP.SPREAD_ARRAY: {
          const arr = this.stack[this.sp - 1] as JSObject;
          if (arr && typeof arr === 'object' && arr.type === 'array') {
            const len = Number(arr.properties.get('length')?.value ?? 0);
            // Replace the array with individual elements
            this.sp--;
            for (let i = 0; i < len; i++) {
              this.stack[this.sp++] = arr.properties.get(String(i))?.value;
            }
          }
          break;
        }
        case OP.SPREAD_ARGS: {
          // Spread top array into individual values for a call
          const arr = this.stack[this.sp - 1] as JSObject;
          if (arr && typeof arr === 'object' && arr.type === 'array') {
            const len = Number(arr.properties.get('length')?.value ?? 0);
            this.sp--;
            for (let i = 0; i < len; i++) {
              this.stack[this.sp++] = arr.properties.get(String(i))?.value;
            }
          }
          break;
        }

        // ── Template literals ─────────────────────────────────────────────
        case OP.TEMPLATE_LITERAL: {
          const quasiCount = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          // Stack has: quasi0, expr0, quasi1, expr1, ..., quasiN
          // Result is quasi0 + expr0 + quasi1 + ... + quasiN
          let result = '';
          for (let i = 0; i < quasiCount; i++) {
            result += toString(this.stack[this.sp - quasiCount * 2 + i * 2]);
            if (i < quasiCount - 1) {
              result += toString(this.stack[this.sp - quasiCount * 2 + i * 2 + 1]);
            }
          }
          this.sp -= quasiCount * 2 - 1;
          this.stack[this.sp - 1] = result;
          break;
        }

        // ── Arrow function ────────────────────────────────────────────────
        case OP.ARROW_EXPR: {
          const idx = this.readU16(bytecode, frame.pc);
          frame.pc += 2;
          const fn = constants[idx] as unknown as BytecodeFunction;
          const jsFn = createFunction(
            fn.name,
            Array.from({ length: fn.paramCount }, (_, i) => `param${i}`),
            fn,
            frame.env,
            fn.isAsync,
            true, // isArrow
            fn.isGenerator,
            true, // isBytecode
          );
          this.stack[this.sp++] = jsFn;
          break;
        }

        case OP.HALT:
          return this.stack[this.sp - 1];

        default:
          throw new JSError(`Unknown opcode: 0x${op.toString(16).padStart(2, '0')}`);
      }
    }

    return this.stack[this.sp - 1];
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private readU16(data: Uint8Array, offset: number): number {
    return (data[offset]! << 8) | data[offset + 1]!;
  }

  private jsAdd(left: JSValue, right: JSValue): JSValue {
    if (typeof left === 'string' || typeof right === 'string') {
      return toString(left) + toString(right);
    }
    return toNumber(left) + toNumber(right);
  }

  private propGet(obj: JSValue, key: JSValue): JSValue {
    const name = toString(key);
    if (typeof obj === 'object' && obj !== null) {
      const o = obj as JSObject;
      if (o.properties.has(name)) {
        return o.properties.get(name)!.value;
      }
      // Walk prototype chain
      let proto = o.prototype;
      while (proto) {
        if (proto.properties.has(name)) {
          return proto.properties.get(name)!.value;
        }
        proto = proto.prototype;
      }
      return undefined;
    }
    if (typeof obj === 'string') {
      if (name === 'length') return obj.length;
      const idx = Number(name);
      if (!isNaN(idx) && idx >= 0 && idx < obj.length) return obj[idx];
      return undefined;
    }
    if (typeof obj === 'number') {
      if (name === 'toString') return createFunction('toString', [], null, new Environment(), false, false, false);
      return undefined;
    }
    if (obj === null || obj === undefined) {
      throw new JSError(`Cannot read properties of ${obj === null ? 'null' : 'undefined'} (reading '${name}')`);
    }
    return undefined;
  }

  private propSet(obj: JSValue, key: JSValue, val: JSValue): void {
    const name = toString(key);
    if (typeof obj === 'object' && obj !== null) {
      const o = obj as JSObject;
      o.properties.set(name, {
        value: val,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }

  // ── Function calls ─────────────────────────────────────────────────────

  private handleCall(argc: number, spread: boolean): void {
    // Stack: arg0, arg1, ..., argN-1, func
    const funcIdx = this.sp - argc - 1;
    const fn = this.stack[funcIdx] as JSValue;
    const args: JSValue[] = [];
    for (let i = 0; i < argc; i++) {
      args.push(this.stack[funcIdx + 1 + i]!);
    }

    if (typeof fn !== 'object' || fn === null) {
      throw new JSError(`${getType(fn)} is not a function`);
    }

    const jsFn = fn as JSFunction;
    if (!jsFn.type || jsFn.type !== 'closure') {
      throw new JSError(`${getType(fn)} is not a function`);
    }

    // Restore stack
    this.sp = funcIdx;

    if (jsFn.isNative && jsFn.nativeFn) {
      const result = jsFn.nativeFn(undefined, args);
      this.stack[this.sp++] = result;
      return;
    }

    // Bytecode function
    if (jsFn.isBytecode && jsFn.body && typeof jsFn.body === 'object' && 'bytecode' in jsFn.body) {
      const bytecodeFn = jsFn.body as BytecodeFunction;
      this.pushFrame(bytecodeFn, jsFn.thisValue ?? undefined, args, jsFn.closure, jsFn.upvalues ?? []);
      const result = this.executeFrame();
      this.stack[this.sp++] = result;
      return;
    }

    // AST function — delegate to interpreter
    if (this.callInterpreter) {
      const result = this.callInterpreter(jsFn, jsFn.thisValue ?? undefined, args);
      this.stack[this.sp++] = result;
      return;
    }

    throw new JSError(`Cannot call non-bytecode function without interpreter bridge`);
  }

  private handleCallMethod(argc: number): void {
    // Stack: obj, key, arg0, arg1, ..., argN-1
    // But we need: obj, key, args... then we get the method from obj[key]
    const baseIdx = this.sp - argc - 2;
    const obj = this.stack[baseIdx]!;
    const key = this.stack[baseIdx + 1]!;
    const args: JSValue[] = [];
    for (let i = 0; i < argc; i++) {
      args.push(this.stack[baseIdx + 2 + i]!);
    }

    // Get the method
    const method = this.propGet(obj, key);

    if (typeof method !== 'object' || method === null) {
      throw new JSError(`Property '${toString(key)}' is not a function`);
    }

    // Restore stack
    this.sp = baseIdx;

    const jsFn = method as JSFunction;
    if (jsFn.isNative && jsFn.nativeFn) {
      const result = jsFn.nativeFn(obj, args);
      this.stack[this.sp++] = result;
      return;
    }

    if (jsFn.isBytecode && jsFn.body && typeof jsFn.body === 'object' && 'bytecode' in jsFn.body) {
      const bytecodeFn = jsFn.body as BytecodeFunction;
      this.pushFrame(bytecodeFn, obj, args, jsFn.closure, jsFn.upvalues ?? []);
      const result = this.executeFrame();
      this.stack[this.sp++] = result;
      return;
    }

    if (this.callInterpreter) {
      const result = this.callInterpreter(jsFn, obj, args);
      this.stack[this.sp++] = result;
      return;
    }

    throw new JSError(`Cannot call non-bytecode method without interpreter bridge`);
  }

  private handleNew(argc: number): void {
    // Stack: arg0, arg1, ..., argN-1, ctor
    const ctorIdx = this.sp - argc - 1;
    const ctor = this.stack[ctorIdx] as JSValue;
    const args: JSValue[] = [];
    for (let i = 0; i < argc; i++) {
      args.push(this.stack[ctorIdx + 1 + i]!);
    }

    if (typeof ctor !== 'object' || ctor === null) {
      throw new JSError(`${getType(ctor)} is not a constructor`);
    }

    // Create new object with prototype
    const jsCtor = ctor as JSFunction;
    const protoObj = (jsCtor as unknown as JSObject).properties?.get('prototype')?.value;
    const newObj = createObject(typeof protoObj === 'object' && protoObj !== null ? protoObj as JSObject : null);

    // Restore stack
    this.sp = ctorIdx;

    if (jsCtor.isNative && jsCtor.nativeFn) {
      const result = jsCtor.nativeFn(newObj, args);
      // If constructor returns an object, use that; otherwise use newObj
      this.stack[this.sp++] = (typeof result === 'object' && result !== null) ? result : newObj;
      return;
    }

    if (jsCtor.isBytecode && jsCtor.body && typeof jsCtor.body === 'object' && 'bytecode' in jsCtor.body) {
      const bytecodeFn = jsCtor.body as BytecodeFunction;
      this.pushFrame(bytecodeFn, newObj, args, jsCtor.closure, jsCtor.upvalues ?? []);
      const result = this.executeFrame();
      // If constructor returns an object, use that; otherwise use newObj
      this.stack[this.sp++] = (typeof result === 'object' && result !== null) ? result : newObj;
      return;
    }

    if (this.callInterpreter) {
      const result = this.callInterpreter(jsCtor, newObj, args);
      this.stack[this.sp++] = (typeof result === 'object' && result !== null) ? result : newObj;
      return;
    }

    this.stack[this.sp++] = newObj;
  }

  private pushFrame(
    fn: BytecodeFunction,
    thisArg: JSValue,
    args: JSValue[],
    closure: Environment,
    upvalues: UpvalueRef[] = [],
  ): void {
    const locals = new Array(fn.localCount).fill(undefined);

    // Set up arguments array
    const argsObj = createArray(args);
    locals[fn.localCount - 1] = argsObj; // last slot is arguments

    // Copy args into param slots
    for (let i = 0; i < fn.paramCount && i < args.length; i++) {
      locals[i] = args[i];
    }

    const env = new Environment(closure);
    env.markFunctionScope();

    this.frames.push({
      fn,
      bytecode: fn.bytecode,
      constants: fn.constants,
      locals,
      pc: 0,
      sp: this.sp,
      env,
      thisArg,
      upvalues,
      localUpvalueMap: new Map(),
    });
  }
}
