/**
 * @file src/browser/settings/sync.ts
 *
 * Cross-device sync engine — syncs bookmarks, history, settings, passwords,
 * and extensions across devices via an end-to-end encrypted sync protocol.
 */

import type { IDisposable } from '../../app/dependency-container';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type SyncDataType = 'bookmarks' | 'history' | 'settings' | 'passwords' | 'extensions' | 'open-tabs';

export type SyncStatus = 'disabled' | 'connecting' | 'syncing' | 'synced' | 'error';

export interface SyncConfig {
  enabled: boolean;
  syncId: string;
  passphrase: string;
  /** Which data types to sync */
  syncTypes: SyncDataType[];
  /** Server endpoint URL */
  endpointUrl: string;
  /** Encryption key derived from passphrase */
  encryptionKey: string;
  /** Last sync timestamp */
  lastSyncAt: number;
  /** Sync interval (ms) */
  syncIntervalMs: number;
}

export interface SyncDevice {
  readonly deviceId: string;
  readonly name: string;
  readonly platform: string;
  readonly lastSeenAt: number;
  readonly syncVersion: number;
}

export interface SyncRecord {
  readonly id: string;
  readonly type: SyncDataType;
  readonly deviceId: string;
  readonly timestamp: number;
  readonly action: 'create' | 'update' | 'delete';
  readonly data: unknown;
  readonly checksum: string;
}

export interface SyncConflict {
  readonly recordId: string;
  readonly type: SyncDataType;
  readonly local: SyncRecord;
  readonly remote: SyncRecord;
}

export type SyncEventType = 'syncStarted' | 'syncCompleted' | 'syncFailed' | 'conflictDetected' | 'statusChanged' | 'deviceAdded' | 'deviceRemoved';

export interface SyncEvent {
  readonly kind: SyncEventType;
  readonly status?: SyncStatus;
  readonly recordCount?: number;
  readonly conflictCount?: number;
  readonly deviceId?: string;
  readonly error?: string;
}

