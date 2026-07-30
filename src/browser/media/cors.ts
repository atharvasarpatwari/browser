import type { IDisposable } from '../../app/dependency-container';
import { CorsEngine, CorsMode, CorsCredentials, CorsRequestDecision, CorsResponseDecision, CorsBlockedError, CorsViolationError, CorsPreflightError } from '../security/cors';
import type { ICorsEngine, CorsRequest, CorsPreCheck, CorsPostCheck, PreflightCacheEntry } from '../security/cors';
import type { IRequestManager, HttpResponseSpec } from '../networking/request-manager';

interface ICorsService extends IDisposable {
  checkRequest(request: CorsRequest): CorsPreCheck;
  checkResponse(request: CorsRequest, response: HttpResponseSpec): CorsPostCheck;
  performPreflight(request: CorsRequest, requestManager: IRequestManager, signal?: AbortSignal): Promise<PreflightCacheEntry>;
  hasCachedPreflight(request: CorsRequest): boolean;
  evictPreflight(origin: string): void;
  clearPreflightCache(): void;
  preflightCacheSize(): number;
  onEvent(handler: CorsServiceEventHandler): () => void;
}

type CorsServiceEventKind = 'request-check' | 'response-check' | 'preflight' | 'cache-evict' | 'block';
type CorsServiceEventHandler = (event: CorsServiceEvent) => void;

interface CorsServiceEvent {
  readonly kind: CorsServiceEventKind;
  readonly data?: Record<string, unknown>;
}

class CorsService implements ICorsService {
  private _engine: CorsEngine;
  private _handlers = new Set<CorsServiceEventHandler>();

  constructor() {
    this._engine = new CorsEngine();
  }

  checkRequest(request: CorsRequest): CorsPreCheck {
    try {
      const result = this._engine.checkRequest(request);
      this.emit({ kind: 'request-check', data: { url: request.url, decision: result.decision } });
      return result;
    } catch (e) {
      if (e instanceof CorsBlockedError) {
        this.emit({ kind: 'block', data: { url: request.url, reason: e.message } });
      }
      throw e;
    }
  }

  checkResponse(request: CorsRequest, response: HttpResponseSpec): CorsPostCheck {
    try {
      const result = this._engine.checkResponse(request, response);
      this.emit({ kind: 'response-check', data: { url: request.url, decision: result.decision } });
      return result;
    } catch (e) {
      if (e instanceof CorsViolationError) {
        this.emit({ kind: 'block', data: { url: request.url, reason: e.message } });
      }
      throw e;
    }
  }

  async performPreflight(request: CorsRequest, requestManager: IRequestManager, signal?: AbortSignal): Promise<PreflightCacheEntry> {
    const result = await this._engine.performPreflight(request, requestManager, signal);
    this.emit({ kind: 'preflight', data: { url: request.url } });
    return result;
  }

  hasCachedPreflight(request: CorsRequest): boolean {
    return this._engine.hasCachedPreflight(request);
  }

  evictPreflight(origin: string): void {
    this._engine.evictPreflight(origin);
    this.emit({ kind: 'cache-evict', data: { origin } });
  }

  clearPreflightCache(): void {
    this._engine.clearPreflightCache();
  }

  preflightCacheSize(): number {
    return this._engine.preflightCacheSize();
  }

  onEvent(handler: CorsServiceEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CorsServiceEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._engine.clearPreflightCache();
  }
}

export { CorsService, CorsMode, CorsCredentials, CorsRequestDecision, CorsResponseDecision, CorsBlockedError, CorsViolationError, CorsPreflightError };
export type { ICorsService, CorsServiceEvent, CorsServiceEventKind, CorsServiceEventHandler, CorsRequest, CorsPreCheck, CorsPostCheck, PreflightCacheEntry };
