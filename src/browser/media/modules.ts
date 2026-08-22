import type { IDisposable } from '../../app/dependency-container';

interface IModuleService extends IDisposable {
  define(name: string, exports: string[], code?: string): number;
  import(specifier: string, fromModule?: string): ImportResult;
  resolve(specifier: string, fromModule?: string): ResolvedModule | undefined;
  link(): LinkResult;
  evaluate(moduleId: number): EvalResult;
  getModule(moduleId: number): ModuleInfo | undefined;
  getModules(): readonly ModuleInfo[];
  getStats(): ModuleStats;
  remove(moduleId: number): boolean;
  clear(): void;
  setResolveHook(hook: (specifier: string, from: string) => string | null): void;
  onEvent(handler: ModuleEventHandler): () => void;
}

interface ModuleInfo {
  readonly id: number;
  readonly name: string;
  readonly exports: readonly string[];
  readonly code: string;
  readonly status: ModuleStatus;
  readonly dependencies: readonly number[];
  readonly dependents: readonly number[];
  readonly evaluated: boolean;
  readonly evaluationOrder?: number;
}

interface ImportResult {
  success: boolean;
  moduleId?: number;
  exports?: Record<string, unknown>;
  error?: string;
  circular?: boolean;
}

interface ResolvedModule {
  readonly id: number;
  readonly name: string;
  readonly status: ModuleStatus;
}

interface LinkResult {
  success: boolean;
  order?: number[];
  error?: string;
  circular?: string[];
}

interface EvalResult {
  success: boolean;
  exports?: Record<string, unknown>;
  error?: string;
  duration: number;
}

interface ModuleStats {
  totalModules: number;
  evaluated: number;
  pending: number;
  errored: number;
  averageDependencies: number;
  maxDepth: number;
}

type ModuleStatus = 'unlinked' | 'linked' | 'evaluating' | 'evaluated' | 'error';
type ModuleEventKind = 'defined' | 'imported' | 'linked' | 'evaluated' | 'error' | 'circular';
type ModuleEventHandler = (event: ModuleEvent) => void;

interface ModuleEvent {
  readonly kind: ModuleEventKind;
  readonly data?: Record<string, unknown>;
}

class ModuleService implements IModuleService {
  private _nextId = 1;
  private _modules = new Map<number, {
    name: string; exports: string[]; code: string; status: ModuleStatus;
    dependencies: Set<number>; dependents: Set<number>;
    evaluated: boolean; evaluationOrder?: number; exportValues: Record<string, unknown>;
  }>();
  private _nameIndex = new Map<string, number>();
  private _resolveHook: ((specifier: string, from: string) => string | null) | null = null;
  private _evalCounter = 0;
  private _handlers = new Set<ModuleEventHandler>();

  setResolveHook(hook: (specifier: string, from: string) => string | null): void {
    this._resolveHook = hook;
  }

  define(name: string, exports: string[], code: string = ''): number {
    const existing = this._nameIndex.get(name);
    if (existing !== undefined) return existing;

    const id = this._nextId++;
    this._modules.set(id, {
      name, exports: [...exports], code,
      status: 'unlinked', evaluated: false,
      dependencies: new Set(), dependents: new Set(),
      exportValues: {},
    });
    this._nameIndex.set(name, id);
    this.emit({ kind: 'defined', data: { id, name, exportCount: exports.length } });
    return id;
  }

  import(specifier: string, fromModule?: string): ImportResult {
    const resolved = this.resolve(specifier, fromModule);
    if (!resolved) {
      return { success: false, error: `Cannot resolve module '${specifier}'` };
    }

    const mod = this._modules.get(resolved.id)!;
    this.emit({ kind: 'imported', data: { from: fromModule, specifier, resolved: resolved.name } });

    if (mod.evaluated) {
      return { success: true, moduleId: resolved.id, exports: { ...mod.exportValues } };
    }

    if (mod.status === 'evaluating') {
      this.emit({ kind: 'circular', data: { id: resolved.id, name: resolved.name, from: fromModule } });
      return { success: true, moduleId: resolved.id, exports: {}, circular: true };
    }

    if (fromModule) {
      const fromId = this._nameIndex.get(fromModule);
      if (fromId !== undefined) {
        mod.dependencies.add(fromId);
        const fromMod = this._modules.get(fromId);
        if (fromMod) fromMod.dependents.add(resolved.id);
      }
    }

    return { success: true, moduleId: resolved.id, exports: { ...mod.exportValues } };
  }

  resolve(specifier: string, fromModule?: string): ResolvedModule | undefined {
    if (this._nameIndex.has(specifier)) {
      const id = this._nameIndex.get(specifier)!;
      const mod = this._modules.get(id)!;
      return { id, name: mod.name, status: mod.status };
    }

    if (this._resolveHook && fromModule) {
      const resolved = this._resolveHook(specifier, fromModule);
      if (resolved && this._nameIndex.has(resolved)) {
        const id = this._nameIndex.get(resolved)!;
        const mod = this._modules.get(id)!;
        return { id, name: mod.name, status: mod.status };
      }
    }

    return undefined;
  }

