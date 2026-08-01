// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GC â€” Garbage Collector engine for the Nova JS runtime.
// Two-generation mark-and-sweep collector with weak references and
// finalization support.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { JSValue, JSObject, JSFunction, Environment, UpvalueRef } from './values';
import { Heap, type HeapStats } from './heap';
import { RootScanner, WeakRefStore } from './roots';
import type { BytecodeVM, CallFrame } from './vm';

// â”€â”€ GC Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GCConfig {
  /** Enable/disable automatic GC collection */
  enabled: boolean;
  /** Young generation collection threshold in bytes */
  youngThreshold: number;
  /** Old generation collection threshold in bytes */
  oldThreshold: number;
  /** Max objects per young collection cycle (for incremental GC) */
  maxObjectsPerYoungCollection: number;
  /** Max objects per old collection cycle */
  maxObjectsPerOldCollection: number;
}

const DEFAULT_CONFIG: GCConfig = {
  enabled: true,
  youngThreshold: 128 * 1024,    // 128KB
  oldThreshold: 1024 * 1024,     // 1MB
  maxObjectsPerYoungCollection: 1000,
  maxObjectsPerOldCollection: 5000,
};

// â”€â”€ Finalization Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * A registry of finalizer callbacks for GC-managed objects.
 * When an object is collected, its finalizer is called.
 */
export class FinalizationRegistry {
  private finalizers = new Map<number, (obj: JSObject | JSFunction) => void>();

  /**
   * Register a finalizer for an object.
   */
  register(obj: JSObject | JSFunction, finalizer: (obj: JSObject | JSFunction) => void): void {
    const id = (obj as unknown as Record<string, unknown>)['__gcId'] as number;
    if (id !== undefined) {
      this.finalizers.set(id, finalizer);
    }
  }

  /**
   * Unregister a finalizer for an object.
   */
  unregister(obj: JSObject | JSFunction): void {
    const id = (obj as unknown as Record<string, unknown>)['__gcId'] as number;
    if (id !== undefined) {
      this.finalizers.delete(id);
    }
  }

  /**
   * Get the finalizer for an object (called during sweep).
   */
  getFinalizer(id: number): ((obj: JSObject | JSFunction) => void) | undefined {
    return this.finalizers.get(id);
  }

  /**
   * Remove a finalizer after it has been called.
   */
  remove(id: number): void {
    this.finalizers.delete(id);
  }

  /**
   * Clear all finalizers.
   */
  clear(): void {
    this.finalizers.clear();
  }

  /**
   * Get the number of registered finalizers.
   */
  size(): number {
    return this.finalizers.size;
  }
}

// â”€â”€ GC Statistics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GCStats {
  /** Total number of collections performed */
  collections: number;
  /** Number of young generation collections */
  youngCollections: number;
  /** Number of old generation collections */
  oldCollections: number;
  /** Total objects collected */
  objectsCollected: number;
  /** Total bytes freed */
  bytesFreed: number;
  /** Total collection time in ms */
  totalTimeMs: number;
  /** Average collection time in ms */
  avgTimeMs: number;
  /** Current heap stats */
  heapStats: HeapStats;
}

