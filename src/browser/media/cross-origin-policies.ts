import type { IDisposable } from '../../app/dependency-container';

interface ICrossOriginPoliciesService extends IDisposable {
  parseCoop(header: string | null): CoopValue;
  parseCoep(header: string | null): CoepValue;
  parseCorp(header: string | null): CorpValue;
  evaluateCoop(header: string | null, openerOrigin: string, openedOrigin: string): CoopDecision;
  evaluateCoep(header: string | null): CoepDecision;
  checkCorp(reqOrigin: string, resOrigin: string, resCorp: string | null, requestMode?: CorpRequestMode): CorpDecision;
  checkSubresource(pageOrigin: string, resourceOrigin: string, resourceCorp: string | null, requestMode: CorpRequestMode, _isSameSite: boolean, coep: string | null): CorpDecision;
  getIsolationStatus(coop: string | null, coep: string | null): CrossOriginIsolationStatus;
  getBlockedCount(): number;
  onEvent(handler: CrossOriginPoliciesEventHandler): () => void;
}

type CoopValue = 'unsafe-none' | 'same-origin' | 'same-origin-allow-popups';
type CoepValue = 'unsafe-none' | 'require-corp' | 'credentialless';
type CorpValue = 'same-origin' | 'same-site' | 'cross-origin' | null;
type CoopDecision = 'same-origin-linked' | 'cross-origin-severed' | 'exposed';
type CoepDecision = 'requires-corp' | 'credentialless' | 'none';
type CorpRequestMode = 'cors' | 'no-cors' | 'navigate' | 'websocket';
type CorpDecision = 'allowed' | 'blocked';
type CrossOriginIsolationStatus = 'cross-origin-isolated' | 'needs-coop' | 'needs-coep' | 'not-isolated';
type CrossOriginPoliciesEventKind = 'coop-evaluated' | 'corp-blocked' | 'coep-evaluated' | 'isolation-checked';
type CrossOriginPoliciesEventHandler = (event: CrossOriginPoliciesEvent) => void;

interface CrossOriginPoliciesEvent {
  readonly kind: CrossOriginPoliciesEventKind;
  readonly data?: Record<string, unknown>;
}

function isSameSite(a: string, b: string): boolean {
  try {
    const hostA = new URL(a).hostname.toLowerCase();
    const hostB = new URL(b).hostname.toLowerCase();
    const baseA = hostA.split('.').slice(-2).join('.');
    const baseB = hostB.split('.').slice(-2).join('.');
    return baseA === baseB;
  } catch {
    return false;
  }
}

function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

class CrossOriginPoliciesService implements ICrossOriginPoliciesService {
  private _blockedCount = 0;
  private _handlers = new Set<CrossOriginPoliciesEventHandler>();

  parseCoop(header: string | null): CoopValue {
    if (!header) return 'unsafe-none';
    const value = header.trim().toLowerCase();
    if (value === 'same-origin') return 'same-origin';
    if (value === 'same-origin-allow-popups') return 'same-origin-allow-popups';
    return 'unsafe-none';
  }

  parseCoep(header: string | null): CoepValue {
    if (!header) return 'unsafe-none';
    const value = header.trim().toLowerCase();
    if (value === 'require-corp') return 'require-corp';
    if (value === 'credentialless') return 'credentialless';
    return 'unsafe-none';
  }

  parseCorp(header: string | null): CorpValue {
    if (!header) return null;
    const value = header.trim().toLowerCase();
    if (value === 'same-origin') return 'same-origin';
    if (value === 'same-site') return 'same-site';
    if (value === 'cross-origin') return 'cross-origin';
    return null;
  }

