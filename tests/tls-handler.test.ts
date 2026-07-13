import { describe, it, expect, beforeEach } from 'vitest';
import {
  TlsHandler,
  TlsVersion,
  CertVerificationStatus,
  CipherSuite,
  TlsCertificateError,
  TlsPinMismatchError,
} from '../src/browser/netwroking/tls-handler';

describe('TlsHandler', () => {
  let handler: TlsHandler;

  beforeEach(() => {
    handler = new TlsHandler();
  });

  describe('negotiate', () => {
    it('should perform TLS negotiation for a hostname', async () => {
      const result = await handler.negotiate('example.com');
      expect(result.hostname).toBe('example.com');
      expect(result.port).toBe(443);
      expect(result.version).toBe(TlsVersion.Tls1_3);
      expect(result.verified).toBe(true);
      expect(result.verificationStatus).toBe(CertVerificationStatus.Valid);
      expect(result.certificateChain.length).toBe(3); // leaf, intermediate, root
    });

    it('should include certificate chain with correct structure', async () => {
      const result = await handler.negotiate('example.com');
      const leaf = result.certificateChain[0];
      expect(leaf).toBeDefined();
      expect(leaf!.subject).toBe('example.com');
      expect(leaf!.issuer).toBe('Nova Intermediate CA');
      expect(leaf!.isCa).toBe(false);
      expect(leaf!.fingerprint).toContain('sha256/');

      const root = result.certificateChain[2];
      expect(root).toBeDefined();
      expect(root!.subject).toBe('Nova Root CA');
      expect(root!.isCa).toBe(true);
    });

    it('should perform HSTS enforcement', async () => {
      handler.addHstsEntry({
        hostname: 'secure.com',
        maxAgeSeconds: 31536000,
        includeSubDomains: true,
        preload: false,
      });

      const result = await handler.negotiate('secure.com', 443);
      expect(result.hstsEnforced).toBe(true);
    });

    it('should not enforce HSTS for non-443 ports', async () => {
      handler.addHstsEntry({
        hostname: 'secure.com',
        maxAgeSeconds: 31536000,
        includeSubDomains: false,
        preload: false,
      });

      const result = await handler.negotiate('secure.com', 8080);
      expect(result.hstsEnforced).toBe(false);
    });

    it('should check certificate pinning', async () => {
      const tempHandler = new TlsHandler({}, () => CertVerificationStatus.Valid);
      const result = await tempHandler.negotiate('pinned.com');
      expect(result.pinningChecked).toBe(true);
    });
  });

  describe('HSTS', () => {
    it('should detect HSTS for exact hostname', () => {
      handler.addHstsEntry({
        hostname: 'example.com',
        maxAgeSeconds: 31536000,
        includeSubDomains: false,
        preload: false,
      });

      expect(handler.shouldUpgradeToHttps('example.com')).toBe(true);
    });

    it('should detect HSTS for subdomains', () => {
      handler.addHstsEntry({
        hostname: 'example.com',
        maxAgeSeconds: 31536000,
        includeSubDomains: true,
        preload: false,
      });

      expect(handler.shouldUpgradeToHttps('sub.example.com')).toBe(true);
    });

    it('should not match subdomains without includeSubDomains', () => {
      handler.addHstsEntry({
        hostname: 'example.com',
        maxAgeSeconds: 31536000,
        includeSubDomains: false,
        preload: false,
      });

      expect(handler.shouldUpgradeToHttps('sub.example.com')).toBe(false);
    });

    it('should respect max-age=0 to delete', () => {
      handler.addHstsEntry({
        hostname: 'delete.me',
        maxAgeSeconds: 0,
        includeSubDomains: false,
        preload: false,
      });

      expect(handler.shouldUpgradeToHttps('delete.me')).toBe(false);
    });

    it('should remove HSTS entries', () => {
      handler.addHstsEntry({
        hostname: 'removable.com',
        maxAgeSeconds: 31536000,
        includeSubDomains: false,
        preload: false,
      });
      expect(handler.removeHstsEntry('removable.com')).toBe(true);
      expect(handler.shouldUpgradeToHttps('removable.com')).toBe(false);
    });
  });

  describe('certificate pinning', () => {
    it('should add and verify certificate pins', async () => {
      const pinHandler = new TlsHandler({}, () => CertVerificationStatus.Valid);
      // Add a pin that won't match — the default evaluator returns Valid,
      // but the pin check should fail since we don't know the fingerprint.
      pinHandler.addPin({
        hostname: 'pinned.com',
        pins: ['sha256/0000000000000000000000000000000000000000000000000000000000000000'],
        expiresAt: 0,
      });

      const result = await pinHandler.negotiate('pinned.com');
      expect(result.pinningChecked).toBe(true);
      expect(result.verificationStatus).toBe(CertVerificationStatus.Pinned);
      expect(result.verified).toBe(false);
    });

    it('should remove certificate pins', () => {
      handler.addPin({
        hostname: 'removable.com',
        pins: ['sha256/abc'],
        expiresAt: 0,
      });
      expect(handler.removePin('removable.com')).toBe(true);
    });
  });

  describe('config', () => {
    it('should return and update config', () => {
      const config = handler.getConfig();
      expect(config.verifyCertificates).toBe(true);

      handler.updateConfig({ verifyCertificates: false });
      expect(handler.getConfig().verifyCertificates).toBe(false);
    });

    it('should skip verification when disabled', async () => {
      handler.updateConfig({ verifyCertificates: false });
      const result = await handler.negotiate('anything.com');
      expect(result.verified).toBe(true);
      expect(result.verificationStatus).toBe(CertVerificationStatus.Valid);
    });

    it('should return supported cipher suites', () => {
      const suites = handler.getSupportedCipherSuites();
      expect(suites.length).toBeGreaterThan(0);
      expect(suites).toContain(CipherSuite.EcdheRsaAes256GcmSha384);
    });
  });

  describe('errors', () => {
    it('should throw TlsCertificateError', () => {
      const err = new TlsCertificateError('bad.com', CertVerificationStatus.Expired, 'cert expired');
      expect(err.name).toBe('TlsCertificateError');
      expect(err.hostname).toBe('bad.com');
      expect(err.status).toBe(CertVerificationStatus.Expired);
    });

    it('should throw TlsPinMismatchError', () => {
      const err = new TlsPinMismatchError('host.com', ['pin1', 'pin2'], 'actual-pin');
      expect(err.name).toBe('TlsPinMismatchError');
    });
  });

  describe('dispose', () => {
    it('should clear all state', () => {
      handler.addHstsEntry({
        hostname: 'test.com',
        maxAgeSeconds: 31536000,
        includeSubDomains: false,
        preload: false,
      });
      handler.addPin({ hostname: 'test.com', pins: ['p'], expiresAt: 0 });
      handler.dispose();
      expect(handler.shouldUpgradeToHttps('test.com')).toBe(false);
    });
  });
});
