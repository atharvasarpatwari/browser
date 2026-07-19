/**
 * @file src/browser/security/permission-manager.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Central per-origin permission store. Handles:
 *   • Permission types: camera, microphone, notifications, geolocation,
 *     persistent-storage, midi, sensors, clipboard-read, clipboard-write,
 *     payment-handler, push, disk-filesystem, screen-capture
 *   • States: prompt (default), granted, denied
 *   • Per-origin permission tracking with optional TTL expiration
 *   • Query, request, revoke, reset APIs
 *   • Bulk operations (resetAll, revokeAll)
 *   • Event emission on permission changes
 *   • Integration with CSP sandbox enforcer for frame permissions
 *
 * Does NOT:
 *   • Enforce permissions at the API boundary (privilege-levels.ts's job)
 *   • Map origins to contexts (origin-isolator.ts's job)
 *   • Parse CSP headers (csp-parser.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only stores and manages per-origin permissions.
 *  Encapsulation    Permission store is private; callers use the public API.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Permission names following the Permissions API spec. */
type PermissionName =
  | 'camera'
  | 'microphone'
  | 'notifications'
  | 'geolocation'
  | 'persistent-storage'
  | 'midi'
  | 'sensors'
  | 'clipboard-read'
  | 'clipboard-write'
  | 'payment-handler'
  | 'push'
  | 'disk-filesystem'
  | 'screen-capture';

/** Permission state. */
type PermissionState = 'prompt' | 'granted' | 'denied';

/** A stored permission entry. */
interface PermissionEntry {
  /** The origin this permission belongs to. */
  readonly origin: string;
  /** The permission name. */
  readonly permission: PermissionName;
  /** Current state. */
  state: PermissionState;
  /** When the permission was last changed. */
  readonly lastModified: number;
  /** Optional expiration timestamp (0 = no expiry). */
  readonly expiresAt: number;
  /** Whether the user explicitly granted/denied (vs. programmatic). */
  readonly userGesture: boolean;
}

/** Result of a permission query. */
interface PermissionQueryResult {
  /** The permission name. */
  readonly permission: PermissionName;
  /** Current state. */
  readonly state: PermissionState;
  /** Whether the permission has expired. */
  readonly expired: boolean;
  /** Whether this was a user gesture. */
  readonly userGesture: boolean;
}

/** Configuration for the permission manager. */
interface PermissionManagerConfig {
  /** Default TTL for granted permissions in milliseconds. 0 = no expiry. */
  readonly defaultTtlMs: number;
  /** Maximum number of permission entries. 0 = unlimited. */
  readonly maxEntries: number;
  /** Permissions that cannot be denied (always prompt/granted). */
  readonly undeniablePermissions: readonly PermissionName[];
}

type PermissionManagerEventType =
  | 'permissionGranted'
  | 'permissionDenied'
  | 'permissionRevoked'
  | 'permissionExpired'
  | 'allRevoked';

interface PermissionManagerEvent {
  readonly kind: PermissionManagerEventType;
  readonly origin: string;
  readonly permission?: PermissionName;
}