export type SyncEventHandler = (event: SyncEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// ENCRYPTION UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

export function deriveEncryptionKey(passphrase: string): string {
  return createHash('sha256').update(passphrase).digest('hex');
}

export function computeChecksum(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface ISyncEngine extends IDisposable {
  /** Initialize sync engine */
  initialize(): Promise<void>;
  /** Enable sync */
  enable(passphrase: string): Promise<void>;
  /** Disable sync */
  disable(): void;
  /** Get sync status */
  getStatus(): SyncStatus;
  /** Get sync config */
  getConfig(): SyncConfig;
  /** Get all synced devices */
  getDevices(): readonly SyncDevice[];
  /** Get current device ID */
  getDeviceId(): string;
  /** Get pending conflicts */
  getConflicts(): readonly SyncConflict[];
  /** Resolve a conflict (use local or remote) */
  resolveConflict(recordId: string, useLocal: boolean): void;
  /** Force a full sync */
  forceSync(): Promise<void>;
  /** Push local changes */
  pushChanges(records: SyncRecord[]): Promise<void>;
  /** Pull remote changes */
  pullChanges(): Promise<SyncRecord[]>;
  /** Subscribe to events */
  onEvent(handler: SyncEventHandler): () => void;
  /** Get sync stats */
  getStats(): SyncStats;
}

export interface SyncStats {
  totalSynced: number;
  lastSyncDuration: number;
  conflictsTotal: number;
  conflictsResolved: number;
  deviceCount: number;
  dataTypes: Record<SyncDataType, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

export class SyncEngine implements ISyncEngine {
  private config: SyncConfig;
  private status: SyncStatus = 'disabled';
  private devices: SyncDevice[] = [];
  private conflicts: SyncConflict[] = [];
  private pendingRecords: SyncRecord[] = [];
  private handlers: SyncEventHandler[] = [];
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private deviceId: string;
  private stats: SyncStats;
  private disposed = false;
  private initialized = false;

  constructor(config?: Partial<SyncConfig>) {
    this.deviceId = `device-${randomUUID().slice(0, 8)}`;
    this.config = {
      enabled: false,
      syncId: '',
      passphrase: '',
      syncTypes: ['bookmarks', 'history', 'settings'],
      endpointUrl: 'https://sync.nova-browser.org',
      encryptionKey: '',
      lastSyncAt: 0,
      syncIntervalMs: 300_000, // 5 minutes
      ...config,
    };
    this.stats = {
      totalSynced: 0,
      lastSyncDuration: 0,
      conflictsTotal: 0,
      conflictsResolved: 0,
      deviceCount: 1,
      dataTypes: { bookmarks: 0, history: 0, settings: 0, passwords: 0, extensions: 0, 'open-tabs': 0 },
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (this.config.enabled && this.config.passphrase) {
      this.status = 'syncing';
      this.emit({ kind: 'statusChanged', status: 'syncing' });
    }
  }

  async enable(passphrase: string): Promise<void> {
    this.config.enabled = true;
    this.config.passphrase = passphrase;
    this.config.encryptionKey = deriveEncryptionKey(passphrase);
    this.config.syncId = this.config.syncId || randomUUID();

    this.status = 'syncing';
    this.emit({ kind: 'statusChanged', status: 'syncing' });

    // Start periodic sync
    this.syncTimer = setInterval(() => {
      this.forceSync().catch(() => {});
    }, this.config.syncIntervalMs);

    // Initial sync
    await this.forceSync();
  }

  disable(): void {
    this.config.enabled = false;
    this.config.passphrase = '';
    this.config.encryptionKey = '';

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    this.status = 'disabled';
    this.emit({ kind: 'statusChanged', status: 'disabled' });
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getConfig(): SyncConfig {
    return { ...this.config };
  }

  getDevices(): readonly SyncDevice[] {
    return [...this.devices];
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getConflicts(): readonly SyncConflict[] {
    return [...this.conflicts];
  }

  resolveConflict(recordId: string, useLocal: boolean): void {
    const idx = this.conflicts.findIndex(c => c.recordId === recordId);
    if (idx < 0) return;
    this.conflicts.splice(idx, 1);
    this.stats.conflictsResolved++;
  }

  async forceSync(): Promise<void> {
    if (!this.config.enabled || this.disposed) return;

    this.emit({ kind: 'syncStarted' });
    const startTime = Date.now();

    try {
      // Pull remote changes
      const remoteRecords = await this.pullChanges();

      // Push local changes
      if (this.pendingRecords.length > 0) {
        await this.pushChanges(this.pendingRecords);
        this.pendingRecords = [];
      }

      // Detect conflicts
      for (const remote of remoteRecords) {
        const local = this.pendingRecords.find(r => r.id === remote.id);
        if (local && local.timestamp > remote.timestamp) {
          this.conflicts.push({
            recordId: remote.id,
            type: remote.type,
            local,
            remote,
          });
          this.emit({ kind: 'conflictDetected' });
          this.stats.conflictsTotal++;
        }
      }

      this.config.lastSyncAt = Date.now();
      this.stats.lastSyncDuration = Date.now() - startTime;
      this.stats.totalSynced += remoteRecords.length;

      this.status = 'synced';
      this.emit({ kind: 'syncCompleted', recordCount: remoteRecords.length });
      this.emit({ kind: 'statusChanged', status: 'synced' });
    } catch (err: any) {
      this.status = 'error';
      this.emit({ kind: 'syncFailed', error: err.message });
      this.emit({ kind: 'statusChanged', status: 'error' });
    }
  }

  async pushChanges(records: SyncRecord[]): Promise<void> {
    // In production, this would POST to the sync server with E2E encryption.
    // For now, just accumulate stats.
    for (const record of records) {
      this.stats.dataTypes[record.type]++;
    }
    this.stats.totalSynced += records.length;
  }

  async pullChanges(): Promise<SyncRecord[]> {
    // In production, this would GET from the sync server.
    // For now, return empty.
    return [];
  }

  onEvent(handler: SyncEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx >= 0) this.handlers.splice(idx, 1);
    };
  }

  getStats(): SyncStats {
    return { ...this.stats, deviceCount: this.devices.length };
  }

  dispose(): void {
    this.disposed = true;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.handlers.length = 0;
  }

  private emit(event: SyncEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch {}
    }
  }
}

export function createSyncEngine(config?: Partial<SyncConfig>): SyncEngine {
  return new SyncEngine(config);
}
