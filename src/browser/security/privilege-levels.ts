/**
 * @file src/browser/security/privilege-levels.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Browser chrome vs web content privilege separation. Handles:
 *   • Privilege tiers: browser-chrome, trusted-extension, web-content,
 *     sandboxed-content
 *   • API surface control per tier (which APIs are available)
 *   • `checkPrivilege(currentLevel, requiredLevel)` decision API
 *   • Integration with SandboxManager for iframe sandboxing
 *   • Privilege escalation prevention
 *   • Dynamic privilege transitions (e.g., extension loading)
 *
 * Does NOT:
 *   • Manage user permissions (permission-manager.ts's job)
 *   • Map origins to contexts (origin-isolator.ts's job)
 *   • Enforce CSP (csp-evaluator.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only manages privilege tiers and API surface control.
 *  Pure functions    Most checks are side-effect-free.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SandboxPermissions } from './sandbox-manager';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Privilege tier — higher number = more privilege. */
type PrivilegeLevel = 'sandboxed-content' | 'web-content' | 'trusted-extension' | 'browser-chrome';

/** An API surface that can be gated by privilege level. */
type ApiSurface =
  | 'dom'                   /* DOM read/write */
  | 'dom-cross-origin'      /* Cross-origin DOM access */
  | 'fetch'                 /* Network fetch */
  | 'fetch-cross-origin'    /* Cross-origin fetch */
  | 'websocket'             /* WebSocket connections */
  | 'storage'               /* localStorage, sessionStorage */
  | 'indexed-db'            /* IndexedDB */
  | 'cookies'               /* Cookie access */
  | 'workers'               /* Web Workers */
  | 'shared-workers'        /* Shared Workers */
  | 'service-workers'       /* Service Workers */
  | 'notifications'         /* Push notifications */
  | 'geolocation'           /* Geolocation API */
  | 'camera'                /* Camera access */
  | 'microphone'            /* Microphone access */
  | 'screen-capture'        /* Screen capture */
  | 'payment'               /* Payment APIs */
  | 'midi'                  /* MIDI access */
  | 'bluetooth'             /* Bluetooth API */
  | 'usb'                   /* USB API */
  | 'nfc'                   /* NFC API */
  | 'file-system'           /* File System API (sandboxed) */
  | 'file-system-external'  /* Access to local file system */
  | 'process'               /* Process management */
  | 'native-messaging'      /* Native messaging host */
  | 'clipboard-read'        /* Read clipboard */
  | 'clipboard-write'       /* Write clipboard */
  | 'eval'                  /* eval() and new Function() */
  | 'timeout-string'        /* setTimeout with string argument */
  | 'navigation-top'        /* Top-level navigation */
  | 'popup'                 /* Window.open / popups */
  | 'pointer-lock'          /* Pointer lock API */
  | 'fullscreen'            /* Fullscreen API */
  | 'dialog'                /* alert/confirm/prompt */
  | 'print'                 /* window.print() */

/** A privilege policy — maps API surfaces to whether they're allowed. */
type PrivilegePolicy = ReadonlyMap<ApiSurface, boolean>;

/** Configuration for privilege levels. */
interface PrivilegeLevelConfig {
  /** Custom API policies per level (overrides defaults). */
  readonly customPolicies?: Partial<Record<PrivilegeLevel, Partial<PrivilegePolicy>>>;
}

