/**
 * @file src/browser/security/sandbox-enforcer.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Integrates SandboxManager, PrivilegeLevels, and CapabilityGate into a single
 * enforcement point for IPC communication. Every IPC request from a renderer
 * process passes through this enforcer before being dispatched.
 *
 * Flow:
 *   1. Receive IPC request from a renderer process
 *   2. Resolve the sender's origin, privilege level, and sandbox permissions
 *   3. Check the CapabilityGate for channel/method access
 *   4. Apply SandboxManager permission overrides
 *   5. Allow or deny the request
 *   6. Emit events for monitoring and auditing
 *
 * Does NOT:
 *   • Spawn or manage processes (process-manager.ts's job)
 *   • Define capability sets (renderer-sandbox.ts's job)
 *   • Handle CSP (csp-enforcement.ts's job)
 *
 * OOP PRINCIPLES
 * ───────────────
 *  Single-Resp.     Only enforces sandbox rules at the IPC boundary.
 *  Open/Closed      New enforcement rules can be added via middleware pattern.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';
import type { PrivilegeLevel, ApiSurface } from './privilege-levels';
import { PrivilegeLevels } from './privilege-levels';
import type { ISandboxManager, SandboxPermissions } from './sandbox-manager';
import { DEFAULT_SANDBOX_PERMISSIONS } from './sandbox-manager';
import { CapabilityGate, createCapabilityGate, type GateDecision } from '../../common/ipc/capability-gate';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Context for an IPC request being evaluated. */
interface EnforcementContext {
  /** The process ID making the request. */
  readonly processId: string;
  /** The origin of the process (if known). */
  readonly origin: string;
  /** The tab ID the process is associated with. */
  readonly tabId: string;
  /** The IPC channel being accessed. */
  readonly channel: string;
  /** The method being called (if any). */
  readonly method?: string;
  /** Timestamp of the request. */
  readonly timestamp: number;
}

/** Result of an enforcement check. */
interface EnforcementResult {
  /** Whether the request is allowed. */
  readonly allowed: boolean;
  /** The decision details. */
  readonly decision: GateDecision;
  /** Sandbox permissions applied (if any). */
  readonly sandboxPermissions?: SandboxPermissions;
  /** The resolved privilege level. */
  readonly privilegeLevel: PrivilegeLevel;
  /** Reason for denial (if denied). */
  readonly reason?: string;
}

/** Event emitted when a request is denied. */
interface EnforcementDeniedEvent {
  readonly kind: 'enforcementDenied';
  readonly context: EnforcementContext;
  readonly result: EnforcementResult;
  readonly timestamp: number;
}

/** Event emitted when a request is allowed. */
interface EnforcementAllowedEvent {
  readonly kind: 'enforcementAllowed';
  readonly context: EnforcementContext;
  readonly result: EnforcementResult;
  readonly timestamp: number;
}

type EnforcementEvent = EnforcementDeniedEvent | EnforcementAllowedEvent;
type EnforcementEventHandler = (event: EnforcementEvent) => void;

/** Configuration for the SandboxEnforcer. */
interface SandboxEnforcerConfig {
  /** Default privilege level for unknown processes. */
  readonly defaultPrivilegeLevel: PrivilegeLevel;
  /** Whether to enforce at all (disable for testing). */
  readonly enabled: boolean;
  /** Whether to log denials. */
  readonly logDenials: boolean;
  /** Whether to emit events. */
  readonly emitEvents: boolean;
  /** Maximum denials to keep in history. */
  readonly maxDenialHistory: number;
}

const DEFAULT_ENFORCER_CONFIG: SandboxEnforcerConfig = {
  defaultPrivilegeLevel: 'web-content',
  enabled: true,
  logDenials: true,
  emitEvents: true,
  maxDenialHistory: 1000,
};

// ─────────────────────────────────────────────────────────────────────────────
// SANDBOX ENFORCER
// ─────────────────────────────────────────────────────────────────────────────

class SandboxEnforcer implements IDisposable {
  private readonly config: SandboxEnforcerConfig;
  private readonly privilegeLevels: PrivilegeLevels;
  private readonly sandboxManager: ISandboxManager;
  private readonly gates = new Map<string, CapabilityGate>();
  private readonly eventHandlers = new Set<EnforcementEventHandler>();
  private readonly denialHistory: EnforcementDeniedEvent[] = [];
  private _disposed = false;

