import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AutoUpdater, createAutoUpdater, DEFAULT_AUTO_UPDATER_CONFIG,
  parseSemver, compareSemver, isUpdateAvailable, verifyChecksum,
} from '../src/browser/engine/auto-updater';
import { createHash } from 'crypto';

// ── Semver Utilities ──

describe('Semver Utilities', () => {
  it('parseSemver parses simple version', () => {
    const v = parseSemver('1.2.3');
    expect(v).toEqual({ major: 1, minor: 2, patch: 3, prerelease: '' });
  });

  it('parseSemver parses prerelease', () => {
    const v = parseSemver('1.0.0-beta.1');
    expect(v.major).toBe(1);
    expect(v.prerelease).toBe('beta.1');
  });

  it('parseSemver throws on invalid', () => {
    expect(() => parseSemver('not-a-version')).toThrow('Invalid semver');
  });

  it('compareSemver detects newer', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('1.1.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
  });

  it('compareSemver detects older', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  it('compareSemver equal versions', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('compareSemver prerelease is less than release', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
  });

  it('isUpdateAvailable returns true when newer', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.1')).toBe(true);
    expect(isUpdateAvailable('1.0.0', '2.0.0')).toBe(true);
  });

  it('isUpdateAvailable returns false when same or older', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.0')).toBe(false);
    expect(isUpdateAvailable('1.0.0', '0.9.9')).toBe(false);
  });
});

// ── Checksum ──

describe('verifyChecksum', () => {
  it('verifies correct checksum', () => {
    const data = Buffer.from('hello world');
    const hash = createHash('sha256').update(data).digest('hex');
    expect(verifyChecksum(data, hash)).toBe(true);
  });

  it('rejects wrong checksum', () => {
    const data = Buffer.from('hello world');
    expect(verifyChecksum(data, '0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
  });
});

// ── AutoUpdater ──

describe('AutoUpdater', () => {
  let updater: AutoUpdater;

  beforeEach(() => {
    updater = createAutoUpdater({
      currentVersion: '1.0.0',
      manifestUrl: 'https://example.com/update.json',
      checkIntervalMs: 60_000,
      autoDownload: false,
    });
  });

  afterEach(async () => {
    await updater.shutdown();
  });

  it('initializes cleanly', async () => {
    await updater.initialize();
    expect(updater.getStatus()).toBe('idle');
  });

  it('shutdown clears timer', async () => {
    await updater.initialize();
    await updater.shutdown();
  });

  it('double-initialize is safe', async () => {
    await updater.initialize();
    await updater.initialize();
  });

  it('reports current status', () => {
    expect(updater.getStatus()).toBe('idle');
  });

  it('getManifest returns undefined initially', () => {
    expect(updater.getManifest()).toBeUndefined();
  });

  it('getProgress returns undefined initially', () => {
    expect(updater.getProgress()).toBeUndefined();
  });

  it('skipVersion and getSkippedVersions', () => {
    updater.skipVersion('1.1.0');
    updater.skipVersion('1.2.0');
    expect(updater.getSkippedVersions()).toEqual(['1.1.0', '1.2.0']);
  });

  it('setChannel updates config', () => {
    updater.setChannel('beta');
    expect(updater.getConfig().channel).toBe('beta');
  });

  it('getConfig returns copy', () => {
    const config = updater.getConfig();
    config.channel = 'nightly';
    expect(updater.getConfig().channel).toBe('stable');
  });

  it('onEvent returns unsubscribe function', () => {
    const handler = vi.fn();
    const unsub = updater.onEvent(handler);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('dispose clears timer', () => {
    updater.dispose();
  });
});

// ── DEFAULT CONFIG ──

describe('DEFAULT_AUTO_UPDATER_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_AUTO_UPDATER_CONFIG.currentVersion).toBe('0.0.0');
    expect(DEFAULT_AUTO_UPDATER_CONFIG.channel).toBe('stable');
    expect(DEFAULT_AUTO_UPDATER_CONFIG.checkIntervalMs).toBeGreaterThan(0);
    expect(DEFAULT_AUTO_UPDATER_CONFIG.autoDownload).toBe(true);
    expect(DEFAULT_AUTO_UPDATER_CONFIG.autoInstallOnQuit).toBe(false);
    expect(DEFAULT_AUTO_UPDATER_CONFIG.maxConnections).toBeGreaterThan(0);
  });
});
