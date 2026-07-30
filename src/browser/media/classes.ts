import type { IDisposable } from '../../app/dependency-container';

interface IClassService extends IDisposable {
  define(name: string, parent?: string, methods?: string[], staticMethods?: string[]): number;
  instantiate(classId: number, args?: unknown[]): InstanceResult;
  getClass(classId: number): ClassInfo | undefined;
  getInstances(classId: number): readonly InstanceInfo[];
  getStats(): ClassStats;
  remove(classId: number): boolean;
  clear(): void;
  onEvent(handler: ClassEventHandler): () => void;
}

interface ClassInfo {
  readonly id: number;
  readonly name: string;
  readonly parent: string | null;
  readonly methods: readonly string[];
  readonly staticMethods: readonly string[];
  readonly defined: string;
  instanceCount: number;
}

interface InstanceInfo {
  readonly id: number;
  readonly classId: number;
  readonly className: string;
  readonly createdAt: number;
  fields: Record<string, unknown>;
}

interface InstanceResult {
  success: boolean;
  instanceId?: number;
  instance?: Record<string, unknown>;
  error?: string;
}

interface ClassStats {
  totalClasses: number;
  totalInstances: number;
  averageMethodsPerClass: number;
  inheritanceDepth: number;
  totalStaticMethods: number;
}

type ClassEventKind = 'defined' | 'instantiated' | 'extended' | 'removed' | 'field_set';
type ClassEventHandler = (event: ClassEvent) => void;

interface ClassEvent {
  readonly kind: ClassEventKind;
  readonly data?: Record<string, unknown>;
}

class ClassService implements IClassService {
  private _nextClassId = 1;
  private _nextInstanceId = 1;
  private _classes = new Map<number, ClassInfo>();
  private _instances = new Map<number, InstanceInfo>();
  private _instanceByClass = new Map<number, Set<number>>();
  private _handlers = new Set<ClassEventHandler>();

  define(name: string, parent?: string, methods: string[] = [], staticMethods: string[] = []): number {
    const id = this._nextClassId++;
    const info: ClassInfo = {
      id, name, parent: parent ?? null, methods: [...methods], staticMethods: [...staticMethods],
      defined: new Date().toISOString(), instanceCount: 0,
    };
    this._classes.set(id, info);
    this._instanceByClass.set(id, new Set());

    this.emit({ kind: 'defined', data: { id, name, parent: parent ?? null, methodCount: methods.length } });
    if (parent) {
      this.emit({ kind: 'extended', data: { childId: id, childName: name, parentName: parent } });
    }
    return id;
  }

  instantiate(classId: number, args?: unknown[]): InstanceResult {
    const info = this._classes.get(classId);
    if (!info) return { success: false, error: 'Class not found' };

    const instanceId = this._nextInstanceId++;
    const fields: Record<string, unknown> = {};
    if (args && args.length > 0) {
      info.methods.forEach((m, i) => {
        if (m.startsWith('constructor')) {
          const constructorArgs = args;
          constructorArgs.forEach((arg, j) => {
            fields[`arg${j}`] = arg;
          });
        }
      });
    }

    const instance: InstanceInfo = { id: instanceId, classId, className: info.name, createdAt: Date.now(), fields };
    this._instances.set(instanceId, instance);
    this._instanceByClass.get(classId)!.add(instanceId);
    info.instanceCount++;

    const proxy = new Proxy(fields, {
      get: (target, prop) => {
        if (prop === '__class') return info.name;
        if (prop === '__id') return instanceId;
        return (target as Record<string, unknown>)[prop as string];
      },
      set: (target, prop, value) => {
        (target as Record<string, unknown>)[prop as string] = value;
        this.emit({ kind: 'field_set', data: { instanceId, classId, field: prop as string, value } });
        return true;
      },
    });

    this.emit({ kind: 'instantiated', data: { instanceId, classId, name: info.name, args } });
    return { success: true, instanceId, instance: proxy };
  }

  getClass(classId: number): ClassInfo | undefined {
    return this._classes.get(classId);
  }

  getInstances(classId: number): readonly InstanceInfo[] {
    const ids = this._instanceByClass.get(classId);
    if (!ids) return [];
    return [...ids].map(id => this._instances.get(id)!).filter(Boolean);
  }

  getStats(): ClassStats {
    let totalMethods = 0;
    let totalStatic = 0;
    let maxDepth = 0;
    for (const c of this._classes.values()) {
      totalMethods += c.methods.length;
      totalStatic += c.staticMethods.length;
      let depth = 0;
      let current: string | null = c.parent;
      while (current) {
        depth++;
        const parent = [...this._classes.values()].find(p => p.name === current);
        current = parent?.parent ?? null;
      }
      if (depth > maxDepth) maxDepth = depth;
    }
    return {
      totalClasses: this._classes.size,
      totalInstances: this._instances.size,
      averageMethodsPerClass: this._classes.size > 0 ? totalMethods / this._classes.size : 0,
      inheritanceDepth: maxDepth,
      totalStaticMethods: totalStatic,
    };
  }

  remove(classId: number): boolean {
    const info = this._classes.get(classId);
    if (!info) return false;
    const instanceIds = this._instanceByClass.get(classId);
    if (instanceIds) {
      for (const id of instanceIds) this._instances.delete(id);
      this._instanceByClass.delete(classId);
    }
    this._classes.delete(classId);
    this.emit({ kind: 'removed', data: { id: classId, name: info.name } });
    return true;
  }

  clear(): void {
    this._classes.clear();
    this._instances.clear();
    this._instanceByClass.clear();
  }

  onEvent(handler: ClassEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: ClassEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._classes.clear();
    this._instances.clear();
    this._instanceByClass.clear();
  }
}

export { ClassService };
export type { IClassService, ClassInfo, InstanceInfo, InstanceResult, ClassStats, ClassEvent, ClassEventKind, ClassEventHandler };