/** Result of a privilege check. */
interface PrivilegeCheckResult {
  /** Whether the access is allowed. */
  readonly allowed: boolean;
  /** The current privilege level. */
  readonly currentLevel: PrivilegeLevel;
  /** The required privilege level. */
  readonly requiredLevel: PrivilegeLevel;
  /** The API surface being checked. */
  readonly apiSurface: ApiSurface;
  /** Reason for denial, if blocked. */
  readonly reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Numeric order for level comparison. */
const LEVEL_ORDER: Record<PrivilegeLevel, number> = {
  'sandboxed-content': 0,
  'web-content': 1,
  'trusted-extension': 2,
  'browser-chrome': 3,
};

/** Default API policies per privilege level. */
const DEFAULT_POLICIES: Record<PrivilegeLevel, PrivilegePolicy> = {
  'sandboxed-content': new Map<ApiSurface, boolean>([
    ['dom', true],
    ['dom-cross-origin', false],
    ['fetch', false],
    ['fetch-cross-origin', false],
    ['websocket', false],
    ['storage', false],
    ['indexed-db', false],
    ['cookies', false],
    ['workers', false],
    ['shared-workers', false],
    ['service-workers', false],
    ['notifications', false],
    ['geolocation', false],
    ['camera', false],
    ['microphone', false],
    ['screen-capture', false],
    ['payment', false],
    ['midi', false],
    ['bluetooth', false],
    ['usb', false],
    ['nfc', false],
    ['file-system', false],
    ['file-system-external', false],
    ['process', false],
    ['native-messaging', false],
    ['clipboard-read', false],
    ['clipboard-write', false],
    ['eval', false],
    ['timeout-string', false],
    ['navigation-top', false],
    ['popup', false],
    ['pointer-lock', false],
    ['fullscreen', false],
    ['dialog', false],
    ['print', false],
  ]),

  'web-content': new Map<ApiSurface, boolean>([
    ['dom', true],
    ['dom-cross-origin', false],
    ['fetch', true],
    ['fetch-cross-origin', false],
    ['websocket', true],
    ['storage', true],
    ['indexed-db', true],
    ['cookies', true],
    ['workers', true],
    ['shared-workers', true],
    ['service-workers', true],
    ['notifications', false],
    ['geolocation', false],
    ['camera', false],
    ['microphone', false],
    ['screen-capture', false],
    ['payment', false],
    ['midi', false],
    ['bluetooth', false],
    ['usb', false],
    ['nfc', false],
    ['file-system', false],
    ['file-system-external', false],
    ['process', false],
    ['native-messaging', false],
    ['clipboard-read', false],
    ['clipboard-write', false],
    ['eval', true],
    ['timeout-string', true],
    ['navigation-top', true],
    ['popup', true],
    ['pointer-lock', false],
    ['fullscreen', false],
    ['dialog', true],
    ['print', true],
  ]),

  'trusted-extension': new Map<ApiSurface, boolean>([
    ['dom', true],
    ['dom-cross-origin', true],
    ['fetch', true],
    ['fetch-cross-origin', true],
    ['websocket', true],
    ['storage', true],
    ['indexed-db', true],
    ['cookies', true],
    ['workers', true],
    ['shared-workers', true],
    ['service-workers', true],
    ['notifications', true],
    ['geolocation', true],
    ['camera', false],
    ['microphone', false],
    ['screen-capture', false],
    ['payment', false],
    ['midi', true],
    ['bluetooth', false],
    ['usb', false],
    ['nfc', false],
    ['file-system', true],
    ['file-system-external', false],
    ['process', false],
    ['native-messaging', false],
    ['clipboard-read', true],
    ['clipboard-write', true],
    ['eval', true],
    ['timeout-string', true],
    ['navigation-top', true],
    ['popup', true],
    ['pointer-lock', false],
    ['fullscreen', true],
    ['dialog', true],
    ['print', true],
  ]),

  'browser-chrome': new Map<ApiSurface, boolean>([
    ['dom', true],
    ['dom-cross-origin', true],
    ['fetch', true],
    ['fetch-cross-origin', true],
    ['websocket', true],
    ['storage', true],
    ['indexed-db', true],
    ['cookies', true],
    ['workers', true],
    ['shared-workers', true],
    ['service-workers', true],
    ['notifications', true],
    ['geolocation', true],
    ['camera', true],
    ['microphone', true],
    ['screen-capture', true],
    ['payment', true],
    ['midi', true],
    ['bluetooth', true],
    ['usb', true],
    ['nfc', true],
    ['file-system', true],
    ['file-system-external', true],
    ['process', true],
    ['native-messaging', true],
    ['clipboard-read', true],
    ['clipboard-write', true],
    ['eval', true],
    ['timeout-string', true],
    ['navigation-top', true],
    ['popup', true],
    ['pointer-lock', true],
    ['fullscreen', true],
    ['dialog', true],
    ['print', true],
  ]),
};

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class PrivilegeLevels {
  private readonly policies: Record<PrivilegeLevel, PrivilegePolicy>;

  constructor(config?: PrivilegeLevelConfig) {
    // Clone defaults and apply custom overrides.
    this.policies = {} as Record<PrivilegeLevel, PrivilegePolicy>;

    for (const level of Object.keys(DEFAULT_POLICIES) as PrivilegeLevel[]) {
      const base = new Map(DEFAULT_POLICIES[level]);
      const custom = config?.customPolicies?.[level];
      if (custom) {
        if (custom instanceof Map) {
          for (const [api, allowed] of custom) {
            base.set(api, allowed);
          }
        } else {
          for (const [api, allowed] of Object.entries(custom)) {
            base.set(api as ApiSurface, allowed as boolean);
          }
        }
      }
      this.policies[level] = base;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Check if a privilege level has access to an API surface.
   */
  check(level: PrivilegeLevel, apiSurface: ApiSurface): PrivilegeCheckResult {
    const policy = this.policies[level];
    const allowed = policy.get(apiSurface) ?? false;

    return {
      allowed,
      currentLevel: level,
      requiredLevel: level,
      apiSurface,
      reason: allowed ? undefined : `Privilege level '${level}' denied access to '${apiSurface}'`,
    };
  }

  /**
   * Check if a current level satisfies a required level for an API surface.
   */
  checkPrivilege(
    currentLevel: PrivilegeLevel,
    requiredLevel: PrivilegeLevel,
    apiSurface: ApiSurface,
  ): PrivilegeCheckResult {
    const currentOrder = LEVEL_ORDER[currentLevel];
    const requiredOrder = LEVEL_ORDER[requiredLevel];

    // Must have at least the required privilege level.
    if (currentOrder < requiredOrder) {
      return {
        allowed: false,
        currentLevel,
        requiredLevel,
        apiSurface,
        reason: `Insufficient privilege: '${currentLevel}' < '${requiredLevel}' for '${apiSurface}'`,
      };
    }

    // Check the API surface at the current level.
    return this.check(currentLevel, apiSurface);
  }

  /**
   * Check if a level can access an API, considering sandbox permissions.
   * For sandboxed content, checks SandboxPermissions for specific overrides.
   */
  checkWithSandbox(
    level: PrivilegeLevel,
    apiSurface: ApiSurface,
    sandboxPerms?: SandboxPermissions,
  ): PrivilegeCheckResult {
    if (level !== 'sandboxed-content' || !sandboxPerms) {
      return this.check(level, apiSurface);
    }

    // Sandbox-specific overrides based on SandboxPermissions.
    const sandboxAllowed = this.getSandboxOverride(apiSurface, sandboxPerms);
    if (sandboxAllowed !== null) {
      return {
        allowed: sandboxAllowed,
        currentLevel: level,
        requiredLevel: level,
        apiSurface,
        reason: sandboxAllowed ? undefined : `Sandboxed content denied '${apiSurface}'`,
      };
    }

    return this.check(level, apiSurface);
  }

  /**
   * Get the API policy for a privilege level.
   */
  getPolicy(level: PrivilegeLevel): ReadonlyMap<ApiSurface, boolean> {
    return this.policies[level];
  }

  /**
   * Check if two levels are the same.
   */
  isSameLevel(a: PrivilegeLevel, b: PrivilegeLevel): boolean {
    return a === b;
  }

  /**
   * Get all available privilege levels.
   */
  getLevels(): readonly PrivilegeLevel[] {
    return ['sandboxed-content', 'web-content', 'trusted-extension', 'browser-chrome'];
  }

  /**
   * Get the numeric order of a level.
   */
  getOrder(level: PrivilegeLevel): number {
    return LEVEL_ORDER[level];
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private getSandboxOverride(
    apiSurface: ApiSurface,
    perms: SandboxPermissions,
  ): boolean | null {
    switch (apiSurface) {
      case 'eval':
      case 'timeout-string':
        return perms.allowScripts;
      case 'dialog':
        return perms.allowModals;
      case 'navigation-top':
        return perms.allowTopNavigation;
      case 'popup':
        return perms.allowPopups;
      case 'pointer-lock':
        return perms.allowPointerLock;
      default:
        return null; // no sandbox override — use default policy
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  PrivilegeLevels,
  LEVEL_ORDER,
  DEFAULT_POLICIES,
};

export type {
  PrivilegeLevel,
  ApiSurface,
  PrivilegePolicy,
  PrivilegeLevelConfig,
  PrivilegeCheckResult,
};
