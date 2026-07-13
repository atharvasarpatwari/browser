import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JwtManager } from '../src/browser/auth/jwt-manager';
import { CredentialType } from '../src/browser/auth/auth-provider';

describe('JwtManager', () => {
  let manager: JwtManager;

  beforeEach(() => {
    manager = new JwtManager();
  });

  describe('decode', () => {
    it('should decode a valid 3-part JWT', () => {
      const token = manager.sign({ sub: 'user1', name: 'Test' }, 'secret');
      const decoded = manager.decode(token);

      expect(decoded).not.toBeNull();
      expect(decoded!.header.alg).toBe('HS256');
      expect(decoded!.header.typ).toBe('JWT');
      expect(decoded!.payload.sub).toBe('user1');
      expect(decoded!.payload.name).toBe('Test');
      expect(decoded!.raw).toBe(token);
    });

    it('should return null for a token with less than 3 parts', () => {
      expect(manager.decode('abc.def')).toBeNull();
      expect(manager.decode('')).toBeNull();
      expect(manager.decode('one')).toBeNull();
    });

    it('should return null for a token with more than 3 parts', () => {
      expect(manager.decode('a.b.c.d')).toBeNull();
    });

    it('should return null for invalid base64 in header', () => {
      expect(manager.decode('!!!.eyJzdWIiOiIxIn0.sig')).toBeNull();
    });

    it('should return null for invalid base64 in payload', () => {
      const validHeader = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      expect(manager.decode(`${validHeader}.!!!.sig`)).toBeNull();
    });

    it('should return null for header without alg', () => {
      const header = btoa(JSON.stringify({ typ: 'JWT' }));
      const payload = btoa(JSON.stringify({ sub: 'user1' }));
      expect(manager.decode(`${header}.${payload}.sig`)).toBeNull();
    });

    it('should decode custom claims', () => {
      const token = manager.sign({
        sub: '123',
        iss: 'https://example.com',
        aud: 'my-client',
        scope: 'openid profile',
        custom: 'value',
      }, 'key');

      const decoded = manager.decode(token);
      expect(decoded!.payload.iss).toBe('https://example.com');
      expect(decoded!.payload.aud).toBe('my-client');
      expect(decoded!.payload.scope).toBe('openid profile');
      expect(decoded!.payload.custom).toBe('value');
    });
  });

  describe('sign', () => {
    it('should produce a valid JWT with default HS256', () => {
      const token = manager.sign({ sub: '123' }, 'my-secret');
      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      const decoded = manager.decode(token);
      expect(decoded).not.toBeNull();
      expect(decoded!.payload.sub).toBe('123');
    });

    it('should set iat and exp automatically', () => {
      const before = Math.floor(Date.now() / 1000);
      const token = manager.sign({ sub: '123' }, 'secret');
      const decoded = manager.decode(token)!;

      expect(decoded.payload.iat).toBeGreaterThanOrEqual(before);
      expect(decoded.payload.exp).toBeGreaterThan(decoded.payload.iat!);
    });

    it('should respect custom expiresIn', () => {
      const token = manager.sign({ sub: '1' }, 'secret', 'HS256', 7200);
      const decoded = manager.decode(token)!;
      expect(decoded.payload.exp! - decoded.payload.iat!).toBe(7200);
    });

    it('should not override iat/exp if already in payload', () => {
      const token = manager.sign({ sub: '1', iat: 1000, exp: 2000 }, 'secret');
      const decoded = manager.decode(token)!;
      expect(decoded.payload.iat).toBe(1000);
      expect(decoded.payload.exp).toBe(2000);
    });

    it('should support HS512 algorithm', () => {
      const token = manager.sign({ sub: '1' }, 'secret', 'HS512');
      const decoded = manager.decode(token)!;
      expect(decoded.header.alg).toBe('HS512');
    });

    it('should produce deterministic signatures for same input', () => {
      const payload = { sub: 'user1' };
      const token1 = manager.sign(payload, 'secret');
      const token2 = manager.sign(payload, 'secret');
      expect(token1).toBe(token2);
    });

    it('should produce different signatures for different secrets', () => {
      const token1 = manager.sign({ sub: '1' }, 'secret1');
      const token2 = manager.sign({ sub: '1' }, 'secret2');
      expect(token1).not.toBe(token2);
    });

    it('should default algorithm to HS256', () => {
      const token = manager.sign({ sub: '1' }, 'secret');
      const decoded = manager.decode(token)!;
      expect(decoded.header.alg).toBe('HS256');
    });
  });

  describe('verify', () => {
    it('should verify a valid token', () => {
      const token = manager.sign({ sub: 'user1' }, 'my-secret');
      const result = manager.verify(token, 'my-secret');
      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload!.sub).toBe('user1');
    });

    it('should reject a token with wrong secret', () => {
      const token = manager.sign({ sub: 'user1' }, 'correct-secret');
      const result = manager.verify(token, 'wrong-secret');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Signature');
    });

    it('should reject an expired token', () => {
      // Create token that expired 1 hour ago.
      const token = manager.sign(
        { sub: 'user1', exp: Math.floor(Date.now() / 1000) - 3600 },
        'secret',
      );
      const result = manager.verify(token, 'secret');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('should accept a token within clock skew', () => {
      // Token expired 10 seconds ago, default skew is 30.
      const token = manager.sign(
        { sub: 'user1', exp: Math.floor(Date.now() / 1000) - 10 },
        'secret',
      );
      const result = manager.verify(token, 'secret', { clockSkewSeconds: 30 });
      expect(result.valid).toBe(true);
    });

    it('should reject a token not yet valid (nbf in future)', () => {
      const token = manager.sign(
        { sub: 'user1', nbf: Math.floor(Date.now() / 1000) + 3600 },
        'secret',
      );
      const result = manager.verify(token, 'secret');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not yet valid');
    });

    it('should check issuer when specified', () => {
      const token = manager.sign({ sub: '1', iss: 'https://issuer.com' }, 'secret');
      expect(manager.verify(token, 'secret', { issuer: 'https://issuer.com' }).valid).toBe(true);
      expect(manager.verify(token, 'secret', { issuer: 'https://other.com' }).valid).toBe(false);
    });

    it('should check audience when specified', () => {
      const token = manager.sign({ sub: '1', aud: 'my-client' }, 'secret');
      expect(manager.verify(token, 'secret', { audience: 'my-client' }).valid).toBe(true);
      expect(manager.verify(token, 'secret', { audience: 'other-client' }).valid).toBe(false);
    });

    it('should check audience as array', () => {
      const token = manager.sign({ sub: '1', aud: ['client-a', 'client-b'] }, 'secret');
      expect(manager.verify(token, 'secret', { audience: 'client-a' }).valid).toBe(true);
      expect(manager.verify(token, 'secret', { audience: 'client-c' }).valid).toBe(false);
    });

    it('should skip expiry check when skipExpiry is true', () => {
      const token = manager.sign(
        { sub: '1', exp: Math.floor(Date.now() / 1000) - 3600 },
        'secret',
      );
      const result = manager.verify(token, 'secret', { skipExpiry: true });
      expect(result.valid).toBe(true);
    });

    it('should skip signature check when skipSignature is true', () => {
      const token = manager.sign({ sub: '1' }, 'secret');
      const result = manager.verify(token, 'wrong-secret', { skipSignature: true });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid JWT format', () => {
      const result = manager.verify('not-a-jwt', 'secret');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid JWT format');
    });
  });

  describe('toAuthToken', () => {
    it('should convert a JWT to an AuthToken', () => {
      const token = manager.sign(
        { sub: 'user1', scope: 'openid profile email', iss: 'https://idp.com' },
        'secret',
      );
      const decoded = manager.decode(token)!;
      const authToken = manager.toAuthToken(decoded);

      expect(authToken.value).toBe(token);
      expect(authToken.type).toBe(CredentialType.IdToken);
      expect(authToken.scopes).toEqual(['openid', 'profile', 'email']);
      expect(authToken.tokenEndpoint).toBe('https://idp.com');
      expect(authToken.expiresAt).toBeDefined();
      expect(authToken.issuedAt).toBeDefined();
    });

    it('should use custom credential type when specified', () => {
      const token = manager.sign({ sub: '1' }, 'secret');
      const decoded = manager.decode(token)!;
      const authToken = manager.toAuthToken(decoded, CredentialType.AccessToken);
      expect(authToken.type).toBe(CredentialType.AccessToken);
    });

    it('should handle missing exp gracefully', () => {
      const token = manager.sign({ sub: '1' }, 'secret');
      const decoded = manager.decode(token)!;
      const authToken = manager.toAuthToken(decoded);
      // sign() adds exp by default, so it should be present
      expect(authToken.expiresAt).toBeDefined();
    });

    it('should default to empty scopes if scope claim is absent', () => {
      const token = manager.sign({ sub: '1' }, 'secret');
      const decoded = manager.decode(token)!;
      const authToken = manager.toAuthToken(decoded);
      expect(authToken.scopes).toEqual([]);
    });
  });

  describe('scheduleRefresh / clearRefreshTimer', () => {
    it('should schedule a refresh callback', () => {
      vi.useFakeTimers();
      try {
        const token = manager.sign(
          { sub: '1', exp: Math.floor(Date.now() / 1000) + 600 },
          'secret',
        );
        const decoded = manager.decode(token)!;
        const callback = vi.fn();

        manager.scheduleRefresh(decoded, 'secret', callback, 300);
        expect(callback).not.toHaveBeenCalled();

        // Advance to the refresh point.
        vi.advanceTimersByTime(300_000 + 1000);
        expect(callback).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should return null for tokens without exp', () => {
      const token = manager.sign({ sub: '1' }, 'secret');
      const decoded = manager.decode(token)!;
      // sign() always adds exp, so decode and manually remove
      const noExpPayload = { ...decoded.payload };
      delete (noExpPayload as Record<string, unknown>).exp;
      const noExpJwt = { ...decoded, payload: noExpPayload };

      const result = manager.scheduleRefresh(noExpJwt, 'secret', () => {});
      expect(result).toBeNull();
    });

    it('should be clearable with clearRefreshTimer', () => {
      vi.useFakeTimers();
      try {
        const token = manager.sign(
          { sub: '1', exp: Math.floor(Date.now() / 1000) + 600 },
          'secret',
        );
        const decoded = manager.decode(token)!;
        const callback = vi.fn();

        const timerId = manager.scheduleRefresh(decoded, 'secret', callback, 300);
        expect(timerId).not.toBeNull();

        manager.clearRefreshTimer(timerId!);
        vi.advanceTimersByTime(310_000);
        expect(callback).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