  evaluateCoop(header: string | null, openerOrigin: string, openedOrigin: string): CoopDecision {
    const coop = this.parseCoop(header);

    if (coop === 'unsafe-none') {
      this.emit({ kind: 'coop-evaluated', data: { coop, decision: 'exposed' } });
      return 'exposed';
    }

    const sameOrigin = isSameOrigin(openerOrigin, openedOrigin);
    if (coop === 'same-origin' && !sameOrigin) {
      this.emit({ kind: 'coop-evaluated', data: { coop, decision: 'cross-origin-severed' } });
      return 'cross-origin-severed';
    }

    if (coop === 'same-origin-allow-popups' && !sameOrigin) {
      this.emit({ kind: 'coop-evaluated', data: { coop, decision: 'exposed', reason: 'allow-popups' } });
      return 'exposed';
    }

    this.emit({ kind: 'coop-evaluated', data: { coop, decision: 'same-origin-linked' } });
    return 'same-origin-linked';
  }

  evaluateCoep(header: string | null): CoepDecision {
    const coep = this.parseCoep(header);
    const decision: CoepDecision = coep === 'require-corp' ? 'requires-corp' : coep === 'credentialless' ? 'credentialless' : 'none';
    this.emit({ kind: 'coep-evaluated', data: { coep, decision } });
    return decision;
  }

  checkCorp(reqOrigin: string, resOrigin: string, resCorp: string | null, requestMode: CorpRequestMode = 'no-cors'): CorpDecision {
    const corp = this.parseCorp(resCorp);

    if (requestMode === 'navigate' || requestMode === 'websocket' || corp === 'cross-origin' || corp === null) {
      return 'allowed';
    }

    if (corp === 'same-origin') {
      if (isSameOrigin(reqOrigin, resOrigin)) return 'allowed';
      this._blockedCount++;
      this.emit({ kind: 'corp-blocked', data: { reqOrigin, resOrigin, corp, reason: 'same-origin' } });
      return 'blocked';
    }

    if (corp === 'same-site') {
      if (isSameSite(reqOrigin, resOrigin)) return 'allowed';
      this._blockedCount++;
      this.emit({ kind: 'corp-blocked', data: { reqOrigin, resOrigin, corp, reason: 'same-site' } });
      return 'blocked';
    }
    return 'allowed';
  }

  checkSubresource(pageOrigin: string, resourceOrigin: string, resourceCorp: string | null, requestMode: CorpRequestMode, _isSameSite: boolean, coep: string | null): CorpDecision {
    const coepValue = this.parseCoep(coep);

    if (coepValue === 'unsafe-none' || requestMode === 'cors') {
      return 'allowed';
    }

    if (coepValue === 'credentialless') {
      if (isSameOrigin(pageOrigin, resourceOrigin)) return 'allowed';
      if (resourceCorp === 'cross-origin') return 'allowed';
      this._blockedCount++;
      this.emit({ kind: 'corp-blocked', data: { pageOrigin, resourceOrigin, reason: 'credentialless' } });
      return 'blocked';
    }

    if (coepValue === 'require-corp') {
      const corpDecision = this.checkCorp(pageOrigin, resourceOrigin, resourceCorp, requestMode);
      if (corpDecision === 'blocked') {
        this.emit({ kind: 'corp-blocked', data: { pageOrigin, resourceOrigin, reason: 'require-corp' } });
      }
      return corpDecision;
    }

    return 'allowed';
  }

  getIsolationStatus(coop: string | null, coep: string | null): CrossOriginIsolationStatus {
    const coopValue = this.parseCoop(coop);
    const coepValue = this.parseCoep(coep);

    const coopOk = coopValue === 'same-origin';
    const coepOk = coepValue === 'require-corp';

    let status: CrossOriginIsolationStatus;
    if (coopOk && coepOk) status = 'cross-origin-isolated';
    else if (!coopOk && !coepOk) status = 'not-isolated';
    else if (!coopOk) status = 'needs-coop';
    else status = 'needs-coep';

    this.emit({ kind: 'isolation-checked', data: { coop, coep, status } });
    return status;
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: CrossOriginPoliciesEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CrossOriginPoliciesEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._blockedCount = 0;
  }
}

export { CrossOriginPoliciesService, isSameOrigin, isSameSite };
export type { ICrossOriginPoliciesService, CoopValue, CoepValue, CorpValue, CoopDecision, CoepDecision, CorpRequestMode, CorpDecision, CrossOriginIsolationStatus, CrossOriginPoliciesEvent, CrossOriginPoliciesEventKind, CrossOriginPoliciesEventHandler };
