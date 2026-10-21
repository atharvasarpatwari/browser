import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/browser/storage/secure-value';

describe('secure-value', () => {
  it('passes plaintext through unchanged when no secureStorage bridge is present (web/test env)', async () => {
    const cipher = await encryptSecret('sk-test-123');
    expect(cipher).toBe('sk-test-123');
  });

  it('returns an already-plaintext stored value unchanged on decrypt', async () => {
    const plain = await decryptSecret('sk-test-123');
    expect(plain).toBe('sk-test-123');
  });

  it('treats empty string as a no-op for encrypt', async () => {
    expect(await encryptSecret('')).toBe('');
  });

  it('round-trips through a fake Electron secureStorage bridge', async () => {
    (window as unknown as { nova: unknown }).nova = {
      secureStorage: {
        encrypt: async (v: string) => Buffer.from(v, 'utf8').toString('base64'),
        decrypt: async (v: string) => Buffer.from(v, 'base64').toString('utf8'),
      },
    };
    try {
      const cipher = await encryptSecret('sk-real-key');
      expect(cipher.startsWith('nova-enc-v1:')).toBe(true);
      expect(cipher).not.toContain('sk-real-key');
      expect(await decryptSecret(cipher)).toBe('sk-real-key');
    } finally {
      delete (window as unknown as { nova?: unknown }).nova;
    }
  });
});
