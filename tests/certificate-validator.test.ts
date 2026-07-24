import { describe, it, expect, beforeEach } from 'vitest';
import { CertificateValidator, DEFAULT_VALIDATION_OPTIONS } from '../src/browser/security/certificate-validator';
import type { CertificateInfo } from '../src/browser/security/certificate-validator';

function makeCert(overrides: Partial<CertificateInfo> = {}): CertificateInfo {
  return {
    subject: 'CN=example.com',
    issuer: 'CN=Let\'s Encrypt',
    serialNumber: '00:11:22',
    validFrom: new Date('2024-01-01'),
    validTo: new Date('2030-12-31'),
    fingerprint: 'AA:BB:CC',
    keySize: 2048,
    algorithm: 'RSA',
    subjectAltNames: ['example.com', '*.example.com'],
    ...overrides,
  };
}

describe('CertificateValidator', () => {
  let validator: CertificateValidator;

  beforeEach(() => {
    validator = new CertificateValidator();
  });

  // ── validate ────────────────────────────────────────────────────────────────

  describe('validate', () => {
    it('should validate a trusted certificate', () => {
      const result = validator.validate(makeCert());
      expect(result.state).toBe('trusted');
      expect(result.isSecure).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect self-signed certificate', () => {
      const cert = makeCert({ subject: 'CN=self', issuer: 'CN=self' });
      const result = validator.validate(cert);
      expect(result.state).toBe('self-signed');
      expect(result.isSecure).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should allow self-signed when configured', () => {
      const v = new CertificateValidator({ allowSelfSigned: true });
      const cert = makeCert({ subject: 'CN=self', issuer: 'CN=self' });
      const result = v.validate(cert);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should detect expired certificate', () => {
      const cert = makeCert({ validTo: new Date('2020-01-01') });
      const result = validator.validate(cert);
      expect(result.state).toBe('expired');
      expect(result.isSecure).toBe(false);
    });

    it('should allow expired when configured', () => {
      const v = new CertificateValidator({ allowExpired: true });
      const cert = makeCert({ validTo: new Date('2020-01-01') });
      const result = v.validate(cert);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should detect not-yet-valid certificate', () => {
      const cert = makeCert({ validFrom: new Date('2030-01-01') });
      const result = validator.validate(cert);
      expect(result.state).toBe('invalid');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn about small key size', () => {
      const cert = makeCert({ keySize: 1024 });
      const result = validator.validate(cert);
      expect(result.warnings.some(w => w.includes('Key size'))).toBe(true);
    });

    it('should include certificate in result', () => {
      const cert = makeCert();
      const result = validator.validate(cert);
      expect(result.certificate).toBe(cert);
    });
  });

  // ── isHostSecure ────────────────────────────────────────────────────────────

  describe('isHostSecure', () => {
    it('should return true for localhost', () => {
      expect(validator.isHostSecure('localhost')).toBe(true);
    });

    it('should return true for 127.x.x.x', () => {
      expect(validator.isHostSecure('127.0.0.1')).toBe(true);
      expect(validator.isHostSecure('127.255.255.255')).toBe(true);
    });

    it('should return true for ::1', () => {
      expect(validator.isHostSecure('::1')).toBe(true);
    });

    it('should return true for *.local', () => {
      expect(validator.isHostSecure('myhost.local')).toBe(true);
    });

    it('should return false for external hosts', () => {
      expect(validator.isHostSecure('example.com')).toBe(false);
    });
  });

  // ── getWarningsForHost ──────────────────────────────────────────────────────

  describe('getWarningsForHost', () => {
    it('should return warning for non-secure host', () => {
      const warnings = validator.getWarningsForHost('example.com');
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should return empty for secure host', () => {
      const warnings = validator.getWarningsForHost('localhost');
      expect(warnings).toHaveLength(0);
    });
  });

  // ── options ─────────────────────────────────────────────────────────────────

  describe('options', () => {
    it('should use default options', () => {
      const opts = validator.getOptions();
      expect(opts.allowSelfSigned).toBe(false);
      expect(opts.minKeySize).toBe(2048);
    });

    it('should update options', () => {
      validator.updateOptions({ minKeySize: 4096 });
      expect(validator.getOptions().minKeySize).toBe(4096);
    });

    it('getOptions should return copy', () => {
      const opts = validator.getOptions();
      opts.minKeySize = 999;
      expect(validator.getOptions().minKeySize).not.toBe(999);
    });
  });

  // ── dispose ─────────────────────────────────────────────────────────────────

  it('should reset options on dispose', () => {
    validator.updateOptions({ minKeySize: 4096 });
    validator.dispose();
    expect(validator.getOptions().minKeySize).toBe(DEFAULT_VALIDATION_OPTIONS.minKeySize);
  });
});
