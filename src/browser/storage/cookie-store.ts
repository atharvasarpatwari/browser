import type { IDisposable } from '../../app/dependency-container';

interface CookieData {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: 'strict' | 'lax' | 'none';
  readonly expires: number | null;
  readonly creationTime: number;
  readonly lastAccessTime: number;
  readonly hostOnly: boolean;
  readonly session: boolean;
}

interface CookieQuery {
  readonly domain?: string;
  readonly name?: string;
  readonly path?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly session?: boolean;
}

interface ICookieStore extends IDisposable {
  set(cookie: Omit<CookieData, 'creationTime' | 'lastAccessTime'>): Promise<void>;
  get(domain: string, name: string, path?: string): Promise<CookieData | null>;
  getAll(query?: CookieQuery): Promise<readonly CookieData[]>;
  delete(domain: string, name: string, path?: string): Promise<boolean>;
  deleteAll(domain?: string): Promise<number>;
  flush(): Promise<void>;
  readonly count: number;
}

function cookieKey(domain: string, name: string, path: string): string {
  return `${domain}|${name}|${path}`;
}

function matchesDomain(cookie: CookieData, domain: string): boolean {
  if (cookie.hostOnly) return cookie.domain === domain;
  return domain.endsWith(cookie.domain) || cookie.domain === domain;
}

class InMemoryCookieStore implements ICookieStore {
  private readonly cookies = new Map<string, CookieData>();

  async set(raw: Omit<CookieData, 'creationTime' | 'lastAccessTime'>): Promise<void> {
    const key = cookieKey(raw.domain, raw.name, raw.path);
    const now = Date.now();
    const existing = this.cookies.get(key);

    const data: CookieData = {
      ...raw,
      creationTime: existing?.creationTime ?? now,
      lastAccessTime: now,
    };

    this.cookies.set(key, data);
    this.evictExpired();
  }

  async get(domain: string, name: string, path = '/'): Promise<CookieData | null> {
    const key = cookieKey(domain, name, path);
    const cookie = this.cookies.get(key);
    if (!cookie) return null;
    if (cookie.expires !== null && cookie.expires < Date.now()) {
      this.cookies.delete(key);
      return null;
    }
    this.cookies.set(key, { ...cookie, lastAccessTime: Date.now() });
    return this.cookies.get(key)!;
  }

  async getAll(query?: CookieQuery): Promise<readonly CookieData[]> {
    this.evictExpired();
    let results = [...this.cookies.values()];

    if (query) {
      if (query.domain) {
        results = results.filter(c => matchesDomain(c, query.domain!));
      }
      if (query.name) {
        results = results.filter(c => c.name === query.name);
      }
      if (query.path) {
        results = results.filter(c => c.path.startsWith(query.path!));
      }
      if (query.secure !== undefined) {
        results = results.filter(c => c.secure === query.secure);
      }
      if (query.httpOnly !== undefined) {
        results = results.filter(c => c.httpOnly === query.httpOnly);
      }
      if (query.session !== undefined) {
        results = results.filter(c => c.session === query.session);
      }
    }

    return results;
  }

  async delete(domain: string, name: string, path = '/'): Promise<boolean> {
    return this.cookies.delete(cookieKey(domain, name, path));
  }

  async deleteAll(domain?: string): Promise<number> {
    if (!domain) {
      const count = this.cookies.size;
      this.cookies.clear();
      return count;
    }
    let deleted = 0;
    for (const [key, cookie] of this.cookies) {
      if (matchesDomain(cookie, domain)) {
        this.cookies.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async flush(): Promise<void> {
    // In production this would write to disk.
  }

  get count(): number {
    this.evictExpired();
    return this.cookies.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, cookie] of this.cookies) {
      if (cookie.expires !== null && cookie.expires < now) {
        this.cookies.delete(key);
      }
    }
  }

  dispose(): void {
    this.cookies.clear();
  }
}

export { InMemoryCookieStore };
export type { ICookieStore, CookieData, CookieQuery };