type PermissionManagerEventHandler = (event: PermissionManagerEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const ALL_PERMISSIONS: readonly PermissionName[] = [
  'camera', 'microphone', 'notifications', 'geolocation',
  'persistent-storage', 'midi', 'sensors', 'clipboard-read',
  'clipboard-write', 'payment-handler', 'push', 'disk-filesystem',
  'screen-capture',
];

const DEFAULT_MANAGER_CONFIG: PermissionManagerConfig = {
  defaultTtlMs: 0,
  maxEntries: 50_000,
  undeniablePermissions: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class PermissionManager implements IDisposable {
  /**
   * Key format: "origin::permission"
   * e.g. "https://example.com::camera"
   */
  private readonly store = new Map<string, PermissionEntry>();
  private readonly handlers = new Set<PermissionManagerEventHandler>();
  private readonly config: PermissionManagerConfig;
  private disposed = false;

  constructor(config?: Partial<PermissionManagerConfig>) {
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
  }

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Query the current state of a permission for an origin.
   */
  query(origin: string, permission: PermissionName): PermissionQueryResult {
    if (this.disposed) throw new Error('PermissionManager is disposed');

    const entry = this.store.get(this.key(origin, permission));

    if (!entry) {
      return {
        permission,
        state: 'prompt',
        expired: false,
        userGesture: false,
      };
    }

    // Check expiry.
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      return {
        permission,
        state: 'prompt',
        expired: true,
        userGesture: entry.userGesture,
      };
    }

    return {
      permission,
      state: entry.state,
      expired: false,
      userGesture: entry.userGesture,
    };
  }

  /**
   * Query all permissions for an origin.
   */
  queryAll(origin: string): PermissionQueryResult[] {
    return ALL_PERMISSIONS.map(p => this.query(origin, p));
  }

  // ── Request / Grant / Deny ───────────────────────────────────────────────

  /**
   * Request a permission for an origin.
   * In a real browser this would show a prompt; here we auto-grant/deny
   * based on the userGesture flag.
   */
  request(
    origin: string,
    permission: PermissionName,
    userGesture = true,
    ttlMs?: number,
  ): PermissionQueryResult {
    if (this.disposed) throw new Error('PermissionManager is disposed');

    // Check if already granted.
    const existing = this.query(origin, permission);
    if (existing.state === 'granted' && !existing.expired) {
      return existing;
    }

    // Undeniable permissions can only be prompt or granted, never denied.
    if (this.config.undeniablePermissions.includes(permission)) {
      return this.grant(origin, permission, userGesture, ttlMs);
    }

    // Auto-grant on request (simulating user clicking "Allow").
    return this.grant(origin, permission, userGesture, ttlMs);
  }

  /**
   * Explicitly grant a permission.
   */
  grant(
    origin: string,
    permission: PermissionName,
    userGesture = false,
    ttlMs?: number,
  ): PermissionQueryResult {
    if (this.disposed) throw new Error('PermissionManager is disposed');

    const effectiveTtl = ttlMs ?? this.config.defaultTtlMs;

    // Enforce capacity.
    if (this.config.maxEntries > 0 && this.store.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const entry: PermissionEntry = {
      origin,
      permission,
      state: 'granted',
      lastModified: Date.now(),
      expiresAt: effectiveTtl > 0 ? Date.now() + effectiveTtl : 0,
      userGesture,
    };

    this.store.set(this.key(origin, permission), entry);

    this.emit({ kind: 'permissionGranted', origin, permission });

    return {
      permission,
      state: 'granted',
      expired: false,
      userGesture,
    };
  }

  /**
   * Explicitly deny a permission.
   */
  deny(
    origin: string,
    permission: PermissionName,
    userGesture = false,
  ): PermissionQueryResult {
    if (this.disposed) throw new Error('PermissionManager is disposed');

    if (this.config.undeniablePermissions.includes(permission)) {
      // Cannot deny — return current state.
      return this.query(origin, permission);
    }

    const entry: PermissionEntry = {
      origin,
      permission,
      state: 'denied',
      lastModified: Date.now(),
      expiresAt: 0,
      userGesture,
    };

    this.store.set(this.key(origin, permission), entry);

    this.emit({ kind: 'permissionDenied', origin, permission });

    return {
      permission,
      state: 'denied',
      expired: false,
      userGesture,
    };
  }

  // ── Revoke ───────────────────────────────────────────────────────────────

  /**
   * Revoke a specific permission (resets to 'prompt').
   */
  revoke(origin: string, permission: PermissionName): void {
    if (this.disposed) return;
    this.store.delete(this.key(origin, permission));
    this.emit({ kind: 'permissionRevoked', origin, permission });
  }

  /**
   * Revoke all permissions for an origin.
   */
  revokeAll(origin: string): void {
    if (this.disposed) return;
    const prefix = `${origin}::`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    this.emit({ kind: 'allRevoked', origin });
  }

  /**
   * Reset all permissions across all origins.
   */
  reset(): void {
    if (this.disposed) return;
    this.store.clear();
  }

  // ── Query helpers ────────────────────────────────────────────────────────

  /**
   * Check if a specific permission is granted for an origin.
   */
  isGranted(origin: string, permission: PermissionName): boolean {
    return this.query(origin, permission).state === 'granted';
  }

  /**
   * Check if a specific permission is denied for an origin.
   */
  isDenied(origin: string, permission: PermissionName): boolean {
    return this.query(origin, permission).state === 'denied';
  }

  /**
   * Get the number of stored entries.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Get all origins that have any stored permissions.
   */
  getOrigins(): string[] {
    const origins = new Set<string>();
    for (const entry of this.store.values()) {
      origins.add(entry.origin);
    }
    return [...origins];
  }

  // ── Event system ─────────────────────────────────────────────────────────

  on(handler: PermissionManagerEventHandler): void {
    this.handlers.add(handler);
  }

  off(handler: PermissionManagerEventHandler): void {
    this.handlers.delete(handler);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private key(origin: string, permission: PermissionName): string {
    return `${origin}::${permission}`;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store) {
      if (entry.lastModified < oldestTime) {
        oldestTime = entry.lastModified;
        oldestKey = key;
      }
    }

    if (oldestKey) this.store.delete(oldestKey);
  }

  private emit(event: PermissionManagerEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch { /* handler errors must not break the manager */ }
    }
  }

  // ── Dispose ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    this.store.clear();
    this.handlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  PermissionManager,
  ALL_PERMISSIONS,
  DEFAULT_MANAGER_CONFIG,
};

export type {
  PermissionName,
  PermissionState,
  PermissionEntry,
  PermissionQueryResult,
  PermissionManagerConfig,
  PermissionManagerEvent,
  PermissionManagerEventHandler,
};
