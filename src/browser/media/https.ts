import type { IDisposable } from '../../app/dependency-container';

interface IHttpsService extends IDisposable {
  isHttps(url: string): boolean;
  upgradeUrl(url: string): string;
  checkAndUpgrade(url: string): string;
  addHstsHost(host: string, maxAge: number, includeSubDomains: boolean): void;
  isHstsHost(host: string): boolean;
  getRemainingHstsSeconds(host: string): number;
  setEnforceHttps(enforce: boolean): void;
  isEnforceHttps(): boolean;
  onEvent(handler: HttpsEventHandler): () => void;
}

type HttpsEventKind = 'upgrade' | 'blocked' | 'hsts-added' | 'hsts-expired';
type HttpsEventHandler = (event: HttpsEvent) => void;

interface HttpsEvent {
  readonly kind: HttpsEventKind;
  readonly data?: Record<string, unknown>;
}

interface HstsEntry {
  readonly host: string;
  readonly maxAge: number;
  readonly includeSubDomains: boolean;
  readonly createdAt: number;
}

class HttpsService implements IHttpsService {
  private _hstsEntries = new Map<string, HstsEntry>();
  private _enforceHttps = true;
  private _handlers = new Set<HttpsEventHandler>();

  isHttps(url: string): boolean {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return false;
    }
  }

  upgradeUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:') {
        u.protocol = 'https:';
        if (u.port === '80') u.port = '';
        const upgraded = u.toString();
        this.emit({ kind: 'upgrade', data: { from: url, to: upgraded } });
        return upgraded;
      }
      return url;
    } catch {
      return url;
    }
  }

  checkAndUpgrade(url: string): string {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') return url;

      const host = u.hostname.toLowerCase();
      const entry = this._hstsEntries.get(host);
      if (entry) {
        const age = Date.now() - entry.createdAt;
        const remaining = entry.maxAge - Math.floor(age / 1000);
        if (remaining > 0) {
          const upgraded = this.upgradeUrl(url);
          if (upgraded !== url) return upgraded;
        } else {
          this._hstsEntries.delete(host);
          this.emit({ kind: 'hsts-expired', data: { host } });
        }
      }

      if (this._enforceHttps) {
        this.emit({ kind: 'blocked', data: { url } });
        return url;
      }

      return url;
    } catch {
      return url;
    }
  }

  addHstsHost(host: string, maxAge: number, includeSubDomains: boolean): void {
    const lower = host.toLowerCase();
    this._hstsEntries.set(lower, { host: lower, maxAge, includeSubDomains, createdAt: Date.now() });
    this.emit({ kind: 'hsts-added', data: { host: lower, maxAge, includeSubDomains } });
  }

  isHstsHost(host: string): boolean {
    const lower = host.toLowerCase();
    if (this._hstsEntries.has(lower)) return true;
    for (const entry of this._hstsEntries.values()) {
      if (entry.includeSubDomains && lower.endsWith('.' + entry.host)) return true;
    }
    return false;
  }

  getRemainingHstsSeconds(host: string): number {
    const lower = host.toLowerCase();
    const entry = this._hstsEntries.get(lower);
    if (!entry) return 0;
    const elapsed = Math.floor((Date.now() - entry.createdAt) / 1000);
    return Math.max(0, entry.maxAge - elapsed);
  }

  setEnforceHttps(enforce: boolean): void {
    this._enforceHttps = enforce;
  }

  isEnforceHttps(): boolean {
    return this._enforceHttps;
  }

  onEvent(handler: HttpsEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: HttpsEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._hstsEntries.clear();
  }
}

export { HttpsService };
export type { IHttpsService, HttpsEvent, HttpsEventKind, HttpsEventHandler, HstsEntry };
