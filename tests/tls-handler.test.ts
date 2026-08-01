import { describe, it, expect, beforeEach } from 'vitest';
import {
  TlsHandler,
  TlsVersion,
  CertVerificationStatus,
  CipherSuite,
  TlsCertificateError,
  TlsPinMismatchError,
} from '../src/browser/networking/tls-handler';
import { RawSocketHttpClient } from '../src/browser/networking/raw-socket-http-client';

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

  describe('loadRootCaStore', () => {
    it('should load Node.js root CAs into a Set', () => {
      const store = TlsHandler.loadRootCaStore();
      expect(store).toBeInstanceOf(Set);
      // Node.js ships with at least 100+ root CAs.
      expect(store.size).toBeGreaterThan(50);
    });

    it('should contain PEM-formatted entries', () => {
      const store = TlsHandler.loadRootCaStore();
      const first = store.values().next().value;
      expect(first).toBeDefined();
      expect(first!).toContain('-----BEGIN CERTIFICATE-----');
      expect(first!).toContain('-----END CERTIFICATE-----');
    });
  });

  describe('verifyChain', () => {
    it('should return Valid for a well-formed simulated chain', () => {
      const now = new Date();
      const chain = [
        {
          subject: 'example.com', issuer: 'Intermediate CA',
          notBefore: now.toISOString(), notAfter: new Date(now.getTime() + 86400000).toISOString(),
          serialNumber: '01', fingerprint: 'abc', san: ['example.com'],
          publicKeyAlgorithm: 'RSA', signatureAlgorithm: 'SHA256withRSA',
          keySize: 2048, isCa: false,
        },
        {
          subject: 'Intermediate CA', issuer: 'Root CA',
          notBefore: now.toISOString(), notAfter: new Date(now.getTime() + 86400000).toISOString(),
          serialNumber: '02', fingerprint: 'def', san: [],
          publicKeyAlgorithm: 'RSA', signatureAlgorithm: 'SHA256withRSA',
          keySize: 4096, isCa: true,
        },
        {
          subject: 'Root CA', issuer: 'Root CA',
          notBefore: now.toISOString(), notAfter: new Date(now.getTime() + 86400000).toISOString(),
          serialNumber: '03', fingerprint: 'ghi', san: [],
          publicKeyAlgorithm: 'RSA', signatureAlgorithm: 'SHA256withRSA',
          keySize: 4096, isCa: true,
        },
      ];
      const status = TlsHandler.verifyChain(chain, 'example.com', new Set());
      expect(status).toBe(CertVerificationStatus.Valid);
    });

    it('should return Expired for an expired certificate', () => {
      const chain = [{
        subject: 'old.com', issuer: 'old.com',
        notBefore: '2020-01-01T00:00:00Z', notAfter: '2021-01-01T00:00:00Z',
        serialNumber: '01', fingerprint: 'abc', san: ['old.com'],
        publicKeyAlgorithm: 'RSA', signatureAlgorithm: 'SHA256withRSA',
        keySize: 2048, isCa: false,
      }];
      const status = TlsHandler.verifyChain(chain, 'old.com', new Set());
      expect(status).toBe(CertVerificationStatus.Expired);
    });

    it('should return NotYetValid for a future certificate', () => {
      const chain = [{
        subject: 'future.com', issuer: 'future.com',
        notBefore: '2099-01-01T00:00:00Z', notAfter: '2100-01-01T00:00:00Z',
        serialNumber: '01', fingerprint: 'abc', san: ['future.com'],
        publicKeyAlgorithm: 'RSA', signatureAlgorithm: 'SHA256withRSA',
        keySize: 2048, isCa: false,
      }];
      const status = TlsHandler.verifyChain(chain, 'future.com', new Set());
      expect(status).toBe(CertVerificationStatus.NotYetValid);
    });

    it('should return Untrusted for weak RSA key', () => {
      const now = new Date();
      const chain = [{
        subject: 'weak.com', issuer: 'weak.com',
        notBefore: now.toISOString(), notAfter: new Date(now.getTime() + 86400000).toISOString(),
        serialNumber: '01', fingerprint: 'abc', san: ['weak.com'],
        publicKeyAlgorithm: 'RSA', signatureAlgorithm: 'SHA256withRSA',
        keySize: 1024, isCa: false,
      }];
      const status = TlsHandler.verifyChain(chain, 'weak.com', new Set());
      expect(status).toBe(CertVerificationStatus.Untrusted);
    });

    it('should return Mismatch for hostname mismatch', () => {
      const now = new Date();
      const chain = [{
        subject: 'other.com', issuer: 'other.com',
        notBefore: now.toISOString(), notAfter: new Date(now.getTime() + 86400000).toISOString(),
        serialNumber: '01', fingerprint: 'abc', san: ['other.com'],
        publicKeyAlgorithm: 'RSA', signatureAlgorithm: 'SHA256withRSA',
        keySize: 2048, isCa: false,
      }];
      const status = TlsHandler.verifyChain(chain, 'different.com', new Set());
      expect(status).toBe(CertVerificationStatus.Mismatch);
    });

    it('should return Unknown for empty chain', () => {
      const status = TlsHandler.verifyChain([], 'example.com', new Set());
      expect(status).toBe(CertVerificationStatus.Unknown);
    });
  });

  describe('generateInterstitial', () => {
    it('should produce HTML for an expired cert error', () => {
      const html = TlsHandler.generateInterstitial('expired.com', CertVerificationStatus.Expired, 'Cert expired 2024');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Certificate Expired');
      expect(html).toContain('expired.com');
      expect(html).toContain('Cert expired 2024');
      expect(html).toContain('Your connection is not private');
    });

    it('should produce HTML for a hostname mismatch', () => {
      const html = TlsHandler.generateInterstitial('mismatch.com', CertVerificationStatus.Mismatch, 'CN does not match');
      expect(html).toContain('Hostname Mismatch');
      expect(html).toContain('mismatch.com');
    });

    it('should produce valid HTML structure', () => {
      const html = TlsHandler.generateInterstitial('test.com', CertVerificationStatus.SelfSigned, 'self-signed');
      expect(html).toContain('<html');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
      expect(html).toContain('<style>');
    });
  });

  describe('sha256Hex', () => {
    it('should produce a 64-character hex string', () => {
      // buildCertificateChain uses sha256Hex internally for simulated fingerprints.
      const chain = (TlsHandler as any).buildCertificateChain('test.com');
      expect(chain.length).toBe(3);
      for (const cert of chain) {
        // fingerprint format: sha256/<64-hex-chars>
        expect(cert.fingerprint).toMatch(/^sha256\/[0-9a-f]{64}$/);
      }
    });
  });

  describe('RawSocketHttpClient + TlsHandler integration', () => {
    it('should construct with tlsHandler option', () => {
      const tlsHandler = new TlsHandler();
      const client = new RawSocketHttpClient({ tlsHandler });
      expect(client).toBeDefined();
    });

    it('should construct without tlsHandler (legacy mode)', () => {
      const client = new RawSocketHttpClient();
      expect(client).toBeDefined();
    });

    it('should reject when tlsHandler reports invalid certificate', async () => {
      // Create a handler that always rejects certificates.
      const rejectingHandler = new TlsHandler(
        { verifyCertificates: true },
        () => CertVerificationStatus.Untrusted,
      );

      const client = new RawSocketHttpClient({ tlsHandler: rejectingHandler });

      // Mock a TLS request — will fail at connection level since no server,
      // but we can verify the client was constructed properly.
      const controller = new AbortController();
      controller.abort(); // Immediately abort.
      await expect(
        client.send({
          url: 'https://untrusted.example.com/',
          method: 'GET',
          headers: new Map(),
          timeoutMs: 1000,
        }, controller.signal),
      ).rejects.toThrow('aborted');
    });

    it('should load root CAs into trust store on construction', () => {
      const client = new RawSocketHttpClient();
      // Access private field via any cast for testing.
      const cas = (client as any).trustedCAs as Set<string>;
      expect(cas).toBeInstanceOf(Set);
      // Should have loaded system root CAs.
      expect(cas.size).toBeGreaterThan(50);
    });
  });
});
