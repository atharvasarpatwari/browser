import type { IDisposable } from '../../app/dependency-container';
import { isSecureContextRequiredPermission, isSecureContextUrl, isSecureContextOrigin } from './secure-context';
import { PermissionManager, PermissionName } from './permission-manager';

/** Result of a permission request through the privacy gate. */
interface PrivacyGateResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly state: 'prompt' | 'granted' | 'denied';
}

/** Options for the privacy gate configuration. */
interface PrivacyGateConfig {
  /** Block permissions on http:// origins by default. */
  readonly blockHttp: boolean;
  /** Allow localhost and loopback as secure contexts. */
  readonly allowLoopback: boolean;
  /** Whitelist of origins that are trusted as secure. */
  readonly originWhitelist?: readonly string[];
}

/** Privacy gate that enforces W3C Secure Contexts policy.
 *  Powerful APIs (geolocation, notifications, camera, microphone, clipboard)
 *  can only be used inside a secure context (https:, wss:, file:, localhost).
 */
export class PrivacyGate implements IDisposable {
  private readonly permissionManager: import('./permission-manager').IPermissionManager;
  private readonly config: PrivacyGateConfig;
  private readonly httpsOrigins: Set<string>;
  private readonly loopbackOrigins: Set<string>;

  constructor(
    permissionManager: import('./permission-manager').IPermissionManager,
    config: PrivacyGateConfig = {
      blockHttp: true,
      allowLoopback: true,
    }
  ) {
    this.permissionManager = permissionManager;
    this.config = config;

    // Build HTTPS origins set from permission manager store
    this.httpsOrigins = new Set();
    this.loopbackOrigins = new Set();

    // Initialize with known loopback addresses
    if (this.config.allowLoopback) {
      this.loopbackOrigins.add('localhost');
      this.loopbackOrigins.add('127.0.0.1');
      this.loopbackOrigins.add('[::1]');
    }
  }

  /** Check if an origin is allowed to use secure context required permissions. */
  checkOrigin(origin: string): PrivacyGateResult {
    // Normalize origin
    let normalizedOrigin = origin;

    try {
      const url = new URL(origin, 'https://');
      normalizedOrigin = url.origin;
    } catch {
      // If we can't parse it, check as origin string
      if (isSecureContextOrigin(origin)) {
        return { allowed: true, state: 'granted' };
      }
    }

    // Block http:// origins if configured
    if (this.config.blockHttp && normalizedOrigin.startsWith('http:')) {
      return {
        allowed: false,
        reason: 'Insecure origin (http://) — powerful permissions blocked',
        state: 'denied',
      };
    }

    // Check if this is a trusted internal scheme (nova:)
    if (this.config.originWhitelist?.includes(normalizedOrigin)) {
      return { allowed: true, state: 'granted' };
    }

    // Check if it's a secure URL (https, wss, file, or loopback)
    const isSecure = isSecureContextUrl(normalizedOrigin);

    if (isSecure) {
      return { allowed: true, state: 'granted' };
    }

    // Check loopback exception
    const lowerOrigin = normalizedOrigin.toLowerCase();
    if (this.config.allowLoopback && this.loopbackOrigins.has(lowerOrigin)) {
      return { allowed: true, state: 'granted' };
    }

    // Check whitelist
    if (this.config.originWhitelist?.includes(lowerOrigin)) {
      return { allowed: true, state: 'granted' };
    }

    return {
      allowed: false,
      reason: 'Non-secure origin — powerful permissions require https:, wss:, file:, or localhost',
      state: 'denied',
    };
  }

  /** Request a permission through the privacy gate.
   *  The permission will only be granted if the origin is secure.
   */
  async requestPermission(
    origin: string,
    permission: PermissionName,
    userGesture = false
  ): Promise<PrivacyGateResult> {
    // First check the origin
    const originCheck = this.checkOrigin(origin);
    if (!originCheck.allowed) {
      return originCheck;
    }

    // If origin is secure, request the permission normally
    const pmResult = this.permissionManager.request(origin, permission, userGesture);

    // Check if this is a secure-context-required permission
    if (isSecureContextRequiredPermission(permission)) {
      // The permissionManager.request already grants it,
      // but we should verify the origin is still secure
      // In a full implementation, we'd re-check the origin after the fact
    }

    return {
      allowed: pmResult.state !== 'denied',
      reason: pmResult.state === 'denied' ? 'Permission denied' : undefined,
      state: pmResult.state,
    };
  }

  /** Grant a permission only if the origin is secure. */
  grantIfSecure(
    origin: string,
    permission: PermissionName,
    userGesture = false
  ): PrivacyGateResult {
    const originCheck = this.checkOrigin(origin);
    if (!originCheck.allowed) {
      return originCheck;
    }

    // Origin is secure, grant the permission
    const pmResult = this.permissionManager.grant(origin, permission, userGesture);

    return {
      allowed: pmResult.state === 'granted',
      reason: undefined,
      state: pmResult.state,
    };
  }

  /** Revoke all permissions for an origin. */
  revokeAll(origin: string): void {
    this.permissionManager.revokeAll(origin);
  }

  dispose(): void {
    this.permissionManager.dispose();
  }
}

/** Convenience function to create a PrivacyGate wired into the PermissionManager. */
export function createPrivacyGate(
  permissionManager?: import('./permission-manager').PermissionManager
): PrivacyGate {
  const pm = permissionManager || new (require('./permission-manager').PermissionManager)();
  return new PrivacyGate(pm);
}

// Export the config type for use in ApplicationBootstrap
export type { PrivacyGateConfig };