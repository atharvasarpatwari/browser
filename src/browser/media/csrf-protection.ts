import type { IDisposable } from '../../app/dependency-container';

interface ICsrfProtectionService extends IDisposable {
  generateToken(origin: string): string;
  validateToken(origin: string, token: string): boolean;
  validateRequest(origin: string, method: string, token?: string): CsrfDecision;
  addOriginToken(origin: string): string;
  removeOriginToken(origin: string): void;
  hasOriginToken(origin: string): boolean;
  setCheckOriginHeader(check: boolean): void;
  setCheckSameSite(check: boolean): void;
  getProtectedMethods(): readonly string[];
  addProtectedMethod(method: string): void;
  getBlockedCount(): number;
  onEvent(handler: CsrfEventHandler): () => void;
}

type CsrfDecision = 'allowed' | 'blocked';
type CsrfEventKind = 'token-generated' | 'token-validated' | 'request-allowed' | 'request-blocked' | 'token-revoked';
type CsrfEventHandler = (event: CsrfEvent) => void;

interface CsrfEvent {
  readonly kind: CsrfEventKind;
  readonly data?: Record<string, unknown>;
}

const DEFAULT_PROTECTED_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class CsrfProtectionService implements ICsrfProtectionService {
  private _tokens = new Map<string, string>();
  private _checkOriginHeader = true;
  private _checkSameSite = true;
  private _protectedMethods = new Set(DEFAULT_PROTECTED_METHODS);
  private _blockedCount = 0;
  private _handlers = new Set<CsrfEventHandler>();

  generateToken(origin: string): string {
    const raw = `${origin}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const token = this._hash(raw);
    this.emit({ kind: 'token-generated', data: { origin } });
    return token;
  }

  validateToken(origin: string, token: string): boolean {
    const stored = this._tokens.get(origin);
    const valid = !!stored && stored === token;
    this.emit({ kind: 'token-validated', data: { origin, valid } });
    return valid;
  }

  validateRequest(origin: string, method: string, token?: string): CsrfDecision {
    const upper = method.toUpperCase();

    if (!this._protectedMethods.has(upper)) {
      return 'allowed';
    }

    if (this._checkOriginHeader) {
      if (!origin || origin === 'null') {
        this._blockedCount++;
        this.emit({ kind: 'request-blocked', data: { origin, method, reason: 'missing-origin' } });
        return 'blocked';
      }
    }

    if (token) {
      if (this.validateToken(origin, token)) {
        this.emit({ kind: 'request-allowed', data: { origin, method } });
        return 'allowed';
      }
      this._blockedCount++;
      this.emit({ kind: 'request-blocked', data: { origin, method, reason: 'invalid-token' } });
      return 'blocked';
    }

    if (this._protectedMethods.has(upper)) {
      this._blockedCount++;
      this.emit({ kind: 'request-blocked', data: { origin, method, reason: 'missing-token' } });
      return 'blocked';
    }

    this.emit({ kind: 'request-allowed', data: { origin, method } });
    return 'allowed';
  }

  addOriginToken(origin: string): string {
    const token = this.generateToken(origin);
    this._tokens.set(origin, token);
    return token;
  }

  removeOriginToken(origin: string): void {
    this._tokens.delete(origin);
    this.emit({ kind: 'token-revoked', data: { origin } });
  }

  hasOriginToken(origin: string): boolean {
    return this._tokens.has(origin);
  }

  setCheckOriginHeader(check: boolean): void {
    this._checkOriginHeader = check;
  }

  setCheckSameSite(check: boolean): void {
    this._checkSameSite = check;
  }

  getProtectedMethods(): readonly string[] {
    return [...this._protectedMethods];
  }

  addProtectedMethod(method: string): void {
    this._protectedMethods.add(method.toUpperCase());
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: CsrfEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CsrfEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  private _hash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36) + '_' + input.length.toString(36);
  }

  dispose(): void {
    this._handlers.clear();
    this._tokens.clear();
    this._protectedMethods.clear();
  }
}

export { CsrfProtectionService, DEFAULT_PROTECTED_METHODS };
export type { ICsrfProtectionService, CsrfDecision, CsrfEvent, CsrfEventKind, CsrfEventHandler };
