// ─────────────────────────────────────────────────────────────────────────────
// JIT — Tier manager, profiling, and hot function detection
// Monitors bytecode function execution and compiles hot functions to WASM.
// ─────────────────────────────────────────────────────────────────────────────

import type { BytecodeFunction } from './bytecode';
import { WasmCompiler, type CompiledModule, createHostImports, type HostEnv } from './wasm-codegen';
import type { Environment, JSValue, JSFunction } from './values';

// ── Constants ────────────────────────────────────────────────────────────────

/** Number of calls before a function is considered "hot" */
const HOT_CALL_THRESHOLD = 100;

/** Number of loop iterations before a function is considered "hot" */
const HOT_LOOP_THRESHOLD = 1000;

/** Maximum number of functions to keep JIT-compiled (LRU eviction) */
const MAX_JIT_CACHE = 64;

/** Maximum WASM module compilation attempts before giving up */
const MAX_COMPILE_ATTEMPTS = 3;

// ── Profiling data ───────────────────────────────────────────────────────────

interface ProfileData {
  /** Total number of times this function was called */
  callCount: number;
  /** Total loop iterations observed */
  loopIterations: number;
  /** Number of times WASM compilation was attempted */
  compileAttempts: number;
  /** Whether this function is eligible for JIT (no eval, with, try/catch) */
  eligible: boolean;
  /** Compilation tier */
  tier: ExecutionTier;
  /** Compiled WASM module (if compiled) */
  compiledModule?: CompiledModule;
  /** Instantiated WASM module (if instantiated) */
  wasmInstance?: WebAssembly.Instance;
  /** Total execution time in the WASM tier (ms) */
  wasmTime: number;
  /** Total execution time in the bytecode tier (ms) */
  bytecodeTime: number;
}

type ExecutionTier = 'bytecode' | 'wasm';

// ── JIT Manager ──────────────────────────────────────────────────────────────

export class JITManager {
  private profiles = new Map<string, ProfileData>();
  private compiler = new WasmCompiler();
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /** Enable or disable JIT compilation */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Get profile data for a function (for diagnostics) */
  getProfile(fn: BytecodeFunction): ProfileData | undefined {
    return this.profiles.get(fn.name);
  }

  /** Get all profile data (for diagnostics) */
  getAllProfiles(): Map<string, ProfileData> {
    return this.profiles;
  }

  /**
   * Called before a bytecode function executes.
   * Returns true if a compiled WASM instance is available.
   */
  onFunctionEntry(fn: BytecodeFunction): boolean {
    if (!this.enabled) return false;

    let profile = this.profiles.get(fn.name);
    if (!profile) {
      profile = {
        callCount: 0,
        loopIterations: 0,
        compileAttempts: 0,
        eligible: this.checkEligibility(fn),
        tier: 'bytecode',
        wasmTime: 0,
        bytecodeTime: 0,
      };
      this.profiles.set(fn.name, profile);
    }

    profile.callCount++;

    // Check if we should try to use WASM
    if (profile.tier === 'wasm' && profile.wasmInstance) {
      return true;
    }

    // Check if function is hot and eligible for compilation
    if (profile.eligible && profile.callCount >= HOT_CALL_THRESHOLD && profile.compileAttempts < MAX_COMPILE_ATTEMPTS) {
      this.tryCompile(fn, profile);
    }

    return false;
  }

  /**
   * Record loop iterations for hot detection.
   */
  recordLoopIterations(fn: BytecodeFunction, iterations: number): void {
    if (!this.enabled) return;

    let profile = this.profiles.get(fn.name);
    if (!profile) return;

    profile.loopIterations += iterations;

    if (profile.eligible && profile.loopIterations >= HOT_LOOP_THRESHOLD && profile.callCount < HOT_CALL_THRESHOLD) {
      // Hot due to loop iterations, even with few calls
      this.tryCompile(fn, profile);
    }
  }

