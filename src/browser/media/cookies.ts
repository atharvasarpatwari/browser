import type { IDisposable } from '../../app/dependency-container';
import { InMemoryCookieStore } from '../storage/cookie-store';
import type { ICookieStore, CookieData, CookieQuery } from '../storage/cookie-store';

interface ICookieService extends IDisposable {
  set(cookie: Omit<CookieData, 'creationTime' | 'lastAccessTime'>): Promise<void>;
  get(domain: string, name: string, path?: string): Promise<CookieData | null>;
  getAll(query?: CookieQuery): Promise<readonly CookieData[]>;
  delete(domain: string, name: string, path?: string): Promise<boolean>;
  deleteAll(domain?: string): Promise<number>;
  get count(): number;
  onEvent(handler: CookieEventHandler): () => void;
}

type CookieEventKind = 'set' | 'delete' | 'expired';
type CookieEventHandler = (event: CookieEvent) => void;

interface CookieEvent {
  readonly kind: CookieEventKind;
  readonly data?: Record<string, unknown>;
}

class CookieService implements ICookieService {
  private _store: InMemoryCookieStore;
  private _handlers = new Set<CookieEventHandler>();

  constructor() {
    this._store = new InMemoryCookieStore();
  }

  async set(cookie: Omit<CookieData, 'creationTime' | 'lastAccessTime'>): Promise<void> {
    await this._store.set(cookie);
    this.emit({ kind: 'set', data: { name: cookie.name, domain: cookie.domain } });
  }

  async get(domain: string, name: string, path?: string): Promise<CookieData | null> {
    return this._store.get(domain, name, path);
  }

  async getAll(query?: CookieQuery): Promise<readonly CookieData[]> {
    return this._store.getAll(query);
  }

  async delete(domain: string, name: string, path?: string): Promise<boolean> {
    const result = await this._store.delete(domain, name, path);
    if (result) this.emit({ kind: 'delete', data: { domain, name } });
    return result;
  }

  async deleteAll(domain?: string): Promise<number> {
    const count = await this._store.deleteAll(domain);
    if (count > 0) this.emit({ kind: 'delete', data: { domain } });
    return count;
  }

  get count(): number {
    return this._store.count;
  }

  onEvent(handler: CookieEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CookieEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._store.dispose();
  }
}

export { CookieService };
export type { ICookieService, CookieData, CookieQuery, CookieEvent, CookieEventKind, CookieEventHandler };
