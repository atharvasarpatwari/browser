import { describe, it, expect, beforeEach } from 'vitest';
import { SAML2Provider } from '../src/browser/auth/saml-provider';
import { AuthProtocol, CredentialType } from '../src/browser/auth/auth-provider';
import type { SAMLConfig } from '../src/browser/auth/auth-provider';

const VALID_SAML_CONFIG: SAMLConfig = {
  idpEntityId: 'https://idp.example.com',
  idpSsoUrl: 'https://idp.example.com/sso',
  spEntityId: 'https://myapp.example.com',
  acsUrl: 'https://myapp.example.com/acs',
  wantAssertionsSigned: true,
  signatureAlgorithm: 'SHA-256',
  nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
};

function buildSampleSAMLResponse(overrides: {
  nameId?: string;
  statusCode?: string;
  sessionIndex?: string;
  issuer?: string;
  attributes?: string;
} = {}): string {
  const nameId = overrides.nameId ?? 'user@example.com';
  const statusCode = overrides.statusCode ?? 'urn:oasis:names:tc:SAML:2.0:status:Success';
  const sessionIndex = overrides.sessionIndex ?? '_session_123';
  const issuer = overrides.issuer ?? 'https://idp.example.com';
  const attributes = overrides.attributes ?? `
    <saml:Attribute Name="email">
      <saml:AttributeValue>user@example.com</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="displayName">
      <saml:AttributeValue>Test User</saml:AttributeValue>
    </saml:Attribute>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
  <saml:Issuer>${issuer}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="${statusCode}"/>
  </samlp:Status>
  <saml:Assertion>
    <saml:Subject>
      <saml:NameID Format="${VALID_SAML_CONFIG.nameIdFormat}">${nameId}</saml:NameID>
    </saml:Subject>
    <saml:AuthnStatement AuthnInstant="2024-01-15T10:00:00Z" SessionIndex="${sessionIndex}">
      <saml:AuthnContext>
        <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
      </saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>${attributes}
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;
}

describe('SAML2Provider', () => {
  let provider: SAML2Provider;

  beforeEach(() => {
    provider = new SAML2Provider('test-saml', VALID_SAML_CONFIG);
  });

  describe('basic properties', () => {
    it('should have SAML2 protocol', () => {
      expect(provider.protocol).toBe(AuthProtocol.SAML2);
      expect(provider.name).toBe('test-saml');
    });

    it('should report isConfigured when config is complete', () => {
      expect(provider.isConfigured).toBe(true);
    });

    it('should report not configured when required fields are missing', () => {
      const bad = new SAML2Provider('bad', { ...VALID_SAML_CONFIG, idpSsoUrl: '' });
      expect(bad.isConfigured).toBe(false);
      bad.dispose();
    });
  });

  describe('authenticate (SP-initiated)', () => {
    it('should return a SSO URL with SAMLRequest', () => {
      const url = provider.authenticate() as string;
      expect(url).toContain('https://idp.example.com/sso?');
      expect(url).toContain('SAMLRequest=');
    });

    it('should produce valid base64url-encoded AuthnRequest', () => {
      const url = provider.authenticate() as string;
      const parsed = new URL(url);
      const samlRequest = parsed.searchParams.get('SAMLRequest')!;

      expect(samlRequest).toMatch(/^[A-Za-z0-9\-_]+$/);

      const padded = samlRequest.replace(/-/g, '+').replace(/_/g, '/');
      const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(padded + pad), c => c.charCodeAt(0)),
      );

      expect(decoded).toContain('AuthnRequest');
      expect(decoded).toContain('urn:oasis:names:tc:SAML:2.0:protocol');
      expect(decoded).toContain(VALID_SAML_CONFIG.spEntityId);
      expect(decoded).toContain(VALID_SAML_CONFIG.idpSsoUrl);
    });

    it('should throw when not configured', () => {
      const bad = new SAML2Provider('bad', { ...VALID_SAML_CONFIG, idpSsoUrl: '' });
      expect(() => bad.authenticate()).toThrow();
      bad.dispose();
    });
  });

  describe('handleCallback (ACS)', () => {
    it('should parse a successful SAML response', async () => {
      const xml = buildSampleSAMLResponse();
      const encoded = btoa(xml);

      const result = await provider.handleCallback(
        `https://myapp.example.com/acs?SAMLResponse=${encodeURIComponent(encoded)}`,
      );

      expect(result.success).toBe(true);
      expect(result.identity).toBeDefined();
      expect(result.identity!.id).toBe('user@example.com');
      expect(result.identity!.name).toBe('Test User');
      expect(result.identity!.email).toBe('user@example.com');
      expect(result.identity!.provider).toBe(AuthProtocol.SAML2);
    });

    it('should create a SAML session token', async () => {
      const xml = buildSampleSAMLResponse();
      const encoded = btoa(xml);

      const result = await provider.handleCallback(
        `https://myapp.example.com/acs?SAMLResponse=${encodeURIComponent(encoded)}`,
      );

      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0]!.type).toBe(CredentialType.SamlAssertion);
    });

    it('should return error when no SAMLResponse is present', async () => {
      const result = await provider.handleCallback(
        'https://myapp.example.com/acs',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No SAMLResponse');
    });

    it('should handle SAML error status codes', async () => {
      const xml = buildSampleSAMLResponse({
        statusCode: 'urn:oasis:names:tc:SAML:2.0:status:Requester',
      });
      const encoded = btoa(xml);

      const result = await provider.handleCallback(
        `https://myapp.example.com/acs?SAMLResponse=${encodeURIComponent(encoded)}`,
      );

      expect(result.success).toBe(false);
    });

    it('should handle malformed XML gracefully', async () => {
      const encoded = btoa('this is not valid xml');

      const result = await provider.handleCallback(
        `https://myapp.example.com/acs?SAMLResponse=${encodeURIComponent(encoded)}`,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('SAML');
    });
  });

  describe('refresh', () => {
    it('should throw since SAML does not support refresh', async () => {
      await expect(provider.refresh('any-token')).rejects.toThrow('does not support token refresh');
    });
  });

  describe('validateToken', () => {
    it('should validate a SAML assertion token', () => {
      const result = provider.validateToken({
        value: 'user@example.com',
        type: CredentialType.SamlAssertion,
        expiresAt: null,
        issuedAt: Date.now(),
        scopes: [],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject non-SAML token types', () => {
      const result = provider.validateToken({
        value: 'not-saml',
        type: CredentialType.AccessToken,
        expiresAt: null,
        issuedAt: Date.now(),
        scopes: [],
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Not a SAML assertion');
    });
  });

  describe('revokeToken', () => {
    it('should return true (local session invalidation)', async () => {
      const result = await provider.revokeToken('any');
      expect(result).toBe(true);
    });
  });

  describe('getIdentity / getTokens', () => {
    it('should be null/empty before auth', () => {
      expect(provider.getIdentity()).toBeNull();
      expect(provider.getTokens()).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('should clear state', () => {
      provider.authenticate();
      provider.dispose();
      expect(provider.getIdentity()).toBeNull();
      expect(provider.getTokens()).toHaveLength(0);
    });
  });

  describe('parseSAMLResponse', () => {
    it('should extract session index', async () => {
      const xml = buildSampleSAMLResponse({ sessionIndex: '_sess_abc' });
      const encoded = btoa(xml);

      const result = await provider.handleCallback(
        `https://myapp.example.com/acs?SAMLResponse=${encodeURIComponent(encoded)}`,
      );

      expect(result.success).toBe(true);
      expect(result.identity!.claims.sessionIndex).toBe('_sess_abc');
    });

    it('should extract issuer', async () => {
      const xml = buildSampleSAMLResponse({ issuer: 'https://custom-idp.com' });
      const encoded = btoa(xml);

      const result = await provider.handleCallback(
        `https://myapp.example.com/acs?SAMLResponse=${encodeURIComponent(encoded)}`,
      );

      expect(result.identity!.claims.issuer).toBe('https://custom-idp.com');
    });

    it('should extract custom attributes', async () => {
      const xml = buildSampleSAMLResponse({
        attributes: `
          <saml:Attribute Name="department">
            <saml:AttributeValue>Engineering</saml:AttributeValue>
          </saml:Attribute>
          <saml:Attribute Name="role">
            <saml:AttributeValue>admin</saml:AttributeValue>
            <saml:AttributeValue>user</saml:AttributeValue>
          </saml:Attribute>
        `,
      });
      const encoded = btoa(xml);

      const result = await provider.handleCallback(
        `https://myapp.example.com/acs?SAMLResponse=${encodeURIComponent(encoded)}`,
      );

      expect(result.identity!.claims.department).toBe('Engineering');
      expect(result.identity!.claims.role).toEqual(['admin', 'user']);
    });
  });
});