  /**
   * Execute a function through the WASM tier if available.
   * Returns undefined if WASM execution is not available (caller should use bytecode VM).
   */
  executeWasm(fn: BytecodeFunction, env: Environment, thisArg: JSValue, args: JSValue[]): JSValue | undefined {
    const profile = this.profiles.get(fn.name);
    if (!profile?.wasmInstance) return undefined;

    const startTime = Date.now();
    try {
      const exports = profile.wasmInstance.exports as Record<string, WebAssembly.Export>;
      const mainFn = exports['main'] as ((argc: number) => bigint) | undefined;
      if (!mainFn) return undefined;

      // Set up args in WASM memory
      const memory = exports['memory'] as WebAssembly.Memory;
      if (!memory) return undefined;

      const memoryView = new DataView(memory.buffer);

      // Write args to stack area (offset 0)
      for (let i = 0; i < args.length; i++) {
        memoryView.setBigUint64(i * 8, this.jsValueToWasm(args[i]!), true);
      }

      // Call main
      const result = mainFn(args.length);

      profile.wasmTime += Date.now() - startTime;
      return this.wasmToJsValue(result);
    } catch (err) {
      // WASM execution failed — fall back to bytecode
      profile.tier = 'bytecode';
      profile.wasmInstance = undefined;
      profile.wasmTime += Date.now() - startTime;
      return undefined;
    }
  }

  /**
   * Record bytecode execution time.
   */
  recordBytecodeTime(fn: BytecodeFunction, timeMs: number): void {
    const profile = this.profiles.get(fn.name);
    if (profile) {
      profile.bytecodeTime += timeMs;
    }
  }

  /**
   * Get JIT statistics for diagnostics.
   */
  getStats(): JITStats {
    let totalFunctions = 0;
    let compiledFunctions = 0;
    let totalCalls = 0;
    let wasmCalls = 0;
    let totalTime = 0;
    let wasmTime = 0;

    for (const profile of this.profiles.values()) {
      totalFunctions++;
      totalCalls += profile.callCount;
      totalTime += profile.bytecodeTime + profile.wasmTime;
      wasmTime += profile.wasmTime;
      if (profile.tier === 'wasm') {
        compiledFunctions++;
        wasmCalls += profile.callCount;
      }
    }

    return {
      totalFunctions,
      compiledFunctions,
      totalCalls,
      wasmCalls,
      totalTime,
      wasmTime,
      speedup: wasmTime > 0 && (totalTime - wasmTime) > 0
        ? (totalTime - wasmTime) / wasmTime
        : 1,
    };
  }

  /**
   * Clear all profiling data and compiled modules.
   */
  reset(): void {
    this.profiles.clear();
  }

  // ── Private ────────────────────────────────────────────────────────────

  /**
   * Check if a function is eligible for JIT compilation.
   * Functions with try/catch, eval, generators, or async are not eligible
   * for the first implementation.
   */
  private checkEligibility(fn: BytecodeFunction): boolean {
    // Async functions need special handling
    if (fn.isAsync) return false;

    // Generators need special handling
    if (fn.isGenerator) return false;

    // Check for try/catch in the function
    if (fn.tryTable.length > 0) return false;

    // Check bytecode for problematic opcodes
    const bc = fn.bytecode;
    for (let i = 0; i < bc.length; i++) {
      switch (bc[i]!) {
        case 0x93: // TRY
        case 0x94: // END_TRY
        case 0x97: // AWAIT
        case 0x98: // YIELD
        case 0x99: // DEBUGGER
          return false;
        default:
          break;
      }
    }

    return true;
  }

  /**
   * Try to compile a bytecode function to WASM.
   */
  private tryCompile(fn: BytecodeFunction, profile: ProfileData): void {
    profile.compileAttempts++;

    try {
      const wasmBytes = this.compiler.compile(fn);
      profile.compiledModule = { module: null as unknown as WebAssembly.Module, fn };

      // Compile the WASM module
      // Note: WebAssembly.compile is async, but we want sync behavior.
      // We store the bytes and compile lazily on first use.
      this.compileAsync(fn, profile, wasmBytes);
    } catch (err) {
      // Compilation failed — mark as ineligible for future attempts
      profile.eligible = false;
    }
  }

  /**
   * Async compilation — called from tryCompile.
   * Falls back to bytecode if compilation fails.
   */
  private async compileAsync(fn: BytecodeFunction, profile: ProfileData, wasmBytes: Uint8Array): Promise<void> {
    try {
      const module = await WebAssembly.compile(wasmBytes);
      profile.compiledModule = { module, fn };

      // Create host environment
      const hostEnv = this.createHostEnv(profile);
      const imports = createHostImports(hostEnv);

      // Instantiate
      const instance = await WebAssembly.instantiate(module, imports);
      profile.wasmInstance = instance;
      profile.tier = 'wasm';

      // Evict LRU if cache is full
      this.evictIfNeeded();
    } catch (err) {
      profile.eligible = false;
    }
  }