// â”€â”€ Garbage Collector â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class GarbageCollector {
  private heap: Heap;
  private scanner: RootScanner;
  private weakRefs: WeakRefStore;
  private finalizers: FinalizationRegistry;
  private config: GCConfig;

  // Statistics
  private _collections = 0;
  private _youngCollections = 0;
  private _oldCollections = 0;
  private _objectsCollected = 0;
  private _bytesFreed = 0;
  private _totalTimeMs = 0;

  // State
  private _disabled = false;
  private _inCollection = false;

  // VM reference for root scanning
  private vm: BytecodeVM | null = null;
  private globalEnv: Environment | null = null;

  constructor(config?: Partial<GCConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.heap = new Heap();
    this.scanner = new RootScanner();
    this.weakRefs = new WeakRefStore();
    this.finalizers = new FinalizationRegistry();

    // Configure heap thresholds
    this.heap.youngThreshold = this.config.youngThreshold;
    this.heap.oldThreshold = this.config.oldThreshold;

    // Register root visitor that marks objects in the heap
    this.scanner.addVisitor((val: JSValue) => {
      if (val === null || val === undefined) return;
      if (typeof val !== 'object' && typeof val !== 'function') return;
      const obj = val as JSObject | JSFunction;
      if (this.heap.has(obj)) {
        this.heap.mark(obj);
      }
    });
  }

  // â”€â”€ Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Set the VM for root scanning */
  setVM(vm: BytecodeVM): void {
    this.vm = vm;
  }

  /** Set the global environment for root scanning */
  setGlobalEnv(env: Environment): void {
    this.globalEnv = env;
  }

  /** Enable or disable the GC */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /** Check if GC is enabled */
  isEnabled(): boolean {
    return this.config.enabled && !this._disabled;
  }

  /** Temporarily disable GC (e.g., during critical sections) */
  disable(): void {
    this._disabled = true;
  }

  /** Re-enable GC after temporary disable */
  enable(): void {
    this._disabled = false;
  }

  /** Check if a collection is currently in progress */
  isInCollection(): boolean {
    return this._inCollection;
  }

  // â”€â”€ Allocation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Allocate a new JSObject on the GC heap.
   */
  allocateObject(prototype: JSObject | null = null): JSObject {
    const obj: JSObject = {
      type: 'object',
      properties: new Map(),
      prototype,
    };
    return this.heap.allocate(obj);
  }

  /**
   * Allocate a new array on the GC heap.
   */
  allocateArray(elements: JSValue[] = []): JSObject {
    const arr: JSObject = {
      type: 'array',
      properties: new Map(),
      prototype: null,
    };
    // Set elements
    for (let i = 0; i < elements.length; i++) {
      arr.properties.set(String(i), {
        value: elements[i],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    arr.properties.set('length', {
      value: elements.length,
      writable: true,
      enumerable: false,
      configurable: false,
    });
    return this.heap.allocate(arr);
  }

  /**
   * Allocate a new function on the GC heap.
   */
  allocateFunction(
    name: string,
    params: string[],
    body: unknown,
    closure: Environment,
    async = false,
    isArrow = false,
    generator = false,
    isBytecode = false,
    upvalues?: UpvalueRef[],
  ): JSFunction {
    const fn: JSFunction = {
      type: 'closure',
      name,
      params,
      body,
      closure,
      async,
      generator,
      isArrow,
      isNative: false,
      isBytecode,
      upvalues,
    };
    return this.heap.allocate(fn);
  }

  /**
   * Allocate a new native function on the GC heap.
   */
  allocateNativeFunction(
    name: string,
    fn: (thisArg: JSValue, args: JSValue[]) => JSValue,
  ): JSFunction {
    const nativeFn: JSFunction = {
      type: 'closure',
      name,
      params: [],
      body: null,
      closure: null as unknown as Environment,
      async: false,
      generator: false,
      isArrow: false,
      isNative: true,
      nativeFn: fn,
    };
    return this.heap.allocate(nativeFn);
  }

  /**
   * Register an externally-created object with the GC.
   */
  register(obj: JSObject | JSFunction): void {
    this.heap.register(obj);
  }

  // â”€â”€ Finalization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Register a finalizer callback for an object.
   */
  onFinalize(obj: JSObject | JSFunction, callback: (obj: JSObject | JSFunction) => void): void {
    const header = this.heap.getHeader(obj);
    if (header) {
      header.finalizer = callback;
    }
  }

  // â”€â”€ Weak References â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Create a weak reference to an object.
   */
  createWeakRef(obj: JSObject | JSFunction): WeakRef<object> {
    return this.weakRefs.create(obj);
  }

  /**
   * Dereference a weak reference.
   */
  derefWeakRef(ref: WeakRef<object>): JSObject | JSFunction | undefined {
    return this.weakRefs.deref(ref);
  }

  // â”€â”€ Collection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Trigger a young generation collection (nursery).
   * Scans roots, traces reachable young objects, sweeps unreachable.
   */
  collectYoung(): number {
    if (!this.isEnabled() || this._inCollection) return 0;

    this._inCollection = true;
    const startTime = performance.now();

    try {
      // Phase 1: Clear marks
      this.heap.clearMarks();

      // Phase 2: Scan roots
      this.scanRoots();

      // Phase 3: Trace reachable objects (starting from roots)
      this.traceFromRoots();

      // Phase 4: Sweep unmarked young objects
      const youngObjects = this.heap.getYoungObjects();
      let swept = 0;
      for (const obj of youngObjects) {
        if (!this.heap.isMarked(obj)) {
          // Run finalizer
          const id = this.heap.getId(obj);
          const finalizer = this.finalizers.getFinalizer(id);
          if (finalizer) {
            try { finalizer(obj); } catch { /* finalizers should not throw */ }
            this.finalizers.remove(id);
          }
          swept++;
        }
      }

      const collected = this.heap.sweep();

      // Phase 5: Promote surviving young objects to old generation
      this.heap.promoteSurvivors();

      // Phase 6: Cleanup weak references
      this.weakRefs.cleanup();

      const elapsed = performance.now() - startTime;
      this._youngCollections++;
      this._collections++;
      this._objectsCollected += collected.length;
      this._totalTimeMs += elapsed;

      return collected.length;
    } finally {
      this._inCollection = false;
    }
  }

  /**
   * Trigger a full collection (young + old generations).
   * More expensive â€” clears all marks and traces everything.
   */
  collectFull(): number {
    if (!this.isEnabled() || this._inCollection) return 0;

    this._inCollection = true;
    const startTime = performance.now();

    try {
      // Phase 1: Clear all marks
      this.heap.clearMarks();

      // Phase 2: Scan roots
      this.scanRoots();

      // Phase 3: Trace all reachable objects
      this.traceFromRoots();

      // Phase 4: Sweep all unmarked objects
      const collected = this.heap.sweep();

      // Phase 5: Cleanup weak references
      this.weakRefs.cleanup();

      const elapsed = performance.now() - startTime;
      this._oldCollections++;
      this._collections++;
      this._objectsCollected += collected.length;
      this._totalTimeMs += elapsed;

      return collected.length;
    } finally {
      this._inCollection = false;
    }
  }

  /**
   * Automatic collection â€” decides which generation to collect based on pressure.
   */
  collect(): number {
    if (!this.isEnabled()) return 0;

    // Check if old generation is over threshold
    if (this.heap.shouldCollectOld()) {
      return this.collectFull();
    }

    // Check if young generation is over threshold
    if (this.heap.shouldCollectYoung()) {
      return this.collectYoung();
    }

    return 0;
  }

  /**
   * Force a full collection regardless of thresholds.
   */
  forceCollect(): number {
    return this.collectFull();
  }

  // â”€â”€ Root Scanning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Scan all root sets and mark reachable objects.
   */
  private scanRoots(): void {
    if (this.vm) {
      const stack = this.vm.getStack();
      const sp = this.vm.getSP();
      const frames = this.vm.getFrames();

      // Scan VM stack
      this.scanner.scanStack(stack, sp);

      // Scan call frames (locals, upvalues, environments)
      this.scanner.scanFrames(frames);
    }

    // Scan global environment (always, even without VM)
    if (this.globalEnv) {
      this.scanner.scanGlobalEnvironment(this.globalEnv);
    }
  }

  // â”€â”€ Tracing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Starting from marked roots, trace all reachable objects and mark them.
   * Uses iterative worklist to avoid stack overflow on deep object graphs.
   */
  private traceFromRoots(): void {
    const worklist: Array<JSObject | JSFunction> = [];

    // Collect all currently-marked objects as starting points
    for (const obj of this.heap.getAllObjects()) {
      if (this.heap.isMarked(obj)) {
        worklist.push(obj);
      }
    }

    // Iterative tracing
    while (worklist.length > 0) {
      const obj = worklist.pop()!;
      this.traceObject(obj, worklist);
    }
  }

  /**
   * Trace a single object â€” mark its children and add them to the worklist.
   */
  private traceObject(
    obj: JSObject | JSFunction,
    worklist: Array<JSObject | JSFunction>,
  ): void {
    if (obj.type === 'closure') {
      this.traceFunction(obj as JSFunction, worklist);
    } else {
      this.traceObjectProps(obj as JSObject, worklist);
    }
  }

  /**
   * Trace a function object â€” closure environment, upvalues, prototype chain.
   */
  private traceFunction(
    fn: JSFunction,
    worklist: Array<JSObject | JSFunction>,
  ): void {
    // Trace closure environment
    if (fn.closure) {
      this.traceEnvironment(fn.closure, worklist);
    }

    // Trace upvalues
    if (fn.upvalues) {
      for (const upval of fn.upvalues) {
        this.traceValue(upval.value, worklist);
      }
    }
  }

  /**
   * Trace an object's properties and prototype chain.
   */
  private traceObjectProps(
    obj: JSObject,
    worklist: Array<JSObject | JSFunction>,
  ): void {
    // Trace prototype
    if (obj.prototype) {
      this.markAndEnqueue(obj.prototype, worklist);
    }

    // Trace all property values
    for (const [, desc] of obj.properties) {
      this.traceValue(desc.value, worklist);
    }
  }

  /**
   * Trace a JSValue â€” if it's an object, mark and enqueue it.
   */
  private traceValue(val: JSValue, worklist: Array<JSObject | JSFunction>): void {
    if (val === null || val === undefined) return;
    if (typeof val !== 'object' && typeof val !== 'function') return;

    const obj = val as JSObject | JSFunction;
    this.markAndEnqueue(obj, worklist);
  }

  /**
   * Mark an object and add it to the worklist if not already marked.
   */
  private markAndEnqueue(
    obj: JSObject | JSFunction,
    worklist: Array<JSObject | JSFunction>,
  ): void {
    if (this.heap.has(obj) && !this.heap.isMarked(obj)) {
      this.heap.mark(obj);
      worklist.push(obj);
    }
  }

  /**
   * Trace an environment chain â€” all bindings in all scopes.
   */
  private traceEnvironment(
    env: Environment | null,
    worklist: Array<JSObject | JSFunction>,
  ): void {
    let current: Environment | null = env;
    while (current) {
      const bindings = current.getBindings();
      for (const [, binding] of bindings) {
        this.traceValue(binding.value, worklist);
      }
      current = current.getParent();
    }
  }

  // â”€â”€ Statistics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Get GC statistics.
   */
  getStats(): GCStats {
    const heapStats = this.heap.getStats();
    return {
      collections: this._collections,
      youngCollections: this._youngCollections,
      oldCollections: this._oldCollections,
      objectsCollected: this._objectsCollected,
      bytesFreed: this._bytesFreed,
      totalTimeMs: this._totalTimeMs,
      avgTimeMs: this._collections > 0 ? this._totalTimeMs / this._collections : 0,
      heapStats,
    };
  }

  /**
   * Reset GC statistics.
   */
  resetStats(): void {
    this._collections = 0;
    this._youngCollections = 0;
    this._oldCollections = 0;
    this._objectsCollected = 0;
    this._bytesFreed = 0;
    this._totalTimeMs = 0;
  }

  /**
   * Get the underlying heap (for testing).
   */
  getHeap(): Heap {
    return this.heap;
  }

  /**
   * Reset the entire GC system.
   */
  reset(): void {
    this.heap.reset();
    this.finalizers.clear();
    this.resetStats();
    this._disabled = false;
    this._inCollection = false;
  }
}

// â”€â”€ Singleton GC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _globalGC: GarbageCollector | null = null;

export function getGC(): GarbageCollector {
  if (!_globalGC) {
    _globalGC = new GarbageCollector();
  }
  return _globalGC;
}

export function setGC(gc: GarbageCollector): void {
  _globalGC = gc;
}
