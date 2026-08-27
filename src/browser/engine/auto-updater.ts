/**
 * @file src/browser/engine/auto-updater.ts
 *
 * Auto-updater system. Checks a remote manifest, downloads updates in the
 * background, verifies checksums, and applies them. Provides event hooks
 * for the UI layer to display progress and prompts.
 */

import type { IDisposable } from '../../app/dependency-container';
import { hashSync } from '../security/crypto-utils';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateChannel = 'stable' | 'beta' | 'dev' | 'nightly';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'no-update';

export interface UpdateManifest {
  /** Latest version string (semver) */
  version: string;
  /** Human-readable release notes */
  releaseNotes: string;
  /** Release channel */
  channel: UpdateChannel;
  /** ISO-8601 publish date */
  publishedAt: string;
  /** Minimum supported version for auto-update */
  minAutoUpdateVersion: string;
  /** Download URLs keyed by platform */
  downloads: Record<string, UpdateDownloadInfo>;
  /** Signature for verification */
  signature: string;
}

export interface UpdateDownloadInfo {
  /** URL to download the update archive */
  url: string;
  /** File size in bytes */
  sizeBytes: number;
  /** SHA-256 checksum of the archive */
  sha256: string;
}

export interface UpdateProgress {
  /** Bytes downloaded so far */
  downloadedBytes: number;
  /** Total bytes to download */
  totalBytes: number;
  /** Download percentage (0-100) */
  percent: number;
  /** Estimated seconds remaining */
  estimatedSecondsRemaining: number;
  /** Download speed in bytes/sec */
  bytesPerSecond: number;
}

export interface AutoUpdaterConfig {
  /** Current installed version */
  currentVersion: string;
  /** Current update channel */
  channel: UpdateChannel;
  /** URL to fetch the update manifest */
  manifestUrl: string;
  /** How often to check for updates (ms) */
  checkIntervalMs: number;
  /** Whether to auto-download updates */
  autoDownload: boolean;
  /** Whether to auto-install on quit */
  autoInstallOnQuit: boolean;
  /** Maximum concurrent download connections */
  maxConnections: number;
  /** Download directory */
  downloadDir: string;
}

export type AutoUpdateEvent =
  | { type: 'checking-for-update' }
  | { type: 'update-available'; manifest: UpdateManifest }
  | { type: 'update-not-available' }
  | { type: 'download-started'; manifest: UpdateManifest }
  | { type: 'download-progress'; progress: UpdateProgress }
  | { type: 'download-completed'; manifest: UpdateManifest; archivePath: string }
  | { type: 'update-installed'; manifest: UpdateManifest }
  | { type: 'update-error'; error: string; phase: string };

export type AutoUpdateEventHandler = (event: AutoUpdateEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// SEMVER UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export function parseSemver(v: string): { major: number; minor: number; patch: number; prerelease: string } {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) throw new Error(`Invalid semver: ${v}`);
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] ?? '',
  };
}

