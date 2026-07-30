export type StorageAreaType = 'local' | 'sync' | 'managed' | 'session';

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageEventHandler = (changes: Record<string, StorageChange>, areaName: string) => void;

export class ExtensionStorage {
  private local = new Map<string, Map<string, unknown>>();
  private sync = new Map<string, Map<string, unknown>>();
  private managed = new Map<string, Map<string, unknown>>();
  private session = new Map<string, Map<string, unknown>>();
  private handlers = new Set<StorageEventHandler>();

  private getArea(extensionId: string, area: StorageAreaType): Map<string, unknown> {
    const store = area === 'local' ? this.local
      : area === 'sync' ? this.sync
      : area === 'managed' ? this.managed
      : this.session;
    if (!store.has(extensionId)) {
      store.set(extensionId, new Map());
    }
    return store.get(extensionId)!;
  }

  get(extensionId: string, area: StorageAreaType, keys: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
    const store = this.getArea(extensionId, area);
    if (keys === null) {
      return Object.fromEntries(store);
    }
    if (typeof keys === 'string') {
      const val = store.get(keys);
      return val !== undefined ? { [keys]: val } : {};
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      for (const k of keys) {
        const val = store.get(k);
        if (val !== undefined) result[k] = val;
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const k of Object.keys(keys)) {
      const val = store.get(k);
      result[k] = val !== undefined ? val : keys[k];
    }
    return result;
  }

  set(extensionId: string, area: StorageAreaType, items: Record<string, unknown>): void {
    const store = this.getArea(extensionId, area);
    const changes: Record<string, StorageChange> = {};
    for (const [key, value] of Object.entries(items)) {
      const oldValue = store.get(key);
      store.set(key, value);
      changes[key] = { oldValue, newValue: value };
    }
    this.notify(changes, area);
  }

  remove(extensionId: string, area: StorageAreaType, keys: string | string[]): void {
    const store = this.getArea(extensionId, area);
    const keyList = Array.isArray(keys) ? keys : [keys];
    const changes: Record<string, StorageChange> = {};
    for (const key of keyList) {
      if (store.has(key)) {
        const oldValue = store.get(key);
        store.delete(key);
        changes[key] = { oldValue, newValue: undefined };
      }
    }
    if (Object.keys(changes).length > 0) {
      this.notify(changes, area);
    }
  }

  clear(extensionId: string, area: StorageAreaType): void {
    const store = this.getArea(extensionId, area);
    const changes: Record<string, StorageChange> = {};
    for (const [key, value] of store) {
      changes[key] = { oldValue: value, newValue: undefined };
    }
    store.clear();
    if (Object.keys(changes).length > 0) {
      this.notify(changes, area);
    }
  }

  getBytesInUse(extensionId: string, area: StorageAreaType, keys?: string | string[]): number {
    const store = this.getArea(extensionId, area);
    const targetKeys = keys === undefined
      ? [...store.keys()]
      : Array.isArray(keys) ? keys : [keys];
    let bytes = 0;
    for (const k of targetKeys) {
      const val = store.get(k);
      if (val !== undefined) {
        bytes += new Blob([JSON.stringify({ [k]: val })]).size;
      }
    }
    return bytes;
  }

  setManaged(extensionId: string, items: Record<string, unknown>): void {
    const store = this.getArea(extensionId, 'managed');
    for (const [key, value] of Object.entries(items)) {
      store.set(key, value);
    }
  }

  getQuota(area: StorageAreaType): { maxBytes: number; maxItems: number } {
    switch (area) {
      case 'local': return { maxBytes: 10 * 1024 * 1024, maxItems: Number.MAX_SAFE_INTEGER };
      case 'sync': return { maxBytes: 1024 * 1024, maxItems: 512 };
      case 'managed': return { maxBytes: Number.MAX_SAFE_INTEGER, maxItems: Number.MAX_SAFE_INTEGER };
      case 'session': return { maxBytes: 10 * 1024 * 1024, maxItems: Number.MAX_SAFE_INTEGER };
    }
  }

  onChanged(handler: StorageEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  clearAll(): void {
    this.local.clear();
    this.sync.clear();
    this.managed.clear();
    this.session.clear();
  }

  dispose(): void {
    this.clearAll();
    this.handlers.clear();
  }

  private notify(changes: Record<string, StorageChange>, areaName: string): void {
    for (const h of this.handlers) {
      try { h(changes, areaName); } catch { }
    }
  }
}
