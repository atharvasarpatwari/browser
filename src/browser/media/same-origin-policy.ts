import type { IDisposable } from '../../app/dependency-container';
import { isSameOrigin, isSameSite, isOpaqueOrigin, parseOrigin, getEffectiveOrigin, getOpaqueOrigin, OPAQUE_ORIGIN } from '../security/origin-service';

interface ISameOriginPolicy extends IDisposable {
  isSameOrigin(a: string, b: string): boolean;
  isSameSite(a: string, b: string): boolean;
  isOpaqueOrigin(origin: string): boolean;
  parseOrigin(url: string, referrerOrigin?: string): string;
  getEffectiveOrigin(url: string, referrerOrigin?: string, sandboxFlags?: Set<string>): string;
  getOpaqueOrigin(): string;
  checkAccess(targetOrigin: string, sourceOrigin: string, resourceType: SOPResourceType): SOPAccessResult;
  onEvent(handler: SOPEventHandler): () => void;
}

type SOPResourceType = 'script' | 'style' | 'fetch' | 'image' | 'media' | 'font' | 'frame' | 'websocket' | 'worker';
type SOPAccessResult = 'allowed' | 'blocked';
type SOPEventKind = 'block' | 'allow';
type SOPEventHandler = (event: SOPEvent) => void;

interface SOPEvent {
  readonly kind: SOPEventKind;
  readonly data?: Record<string, unknown>;
}

class SameOriginPolicy implements ISameOriginPolicy {
  private _handlers = new Set<SOPEventHandler>();

  isSameOrigin(a: string, b: string): boolean {
    return isSameOrigin(a, b);
  }

  isSameSite(a: string, b: string): boolean {
    return isSameSite(a, b);
  }

  isOpaqueOrigin(origin: string): boolean {
    return isOpaqueOrigin(origin);
  }

  parseOrigin(url: string, referrerOrigin?: string): string {
    return parseOrigin(url, referrerOrigin);
  }

  getEffectiveOrigin(url: string, referrerOrigin?: string, sandboxFlags?: Set<string>): string {
    return getEffectiveOrigin(url, referrerOrigin, sandboxFlags);
  }

  getOpaqueOrigin(): string {
    return getOpaqueOrigin();
  }

  checkAccess(targetOrigin: string, sourceOrigin: string, _resourceType: SOPResourceType): SOPAccessResult {
    const same = isSameOrigin(targetOrigin, sourceOrigin);
    if (same) {
      this.emit({ kind: 'allow', data: { targetOrigin, sourceOrigin } });
      return 'allowed';
    }
    this.emit({ kind: 'block', data: { targetOrigin, sourceOrigin } });
    return 'blocked';
  }

  onEvent(handler: SOPEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: SOPEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { SameOriginPolicy, OPAQUE_ORIGIN };
export type { ISameOriginPolicy, SOPResourceType, SOPAccessResult, SOPEvent, SOPEventKind, SOPEventHandler };