  constructor(
    sandboxManager: ISandboxManager,
    privilegeLevels?: PrivilegeLevels,
    config?: Partial<SandboxEnforcerConfig>,
  ) {
    this.config = { ...DEFAULT_ENFORCER_CONFIG, ...config };
    this.sandboxManager = sandboxManager;
    this.privilegeLevels = privilegeLevels ?? new PrivilegeLevels();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Register a process with its privilege level and origin.
   * Creates a CapabilityGate for the process.
   */
  registerProcess(
    processId: string,
    privilegeLevel: PrivilegeLevel,
    origin: string,
    tabId: string,
  ): void {
    const gate = createCapabilityGate(privilegeLevel, {
      logDenials: this.config.logDenials,
    });
    this.gates.set(processId, gate);
  }

  /**
   * Unregister a process (e.g., on process exit).
   */
  unregisterProcess(processId: string): void {
    this.gates.delete(processId);
  }

  /**
   * Enforce sandbox rules on an IPC request.
   * Returns an EnforcementResult indicating whether the request is allowed.
   */
  enforce(context: EnforcementContext): EnforcementResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        decision: {
          allowed: true,
          reason: 'Enforcement disabled',
          channel: context.channel,
          method: context.method,
          privilegeLevel: 'browser-chrome',
        },
        privilegeLevel: 'browser-chrome',
      };
    }

    // 1. Get the gate for this process
    const gate = this.gates.get(context.processId);
    if (!gate) {
      // Unknown process — use default privilege level
      const defaultGate = this.createDefaultGate(context.processId);
      const decision = defaultGate.check(context.channel, context.method);
      const result: EnforcementResult = {
        allowed: decision.allowed,
        decision,
        privilegeLevel: decision.privilegeLevel,
        reason: decision.allowed ? undefined : decision.reason,
      };

      if (!decision.allowed) {
        this.recordDenial(context, result);
      }

      return result;
    }

    // 2. Check channel/method access via CapabilityGate
    const gateDecision = gate.check(context.channel, context.method);
    if (!gateDecision.allowed) {
      const result: EnforcementResult = {
        allowed: false,
        decision: gateDecision,
        privilegeLevel: gateDecision.privilegeLevel,
        reason: gateDecision.reason,
      };
      this.recordDenial(context, result);
      return result;
    }

    // 3. Apply sandbox permission overrides
    const sandboxPerms = this.sandboxManager.getPermissionsForOrigin(context.origin);
    const privilegeLevel = gate.getPrivilegeLevel();

    // Check if the sandbox permissions deny something the gate allows
    const sandboxResult = this.checkSandboxPermissions(
      context,
      privilegeLevel,
      sandboxPerms,
    );

    if (!sandboxResult.allowed) {
      this.recordDenial(context, sandboxResult);
      return sandboxResult;
    }

    // 4. All checks passed
    const result: EnforcementResult = {
      allowed: true,
      decision: gateDecision,
      sandboxPermissions: sandboxPerms,
      privilegeLevel,
    };

    if (this.config.emitEvents) {
      this.emit({
        kind: 'enforcementAllowed',
        context,
        result,
        timestamp: Date.now(),
      });
    }

    return result;
  }

  /**
   * Check if a specific API surface is allowed for a process.
   */
  checkApiAccess(
    processId: string,
    apiSurface: ApiSurface,
    origin: string,
  ): boolean {
    const gate = this.gates.get(processId);
    if (!gate) return false;

    const privilegeLevel = gate.getPrivilegeLevel();
    const check = this.privilegeLevels.check(privilegeLevel, apiSurface);

    if (!check.allowed) return false;

    // Also check sandbox permissions
    const sandboxPerms = this.sandboxManager.getPermissionsForOrigin(origin);
    const sandboxCheck = this.privilegeLevels.checkWithSandbox(
      privilegeLevel,
      apiSurface,
      sandboxPerms,
    );

    return sandboxCheck.allowed;
  }

  /**
   * Get the privilege level for a process.
   */
  getPrivilegeLevel(processId: string): PrivilegeLevel | null {
    const gate = this.gates.get(processId);
    return gate ? gate.getPrivilegeLevel() : null;
  }

  /**
   * Get recent denials.
   */
  getDenialHistory(limit: number = 100): readonly EnforcementDeniedEvent[] {
    return this.denialHistory.slice(-limit);
  }

  /**
   * Get denial count.
   */
  getDenialCount(): number {
    return this.denialHistory.length;
  }

  /**
   * Subscribe to enforcement events.
   */
  on(handler: EnforcementEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Unsubscribe from enforcement events.
   */
  off(handler: EnforcementEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Check if the enforcer is disposed.
   */
  get disposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    this._disposed = true;
    this.gates.clear();
    this.eventHandlers.clear();
    this.denialHistory.length = 0;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private createDefaultGate(processId: string): CapabilityGate {
    const gate = createCapabilityGate(this.config.defaultPrivilegeLevel, {
      logDenials: this.config.logDenials,
    });
    this.gates.set(processId, gate);
    return gate;
  }

  private checkSandboxPermissions(
    context: EnforcementContext,
    privilegeLevel: PrivilegeLevel,
    perms: SandboxPermissions,
  ): EnforcementResult {
    // Map sandbox permission fields to the IPC surfaces they restrict.
    // Only check permissions that are RELEVANT to the requested channel/method.
    const permissionChecks: Array<{
      channel: string;
      method?: string;
      permission: boolean;
      surface: ApiSurface;
    }> = [
      // Scripts: block eval when allowScripts is false
      { channel: 'script', method: 'execute-script', permission: perms.allowScripts, surface: 'eval' },
      { channel: 'script', permission: perms.allowScripts, surface: 'eval' },
      // Navigation: block top-navigation when allowTopNavigation is false
      { channel: 'navigation', method: 'navigate', permission: perms.allowTopNavigation, surface: 'navigation-top' },
      { channel: 'navigation', permission: perms.allowTopNavigation, surface: 'navigation-top' },
    ];

    for (const check of permissionChecks) {
      if (!check.permission) {
        // Only deny if the channel/method actually matches
        if (context.channel === check.channel && (!check.method || context.method === check.method)) {
          return {
            allowed: false,
            decision: {
              allowed: false,
              reason: `Sandbox permission denied '${check.surface}' on channel '${context.channel}'`,
              channel: context.channel,
              method: context.method,
              privilegeLevel,
            },
            sandboxPermissions: perms,
            privilegeLevel,
            reason: `Sandbox permission denied '${check.surface}' on channel '${context.channel}'`,
          };
        }
      }
    }

    // Sandbox doesn't add extra restrictions for this request
    return {
      allowed: true,
      decision: {
        allowed: true,
        reason: 'Sandbox check passed',
        channel: context.channel,
        method: context.method,
        privilegeLevel,
      },
      sandboxPermissions: perms,
      privilegeLevel,
    };
  }

  private recordDenial(context: EnforcementContext, result: EnforcementResult): void {
    const event: EnforcementDeniedEvent = {
      kind: 'enforcementDenied',
      context,
      result,
      timestamp: Date.now(),
    };

    this.denialHistory.push(event);
    if (this.denialHistory.length > this.config.maxDenialHistory) {
      this.denialHistory.splice(0, this.denialHistory.length - this.config.maxDenialHistory);
    }

    if (this.config.logDenials) {
      console.warn(
        `[SandboxEnforcer] DENIED process=${context.processId} origin=${context.origin} ` +
        `channel=${context.channel}${context.method ? ` method=${context.method}` : ''} ` +
        `reason=${result.reason}`,
      );
    }

    if (this.config.emitEvents) {
      this.emit(event);
    }
  }

  private emit(event: EnforcementEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* swallow */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a fully-wired SandboxEnforcer.
 */
function createSandboxEnforcer(
  sandboxManager: ISandboxManager,
  options?: {
    privilegeLevels?: PrivilegeLevels;
    defaultPrivilegeLevel?: PrivilegeLevel;
    logDenials?: boolean;
    enabled?: boolean;
  },
): SandboxEnforcer {
  return new SandboxEnforcer(sandboxManager, options?.privilegeLevels, {
    defaultPrivilegeLevel: options?.defaultPrivilegeLevel ?? 'web-content',
    logDenials: options?.logDenials ?? true,
    enabled: options?.enabled ?? true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  SandboxEnforcer,
  createSandboxEnforcer,
  DEFAULT_ENFORCER_CONFIG,
};

export type {
  EnforcementContext,
  EnforcementResult,
  EnforcementEvent,
  EnforcementDeniedEvent,
  EnforcementAllowedEvent,
  EnforcementEventHandler,
  SandboxEnforcerConfig,
};
