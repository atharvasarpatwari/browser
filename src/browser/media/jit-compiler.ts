import type { IDisposable } from '../../app/dependency-container';

interface IJITCompilerService extends IDisposable {
  registerFunction(name: string, bytecodeSize: number): number;
  recordCall(functionId: number): void;
  recordLoopIteration(functionId: number): void;
  getFunctionInfo(functionId: number): JITFunctionInfo | undefined;
  compile(functionId: number): CompilationResult;
  getHotFunctions(): JITFunctionInfo[];
  getStats(): JITStats;
  setThresholds(thresholds: JITThresholds): void;
  getThresholds(): JITThresholds;
  reset(): void;
  onEvent(handler: JITEventHandler): () => void;
}

interface JITThresholds {
  readonly hotCallCount: number;
  readonly hotLoopIterations: number;
  readonly maxCompiledFunctions: number;
  readonly tierUpDelay: number;
}

interface JITFunctionInfo {
  readonly id: number;
  readonly name: string;
  readonly bytecodeSize: number;
  callCount: number;
  loopIterations: number;
  tier: ExecutionTier;
  compiled: boolean;
  compilationTime?: number;
  executionTime?: number;
  optimizationLevel?: number;
}

interface CompilationResult {
  success: boolean;
  functionId: number;
  tier: ExecutionTier;
  compilationTime: number;
  sizeReduction: number;
  error?: string;
}

interface JITStats {
  totalFunctions: number;
  hotFunctions: number;
  compiledFunctions: number;
  totalCompilations: number;
  failedCompilations: number;
  averageCompilationTime: number;
  totalExecutionTime: number;
  cacheHitRate: number;
  memoryUsed: number;
}

type ExecutionTier = 'interpreter' | 'bytecode' | 'jit' | 'wasm';
type JITEventKind = 'registered' | 'hot_detected' | 'compiled' | 'compilation_failed' | 'tier_up' | 'evicted' | 'reset';
type JITEventHandler = (event: JITEvent) => void;

interface JITEvent {
  readonly kind: JITEventKind;
  readonly data?: Record<string, unknown>;
}

const JIT_DEFAULT_THRESHOLDS: JITThresholds = {
  hotCallCount: 100,
  hotLoopIterations: 1000,
  maxCompiledFunctions: 64,
  tierUpDelay: 50,
};

class JITCompilerService implements IJITCompilerService {
  private _functions = new Map<number, JITFunctionInfo & { _compilations: number; _totalExecTime: number; _cacheHits: number; _cacheMisses: number }>();
  private _nextId = 1;
  private _compiledCount = 0;
  private _failedCount = 0;
  private _totalCompileTime = 0;
  private _totalExecTime = 0;
  private _cacheHits = 0;
  private _cacheMisses = 0;
  private _thresholds: JITThresholds = { ...JIT_DEFAULT_THRESHOLDS };
  private _handlers = new Set<JITEventHandler>();

  registerFunction(name: string, bytecodeSize: number): number {
    const id = this._nextId++;
    this._functions.set(id, {
      id, name, bytecodeSize,
      callCount: 0, loopIterations: 0,
      tier: 'bytecode', compiled: false,
      _compilations: 0, _totalExecTime: 0,
      _cacheHits: 0, _cacheMisses: 0,
    });
    this.emit({ kind: 'registered', data: { id, name, bytecodeSize } });
    return id;
  }

  recordCall(functionId: number): void {
    const info = this._functions.get(functionId);
    if (!info) return;
    info.callCount++;

    if (info.compiled) {
      info._cacheHits++;
      this._cacheHits++;
    } else {
      info._cacheMisses++;
      this._cacheMisses++;
    }

    if (!info.compiled && info.callCount >= this._thresholds.hotCallCount) {
      this.compile(functionId);
    }
  }

  recordLoopIteration(functionId: number): void {
    const info = this._functions.get(functionId);
    if (!info) return;
    info.loopIterations++;

    if (!info.compiled && info.loopIterations >= this._thresholds.hotLoopIterations) {
      this.compile(functionId);
    }
  }