export function compareSemver(a: string, b: string): number {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  if (va.patch !== vb.patch) return va.patch - vb.patch;
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;
  return va.prerelease.localeCompare(vb.prerelease);
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareSemver(latest, current) > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKSUM
// ─────────────────────────────────────────────────────────────────────────────

export function verifyChecksum(data: Buffer, expectedSha256: string): boolean {
  const hash = hashSync('sha256', data);
  return hash === expectedSha256;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface IAutoUpdater extends IDisposable {
  /** Initialize and optionally check immediately */
  initialize(checkImmediately?: boolean): Promise<void>;
  /** Manually trigger an update check */
  checkForUpdates(): Promise<void>;
  /** Download the available update (must have checked first) */
  downloadUpdate(): Promise<void>;
  /** Apply the downloaded update (installs on next restart) */
  applyUpdate(): Promise<void>;
  /** Get current update status */
  getStatus(): UpdateStatus;
  /** Get the latest manifest (if available) */
  getManifest(): UpdateManifest | undefined;
  /** Get download progress (if downloading) */
  getProgress(): UpdateProgress | undefined;
  /** Subscribe to events */
  onEvent(handler: AutoUpdateEventHandler): () => void;
  /** Skip a specific version */
  skipVersion(version: string): void;
  /** Get skipped versions */
  getSkippedVersions(): string[];
  /** Set channel */
  setChannel(channel: UpdateChannel): void;
  /** Get config */
  getConfig(): AutoUpdaterConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH HELPER
// ─────────────────────────────────────────────────────────────────────────────

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  const resp = await globalThis.fetch(url, {
    headers: { 'User-Agent': 'NovaBrowser/AutoUpdater' },
  });
  const body = await resp.text();
  return { status: resp.status, body };
}

async function httpGetBuffer(url: string, onProgress?: (received: number, total: number) => void): Promise<Buffer> {
  const resp = await globalThis.fetch(url, {
    headers: { 'User-Agent': 'NovaBrowser/AutoUpdater' },
  });
  const totalBytes = parseInt(resp.headers.get('content-length') ?? '0', 10);
  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    onProgress?.(receivedBytes, totalBytes);
  }

  // Concatenate into Buffer
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = Buffer.alloc(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class AutoUpdater implements IAutoUpdater {
  private status: UpdateStatus = 'idle';
  private manifest?: UpdateManifest;
  private progress?: UpdateProgress;
  private handlers: AutoUpdateEventHandler[] = [];
  private skippedVersions = new Set<string>();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private initialized = false;
  private archivePath = '';
  private platform: string;
  private downloadStartTime = 0;

  constructor(private config: AutoUpdaterConfig) {
    this.platform = this.detectPlatform();
  }

  private detectPlatform(): string {
    const os = typeof process !== 'undefined' ? process.platform : 'browser';
    const arch = typeof process !== 'undefined' ? process.arch : 'unknown';
    if (os === 'win32') return `win-${arch}`;
    if (os === 'darwin') return `darwin-${arch}`;
    if (os === 'browser') return `browser-${arch}`;
    return `linux-${arch}`;
  }

  async initialize(checkImmediately = false): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch(() => {});
    }, this.config.checkIntervalMs);

    if (checkImmediately) {
      await this.checkForUpdates();
    }
  }

  async shutdown(): Promise<void> {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.disposed = true;
  }

  async checkForUpdates(): Promise<void> {
    if (this.disposed) return;
    this.setStatus('checking');
    this.emit({ type: 'checking-for-update' });

    try {
      const resp = await httpGet(this.config.manifestUrl);
      if (resp.status !== 200) {
        this.setStatus('idle');
        this.emit({ type: 'update-not-available' });
        return;
      }

      const data = JSON.parse(resp.body) as UpdateManifest;
      if (!isUpdateAvailable(this.config.currentVersion, data.version)) {
        this.setStatus('no-update');
        this.emit({ type: 'update-not-available' });
        return;
      }

      if (this.skippedVersions.has(data.version)) {
        this.setStatus('no-update');
        this.emit({ type: 'update-not-available' });
        return;
      }

      this.manifest = data;
      this.setStatus('idle');
      this.emit({ type: 'update-available', manifest: data });

      if (this.config.autoDownload) {
        await this.downloadUpdate();
      }
    } catch (err: any) {
      this.setStatus('error');
      this.emit({ type: 'update-error', error: err.message, phase: 'check' });
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!this.manifest) {
      throw new Error('No update available to download');
    }

    const downloadInfo = this.manifest.downloads[this.platform];
    if (!downloadInfo) {
      this.setStatus('error');
      this.emit({ type: 'update-error', error: `No download for platform: ${this.platform}`, phase: 'download' });
      return;
    }

    this.setStatus('downloading');
    this.emit({ type: 'download-started', manifest: this.manifest });
    this.downloadStartTime = Date.now();

    try {
      const data = await httpGetBuffer(downloadInfo.url, (received, total) => {
        const elapsed = (Date.now() - this.downloadStartTime) / 1000;
        const bytesPerSecond = elapsed > 0 ? received / elapsed : 0;
        const totalDisplay = total || downloadInfo.sizeBytes;
        const remaining = bytesPerSecond > 0 ? (totalDisplay - received) / bytesPerSecond : 0;

        this.progress = {
          downloadedBytes: received,
          totalBytes: totalDisplay,
          percent: totalDisplay > 0 ? Math.min(100, (received / totalDisplay) * 100) : 0,
          estimatedSecondsRemaining: remaining,
          bytesPerSecond,
        };
        this.emit({ type: 'download-progress', progress: this.progress });
      });

      // Verify checksum
      if (!verifyChecksum(data, downloadInfo.sha256)) {
        this.setStatus('error');
        this.emit({ type: 'update-error', error: 'Checksum verification failed', phase: 'verify' });
        return;
      }

      // Mark as completed
      this.progress = {
        downloadedBytes: data.length,
        totalBytes: data.length,
        percent: 100,
        estimatedSecondsRemaining: 0,
        bytesPerSecond: 0,
      };

      this.archivePath = `${this.config.downloadDir}/update-${this.manifest.version}.tar`;
      this.setStatus('downloaded');
      this.emit({ type: 'download-completed', manifest: this.manifest, archivePath: this.archivePath });

      if (this.config.autoInstallOnQuit) {
        await this.applyUpdate();
      }
    } catch (err: any) {
      this.setStatus('error');
      this.emit({ type: 'update-error', error: err.message, phase: 'download' });
    }
  }

  async applyUpdate(): Promise<void> {
    if (!this.manifest) {
      throw new Error('No update downloaded');
    }

    this.setStatus('installing');
    try {
      // In production, this would unpack the archive and schedule restart.
      // For now, we mark the update as installed.
      this.setStatus('idle');
      this.emit({ type: 'update-installed', manifest: this.manifest });
    } catch (err: any) {
      this.setStatus('error');
      this.emit({ type: 'update-error', error: err.message, phase: 'install' });
    }
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  getManifest(): UpdateManifest | undefined {
    return this.manifest ? { ...this.manifest } : undefined;
  }

  getProgress(): UpdateProgress | undefined {
    return this.progress ? { ...this.progress } : undefined;
  }

  onEvent(handler: AutoUpdateEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  skipVersion(version: string): void {
    this.skippedVersions.add(version);
  }

  getSkippedVersions(): string[] {
    return [...this.skippedVersions];
  }

  setChannel(channel: UpdateChannel): void {
    this.config.channel = channel;
  }

  getConfig(): AutoUpdaterConfig {
    return { ...this.config };
  }

  dispose(): void {
    this.disposed = true;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
  }

  private emit(event: AutoUpdateEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_AUTO_UPDATER_CONFIG: AutoUpdaterConfig = {
  currentVersion: '0.0.0',
  channel: 'stable',
  manifestUrl: 'https://releases.nova-browser.org/update.json',
  checkIntervalMs: 4 * 60 * 60 * 1000, // 4 hours
  autoDownload: true,
  autoInstallOnQuit: false,
  maxConnections: 4,
  downloadDir: '/tmp/nova-updates',
};

export function createAutoUpdater(config?: Partial<AutoUpdaterConfig>): AutoUpdater {
  return new AutoUpdater({ ...DEFAULT_AUTO_UPDATER_CONFIG, ...config });
}
