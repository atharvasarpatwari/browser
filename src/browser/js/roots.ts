// ─────────────────────────────────────────────────────────────────────────────
// ROOTS — GC root set manager.
// Scans all reachable roots: VM stack, call frames, environments, globals.
// ─────────────────────────────────────────────────────────────────────────────

import type { JSValue, JSObject, JSFunction, Environment, UpvalueRef } from './values';
import type { CallFrame } from './vm';

// ── Root Visitor ─────────────────────────────────────────────────────────────

/** Callback type for visiting a rooted JSValue */
export type RootVisitor = (val: JSValue) => void;

// ── Root Scanner ─────────────────────────────────────────────────────────────

/**
 * Scans root sets from the VM and environment chains.
 * Used by the GC to find all reachable objects before tracing.
 */
export class RootScanner {
  private visitors: RootVisitor[] = [];

  /** Register a visitor that will be called for every rooted value */
  addVisitor(visitor: RootVisitor): void {
    this.visitors.push(visitor);
  }

  /** Remove a previously registered visitor */
  removeVisitor(visitor: RootVisitor): void {
    const idx = this.visitors.indexOf(visitor);
    if (idx >= 0) this.visitors.splice(idx, 1);
  }

  /** Visit a single value (calls all registered visitors) */
  visit(val: JSValue): void {
    for (const v of this.visitors) {
      v(val);
    }
  }

  // ── VM Stack Scanning ────────────────────────────────────────────────────

  /**
   * Scan the VM operand stack — every slot may hold an object reference.
   */
  scanStack(stack: JSValue[], sp: number): void {
    for (let i = 0; i < sp; i++) {
      this.visit(stack[i]);
    }
  }

  // ── Call Frame Scanning ──────────────────────────────────────────────────

  /**
   * Scan all call frames: locals, upvalues, thisArg, and env.
   */
  scanFrames(frames: CallFrame[]): void {
    for (const frame of frames) {
      this.scanFrame(frame);
    }
  }

  /**
   * Scan a single call frame.
   */
  scanFrame(frame: CallFrame): void {
    // Scan locals
    for (let i = 0; i < frame.locals.length; i++) {
      this.visit(frame.locals[i]);
    }

    // Scan thisArg
    this.visit(frame.thisArg);

    // Scan upvalues
    for (let i = 0; i < frame.upvalues.length; i++) {
      this.visit(frame.upvalues[i].value);
    }

    // Scan environment bindings
    this.scanEnvironment(frame.env);
  }

  // ── Environment Scanning ─────────────────────────────────────────────────

  /**
   * Scan an entire environment chain.
   */
  scanEnvironment(env: Environment | null): void {
    let current: Environment | null = env;
    while (current) {
      this.scanEnvironmentBindings(current);
      current = current.getParent();
    }
  }

  /**
   * Scan bindings in a single environment (does not traverse parent).
   */
  scanEnvironmentBindings(env: Environment): void {
    const bindings = env.getBindings();
    for (const [, binding] of bindings) {
      this.visit(binding.value);
    }
  }

  // ── Global Environment Scanning ──────────────────────────────────────────

  /**
   * Scan the global environment and all its bindings.
   */
  scanGlobalEnvironment(env: Environment): void {
    this.scanEnvironment(env);
  }

  // ── Convenience: Scan everything ─────────────────────────────────────────

  /**
   * Scan all roots from VM state.
   * Call this at the start of a GC cycle to build the root set.
   */
  scanAll(
    stack: JSValue[],
    sp: number,
    frames: CallFrame[],
    globalEnv: Environment,
  ): void {
    this.scanStack(stack, sp);
    this.scanFrames(frames);
    this.scanGlobalEnvironment(globalEnv);
  }
}

// ── Weak Reference Store ─────────────────────────────────────────────────────

/**
 * Creates WeakRef instances for GC-managed objects.
 * Uses FinalizationRegistry to clean up internal bookkeeping when objects die.
 * Does NOT hold strong references to tracked objects (which would prevent GC).
 */
export class WeakRefStore {
  private registry = new FinalizationRegistry<{ id: number }>((token) => {
    this.liveCount--;
    this.deadTokens.add(token.id);
  });
  private nextId = 1;
  private liveCount = 0;
  private deadTokens = new Set<number>();

  /**
   * Create a WeakRef pointing to the given object.
   */
  create(obj: JSObject | JSFunction): WeakRef<object> {
    const id = this.nextId++;
    this.liveCount++;
    const token = { id };
    this.registry.register(obj, token);
    return new WeakRef(obj as object);
  }

  /**
   * Dereference a WeakRef — returns the object if still alive, else undefined.
   */
  deref(ref: WeakRef<object>): JSObject | JSFunction | undefined {
    return ref.deref() as JSObject | JSFunction | undefined;
  }

  /**
   * Cleanup is a no-op — FinalizationRegistry handles bookkeeping automatically.
   */
  cleanup(): void {
    // FinalizationRegistry handles dead reference cleanup automatically
  }

  /**
   * Remove all tracking.
   */
  remove(_obj: JSObject | JSFunction): void {
    // FinalizationRegistry will handle this when the object is collected
  }

  /**
   * Get the count of live weak references (approximate).
   */
  count(_obj: JSObject | JSFunction): number {
    return this.liveCount;
  }
}
