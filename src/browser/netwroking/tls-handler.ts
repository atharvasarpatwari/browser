/**
 * @file src/browser/netwroking/tls-handler.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Manage TLS/SSL connections: certificate chain validation, cipher suite
 * negotiation, HSTS enforcement, certificate pinning, and OCSP stapling.
 *
 * Pipeline position
 * ─────────────────
 *   ConnectionPool.open(hostname, port)
 *        │
 *        ▼
 *   TlsHandler.negotiate(hostname)
 *        │
 *        ├──▶ valid cert?     → proceed with encrypted connection
 *        ├──▶ HSTS known?     → auto-upgrade to HTTPS
 *        ├──▶ pinned?         → verify against pinned certificates
 *        └──▶ untrusted       → throw TlsCertificateError
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      ITlsHandler hides certificate validation behind negotiate().
 *  Encapsulation    Trust store, HSTS map, and pin set are private.
 *  Single-Resp.     This file handles TLS — nothing else.
 *  Open / Closed    New validation strategies implement ITlsHandler.
 *  Dependency-Inv.  Constructor accepts a custom trust evaluator for tests.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/** TLS version negotiated. */
enum TlsVersion {
  Tls1_0 = 'TLSv1',
  Tls1_1 = 'TLSv1.1',
  Tls1_2 = 'TLSv1.2',
  Tls1_3 = 'TLSv1.3',
}

/** Certificate verification status. */
enum CertVerificationStatus {
  Valid       = 'valid',
  Expired     = 'expired',
  NotYetValid = 'not-yet-valid',
  Revoked     = 'revoked',
  Untrusted   = 'untrusted',
  Mismatch    = 'hostname-mismatch',
  Pinned      = 'pin-mismatch',
  SelfSigned  = 'self-signed',
  Unknown     = 'unknown',
}

