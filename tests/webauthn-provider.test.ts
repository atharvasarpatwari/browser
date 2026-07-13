import { describe, it, expect, beforeEach } from 'vitest';
import { WebAuthnProvider } from '../src/browser/auth/webauthn-provider';
import { AuthProtocol, CredentialType } from '../src/browser/auth/auth-provider';
import type { WebAuthnConfig } from '../src/browser/auth/auth-provider';

const VALID_CONFIG: WebAuthnConfig = {
  rpName: 'Nova Browser',
  rpId: 'example.com',
  origin: 'https://example.com',
  preferredTransport: 'internal',
  requireResidentKey: true,
  userVerification: 'preferred',
  timeoutMs: 60000,
};

describe('WebAuthnProvider', () => {
  let provider: WebAuthnProvider;

  beforeEach(() => {
    provider = new WebAuthnProvider('test-webauthn', VALID_CONFIG);
  });

  describe('basic properties', () => {
    it('should use WebAuthn protocol', () => {
      expect(provider.protocol).toBe(AuthProtocol.WebAuthn);
      expect(provider.name).toBe('test-webauthn');
    });

    it('should report isConfigured when config is complete', () => {
      expect(provider.isConfigured).toBe(true);
    });

    it('should report not configured when rpName is empty', () => {
      const bad = new WebAuthnProvider('bad', { ...VALID_CONFIG, rpName: '' });
      expect(bad.isConfigured).toBe(false);
      bad.dispose();
    });

    it('should report not configured when rpId is empty', () => {
      const bad = new WebAuthnProvider('bad', { ...VALID_CONFIG, rpId: '' });
      expect(bad.isConfigured).toBe(false);
      bad.dispose();
    });

    it('should report not configured when origin is empty', () => {
      const bad = new WebAuthnProvider('bad', { ...VALID_CONFIG, origin: '' });
      expect(bad.isConfigured).toBe(false);
      bad.dispose();
    });
  });

  describe('register', () => {
    it('should register a credential in simulated mode', async () => {
      const result = await provider.register('user-1', 'alice', 'Alice Smith');

      expect(result.success).toBe(true);
      expect(result.credential).toBeDefined();
      expect(result.credential!.userId).toBe('user-1');
      expect(result.credential!.userName).toBe('alice');
      expect(result.credential!.counter).toBe(0);
      expect(result.credential!.credentialId.length).toBeGreaterThan(0);
      expect(result.credential!.publicKey.length).toBeGreaterThan(0);
      expect(result.credential!.transports).toEqual(['internal']);
    });

    it('should throw when not configured', async () => {
      const bad = new WebAuthnProvider('bad', { ...VALID_CONFIG, rpName: '' });
      await expect(bad.register('u', 'n', 'd')).rejects.toThrow();
      bad.dispose();
    });

    it('should store the credential for later authentication', async () => {
      await provider.register('user-1', 'alice', 'Alice');

      // Authenticate should find the stored credential.
      const authResult = await provider.authenticate();
      expect(authResult.success).toBe(true);
    });
  });

  describe('authenticate', () => {
    it('should fail when no credentials are registered', async () => {
      const result = await provider.authenticate();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No credentials registered');
    });

    it('should succeed with a registered credential', async () => {
      await provider.register('user-1', 'alice', 'Alice');
      const result = await provider.authenticate();

      expect(result.success).toBe(true);
      expect(result.identity).toBeDefined();
      expect(result.identity!.id).toBe('user-1');
      expect(result.identity!.name).toBe('alice');
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0]!.type).toBe(CredentialType.WebAuthnCred);
    });
  });

  describe('authenticateWithCredential', () => {
    it('should authenticate with a specific credential ID', async () => {
      const regResult = await provider.register('user-1', 'alice', 'Alice');
      const credId = regResult.credential!.credentialId;

      const authResult = await provider.authenticateWithCredential(credId);
      expect(authResult.success).toBe(true);
      expect(authResult.credentialId).toBe(credId);
      expect(authResult.counter).toBe(1);
      expect(authResult.userHandle).toBe('user-1');
    });

    it('should fail with a non-existent credential ID', async () => {
      await provider.register('user-1', 'alice', 'Alice');
      const result = await provider.authenticateWithCredential('nonexistent-cred');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Credential not found');
    });

    it('should use the first credential when no ID is specified', async () => {
      await provider.register('user-1', 'alice', 'Alice');
      await provider.register('user-2', 'bob', 'Bob');
      const result = await provider.authenticateWithCredential();
      expect(result.success).toBe(true);
    });
  });

  describe('handleCallback', () => {
    it('should return an error (WebAuthn does not use callbacks)', async () => {
      const result = await provider.handleCallback('https://example.com/callback');
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not use callback URLs');
    });
  });

  describe('refresh', () => {
    it('should throw (WebAuthn does not support refresh)', async () => {
      await expect(provider.refresh('any')).rejects.toThrow('does not support token refresh');
    });
  });

  describe('validateToken', () => {
    it('should validate a WebAuthn credential token', () => {
      const result = provider.validateToken({
        value: 'cred-123',
        type: CredentialType.WebAuthnCred,
        expiresAt: null,
        issuedAt: Date.now(),
        scopes: [],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject non-WebAuthn token types', () => {
      const result = provider.validateToken({
        value: 'not-webauthn',
        type: CredentialType.AccessToken,
        expiresAt: null,
        issuedAt: Date.now(),
        scopes: [],
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Not a WebAuthn credential');
    });
  });

  describe('revokeToken', () => {
    it('should remove a stored credential by ID', async () => {
      const regResult = await provider.register('user-1', 'alice', 'Alice');
      const credId = regResult.credential!.credentialId;

      const result = await provider.revokeToken(credId);
      expect(result).toBe(true);

      // After revoking, authentication should fail.
      const authResult = await provider.authenticate();
      expect(authResult.success).toBe(false);
    });

    it('should return false for non-existent credential', async () => {
      const result = await provider.revokeToken('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getIdentity / getTokens', () => {
    it('should be null/empty before auth', () => {
      expect(provider.getIdentity()).toBeNull();
      expect(provider.getTokens()).toHaveLength(0);
    });

    it('should be populated after authentication', async () => {
      await provider.register('user-1', 'alice', 'Alice');
      await provider.authenticate();

      expect(provider.getIdentity()).not.toBeNull();
      expect(provider.getIdentity()!.id).toBe('user-1');
      expect(provider.getTokens()).toHaveLength(1);
    });
  });

  describe('dispose', () => {
    it('should clear all stored credentials and state', async () => {
      await provider.register('user-1', 'alice', 'Alice');
      await provider.authenticate();

      provider.dispose();
      expect(provider.getIdentity()).toBeNull();
      expect(provider.getTokens()).toHaveLength(0);

      // After dispose, authenticate should fail (no credentials).
      const result = await provider.authenticate();
      expect(result.success).toBe(false);
    });
  });

  describe('multiple credentials', () => {
    it('should support multiple registrations', async () => {
      const reg1 = await provider.register('user-1', 'alice', 'Alice');
      const reg2 = await provider.register('user-2', 'bob', 'Bob');

      expect(reg1.success).toBe(true);
      expect(reg2.success).toBe(true);
      expect(reg1.credential!.credentialId).not.toBe(reg2.credential!.credentialId);
    });

    it('should authenticate with the first credential by default', async () => {
      await provider.register('user-1', 'alice', 'Alice');
      await provider.register('user-2', 'bob', 'Bob');

      const result = await provider.authenticate();
      expect(result.success).toBe(true);
      expect(result.identity!.id).toBe('user-1');
    });
  });
});
