import type { IDisposable } from '../../app/dependency-container';
import { CertificateValidator } from '../security/certificate-validator';
import type { CertificateInfo, CertificateValidationResult, ValidationOptions } from '../security/certificate-validator';

interface ICertificateService extends IDisposable {
  validate(certificate: CertificateInfo): CertificateValidationResult;
  isHostSecure(hostname: string): boolean;
  getWarningsForHost(hostname: string): readonly string[];
  updateOptions(options: Partial<ValidationOptions>): void;
  getOptions(): ValidationOptions;
  addTrustedCertificate(certificate: CertificateInfo): void;
  addHostOverride(hostname: string, state: CertificateOverrideState): void;
  removeHostOverride(hostname: string): void;
  onEvent(handler: CertificateEventHandler): () => void;
}

type CertificateEventKind = 'validation' | 'warning' | 'error' | 'override-added' | 'override-removed';
type CertificateEventHandler = (event: CertificateEvent) => void;
type CertificateOverrideState = 'trusted' | 'self-signed' | 'expired' | 'revoked';

interface CertificateEvent {
  readonly kind: CertificateEventKind;
  readonly data?: Record<string, unknown>;
}

class CertificateService implements ICertificateService {
  private _validator: CertificateValidator;
  private _trustedCerts = new Map<string, CertificateInfo>();
  private _hostOverrides = new Map<string, CertificateOverrideState>();
  private _handlers = new Set<CertificateEventHandler>();

  constructor(options?: Partial<ValidationOptions>) {
    this._validator = new CertificateValidator(options);
  }

  validate(certificate: CertificateInfo): CertificateValidationResult {
    const result = this._validator.validate(certificate);
    if (result.isSecure) {
      this.emit({ kind: 'validation', data: { subject: certificate.subject, state: result.state } });
    } else {
      this.emit({ kind: 'error', data: { subject: certificate.subject, errors: [...result.errors] } });
      for (const w of result.warnings) {
        this.emit({ kind: 'warning', data: { subject: certificate.subject, warning: w } });
      }
    }
    return result;
  }

  isHostSecure(hostname: string): boolean {
    const override = this._hostOverrides.get(hostname.toLowerCase());
    if (override === 'trusted') return true;
    if (override && override !== 'trusted') return false;
    return this._validator.isHostSecure(hostname);
  }

  getWarningsForHost(hostname: string): readonly string[] {
    return this._validator.getWarningsForHost(hostname);
  }

  updateOptions(options: Partial<ValidationOptions>): void {
    this._validator.updateOptions(options);
  }

  getOptions(): ValidationOptions {
    return this._validator.getOptions();
  }

  addTrustedCertificate(certificate: CertificateInfo): void {
    this._trustedCerts.set(certificate.fingerprint, certificate);
  }

  addHostOverride(hostname: string, state: CertificateOverrideState): void {
    this._hostOverrides.set(hostname.toLowerCase(), state);
    this.emit({ kind: 'override-added', data: { hostname, state } });
  }

  removeHostOverride(hostname: string): void {
    this._hostOverrides.delete(hostname.toLowerCase());
    this.emit({ kind: 'override-removed', data: { hostname } });
  }

  onEvent(handler: CertificateEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CertificateEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._trustedCerts.clear();
    this._hostOverrides.clear();
  }
}

export { CertificateService };
export type { ICertificateService, CertificateEvent, CertificateEventKind, CertificateEventHandler, CertificateOverrideState, CertificateInfo, CertificateValidationResult, ValidationOptions };