  link(): LinkResult {
    const visited = new Set<number>();
    const visiting = new Set<number>();
    const order: number[] = [];
    const circular: string[] = [];

    const visit = (id: number): boolean => {
      if (visited.has(id)) return true;
      if (visiting.has(id)) {
        const mod = this._modules.get(id)!;
        circular.push(mod.name);
        return false;
      }
      visiting.add(id);
      const mod = this._modules.get(id)!;
      for (const depId of mod.dependencies) {
        visit(depId);
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
      mod.status = 'linked';
      return true;
    };

    for (const id of this._modules.keys()) {
      if (!visited.has(id)) visit(id);
    }

    if (circular.length > 0) {
      this.emit({ kind: 'circular', data: { modules: circular } });
    }

    this.emit({ kind: 'linked', data: { order, moduleCount: order.length } });
    return { success: circular.length === 0, order, circular: circular.length > 0 ? circular : undefined };
  }

  evaluate(moduleId: number): EvalResult {
    const mod = this._modules.get(moduleId);
    if (!mod) return { success: false, error: 'Module not found', duration: 0 };

    if (mod.evaluated) return { success: true, exports: { ...mod.exportValues }, duration: 0 };

    const startTime = performance.now();
    mod.status = 'evaluating';

    try {
      const exportValues: Record<string, unknown> = {};
      for (const exp of mod.exports) {
        exportValues[exp] = `[export: ${exp}]`;
      }

      if (mod.code) {
        const lines = mod.code.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          const exportMatch = trimmed.match(/export\s+(const|let|var)\s+(\w+)\s*=\s*(.+?)\s*;?\s*$/);
          if (exportMatch) {
            let val: unknown = exportMatch[3]!.trim();
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            else if (val === 'null') val = null;
            else if (/^-?\d+(\.\d+)?$/.test(val as string)) val = parseFloat(val as string);
            else if ((val as string).startsWith('"') || (val as string).startsWith("'")) val = (val as string).slice(1, -1);
            exportValues[exportMatch[2]!] = val;
          }
          const fnMatch = trimmed.match(/export\s+(function\s+\w+)/);
          if (fnMatch) {
            exportValues[fnMatch[1]!.replace('function ', '')] = `[function]`;
          }
        }
      }

      mod.exportValues = exportValues;
      this._evalCounter++;
      mod.evaluationOrder = this._evalCounter;
      mod.evaluated = true;
      mod.status = 'evaluated';
      const duration = performance.now() - startTime;

      this.emit({ kind: 'evaluated', data: { id: moduleId, name: mod.name, exports: Object.keys(exportValues), duration } });
      return { success: true, exports: exportValues, duration };
    } catch (e) {
      mod.status = 'error';
      const msg = e instanceof Error ? e.message : String(e);
      this.emit({ kind: 'error', data: { id: moduleId, name: mod.name, error: msg } });
      return { success: false, error: msg, duration: performance.now() - startTime };
    }
  }

  getModule(moduleId: number): ModuleInfo | undefined {
    const mod = this._modules.get(moduleId);
    if (!mod) return undefined;
    return {
      id: moduleId, name: mod.name, exports: [...mod.exports], code: mod.code,
      status: mod.status, dependencies: [...mod.dependencies], dependents: [...mod.dependents],
      evaluated: mod.evaluated, evaluationOrder: mod.evaluationOrder,
    };
  }

  getModules(): readonly ModuleInfo[] {
    return [...this._modules.keys()].map(id => this.getModule(id)!).filter(Boolean);
  }

  getStats(): ModuleStats {
    let evaluated = 0;
    let pending = 0;
    let errored = 0;
    let totalDeps = 0;
    let maxDepth = 0;
    for (const mod of this._modules.values()) {
      if (mod.status === 'evaluated') evaluated++;
      else if (mod.status === 'error') errored++;
      else pending++;
      totalDeps += mod.dependencies.size;
      const depth = mod.evaluationOrder ?? 0;
      if (depth > maxDepth) maxDepth = depth;
    }
    return {
      totalModules: this._modules.size,
      evaluated, pending, errored,
      averageDependencies: this._modules.size > 0 ? totalDeps / this._modules.size : 0,
      maxDepth,
    };
  }

  remove(moduleId: number): boolean {
    const mod = this._modules.get(moduleId);
    if (!mod) return false;
    this._nameIndex.delete(mod.name);
    this._modules.delete(moduleId);
    for (const other of this._modules.values()) {
      other.dependencies.delete(moduleId);
      other.dependents.delete(moduleId);
    }
    return true;
  }

  clear(): void {
    this._modules.clear();
    this._nameIndex.clear();
    this._evalCounter = 0;
  }

  onEvent(handler: ModuleEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: ModuleEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._modules.clear();
    this._nameIndex.clear();
  }
}

export { ModuleService };
export type { IModuleService, ModuleInfo, ImportResult, ResolvedModule, LinkResult, EvalResult, ModuleStats, ModuleStatus, ModuleEvent, ModuleEventKind, ModuleEventHandler };
