import type { IDisposable } from '../../app/dependency-container';

type CertificateState = 'trusted' | 'self-signed' | 'expired' | 'revoked' | 'invalid' | 'unknown';

interface CertificateInfo {
  readonly subject: string;
  readonly issuer: string;
  readonly serialNumber: string;
  readonly validFrom: Date;
  readonly validTo: Date;
  readonly fingerprint: string;
  readonly keySize: number;
  readonly algorithm: string;
  readonly subjectAltNames: readonly string[];
}

interface CertificateValidationResult {
  readonly state: CertificateState;
  readonly certificate: CertificateInfo | null;
  readonly isSecure: boolean;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

interface ValidationOptions {
  readonly allowSelfSigned: boolean;
  readonly allowExpired: boolean;
  readonly allowRevoked: boolean;
  readonly minKeySize: number;
}

const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
  allowSelfSigned: false,
  allowExpired: false,
  allowRevoked: false,
  minKeySize: 2048,
};

interface ICertificateValidator extends IDisposable {
  validate(certificate: CertificateInfo): CertificateValidationResult;
  isHostSecure(hostname: string): boolean;
  getWarningsForHost(hostname: string): readonly string[];
  updateOptions(options: Partial<ValidationOptions>): void;
  getOptions(): ValidationOptions;
}

class CertificateValidator implements ICertificateValidator {
  private options: ValidationOptions;

  constructor(options?: Partial<ValidationOptions>) {
    this.options = { ...DEFAULT_VALIDATION_OPTIONS, ...options };
  }

  validate(certificate: CertificateInfo): CertificateValidationResult {
    const warnings: string[] = [];
    const errors: string[] = [];
    const now = new Date();

    let state: CertificateState = 'trusted';

    if (this.isSelfSigned(certificate)) {
      state = 'self-signed';
      if (!this.options.allowSelfSigned) {
        errors.push('Certificate is self-signed');
      } else {
        warnings.push('Certificate is self-signed');
      }
    }

    if (certificate.validTo < now) {
      state = 'expired';
      if (!this.options.allowExpired) {
        errors.push(`Certificate expired on ${certificate.validTo.toISOString()}`);
      } else {
        warnings.push(`Certificate expired on ${certificate.validTo.toISOString()}`);
      }
    }

    if (certificate.validFrom > now) {
      state = 'invalid';
      errors.push(`Certificate is not yet valid (valid from ${certificate.validFrom.toISOString()})`);
    }

    if (certificate.keySize < this.options.minKeySize) {
      warnings.push(
        `Key size ${certificate.keySize} is below minimum ${this.options.minKeySize}`,
      );
    }

    return {
      state,
      certificate,
      isSecure: state === 'trusted' && errors.length === 0,
      warnings,
      errors,
    };
  }

  isHostSecure(hostname: string): boolean {
    return hostname === 'localhost' ||
           hostname.endsWith('.local') ||
           /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
           hostname === '::1';
  }

  getWarningsForHost(hostname: string): readonly string[] {
    const warnings: string[] = [];
    if (!this.isHostSecure(hostname)) {
      warnings.push(`Connection to "${hostname}" is not secure`);
    }
    return warnings;
  }

  updateOptions(options: Partial<ValidationOptions>): void {
    this.options = { ...this.options, ...options };
  }

  getOptions(): ValidationOptions {
    return { ...this.options };
  }

  private isSelfSigned(cert: CertificateInfo): boolean {
    return cert.subject === cert.issuer;
  }

  dispose(): void {
    this.options = { ...DEFAULT_VALIDATION_OPTIONS };
  }
}

export { CertificateValidator, DEFAULT_VALIDATION_OPTIONS };
export type { ICertificateValidator, CertificateInfo, CertificateValidationResult, CertificateState, ValidationOptions };
