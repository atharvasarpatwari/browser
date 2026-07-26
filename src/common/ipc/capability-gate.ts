/**
 * @file src/common/ipc/capability-gate.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Gates IPC operations based on the sender's privilege level and capabilities.
 * Every IPC request and method call passes through a CapabilityGate before
 * being dispatched. The gate checks:
 *
 *   1. Channel-level access — can this process use this IPC channel?
 *   2. Method-level access — can this process call this service method?
 *   3. Privilege escalation — is this request trying to exceed the sender's tier?
 *
 * Does NOT:
 *   • Define privilege tiers (privilege-levels.ts's job)
 *   • Define capability sets (renderer-sandbox.ts's job)
 *   • Enforce sandbox permissions (sandbox-enforcer.ts's job)
 *
 * OOP PRINCIPLES
 * ───────────────
 *  Single-Resp.     Only checks capability-based access control.
 *  Pure functions    Most checks are side-effect-free.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PrivilegeLevel, ApiSurface } from '../../browser/security/privilege-levels';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A gate decision — allow or deny with a reason. */
interface GateDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly channel?: string;
  readonly method?: string;
  readonly privilegeLevel: PrivilegeLevel;
}

/** Map from IPC channel names to required API surfaces. */
type ChannelCapabilityMap = ReadonlyMap<string, ApiSurface>;

/** Map from service method names to required API surfaces. */
type MethodCapabilityMap = ReadonlyMap<string, ApiSurface>;

