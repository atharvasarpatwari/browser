import type { IDisposable } from '../../app/dependency-container';

interface ICacheStorageService extends IDisposable {
  open(cacheName: string): Promise<CacheFacade>;
  has(cacheName: string): Promise<boolean>;
  delete(cacheName: string): Promise<boolean>;
  keys(): Promise<string[]>;
  match(request: string | Request, options?: CacheQueryOptions): Promise<Response | undefined>;
  onEvent(handler: CacheStorageEventHandler): () => void;
}

interface CacheQueryOptions {
  ignoreSearch?: boolean;
  ignoreMethod?: boolean;
  ignoreVary?: boolean;
  cacheName?: string;
}

type CacheStorageEventKind = 'cache-created' | 'cache-deleted' | 'match' | 'put' | 'delete-entry';
type CacheStorageEventHandler = (event: CacheStorageEvent) => void;

interface CacheStorageEvent {
  readonly kind: CacheStorageEventKind;
  readonly data?: Record<string, unknown>;
}

interface CacheEntry {
  readonly request: Request;
  readonly response: Response;
  readonly time: number;
}

class CacheFacade {
  private _entries: CacheEntry[] = [];

  get entries(): readonly CacheEntry[] {
    return [...this._entries];
  }

  get size(): number {
    return this._entries.length;
  }

  async put(request: Request | string, response: Response): Promise<void> {
    const req = request instanceof Request ? request : new Request(request);
    const entry: CacheEntry = { request: req, response, time: Date.now() };
    const existing = this._entries.findIndex(e => CacheFacade.normalizeUrl(e.request.url) === CacheFacade.normalizeUrl(req.url) && e.request.method === req.method);
    if (existing >= 0) {
      this._entries[existing] = entry;
    } else {
      this._entries.push(entry);
    }
  }

  private static normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.toString();
    } catch {
      return url;
    }
  }

  async match(request: Request | string, options?: CacheQueryOptions): Promise<Response | undefined> {
    const rawUrl = typeof request === 'string' ? request : request.url;
    const url = CacheFacade.normalizeUrl(rawUrl);
    const method = request instanceof Request ? request.method : 'GET';
    for (const entry of this._entries) {
      let matchUrl = CacheFacade.normalizeUrl(entry.request.url) === url;
      if (options?.ignoreSearch) {
        matchUrl = entry.request.url.split('?')[0] === rawUrl.split('?')[0];
      }
      const matchMethod = options?.ignoreMethod || entry.request.method === method;
      if (matchUrl && matchMethod) {
        return entry.response.clone();
      }
    }
    return undefined;
  }

  async matchAll(request?: Request | string, options?: CacheQueryOptions): Promise<Response[]> {
    const rawUrl = request ? (typeof request === 'string' ? request : request.url) : undefined;
    const url = rawUrl ? CacheFacade.normalizeUrl(rawUrl) : undefined;
    const results: Response[] = [];
    for (const entry of this._entries) {
      if (!url || CacheFacade.normalizeUrl(entry.request.url) === url) {
        results.push(entry.response.clone());
      }
    }
    return results;
  }

  async delete(request: Request | string, options?: CacheQueryOptions): Promise<boolean> {
    const rawUrl = typeof request === 'string' ? request : request.url;
    const url = CacheFacade.normalizeUrl(rawUrl);
    const before = this._entries.length;
    this._entries = this._entries.filter(e => CacheFacade.normalizeUrl(e.request.url) !== url);
    return before !== this._entries.length;
  }

  async keys(request?: Request | string, options?: CacheQueryOptions): Promise<Request[]> {
    const rawUrl = request ? (typeof request === 'string' ? request : request.url) : undefined;
    const url = rawUrl ? CacheFacade.normalizeUrl(rawUrl) : undefined;
    if (url) {
      return this._entries.filter(e => CacheFacade.normalizeUrl(e.request.url) === url).map(e => e.request);
    }
    return this._entries.map(e => e.request);
  }

  clear(): void {
    this._entries = [];
  }
}

class CacheStorageService implements ICacheStorageService {
  private _caches = new Map<string, CacheFacade>();
  private _handlers = new Set<CacheStorageEventHandler>();

  async open(cacheName: string): Promise<CacheFacade> {
    let cache = this._caches.get(cacheName);
    if (!cache) {
      cache = new CacheFacade();
      this._caches.set(cacheName, cache);
      this.emit({ kind: 'cache-created', data: { cacheName } });
    }
    return cache;
  }

  async has(cacheName: string): Promise<boolean> {
    return this._caches.has(cacheName);
  }

  async delete(cacheName: string): Promise<boolean> {
    const existed = this._caches.has(cacheName);
    if (existed) {
      this._caches.get(cacheName)?.clear();
      this._caches.delete(cacheName);
      this.emit({ kind: 'cache-deleted', data: { cacheName } });
    }
    return existed;
  }

  async keys(): Promise<string[]> {
    return [...this._caches.keys()];
  }

  async match(request: string | Request, options?: CacheQueryOptions): Promise<Response | undefined> {
    const cacheName = options?.cacheName;
    if (cacheName) {
      const cache = this._caches.get(cacheName);
      if (!cache) return undefined;
      return cache.match(request, options);
    }
    for (const cache of this._caches.values()) {
      const result = await cache.match(request, options);
      if (result) return result;
    }
    return undefined;
  }

  onEvent(handler: CacheStorageEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CacheStorageEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    for (const cache of this._caches.values()) {
      cache.clear();
    }
    this._caches.clear();
  }
}

export { CacheStorageService, CacheFacade };
export type { ICacheStorageService, CacheStorageEvent, CacheStorageEventKind, CacheStorageEventHandler, CacheQueryOptions, CacheEntry };