  /**
   * Create the host environment for WASM execution.
   */
  private createHostEnv(profile: ProfileData): HostEnv {
    return {
      constants: profile.fn.constants,
      getStackValue: (_sp: number) => undefined,
      setStackValue: (_sp: number, _val: unknown) => {},
      loadGlobal: (_nameIdx: number) => undefined,
      storeGlobal: (_nameIdx: number, _val: unknown) => {},
      toJSValue: (i64: bigint): unknown => {
        return this.wasmToJsValue(i64);
      },
      toI64: (val: unknown): bigint => {
        return this.jsValueToWasm(val);
      },
    };
  }

  /**
   * Convert a JSValue to WASM i64 (NaN-boxed).
   */
  private jsValueToWasm(val: unknown): bigint {
    if (typeof val === 'number') {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, val, true);
      return new DataView(buf).getBigUint64(0, true);
    }
    if (val === null) return 0x7FF8_0000_0000_0001n;
    if (val === undefined) return 0x7FF8_0000_0000_0002n;
    if (val === false) return 0x7FF8_0000_0000_0003n;
    if (val === true) return 0x7FF8_0000_0000_0004n;
    if (typeof val === 'string') {
      // Store string in a table — for now, return a marker
      return 0x7FF8_0000_0000_0020n;
    }
    // Objects — return marker
    return 0x7FF8_0000_0000_0010n;
  }

  /**
   * Convert a WASM i64 (NaN-boxed) back to JSValue.
   */
  private wasmToJsValue(i64: bigint): JSValue {
    // Check if it's a tagged value (upper 16 bits = 0x7FF8)
    const upper16 = Number((i64 >> 48n) & 0xFFFFn);
    if (upper16 === 0x7FF8) {
      const tag = Number(i64 & 0xFFFFn);
      switch (tag) {
        case 0x0001: return null;
        case 0x0002: return undefined;
        case 0x0003: return false;
        case 0x0004: return true;
        default: return undefined; // pointer types — not fully implemented yet
      }
    }
    // Raw number
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, i64, true);
    return new DataView(buf).getFloat64(0, true);
  }

  /**
   * Evict oldest compiled modules if cache is full.
   */
  private evictIfNeeded(): void {
    if (this.profiles.size <= MAX_JIT_CACHE) return;

    // Find the profile with the least wasm time (least used)
    let oldest: ProfileData | undefined;
    let oldestKey = '';
    for (const [key, profile] of this.profiles) {
      if (profile.tier === 'wasm' && (!oldest || profile.wasmTime < oldest.wasmTime)) {
        oldest = profile;
        oldestKey = key;
      }
    }

    if (oldest && oldestKey) {
      oldest.tier = 'bytecode';
      oldest.wasmInstance = undefined;
      oldest.compiledModule = undefined;
    }
  }
}

// ── JIT Stats ────────────────────────────────────────────────────────────────

export interface JITStats {
  totalFunctions: number;
  compiledFunctions: number;
  totalCalls: number;
  wasmCalls: number;
  totalTime: number;
  wasmTime: number;
  speedup: number;
}

// ── Tiered execution wrapper ─────────────────────────────────────────────────

/**
 * Wraps the bytecode VM with JIT-aware execution.
 * Before each function call, checks if WASM execution is available.
 */
export class TieredExecutor {
  private jit: JITManager;

  constructor(jit?: JITManager) {
    this.jit = jit ?? new JITManager();
  }

  getJIT(): JITManager {
    return this.jit;
  }

  /**
   * Execute a bytecode function with tiered execution.
   * Returns the result, or undefined if JIT execution should be attempted separately.
   */
  shouldUseWasm(fn: BytecodeFunction): boolean {
    return this.jit.onFunctionEntry(fn);
  }

  executeWasm(
    fn: BytecodeFunction,
    env: Environment,
    thisArg: JSValue,
    args: JSValue[],
  ): JSValue | undefined {
    return this.jit.executeWasm(fn, env, thisArg, args);
  }

  recordLoop(fn: BytecodeFunction, iterations: number): void {
    this.jit.recordLoopIterations(fn, iterations);
  }

  getStats(): JITStats {
    return this.jit.getStats();
  }
}