  getFunctionInfo(functionId: number): JITFunctionInfo | undefined {
    const info = this._functions.get(functionId);
    if (!info) return undefined;
    const { _compilations, _totalExecTime, _cacheHits, _cacheMisses, ...rest } = info;
    return rest;
  }

  compile(functionId: number): CompilationResult {
    const info = this._functions.get(functionId);
    if (!info) return { success: false, functionId, tier: 'bytecode', compilationTime: 0, sizeReduction: 0, error: 'Function not found' };

    if (this._compiledCount >= this._thresholds.maxCompiledFunctions) {
      return { success: false, functionId, tier: 'bytecode', compilationTime: 0, sizeReduction: 0, error: 'Max compiled functions reached' };
    }

    const startTime = performance.now();
    info._compilations++;

    try {
      const compilationTime = Math.max(0.1, info.bytecodeSize * 0.05);
      const optimizationLevel = Math.min(3, Math.floor(info.callCount / 50));
      const sizeReduction = Math.round(info.bytecodeSize * (0.3 + optimizationLevel * 0.15));
      let targetTier: ExecutionTier = 'jit';

      if (info.bytecodeSize > 500) {
        targetTier = 'jit';
      }
      if (info.callCount > 500 || info.loopIterations > 5000) {
        targetTier = 'wasm';
      }

      info.tier = targetTier;
      info.compiled = true;
      info.compilationTime = compilationTime;
      info.optimizationLevel = optimizationLevel;
      this._compiledCount++;
      this._totalCompileTime += compilationTime;

      this.emit({
        kind: 'compiled',
        data: { functionId, name: info.name, tier: targetTier, optimizationLevel, compilationTime, sizeReduction },
      });

      this.emit({ kind: 'tier_up', data: { functionId, from: 'bytecode', to: targetTier } });

      return { success: true, functionId, tier: targetTier, compilationTime, sizeReduction };
    } catch (e) {
      this._failedCount++;
      const msg = e instanceof Error ? e.message : String(e);
      this.emit({ kind: 'compilation_failed', data: { functionId, name: info.name, error: msg } });
      return { success: false, functionId, tier: 'bytecode', compilationTime: performance.now() - startTime, sizeReduction: 0, error: msg };
    }
  }

  getHotFunctions(): JITFunctionInfo[] {
    const hot: JITFunctionInfo[] = [];
    for (const info of this._functions.values()) {
      if (info.callCount >= this._thresholds.hotCallCount || info.loopIterations >= this._thresholds.hotLoopIterations) {
        const { _compilations, _totalExecTime, _cacheHits, _cacheMisses, ...rest } = info;
        hot.push(rest);
      }
    }
    return hot;
  }

  getStats(): JITStats {
    return {
      totalFunctions: this._functions.size,
      hotFunctions: this.getHotFunctions().length,
      compiledFunctions: this._compiledCount,
      totalCompilations: this._compiledCount + this._failedCount,
      failedCompilations: this._failedCount,
      averageCompilationTime: this._compiledCount > 0 ? this._totalCompileTime / this._compiledCount : 0,
      totalExecutionTime: this._totalExecTime,
      cacheHitRate: (this._cacheHits + this._cacheMisses) > 0 ? this._cacheHits / (this._cacheHits + this._cacheMisses) : 0,
      memoryUsed: this._functions.size * 128,
    };
  }

  setThresholds(thresholds: Partial<JITThresholds>): void {
    this._thresholds = { ...this._thresholds, ...thresholds };
  }

  getThresholds(): JITThresholds {
    return { ...this._thresholds };
  }

  reset(): void {
    this._functions.clear();
    this._nextId = 1;
    this._compiledCount = 0;
    this._failedCount = 0;
    this._totalCompileTime = 0;
    this._totalExecTime = 0;
    this._cacheHits = 0;
    this._cacheMisses = 0;
    this.emit({ kind: 'reset' });
  }

  onEvent(handler: JITEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: JITEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._functions.clear();
  }
}

export { JITCompilerService, JIT_DEFAULT_THRESHOLDS };
export type { IJITCompilerService, JITThresholds, JITFunctionInfo, CompilationResult, JITStats, ExecutionTier, JITEvent, JITEventKind, JITEventHandler };
