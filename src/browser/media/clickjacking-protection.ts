import type { IDisposable } from '../../app/dependency-container';

interface IClickjackingProtectionService extends IDisposable {
  evaluateResponse(url: string, xFrameOptions: string | null, frameAncestors: string | null, topOrigin: string): ClickjackingDecision;
  setDefaultPolicy(policy: XFrameOptionsPolicy): void;
  getDefaultPolicy(): XFrameOptionsPolicy;
  addAllowedFramedOrigin(origin: string): void;
  removeAllowedFramedOrigin(origin: string): void;
  isOriginAllowedToFrame(origin: string): boolean;
  getBlockedCount(): number;
  onEvent(handler: ClickjackingEventHandler): () => void;
}

type XFrameOptionsPolicy = 'deny' | 'sameorigin' | 'allow-from' | 'disabled';
type ClickjackingDecision = 'allowed' | 'blocked';
type ClickjackingEventKind = 'blocked' | 'allowed' | 'policy-violation';
type ClickjackingEventHandler = (event: ClickjackingEvent) => void;

interface ClickjackingEvent {
  readonly kind: ClickjackingEventKind;
  readonly data?: Record<string, unknown>;
}

class ClickjackingProtectionService implements IClickjackingProtectionService {
  private _defaultPolicy: XFrameOptionsPolicy = 'sameorigin';
  private _allowedFramedOrigins = new Set<string>();
  private _blockedCount = 0;
  private _handlers = new Set<ClickjackingEventHandler>();

  evaluateResponse(url: string, xFrameOptions: string | null, frameAncestors: string | null, topOrigin: string): ClickjackingDecision {
    if (this._defaultPolicy === 'disabled') {
      this.emit({ kind: 'allowed', data: { url } });
      return 'allowed';
    }

    if (xFrameOptions) {
      const lower = xFrameOptions.trim().toLowerCase();
      if (lower === 'deny') {
        this._blockedCount++;
        this.emit({ kind: 'blocked', data: { url, reason: 'X-Frame-Options: DENY' } });
        return 'blocked';
      }
      if (lower === 'sameorigin') {
        try {
          const pageOrigin = new URL(url).origin;
          if (pageOrigin !== topOrigin) {
            this._blockedCount++;
            this.emit({ kind: 'blocked', data: { url, reason: 'X-Frame-Options: SAMEORIGIN mismatch' } });
            return 'blocked';
          }
        } catch {
          this._blockedCount++;
          this.emit({ kind: 'blocked', data: { url, reason: 'X-Frame-Options: SAMEORIGIN invalid URL' } });
          return 'blocked';
        }
      }
    }

    if (frameAncestors) {
      const directives = frameAncestors.split(';').map(d => d.trim()).filter(Boolean);
      for (const directive of directives) {
        const parts = directive.split(/\s+/);
        if (parts[0] !== 'frame-ancestors') continue;
        const allowed = parts.slice(1);
        if (allowed.includes("'none'")) {
          this._blockedCount++;
          this.emit({ kind: 'blocked', data: { url, reason: "CSP frame-ancestors 'none'" } });
          return 'blocked';
        }
        if (allowed.includes("'self'")) {
          try {
            const pageOrigin = new URL(url).origin;
            if (pageOrigin !== topOrigin && !allowed.includes(topOrigin)) {
              this._blockedCount++;
              this.emit({ kind: 'blocked', data: { url, reason: "CSP frame-ancestors 'self' mismatch" } });
              return 'blocked';
            }
          } catch { }
        }
        if (!allowed.includes("'self'") && !allowed.includes("'none'") && !allowed.includes(topOrigin)) {
          this._blockedCount++;
          this.emit({ kind: 'blocked', data: { url, reason: 'CSP frame-ancestors does not include top origin' } });
          return 'blocked';
        }
      }
    }

    if (this._defaultPolicy === 'deny') {
      this._blockedCount++;
      this.emit({ kind: 'blocked', data: { url, reason: 'Default policy: DENY' } });
      return 'blocked';
    }

    if (this._defaultPolicy === 'sameorigin') {
      try {
        const pageOrigin = new URL(url).origin;
        if (pageOrigin !== topOrigin && !this._allowedFramedOrigins.has(pageOrigin)) {
          this._blockedCount++;
          this.emit({ kind: 'blocked', data: { url, reason: 'Default policy: SAMEORIGIN mismatch' } });
          return 'blocked';
        }
      } catch {
        this._blockedCount++;
        this.emit({ kind: 'blocked', data: { url, reason: 'Default policy: invalid URL' } });
        return 'blocked';
      }
    }

    this.emit({ kind: 'allowed', data: { url } });
    return 'allowed';
  }

  setDefaultPolicy(policy: XFrameOptionsPolicy): void {
    this._defaultPolicy = policy;
  }

  getDefaultPolicy(): XFrameOptionsPolicy {
    return this._defaultPolicy;
  }

  addAllowedFramedOrigin(origin: string): void {
    this._allowedFramedOrigins.add(origin);
  }

  removeAllowedFramedOrigin(origin: string): void {
    this._allowedFramedOrigins.delete(origin);
  }

  isOriginAllowedToFrame(origin: string): boolean {
    return this._allowedFramedOrigins.has(origin);
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: ClickjackingEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: ClickjackingEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._allowedFramedOrigins.clear();
    this._blockedCount = 0;
  }
}

export { ClickjackingProtectionService };
export type { IClickjackingProtectionService, XFrameOptionsPolicy, ClickjackingDecision, ClickjackingEvent, ClickjackingEventKind, ClickjackingEventHandler };
