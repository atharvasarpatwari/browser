import type { IDisposable } from '../../app/dependency-container';

interface ICertificateTransparencyService extends IDisposable {
  setRequiredScts(count: number): void;
  getRequiredScts(): number;
  setRequireCt(enforce: boolean): void;
  isRequireCt(): boolean;
  validateSct(sct: SctEntry): SctValidity;
  countValidScts(scts: readonly SctEntry[]): number;
  checkCertificates(scts: readonly SctEntry[], host?: string): CertificateTransparencyDecision;
  setMaxClockSkewSeconds(seconds: number): void;
  getBlockedCount(): number;
  onEvent(handler: CertificateTransparencyEventHandler): () => void;
}

type SctValidity = 'valid' | 'invalid-log-id' | 'invalid-signature' | 'future-timestamp' | 'expired-timestamp';
type CertificateTransparencyDecision = 'pass' | 'warn' | 'fail';
type CertificateTransparencyEventKind = 'checked' | 'blocked' | 'warned' | 'policy-changed';
type CertificateTransparencyEventHandler = (event: CertificateTransparencyEvent) => void;

interface CertificateTransparencyEvent {
  readonly kind: CertificateTransparencyEventKind;
  readonly data?: Record<string, unknown>;
}

interface SctEntry {
  readonly logId: string;
  readonly timestamp: number;
  readonly signature: string;
}

const DEFAULT_REQUIRED_SCTS = 2;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 3600;
const SCT_MAX_AGE_SECONDS = 120 * 24 * 3600;

class CertificateTransparencyService implements ICertificateTransparencyService {
  private _requiredScts = DEFAULT_REQUIRED_SCTS;
  private _requireCt = true;
  private _maxClockSkewSeconds = DEFAULT_MAX_CLOCK_SKEW_SECONDS;
  private _blockedCount = 0;
  private _handlers = new Set<CertificateTransparencyEventHandler>();

  setRequiredScts(count: number): void {
    this._requiredScts = Math.max(1, Math.floor(count));
    this.emit({ kind: 'policy-changed', data: { requiredScts: this._requiredScts } });
  }

  getRequiredScts(): number {
    return this._requiredScts;
  }

  setRequireCt(enforce: boolean): void {
    this._requireCt = enforce;
    this.emit({ kind: 'policy-changed', data: { requireCt: enforce } });
  }

  isRequireCt(): boolean {
    return this._requireCt;
  }

  validateSct(sct: SctEntry): SctValidity {
    if (!sct.logId || typeof sct.logId !== 'string' || sct.logId.length < 4) return 'invalid-log-id';
    if (!sct.signature || typeof sct.signature !== 'string' || sct.signature.length < 8) return 'invalid-signature';
    if (typeof sct.timestamp !== 'number' || !isFinite(sct.timestamp)) return 'invalid-signature';

    const now = Date.now();
    if (sct.timestamp > now + this._maxClockSkewSeconds * 1000) return 'future-timestamp';
    if (now - sct.timestamp > SCT_MAX_AGE_SECONDS * 1000) return 'expired-timestamp';

    return 'valid';
  }

  countValidScts(scts: readonly SctEntry[]): number {
    let count = 0;
    const seenLogs = new Set<string>();
    for (const sct of scts) {
      if (this.validateSct(sct) === 'valid') {
        if (!seenLogs.has(sct.logId)) {
          seenLogs.add(sct.logId);
          count++;
        }
      }
    }
    return count;
  }

  checkCertificates(scts: readonly SctEntry[], host?: string): CertificateTransparencyDecision {
    const validCount = this.countValidScts(scts ?? []);

    if (!this._requireCt) {
      this.emit({ kind: 'checked', data: { host, validScts: validCount, decision: 'pass', reason: 'disabled' } });
      return 'pass';
    }

    if (validCount >= this._requiredScts) {
      this.emit({ kind: 'checked', data: { host, validScts: validCount, decision: 'pass' } });
      return 'pass';
    }

    if (validCount > 0) {
      this.emit({ kind: 'warned', data: { host, validScts: validCount, required: this._requiredScts } });
      return 'warn';
    }

    this._blockedCount++;
    this.emit({ kind: 'blocked', data: { host, validScts: 0, required: this._requiredScts, reason: 'no-valid-scts' } });
    return 'fail';
  }

  setMaxClockSkewSeconds(seconds: number): void {
    this._maxClockSkewSeconds = Math.max(0, seconds);
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: CertificateTransparencyEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CertificateTransparencyEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._blockedCount = 0;
  }
}

export { CertificateTransparencyService, DEFAULT_REQUIRED_SCTS };
export type { ICertificateTransparencyService, SctEntry, SctValidity, CertificateTransparencyDecision, CertificateTransparencyEvent, CertificateTransparencyEventKind, CertificateTransparencyEventHandler };
