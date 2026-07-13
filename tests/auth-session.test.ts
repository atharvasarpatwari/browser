import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuthSession } from '../src/browser/auth/auth-session';
import { AuthProtocol, AuthSessionState, CredentialType } from '../src/browser/auth/auth-provider';
import type { AuthToken, AuthIdentity } from '../src/browser/auth/auth-provider';

const TEST_IDENTITY: AuthIdentity = {
  id: 'user-123',
  name: 'Test User',
  email: 'test@example.com',
  provider: AuthProtocol.OAuth2,
  claims: { sub: 'user-123' },
};

const TEST_TOKEN: AuthToken = {
  value: 'access_token_xyz',
  type: CredentialType.AccessToken,
  expiresAt: Date.now() + 3600_000,
  issuedAt: Date.now(),
  scopes: ['openid', 'profile'],
};

const TEST_REFRESH_TOKEN: AuthToken = {
  value: 'refresh_token_abc',
  type: CredentialType.RefreshToken,
  expiresAt: null,
  issuedAt: Date.now(),
  scopes: [],
};

describe('AuthSession', () => {
  let session: AuthSession;

  beforeEach(() => {
    vi.useFakeTimers();
    session = new AuthSession('sess-1');
  });

  afterEach(() => {
    session.dispose();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in Unauthenticated state', () => {
      expect(session.state).toBe(AuthSessionState.Unauthenticated);
    });

    it('should have a unique ID', () => {
      expect(session.id).toBe('sess-1');
    });

    it('should have a creation timestamp', () => {
      expect(session.createdAt).toBeGreaterThan(0);
    });

    it('should have null identity initially', () => {
      expect(session.identity).toBeNull();
    });

    it('should have null accessToken initially', () => {
      expect(session.accessToken).toBeNull();
    });
  });

  describe('authenticate', () => {
    it('should transition to Authenticated state', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      expect(session.state).toBe(AuthSessionState.Authenticated);
    });

    it('should store the identity', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      expect(session.identity).toEqual(TEST_IDENTITY);
    });

    it('should store the tokens', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN, TEST_REFRESH_TOKEN]);
      const snapshot = session.snapshot();
      expect(snapshot.tokens).toHaveLength(2);
    });

    it('should update lastAccessedAt', () => {
      const before = Date.now();
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      expect(session.lastAccessedAt).toBeGreaterThanOrEqual(before);
    });

    it('should emit stateChanged event', () => {
      const handler = vi.fn();
      session.on('stateChanged', handler);
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'stateChanged',
          previousState: AuthSessionState.Unauthenticated,
          newState: AuthSessionState.Authenticated,
        }),
      );
    });
  });

  describe('expire', () => {
    it('should transition to Expired state', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      session.expire();
      expect(session.state).toBe(AuthSessionState.Expired);
    });

    it('should emit stateChanged event', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      const handler = vi.fn();
      session.on('stateChanged', handler);
      session.expire();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'stateChanged',
          previousState: AuthSessionState.Authenticated,
          newState: AuthSessionState.Expired,
        }),
      );
    });
  });

  describe('fail', () => {
    it('should transition to Failed state', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      session.fail('Something went wrong');
      expect(session.state).toBe(AuthSessionState.Failed);
    });
  });

  describe('signOut', () => {
    it('should transition to SignedOut state', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      session.signOut();
      expect(session.state).toBe(AuthSessionState.SignedOut);
    });

    it('should clear identity and tokens', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      session.signOut();
      expect(session.identity).toBeNull();
      expect(session.snapshot().tokens).toHaveLength(0);
    });

    it('should emit stateChanged and destroyed events', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      const stateHandler = vi.fn();
      const destroyedHandler = vi.fn();
      session.on('stateChanged', stateHandler);
      session.on('destroyed', destroyedHandler);

      session.signOut();
      expect(stateHandler).toHaveBeenCalled();
      expect(destroyedHandler).toHaveBeenCalled();
    });
  });

  describe('touch', () => {
    it('should update lastAccessedAt', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      const beforeUpdate = Date.now();
      vi.advanceTimersByTime(1000);
      session.touch();
      expect(session.lastAccessedAt).toBeGreaterThanOrEqual(beforeUpdate + 1000);
    });

    it('should emit activity event', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      const handler = vi.fn();
      session.on('activity', handler);
      session.touch();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('isExpired', () => {
    it('should return false for active session', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      expect(session.isExpired()).toBe(false);
    });

    it('should return true when state is Expired', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      session.expire();
      expect(session.isExpired()).toBe(true);
    });

    it('should return true when state is SignedOut', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      session.signOut();
      expect(session.isExpired()).toBe(true);
    });

    it('should expire after maxDurationMs', () => {
      const shortSession = new AuthSession('short', { maxDurationMs: 1000 });
      shortSession.authenticate(TEST_IDENTITY, [TEST_TOKEN]);

      vi.advanceTimersByTime(1100);
      expect(shortSession.isExpired()).toBe(true);
      shortSession.dispose();
    });
  });

  describe('replaceToken', () => {
    it('should replace the old token with a new one', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      const newToken: AuthToken = {
        ...TEST_TOKEN,
        value: 'new_access_token',
      };

      session.replaceToken(TEST_TOKEN, newToken);
      expect(session.accessToken!.value).toBe('new_access_token');
    });

    it('should emit tokenRefreshed event', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      const handler = vi.fn();
      session.on('tokenRefreshed', handler);

      const newToken: AuthToken = { ...TEST_TOKEN, value: 'new_tok' };
      session.replaceToken(TEST_TOKEN, newToken);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tokenRefreshed',
          oldToken: TEST_TOKEN,
          newToken,
        }),
      );
    });
  });

  describe('snapshot', () => {
    it('should return immutable snapshot of session state', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      const snap = session.snapshot();

      expect(snap.id).toBe('sess-1');
      expect(snap.state).toBe(AuthSessionState.Authenticated);
      expect(snap.identity).toEqual(TEST_IDENTITY);
      expect(snap.tokens).toHaveLength(1);
      expect(snap.protocol).toBe(AuthProtocol.OAuth2);
    });

    it('should return null-safe defaults for unauthenticated session', () => {
      const snap = session.snapshot();
      expect(snap.identity).toBeNull();
      expect(snap.tokens).toHaveLength(0);
      expect(snap.protocol).toBe(AuthProtocol.Custom);
    });
  });

  describe('event system', () => {
    it('should support multiple handlers for the same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      session.on('stateChanged', handler1);
      session.on('stateChanged', handler2);

      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should support unsubscribing from events', () => {
      const handler = vi.fn();
      session.on('stateChanged', handler);
      session.off('stateChanged', handler);

      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not throw if handler throws', () => {
      session.on('stateChanged', () => {
        throw new Error('Handler error');
      });

      // Should not throw.
      expect(() => {
        session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      }).not.toThrow();
    });
  });

  describe('idle timeout', () => {
    it('should expire after idle timeout', () => {
      const idleSession = new AuthSession('idle', { idleTimeoutMs: 5000 });
      idleSession.authenticate(TEST_IDENTITY, [TEST_TOKEN]);

      vi.advanceTimersByTime(5100);
      expect(idleSession.state).toBe(AuthSessionState.Expired);
      idleSession.dispose();
    });

    it('should reset idle timer on touch', () => {
      const idleSession = new AuthSession('idle', { idleTimeoutMs: 5000 });
      idleSession.authenticate(TEST_IDENTITY, [TEST_TOKEN]);

      vi.advanceTimersByTime(4000);
      idleSession.touch();
      vi.advanceTimersByTime(4000);
      expect(idleSession.state).toBe(AuthSessionState.Authenticated);
      idleSession.dispose();
    });
  });

  describe('max duration', () => {
    it('should expire after max duration regardless of activity', () => {
      const maxSession = new AuthSession('max', { maxDurationMs: 5000 });
      maxSession.authenticate(TEST_IDENTITY, [TEST_TOKEN]);

      vi.advanceTimersByTime(4000);
      maxSession.touch();
      vi.advanceTimersByTime(2000);
      expect(maxSession.state).toBe(AuthSessionState.Expired);
      maxSession.dispose();
    });
  });

  describe('dispose', () => {
    it('should clear all state and handlers', () => {
      session.authenticate(TEST_IDENTITY, [TEST_TOKEN]);
      const handler = vi.fn();
      session.on('stateChanged', handler);

      session.dispose();

      // After dispose, events should not fire.
      // (handlers are cleared)
      expect(session.identity).toBeNull();
      expect(session.snapshot().tokens).toHaveLength(0);
    });
  });
});
