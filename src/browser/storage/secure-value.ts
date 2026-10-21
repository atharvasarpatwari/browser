/**
 * Encrypts/decrypts settings values that shouldn't sit in plaintext in
 * localStorage (currently just the Anthropic API key). Uses the OS keychain
 * via the Electron secureStorage bridge (electron/secure-store.cjs) when
 * available.
 *
 * ponytail: outside Electron (web/Android) there's no OS keychain to call, so
 * the value passes through unencrypted — upgrade path is a platform-specific
 * bridge (e.g. Android Keystore) if those targets start storing real secrets.
 */

const ENC_PREFIX = 'nova-enc-v1:';

interface SecureStorageBridge {
  encrypt(value: string): Promise<string | null>;
  decrypt(value: string): Promise<string | null>;
}

function getBridge(): SecureStorageBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { nova?: { secureStorage?: SecureStorageBridge } }).nova?.secureStorage ?? null;
}

async function encryptSecret(plain: string): Promise<string> {
  if (!plain) return plain;
  const bridge = getBridge();
  if (!bridge) return plain;
  const cipher = await bridge.encrypt(plain);
  return cipher ? ENC_PREFIX + cipher : plain;
}

async function decryptSecret(stored: string): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const bridge = getBridge();
  if (!bridge) return '';
  const plain = await bridge.decrypt(stored.slice(ENC_PREFIX.length));
  return plain ?? '';
}

export { encryptSecret, decryptSecret };
