import type { IDisposable } from '../../app/dependency-container';

interface IReferrerPolicyService extends IDisposable {
  parsePolicy(header: string | null): ReferrerPolicyValue;
  computeReferrer(policy: ReferrerPolicyValue, sourceUrl: string, targetUrl: string): string | null;
  getReferrer(policy: ReferrerPolicyValue, sourceUrl: string, targetUrl: string): string | null;
  setDefaultPolicy(policy: ReferrerPolicyValue): void;
  getDefaultPolicy(): ReferrerPolicyValue;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  getReferrerCount(): number;
  getTruncatedCount(): number;
  onEvent(handler: ReferrerPolicyEventHandler): () => void;
}

type ReferrerPolicyValue =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

type ReferrerPolicyEventKind = 'referrer-computed' | 'referrer-stripped' | 'referrer-blocked' | 'policy-changed';
type ReferrerPolicyEventHandler = (event: ReferrerPolicyEvent) => void;

interface ReferrerPolicyEvent {
  readonly kind: ReferrerPolicyEventKind;
  readonly data?: Record<string, unknown>;
}

const VALID_POLICIES: ReadonlySet<string> = new Set([
  '', 'no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
  'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
]);

class ReferrerPolicyService implements IReferrerPolicyService {
  private _defaultPolicy: ReferrerPolicyValue = 'strict-origin-when-cross-origin';
  private _enabled = true;
  private _referrerCount = 0;
  private _truncatedCount = 0;
  private _handlers = new Set<ReferrerPolicyEventHandler>();

  parsePolicy(header: string | null): ReferrerPolicyValue {
    if (!header) return this._defaultPolicy;
    const tokens = header.split(',').map((t) => t.trim().toLowerCase());
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (VALID_POLICIES.has(tokens[i]) && tokens[i] !== '') return tokens[i] as ReferrerPolicyValue;
    }
    return this._defaultPolicy;
  }

  computeReferrer(policy: ReferrerPolicyValue, sourceUrl: string, targetUrl: string): string | null {
    let source: URL;
    let target: URL;
    try {
      source = new URL(sourceUrl);
      target = new URL(targetUrl);
    } catch {
      return null;
    }

    if (!this._enabled) return null;

    this._referrerCount++;
    const sourceOrigin = source.origin;
    const targetOrigin = target.origin;
    const sameOrigin = sourceOrigin === targetOrigin;
    const isDowngrade = this.isDowngrade(source, target);

    switch (policy) {
      case 'no-referrer':
        this.emit({ kind: 'referrer-blocked', data: { sourceUrl, targetUrl, policy } });
        return null;

      case 'unsafe-url':
        return source.href;

      case 'origin':
        return sourceOrigin;

      case 'origin-when-cross-origin':
        return sameOrigin ? source.href : sourceOrigin;

      case 'same-origin':
        if (sameOrigin) return source.href;
        this._truncatedCount++;
        this.emit({ kind: 'referrer-blocked', data: { sourceUrl, targetUrl, policy, reason: 'cross-origin' } });
        return null;

      case 'no-referrer-when-downgrade':
        if (isDowngrade) return null;
        return source.href;

      case 'strict-origin':
        if (isDowngrade) return null;
        return sourceOrigin;

      case 'strict-origin-when-cross-origin':
        if (sameOrigin) return source.href;
        if (isDowngrade) return null;
        this._truncatedCount++;
        this.emit({ kind: 'referrer-stripped', data: { sourceUrl, targetUrl, policy, value: sourceOrigin } });
        return sourceOrigin;

      default:
        return source.href;
    }
  }

  getReferrer(policy: ReferrerPolicyValue, sourceUrl: string, targetUrl: string): string | null {
    return this.computeReferrer(policy, sourceUrl, targetUrl);
  }

  setDefaultPolicy(policy: ReferrerPolicyValue): void {
    this._defaultPolicy = policy;
    this.emit({ kind: 'policy-changed', data: { policy } });
  }

  getDefaultPolicy(): ReferrerPolicyValue {
    return this._defaultPolicy;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  getReferrerCount(): number {
    return this._referrerCount;
  }

  getTruncatedCount(): number {
    return this._truncatedCount;
  }

  onEvent(handler: ReferrerPolicyEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: ReferrerPolicyEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._referrerCount = 0;
    this._truncatedCount = 0;
  }

  private isDowngrade(source: URL, target: URL): boolean {
    const secureSource = source.protocol === 'https:' || source.protocol === 'wss:';
    const secureTarget = target.protocol === 'https:' || target.protocol === 'wss:';
    return secureSource && !secureTarget;
  }
}

export { ReferrerPolicyService, VALID_POLICIES };
export type { IReferrerPolicyService, ReferrerPolicyValue, ReferrerPolicyEvent, ReferrerPolicyEventKind, ReferrerPolicyEventHandler };
