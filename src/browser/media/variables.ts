import type { IDisposable } from '../../app/dependency-container';

interface IVariableService extends IDisposable {
  declare(name: string, kind: VariableKind, scope?: ScopeId): VariableRecord;
  set(name: string, value: unknown, scope?: ScopeId): boolean;
  get(name: string, scope?: ScopeId): VariableResult;
  has(name: string, scope?: ScopeId): boolean;
  delete(name: string, scope?: ScopeId): boolean;
  createScope(type: ScopeType, parent?: ScopeId): ScopeId;
  destroyScope(id: ScopeId): void;
  getScope(id: ScopeId): ScopeInfo | undefined;
  get currentScope(): ScopeId;
  dump(): Record<string, unknown>;
  onEvent(handler: VariableEventHandler): () => void;
}

type VariableKind = 'var' | 'let' | 'const';
type ScopeType = 'global' | 'block' | 'function' | 'module';
type VariableEventKind = 'declared' | 'set' | 'get' | 'deleted' | 'scope_created' | 'scope_destroyed';
type VariableEventHandler = (event: VariableEvent) => void;

interface VariableEvent {
  readonly kind: VariableEventKind;
  readonly data?: Record<string, unknown>;
}

interface VariableRecord {
  readonly id: number;
  readonly name: string;
  readonly kind: VariableKind;
  value: unknown;
  readonly scope: ScopeId;
  readonly line?: number;
  readonly column?: number;
  initialized: boolean;
}

interface VariableResult {
  found: boolean;
  value?: unknown;
  initialized?: boolean;
  scope?: ScopeId;
}

interface ScopeInfo {
  readonly id: ScopeId;
  readonly type: ScopeType;
  readonly parent: ScopeId | null;
  readonly depth: number;
}

type ScopeId = number;

class VariableService implements IVariableService {
  private _nextScopeId: ScopeId = 1;
  private _nextVarId = 1;
  private _scopes = new Map<ScopeId, ScopeInfo>();
  private _variables = new Map<number, VariableRecord>();
  private _scopeVars = new Map<ScopeId, Set<number>>();
  private _nameIndex = new Map<string, Map<ScopeId, number>>();
  private _currentScope: ScopeId;
  private _handlers = new Set<VariableEventHandler>();

  constructor() {
    const globalId = this._nextScopeId++;
    this._scopes.set(globalId, { id: globalId, type: 'global', parent: null, depth: 0 });
    this._scopeVars.set(globalId, new Set());
    this._currentScope = globalId;
  }

  get currentScope(): ScopeId {
    return this._currentScope;
  }

  createScope(type: ScopeType, parent?: ScopeId): ScopeId {
    const pid = parent ?? this._currentScope;
    const parentInfo = this._scopes.get(pid);
    const id = this._nextScopeId++;
    this._scopes.set(id, { id, type, parent: pid, depth: parentInfo ? parentInfo.depth + 1 : 0 });
    this._scopeVars.set(id, new Set());
    this.emit({ kind: 'scope_created', data: { id, type, parent: pid } });
    return id;
  }

  destroyScope(id: ScopeId): void {
    const vars = this._scopeVars.get(id);
    if (vars) {
      for (const vid of vars) {
        this._variables.delete(vid);
      }
      this._scopeVars.delete(id);
    }
    this._scopes.delete(id);
    for (const [name, scopeMap] of this._nameIndex) {
      scopeMap.delete(id);
      if (scopeMap.size === 0) this._nameIndex.delete(name);
    }
    this.emit({ kind: 'scope_destroyed', data: { id } });
  }

  declare(name: string, kind: VariableKind, scope?: ScopeId): VariableRecord {
    const sid = scope ?? this._currentScope;
    if (!this._scopes.has(sid)) throw new Error(`Scope ${sid} not found`);

    const existing = this._nameIndex.get(name)?.get(sid);
    if (existing !== undefined) {
      const existingVar = this._variables.get(existing)!;
      if (existingVar.kind !== 'var') throw new Error(`Identifier '${name}' has already been declared`);
    }

    const id = this._nextVarId++;
    const record: VariableRecord = { id, name, kind, value: undefined, scope: sid, initialized: false };
    this._variables.set(id, record);
    this._scopeVars.get(sid)!.add(id);
    if (!this._nameIndex.has(name)) this._nameIndex.set(name, new Map());
    this._nameIndex.get(name)!.set(sid, id);

    this.emit({ kind: 'declared', data: { id, name, kind, scope: sid } });
    return record;
  }

  set(name: string, value: unknown, scope?: ScopeId): boolean {
    const sid = scope ?? this._currentScope;
    const resolved = this.resolve(name, sid);
    if (!resolved) return false;

    const record = this._variables.get(resolved.varId)!;
    if (record.kind === 'const' && record.initialized) return false;
    record.value = value;
    record.initialized = true;

    this.emit({ kind: 'set', data: { id: record.id, name, value, scope: resolved.scope } });
    return true;
  }

  get(name: string, scope?: ScopeId): VariableResult {
    const sid = scope ?? this._currentScope;
    const resolved = this.resolve(name, sid);
    if (!resolved) return { found: false };

    const record = this._variables.get(resolved.varId)!;
    this.emit({ kind: 'get', data: { id: record.id, name, scope: resolved.scope } });
    return { found: true, value: record.value, initialized: record.initialized, scope: resolved.scope };
  }

  has(name: string, scope?: ScopeId): boolean {
    return this.resolve(name, scope ?? this._currentScope) !== null;
  }

  delete(name: string, scope?: ScopeId): boolean {
    const sid = scope ?? this._currentScope;
    const resolved = this.resolve(name, sid);
    if (!resolved) return false;

    const record = this._variables.get(resolved.varId);
    if (record) {
      this._variables.delete(resolved.varId);
      this._scopeVars.get(resolved.scope)?.delete(resolved.varId);
      const scopeMap = this._nameIndex.get(name);
      if (scopeMap) {
        scopeMap.delete(resolved.scope);
        if (scopeMap.size === 0) this._nameIndex.delete(name);
      }
      this.emit({ kind: 'deleted', data: { name, scope: resolved.scope } });
    }
    return true;
  }

  getScope(id: ScopeId): ScopeInfo | undefined {
    return this._scopes.get(id);
  }

  dump(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [id, record] of this._variables) {
      result[record.name] = record.value;
    }
    return result;
  }

  private resolve(name: string, scopeId: ScopeId): { varId: number; scope: ScopeId } | null {
    let current: ScopeId | null = scopeId;
    while (current !== null) {
      const scopeMap = this._nameIndex.get(name);
      if (scopeMap) {
        const varId = scopeMap.get(current);
        if (varId !== undefined) return { varId, scope: current };
      }
      const info = this._scopes.get(current);
      current = info?.parent ?? null;
    }
    return null;
  }

  onEvent(handler: VariableEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: VariableEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._variables.clear();
    this._scopes.clear();
    this._scopeVars.clear();
    this._nameIndex.clear();
  }
}

export { VariableService };
export type { IVariableService, VariableKind, ScopeType, VariableEvent, VariableEventKind, VariableEventHandler, VariableRecord, VariableResult, ScopeInfo, ScopeId };