/** Configuration for a capability gate. */
interface CapabilityGateConfig {
  /** The privilege level of the process this gate protects. */
  readonly privilegeLevel: PrivilegeLevel;
  /** Additional capabilities beyond the default privilege level. */
  readonly extraCapabilities?: readonly string[];
  /** Custom channel→API surface mappings (override defaults). */
  readonly channelOverrides?: ChannelCapabilityMap;
  /** Custom method→API surface mappings (override defaults). */
  readonly methodOverrides?: MethodCapabilityMap;
  /** Whether to log denied requests. */
  readonly logDenials?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CHANNEL → API SURFACE MAPPINGS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHANNEL_MAP: ChannelCapabilityMap = new Map([
  // Tab lifecycle — always allowed for any process
  ['tab-lifecycle', 'dom'],
  ['tab-lifecycle-proxy', 'dom'],

  // Renderer services — need dom + javascript
  ['renderer', 'dom'],
  ['renderer-proxy', 'dom'],

  // Navigation — needs navigation capability
  ['navigation', 'navigation-top'],
  ['navigation-proxy', 'navigation-top'],

  // DOM operations — needs dom
  ['dom', 'dom'],
  ['dom-proxy', 'dom'],

  // CSS — needs dom (CSS is part of rendering)
  ['css', 'dom'],

  // Layout — needs dom
  ['layout', 'dom'],
  ['layout-proxy', 'dom'],

  // Paint — needs dom
  ['paint', 'dom'],

  // Script execution — needs javascript
  ['script', 'eval'],

  // Network — needs fetch (proxied)
  ['network', 'fetch'],
  ['network-proxy', 'fetch'],
  ['fetch', 'fetch'],
  ['fetch-proxy', 'fetch'],

  // Storage — needs storage
  ['storage', 'storage'],
  ['storage-proxy', 'storage'],
  ['local-storage', 'storage'],
  ['session-storage', 'storage'],

  // IndexedDB — needs indexed-db
  ['indexed-db', 'indexed-db'],
  ['indexed-db-proxy', 'indexed-db'],

  // WebSocket — needs websocket
  ['websocket', 'websocket'],
  ['websocket-proxy', 'websocket'],

  // Workers — needs workers
  ['workers', 'workers'],
  ['workers-proxy', 'workers'],

  // Clipboard — needs clipboard
  ['clipboard', 'clipboard-read'],
  ['clipboard-read', 'clipboard-read'],
  ['clipboard-write', 'clipboard-write'],

  // Notifications — needs notifications
  ['notifications', 'notifications'],

  // Geolocation — needs geolocation
  ['geolocation', 'geolocation'],

  // Permissions — needs dom
  ['permissions', 'dom'],

  // Process management — needs process capability
  ['process', 'process'],
  ['process-manager', 'process'],

  // DevTools — browser chrome only
  ['devtools', 'process'],
  ['devtools-proxy', 'process'],

  // Security — browser chrome only
  ['security', 'process'],
  ['security-proxy', 'process'],

  // Canvas
  ['canvas', 'dom'],

  // Image decoding
  ['image-decode', 'dom'],

  // Console (should always work)
  ['console', 'dom'],

  // Timer (should always work)
  ['timer', 'dom'],

  // Crypto
  ['crypto', 'dom'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT METHOD → API SURFACE MAPPINGS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_METHOD_MAP: MethodCapabilityMap = new Map([
  // Render methods
  ['render-page', 'dom'],
  ['get-layout-tree', 'dom'],
  ['layout-page', 'dom'],
  ['paint-page', 'dom'],

  // DOM methods
  ['get-document', 'dom'],
  ['create-element', 'dom'],
  ['set-attribute', 'dom'],
  ['get-attribute', 'dom'],
  ['append-child', 'dom'],
  ['remove-child', 'dom'],
  ['query-selector', 'dom'],
  ['query-selector-all', 'dom'],

  // Navigation methods
  ['navigate', 'navigation-top'],
  ['go-back', 'navigation-top'],
  ['go-forward', 'navigation-top'],
  ['reload', 'navigation-top'],

  // Network methods
  ['fetch', 'fetch'],
  ['load-page', 'fetch'],
  ['load-html', 'fetch'],

  // Storage methods
  ['get-item', 'storage'],
  ['set-item', 'storage'],
  ['remove-item', 'storage'],
  ['clear', 'storage'],
  ['keys', 'storage'],

  // IndexedDB methods
  ['idb-open', 'indexed-db'],
  ['idb-transaction', 'indexed-db'],
  ['idb-get', 'indexed-db'],
  ['idb-put', 'indexed-db'],
  ['idb-delete', 'indexed-db'],
  ['idb-cursor', 'indexed-db'],

  // WebSocket methods
  ['ws-connect', 'websocket'],
  ['ws-send', 'websocket'],
  ['ws-close', 'websocket'],

  // Worker methods
  ['worker-create', 'workers'],
  ['worker-post-message', 'workers'],
  ['worker-terminate', 'workers'],

  // Clipboard methods
  ['clipboard-read', 'clipboard-read'],
  ['clipboard-write', 'clipboard-write'],

  // Notification methods
  ['notification-show', 'notifications'],
  ['notification-close', 'notifications'],

  // Geolocation methods
  ['geolocation-get', 'geolocation'],

  // Script methods
  ['execute-script', 'eval'],
  ['eval', 'eval'],

  // Process methods (high privilege)
  ['spawn-process', 'process'],
  ['destroy-process', 'process'],
  ['get-process-info', 'process'],

  // Security methods (high privilege)
  ['get-csp', 'process'],
  ['set-csp', 'process'],
  ['get-sandbox-permissions', 'process'],
  ['set-sandbox-permissions', 'process'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// CAPABILITY GATE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CapabilityGate {
  private readonly config: CapabilityGateConfig;
  private readonly channelMap: ChannelCapabilityMap;
  private readonly methodMap: MethodCapabilityMap;
  private readonly denials: Array<{
    timestamp: number;
    channel: string;
    method?: string;
    reason: string;
    privilegeLevel: PrivilegeLevel;
  }> = [];

  constructor(config: CapabilityGateConfig) {
    this.config = config;

    // Merge defaults with overrides
    const channelMap = new Map(DEFAULT_CHANNEL_MAP);
    if (config.channelOverrides) {
      for (const [k, v] of config.channelOverrides) {
        channelMap.set(k, v);
      }
    }
    this.channelMap = channelMap;

    const methodMap = new Map(DEFAULT_METHOD_MAP);
    if (config.methodOverrides) {
      for (const [k, v] of config.methodOverrides) {
        methodMap.set(k, v);
      }
    }
    this.methodMap = methodMap;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Check if an IPC channel is allowed for this process.
   */
  checkChannel(channel: string): GateDecision {
    // Browser chrome gets everything, including unknown channels
    if (this.config.privilegeLevel === 'browser-chrome') {
      return this.allow(channel, undefined);
    }

    const requiredSurface = this.channelMap.get(channel);

    // Unknown channels are denied by default
    if (!requiredSurface) {
      return this.deny(channel, undefined, `Unknown channel '${channel}'`);
    }

    // Check extra capabilities first
    if (this.config.extraCapabilities?.includes(channel)) {
      return this.allow(channel, undefined);
    }

    // Check if the channel was explicitly granted via overrides
    if (this.config.channelOverrides?.has(channel)) {
      return this.allow(channel, undefined);
    }

    // Check if the privilege level allows this API surface
    if (this.isAllowedForLevel(requiredSurface)) {
      return this.allow(channel, undefined);
    }

    return this.deny(channel, undefined,
      `Privilege level '${this.config.privilegeLevel}' denied channel '${channel}' (requires '${requiredSurface}')`);
  }

  /**
   * Check if a specific method call is allowed on a channel.
   */
  checkMethod(channel: string, method: string): GateDecision {
    // Browser chrome gets everything, including unknown methods
    if (this.config.privilegeLevel === 'browser-chrome') {
      return this.allow(channel, method);
    }

    const requiredSurface = this.methodMap.get(method);

    // Unknown methods are denied by default
    if (!requiredSurface) {
      return this.deny(channel, method, `Unknown method '${method}'`);
    }

    // Check extra capabilities first
    if (this.config.extraCapabilities?.includes(method)) {
      return this.allow(channel, method);
    }

    // Check if the method was explicitly granted via overrides
    if (this.config.methodOverrides?.has(method)) {
      return this.allow(channel, method);
    }

    // Check if the privilege level allows this API surface
    if (this.isAllowedForLevel(requiredSurface)) {
      return this.allow(channel, method);
    }

    return this.deny(channel, method,
      `Privilege level '${this.config.privilegeLevel}' denied method '${method}' on channel '${channel}' (requires '${requiredSurface}')`);
  }

  /**
   * Check both channel and method in one call.
   */
  check(channel: string, method?: string): GateDecision {
    const channelResult = this.checkChannel(channel);
    if (!channelResult.allowed) return channelResult;

    if (method) {
      return this.checkMethod(channel, method);
    }

    return channelResult;
  }

  /**
   * Get the privilege level this gate is protecting.
   */
  getPrivilegeLevel(): PrivilegeLevel {
    return this.config.privilegeLevel;
  }

  /**
   * Get recent denials (for auditing).
   */
  getDenials(limit: number = 100): readonly typeof this.denials[number][] {
    return this.denials.slice(-limit);
  }

  /**
   * Get denial count.
   */
  getDenialCount(): number {
    return this.denials.length;
  }

  /**
   * Clear denial history.
   */
  clearDenials(): void {
    this.denials.length = 0;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private allow(channel: string, method?: string): GateDecision {
    return {
      allowed: true,
      reason: 'OK',
      channel,
      method,
      privilegeLevel: this.config.privilegeLevel,
    };
  }

  private deny(channel: string, method: string | undefined, reason: string): GateDecision {
    const denial = {
      timestamp: Date.now(),
      channel,
      method,
      reason,
      privilegeLevel: this.config.privilegeLevel,
    };

    this.denials.push(denial);
    if (this.denials.length > 1000) {
      this.denials.splice(0, this.denials.length - 1000);
    }

    if (this.config.logDenials) {
      console.warn(`[CapabilityGate] DENIED: ${reason}`);
    }

    return {
      allowed: false,
      reason,
      channel,
      method,
      privilegeLevel: this.config.privilegeLevel,
    };
  }

  /**
   * Determine if an API surface is allowed for the current privilege level.
   * This is a simplified check — the full check uses PrivilegeLevels + SandboxManager.
   */
  private isAllowedForLevel(surface: ApiSurface): boolean {
    switch (this.config.privilegeLevel) {
      case 'sandboxed-content':
        // Only basic DOM operations
        return surface === 'dom';

      case 'web-content':
        // DOM, fetch, storage, websocket, workers, eval, timers, clipboard, notifications, geolocation
        return ['dom', 'fetch', 'storage', 'indexed-db', 'websocket', 'workers',
                'eval', 'navigation-top', 'notification', 'notifications',
                'geolocation', 'clipboard-read', 'clipboard-write',
                'dom-events', 'dialogs'].includes(surface);

      case 'trusted-extension':
        // Most things except hardware access
        return !['process', 'native-messaging'].includes(surface);

      case 'browser-chrome':
        // Everything
        return true;

      default:
        return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a CapabilityGate for a renderer process based on its privilege level.
 */
function createCapabilityGate(
  privilegeLevel: PrivilegeLevel,
  options?: {
    extraCapabilities?: readonly string[];
    channelOverrides?: ChannelCapabilityMap;
    methodOverrides?: MethodCapabilityMap;
    logDenials?: boolean;
  },
): CapabilityGate {
  return new CapabilityGate({
    privilegeLevel,
    extraCapabilities: options?.extraCapabilities,
    channelOverrides: options?.channelOverrides,
    methodOverrides: options?.methodOverrides,
    logDenials: options?.logDenials ?? false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CapabilityGate,
  createCapabilityGate,
  DEFAULT_CHANNEL_MAP,
  DEFAULT_METHOD_MAP,
};

export type {
  GateDecision,
  ChannelCapabilityMap,
  MethodCapabilityMap,
  CapabilityGateConfig,
};
