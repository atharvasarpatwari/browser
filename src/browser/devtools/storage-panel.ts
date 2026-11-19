export interface StorageEntry {
  key: string;
  value: string;
  size: number;
}

export interface StorageOrigin {
  origin: string;
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
  cookies: StorageEntry[];
  databases: IDBDatabaseInfo[];
}

export interface IDBDatabaseInfo {
  name: string;
  version: number;
  objectStores: string[];
}

export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'strict' | 'lax' | 'none';
}

export type StorageEventType =
  | 'originAdded' | 'originRemoved'
  | 'entryUpdated' | 'entryDeleted'
  | 'cleared';

export interface StorageEvent {
  kind: StorageEventType;
  origin?: string;
  store?: 'localStorage' | 'sessionStorage' | 'cookies' | 'indexedDB';
  entry?: StorageEntry;
}

export type StorageEventHandler = (event: StorageEvent) => void;

export class StorageInspector {
  private origins = new Map<string, StorageOrigin>();
  private handlers = new Set<StorageEventHandler>();

  addOrigin(origin: string): StorageOrigin {
    const existing = this.origins.get(origin);
    if (existing) return existing;
    const data: StorageOrigin = {
      origin,
      localStorage: [],
      sessionStorage: [],
      cookies: [],
      databases: [],
    };
    this.origins.set(origin, data);
    this.emit({ kind: 'originAdded', origin });
    return data;
  }

  removeOrigin(origin: string): void {
    if (!this.origins.has(origin)) return;
    this.origins.delete(origin);
    this.emit({ kind: 'originRemoved', origin });
  }

  getOrigins(): StorageOrigin[] { return [...this.origins.values()]; }

  getOrigin(origin: string): StorageOrigin | undefined { return this.origins.get(origin); }

  setLocalStorageItem(origin: string, key: string, value: string): void {
    const data = this.addOrigin(origin);
    const existing = data.localStorage.find(e => e.key === key);
    if (existing) {
      existing.value = value;
      existing.size = key.length + value.length;
    } else {
      data.localStorage.push({ key, value, size: key.length + value.length });
    }
    this.emit({ kind: 'entryUpdated', origin, store: 'localStorage', entry: { key, value, size: key.length + value.length } });
  }

  removeLocalStorageItem(origin: string, key: string): void {
    const data = this.origins.get(origin);
    if (!data) return;
    data.localStorage = data.localStorage.filter(e => e.key !== key);
    this.emit({ kind: 'entryDeleted', origin, store: 'localStorage' });
  }

  setSessionStorageItem(origin: string, key: string, value: string): void {
    const data = this.addOrigin(origin);
    const existing = data.sessionStorage.find(e => e.key === key);
    if (existing) {
      existing.value = value;
      existing.size = key.length + value.length;
    } else {
      data.sessionStorage.push({ key, value, size: key.length + value.length });
    }
    this.emit({ kind: 'entryUpdated', origin, store: 'sessionStorage', entry: { key, value, size: key.length + value.length } });
  }

  removeSessionStorageItem(origin: string, key: string): void {
    const data = this.origins.get(origin);
    if (!data) return;
    data.sessionStorage = data.sessionStorage.filter(e => e.key !== key);
    this.emit({ kind: 'entryDeleted', origin, store: 'sessionStorage' });
  }

  addCookie(origin: string, cookie: CookieEntry): void {
    const data = this.addOrigin(origin);
    data.cookies.push({ key: cookie.name, value: cookie.value, size: cookie.name.length + cookie.value.length });
    this.emit({ kind: 'entryUpdated', origin, store: 'cookies' });
  }

  removeCookie(origin: string, name: string): void {
    const data = this.origins.get(origin);
    if (!data) return;
    data.cookies = data.cookies.filter(e => e.key !== name);
    this.emit({ kind: 'entryDeleted', origin, store: 'cookies' });
  }

  addDatabase(origin: string, info: IDBDatabaseInfo): void {
    const data = this.addOrigin(origin);
    const existing = data.databases.find(d => d.name === info.name);
    if (existing) {
      existing.version = info.version;
      existing.objectStores = info.objectStores;
    } else {
      data.databases.push(info);
    }
  }

  clearOrigin(origin: string): void {
    const data = this.origins.get(origin);
    if (!data) return;
    data.localStorage = [];
    data.sessionStorage = [];
    data.cookies = [];
    data.databases = [];
    this.emit({ kind: 'entryDeleted', origin });
  }

  clear(): void {
    this.origins.clear();
    this.emit({ kind: 'cleared' });
  }

  onEvent(handler: StorageEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: StorageEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