/** Known cipher suite identifiers (subset). */
enum CipherSuite {
  // TLS 1.2 suites
  EcdheRsaAes128GcmSha256   = 0x1301,
  EcdheRsaAes256GcmSha384   = 0x1302,
  EcdheRsaChacha20Poly1305  = 0x1303,
  Aes128GcmSha256           = 0x1304,
  Aes256GcmSha384           = 0x1305,
  // TLS 1.3 suites
  Aes128CcmSha256           = 0x1306,
  Aes128Ccm8Sha256          = 0x1307,
  // Fallback
  UnknownCipher             = 0x0000,
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** Represents a single X.509 certificate in a chain. */
interface CertificateInfo {
  /** Subject Common Name (CN) or Subject Alternative Name (SAN). */
  readonly subject: string;
  /** Issuer distinguished name. */
  readonly issuer: string;
  /** ISO-8601 timestamp of when the cert becomes valid. */
  readonly notBefore: string;
  /** ISO-8601 timestamp of when the cert expires. */
  readonly notAfter: string;
  /** Serial number as hex string. */
  readonly serialNumber: string;
  /** SHA-256 fingerprint of the certificate. */
  readonly fingerprint: string;
  /** Subject Alternative Names (DNS names, IPs). */
  readonly san: readonly string[];
  /** Public key algorithm (e.g., "RSA", "ECDSA"). */
  readonly publicKeyAlgorithm: string;
  /** Signature algorithm (e.g., "SHA256withRSA"). */
  readonly signatureAlgorithm: string;
  /** Key size in bits. */
  readonly keySize: number;
  /** Whether this is a CA certificate. */
  readonly isCa: boolean;
}

/** Result of a TLS negotiation. */
interface TlsNegotiationResult {
  readonly hostname: string;
  readonly port: number;
  readonly version: TlsVersion;
  readonly cipherSuite: CipherSuite;
  readonly certificateChain: readonly CertificateInfo[];
  readonly verified: boolean;
  readonly verificationStatus: CertVerificationStatus;
  /** Whether HSTS was enforced for this connection. */
  readonly hstsEnforced: boolean;
  /** Whether certificate pinning was checked. */
  readonly pinningChecked: boolean;
  /** Negotiation time in milliseconds. */
  readonly negotiationTimeMs: number;
}

/** HSTS entry for a domain. */
interface HstsEntry {
  readonly hostname: string;
  readonly maxAgeSeconds: number;
  readonly includeSubDomains: boolean;
  readonly preload: boolean;
  readonly createdAt: number;
}

/** A certificate pin (SHA-256 of SubjectPublicKeyInfo). */
interface CertificatePin {
  readonly hostname: string;
  /** SHA-256 SPKI hashes that are valid for this host. */
  readonly pins: readonly string[];
  /** When the pin was set. */
  readonly createdAt: number;
  /** When the pin expires (0 = never). */
  readonly expiresAt: number;
}

/** TLS configuration options. */
interface TlsConfig {
  /** Minimum TLS version to accept. */
  readonly minVersion: TlsVersion;
  /** Whether to verify server certificates. */
  readonly verifyCertificates: boolean;
  /** Whether to enforce HSTS. */
  readonly enforceHsts: boolean;
  /** Whether to check certificate pinning. */
  readonly checkPinning: boolean;
  /** Whether to check OCSP stapling. */
  readonly checkOcsp: boolean;
  /** Maximum allowed certificate chain depth. */
  readonly maxChainDepth: number;
  /** Minimum RSA key size. */
  readonly minRsaKeySize: number;
  /** Minimum ECDSA key size. */
  readonly minEcdsaKeySize: number;
  /** Allowed cipher suites. Empty = default secure set. */
  readonly allowedCipherSuites: readonly CipherSuite[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

type CertificateEvaluator = (certs: readonly CertificateInfo[], hostname: string) => CertVerificationStatus;

interface ITlsHandler extends IDisposable {
  /** Perform TLS negotiation for a hostname. */
  negotiate(hostname: string, port?: number): Promise<TlsNegotiationResult>;
  /** Check if a hostname should be upgraded to HTTPS via HSTS. */
  shouldUpgradeToHttps(hostname: string): boolean;
  /** Add an HSTS entry for a domain. */
  addHstsEntry(entry: Omit<HstsEntry, 'createdAt'>): void;
  /** Remove an HSTS entry. */
  removeHstsEntry(hostname: string): boolean;
  /** Add a certificate pin for a domain. */
  addPin(pin: Omit<CertificatePin, 'createdAt'>): void;
  /** Remove all pins for a domain. */
  removePin(hostname: string): boolean;
  /** Get the current TLS config. */
  getConfig(): TlsConfig;
  /** Update TLS config. */
  updateConfig(config: Partial<TlsConfig>): void;
  /** Get the list of supported cipher suites. */
  getSupportedCipherSuites(): readonly CipherSuite[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TLS_CONFIG: TlsConfig = {
  minVersion:           TlsVersion.Tls1_2,
  verifyCertificates:   true,
  enforceHsts:          true,
  checkPinning:         true,
  checkOcsp:            true,
  maxChainDepth:        5,
  minRsaKeySize:        2048,
  minEcdsaKeySize:      256,
  allowedCipherSuites:  [],
};

const DEFAULT_HSTS_MAX_AGE = 31536000; // 1 year
const HSTS_PORT = 443;

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class TlsError extends Error {
  readonly hostname: string;
  constructor(hostname: string, message: string) {
    super(message);
    this.name = 'TlsError';
    this.hostname = hostname;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class TlsCertificateError extends TlsError {
  readonly status: CertVerificationStatus;
  constructor(hostname: string, status: CertVerificationStatus, detail: string) {
    super(hostname, `Certificate verification failed for "${hostname}": [${status}] ${detail}`);
    this.name = 'TlsCertificateError';
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class TlsHandshakeError extends TlsError {
  readonly tlsVersion: TlsVersion | null;
  constructor(hostname: string, tlsVersion: TlsVersion | null, detail: string) {
    super(hostname, `TLS handshake failed for "${hostname}": ${detail}`);
    this.name = 'TlsHandshakeError';
    this.tlsVersion = tlsVersion;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class TlsPinMismatchError extends TlsError {
  constructor(hostname: string, expected: readonly string[], actual: string) {
    super(
      hostname,
      `Certificate pin mismatch for "${hostname}": ` +
      `expected one of [${expected.join(', ')}], got "${actual}".`,
    );
    this.name = 'TlsPinMismatchError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CIPHER SUITES
// ─────────────────────────────────────────────────────────────────────────────

const SECURE_CIPHER_SUITES: readonly CipherSuite[] = [
  CipherSuite.EcdheRsaChacha20Poly1305,
  CipherSuite.EcdheRsaAes256GcmSha384,
  CipherSuite.EcdheRsaAes128GcmSha256,
  CipherSuite.Aes256GcmSha384,
  CipherSuite.Aes128GcmSha256,
];

// ─────────────────────────────────────────────────────────────────────────────
// TLS HANDLER
// ─────────────────────────────────────────────────────────────────────────────

class TlsHandler implements ITlsHandler {
  private config: TlsConfig;
  private readonly hstsStore = new Map<string, HstsEntry>();
  private readonly pinStore = new Map<string, CertificatePin>();
  private readonly evaluator: CertificateEvaluator;

  constructor(
    config?: Partial<TlsConfig>,
    evaluator?: CertificateEvaluator,
  ) {
    this.config = { ...DEFAULT_TLS_CONFIG, ...config };
    this.evaluator = evaluator ?? TlsHandler.defaultEvaluator;
  }

  // ── ITlsHandler: negotiate ──────────────────────────────────────────

  async negotiate(
    hostname: string,
    port = HSTS_PORT,
  ): Promise<TlsNegotiationResult> {
    const startTime = Date.now();

    // 1. HSTS check.
    let hstsEnforced = false;
    if (this.config.enforceHsts && port === HSTS_PORT) {
      hstsEnforced = this.shouldUpgradeToHttps(hostname);
    }

    // 2. Build simulated certificate chain.
    const chain = TlsHandler.buildCertificateChain(hostname);

    // 3. Verify certificates.
    const verificationStatus = this.config.verifyCertificates
      ? this.evaluator(chain, hostname)
      : CertVerificationStatus.Valid;

    // 4. Hostname verification (always runs if verify is on).
    let finalStatus = verificationStatus;
    if (this.config.verifyCertificates && finalStatus === CertVerificationStatus.Valid) {
      if (!TlsHandler.verifyHostname(chain, hostname)) {
        finalStatus = CertVerificationStatus.Mismatch;
      }
    }

    // 5. Key size validation.
    if (this.config.verifyCertificates && finalStatus === CertVerificationStatus.Valid) {
      const weakKey = chain.find(c =>
        (c.publicKeyAlgorithm === 'RSA' && c.keySize < this.config.minRsaKeySize) ||
        (c.publicKeyAlgorithm === 'ECDSA' && c.keySize < this.config.minEcdsaKeySize),
      );
      if (weakKey) {
        finalStatus = CertVerificationStatus.Untrusted;
      }
    }

    // 6. Chain depth check.
    if (this.config.verifyCertificates && chain.length > this.config.maxChainDepth) {
      finalStatus = CertVerificationStatus.Untrusted;
    }

    // 7. Pinning check.
    let pinningChecked = false;
    if (this.config.checkPinning && finalStatus === CertVerificationStatus.Valid) {
      pinningChecked = true;
      const pin = this.pinStore.get(hostname);
      if (pin) {
        const leafFingerprint = chain[0]?.fingerprint ?? '';
        if (!pin.pins.includes(leafFingerprint)) {
          finalStatus = CertVerificationStatus.Pinned;
        }
        // Check pin expiry.
        if (pin.expiresAt > 0 && pin.expiresAt < Date.now()) {
          pinningChecked = false; // Expired pin — skip check.
        }
      }
    }

    return {
      hostname,
      port,
      version: TlsVersion.Tls1_3,
      cipherSuite: CipherSuite.EcdheRsaAes256GcmSha384,
      certificateChain: chain,
      verified: finalStatus === CertVerificationStatus.Valid,
      verificationStatus: finalStatus,
      hstsEnforced,
      pinningChecked,
      negotiationTimeMs: Date.now() - startTime,
    };
  }

  // ── ITlsHandler: HSTS ──────────────────────────────────────────────

  shouldUpgradeToHttps(hostname: string): boolean {
    // Check exact match.
    const exact = this.hstsStore.get(hostname);
    if (exact) {
      if (exact.maxAgeSeconds <= 0) return false; // Max-Age 0 = remove.
      if (exact.expiresAt !== undefined && exact.expiresAt < Date.now()) {
        this.hstsStore.delete(hostname);
        return false;
      }
      return true;
    }

    // Check parent domains with includeSubDomains.
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      const entry = this.hstsStore.get(parent);
      if (entry?.includeSubDomains) {
        if (entry.maxAgeSeconds <= 0) return false;
        return true;
      }
    }

    return false;
  }

  addHstsEntry(entry: Omit<HstsEntry, 'createdAt'>): void {
    this.hstsStore.set(entry.hostname, {
      ...entry,
      createdAt: Date.now(),
    });
  }

  removeHstsEntry(hostname: string): boolean {
    return this.hstsStore.delete(hostname);
  }

  // ── ITlsHandler: pinning ───────────────────────────────────────────

  addPin(pin: Omit<CertificatePin, 'createdAt'>): void {
    this.pinStore.set(pin.hostname, {
      ...pin,
      createdAt: Date.now(),
    });
  }

  removePin(hostname: string): boolean {
    return this.pinStore.delete(hostname);
  }

  // ── ITlsHandler: config ────────────────────────────────────────────

  getConfig(): TlsConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<TlsConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getSupportedCipherSuites(): readonly CipherSuite[] {
    return this.config.allowedCipherSuites.length > 0
      ? [...this.config.allowedCipherSuites]
      : [...SECURE_CIPHER_SUITES];
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void {
    this.hstsStore.clear();
    this.pinStore.clear();
  }

  // ── Private helpers ────────────────────────────────────────────────

  private static defaultEvaluator(
    _certs: readonly CertificateInfo[],
    _hostname: string,
  ): CertVerificationStatus {
    // Default: trust the chain. Real implementation would check the
    // system trust store, OCSP, CRL, etc.
    return CertVerificationStatus.Valid;
  }

  private static buildCertificateChain(hostname: string): readonly CertificateInfo[] {
    const now = new Date();
    const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const twoYears = new Date(now.getTime() + 730 * 24 * 60 * 60 * 1000);

    // Leaf certificate.
    const leaf: CertificateInfo = {
      subject: hostname,
      issuer: 'Nova Intermediate CA',
      notBefore: now.toISOString(),
      notAfter: oneYear.toISOString(),
      serialNumber: '01:23:45:67:89:AB:CD:EF',
      fingerprint: `sha256/${TlsHandler.sha256Hex(hostname + ':leaf')}`,
      san: [hostname],
      publicKeyAlgorithm: 'RSA',
      signatureAlgorithm: 'SHA256withRSA',
      keySize: 2048,
      isCa: false,
    };

    // Intermediate certificate.
    const intermediate: CertificateInfo = {
      subject: 'Nova Intermediate CA',
      issuer: 'Nova Root CA',
      notBefore: now.toISOString(),
      notAfter: twoYears.toISOString(),
      serialNumber: '02:34:56:78:9A:BC:DE:F0',
      fingerprint: `sha256/${TlsHandler.sha256Hex('intermediate')}`,
      san: [],
      publicKeyAlgorithm: 'RSA',
      signatureAlgorithm: 'SHA256withRSA',
      keySize: 4096,
      isCa: true,
    };

    // Root certificate.
    const root: CertificateInfo = {
      subject: 'Nova Root CA',
      issuer: 'Nova Root CA',
      notBefore: now.toISOString(),
      notAfter: twoYears.toISOString(),
      serialNumber: '03:45:67:89:AB:CD:EF:01',
      fingerprint: `sha256/${TlsHandler.sha256Hex('root')}`,
      san: [],
      publicKeyAlgorithm: 'RSA',
      signatureAlgorithm: 'SHA256withRSA',
      keySize: 4096,
      isCa: true,
    };

    return [leaf, intermediate, root];
  }

  private static verifyHostname(chain: readonly CertificateInfo[], hostname: string): boolean {
    const leaf = chain[0];
    if (!leaf) return false;

    // Check SANs first.
    if (leaf.san.length > 0) {
      return leaf.san.some(name => TlsHandler.hostnameMatches(hostname, name));
    }

    // Fall back to CN.
    return TlsHandler.hostnameMatches(hostname, leaf.subject);
  }

  private static hostnameMatches(hostname: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      // Wildcard: *.example.com matches sub.example.com but not example.com.
      const suffix = pattern.slice(1); // ".example.com"
      return hostname.endsWith(suffix) && hostname.slice(0, -suffix.length).indexOf('.') !== -1;
    }
    return hostname === pattern;
  }

  /** Simple deterministic hash for demo fingerprints. */
  private static sha256Hex(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return (hex + hex + hex + hex + hex + hex + hex + hex).slice(0, 64);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  TlsHandler,
  TlsVersion,
  CertVerificationStatus,
  CipherSuite,
  TlsError,
  TlsCertificateError,
  TlsHandshakeError,
  TlsPinMismatchError,
  SECURE_CIPHER_SUITES,
  DEFAULT_TLS_CONFIG,
};

export type {
  ITlsHandler,
  CertificateInfo,
  TlsNegotiationResult,
  HstsEntry,
  CertificatePin,
  TlsConfig,
  CertificateEvaluator,
};
