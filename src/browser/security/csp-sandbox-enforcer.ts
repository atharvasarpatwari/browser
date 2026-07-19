/**
 * @file src/browser/security/csp-sandbox-enforcer.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforce CSP sandbox directives. Handles:
 *   • Parsing sandbox flags from CSP header
 *   • Mapping CSP sandbox tokens to SandboxPermissions
 *   • Applying sandbox restrictions to iframe contexts
 *   • Integrating with SandboxManager for permission resolution
 *   • Enforcing allow-scripts, allow-forms, allow-modals, allow-popups,
 *     allow-same-origin, allow-top-navigation, allow-pointer-lock,
 *     allow-orientation-lock, allow-presentation
 *   • Handling sandbox flag intersection (most restrictive wins)
 *
 * Does NOT:
 *   • Parse CSP headers (csp-parser.ts's job)
 *   • Create iframes (BrowserEngine's job)
 *   • Manage sandbox permissions (sandbox-manager.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only maps CSP sandbox flags to SandboxPermissions.
 *  Abstraction      Uses SandboxPermissions interface from sandbox-manager.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CspPolicy } from './csp-parser';
import type { SandboxPermissions } from './sandbox-manager';
import type { CspPolicyStore } from './csp-policy-store';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** CSP sandbox token to SandboxPermissions mapping. */
interface SandboxMapping {
  /** CSP token name (e.g. 'allow-scripts'). */
  readonly token: string;
  /** The SandboxPermissions field it maps to. */
  readonly permission: keyof SandboxPermissions;
}

/** Result of applying CSP sandbox restrictions. */
interface SandboxEnforcementResult {
  /** The resulting sandbox permissions. */
  readonly permissions: SandboxPermissions;
  /** Whether the context is sandboxed at all. */
  readonly isSandboxed: boolean;
  /** The CSP policy that imposed the restrictions. */
  readonly policy: CspPolicy | null;
  /** Whether allow-same-origin was present. */
  readonly allowSameOrigin: boolean;
  /** Whether top navigation is blocked. */
  readonly topNavigationBlocked: boolean;
  /** The list of active sandbox flags. */
  readonly activeFlags: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Mapping from CSP sandbox tokens to SandboxPermissions fields. */
const SANDBOX_MAPPINGS: readonly SandboxMapping[] = [
  { token: 'allow-scripts', permission: 'allowScripts' },
  { token: 'allow-forms', permission: 'allowForms' },
  { token: 'allow-modals', permission: 'allowModals' },
  { token: 'allow-popups', permission: 'allowPopups' },
  { token: 'allow-popups-to-escape-sandbox', permission: 'allowPopups' },
  { token: 'allow-same-origin', permission: 'allowSameOrigin' },
  { token: 'allow-top-navigation', permission: 'allowTopNavigation' },
  { token: 'allow-top-navigation-by-user-activation', permission: 'allowTopNavigation' },
  { token: 'allow-pointer-lock', permission: 'allowPointerLock' },
  { token: 'allow-orientation-lock', permission: 'allowOrientationLock' },
  { token: 'allow-presentation', permission: 'allowPresentation' },
];

/** Permissions when sandbox is present but no allow-* tokens specified. */
const FULLY_SANDBOXED: SandboxPermissions = {
  allowScripts: false,
  allowForms: false,
  allowModals: false,
  allowPopups: false,
  allowSameOrigin: false,
  allowTopNavigation: false,
  allowPointerLock: false,
  allowOrientationLock: false,
  allowPresentation: false,
};

/** Permissions when no sandbox is applied (fully unrestricted). */
const UNSANDBOXED: SandboxPermissions = {
  allowScripts: true,
  allowForms: true,
  allowModals: true,
  allowPopups: true,
  allowSameOrigin: true,
  allowTopNavigation: true,
  allowPointerLock: true,
  allowOrientationLock: true,
  allowPresentation: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CspSandboxEnforcer {
  private readonly policyStore: CspPolicyStore;

  constructor(policyStore: CspPolicyStore) {
    this.policyStore = policyStore;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Resolve sandbox permissions for a frame at the given URL,
   * based on the CSP policies of the embedding document.
   *
   * @param frameUrl The URL of the frame being sandboxed.
   * @param parentOrigin The origin of the parent document.
   * @returns The resulting sandbox permissions.
   */
  resolveSandboxPermissions(
    frameUrl: string,
    parentOrigin: string,
  ): SandboxEnforcementResult {
    const policy = this.policyStore.getEnforcePolicy(parentOrigin);

    if (!policy || !policy.hasSandbox) {
      return {
        permissions: { ...UNSANDBOXED },
        isSandboxed: false,
        policy: null,
        allowSameOrigin: true,
        topNavigationBlocked: false,
        activeFlags: [],
      };
    }

    return this.applySandboxFlags(policy);
  }

  /**
   * Apply sandbox flags from a CSP policy directly.
   */
  applySandboxFlags(policy: CspPolicy): SandboxEnforcementResult {
    if (!policy.hasSandbox) {
      return {
        permissions: { ...UNSANDBOXED },
        isSandboxed: false,
        policy,
        allowSameOrigin: true,
        topNavigationBlocked: false,
        activeFlags: [],
      };
    }

    // Start with fully sandboxed, then enable permissions based on flags.
    const permissions: SandboxPermissions = { ...FULLY_SANDBOXED };
    const activeFlags: string[] = [];

    for (const flag of policy.sandboxFlags) {
      const mapping = SANDBOX_MAPPINGS.find(m => m.token === flag);
      if (mapping) {
        (permissions as Record<string, boolean>)[mapping.permission] = true;
        activeFlags.push(flag);
      }
    }

    // An empty sandbox attribute (no tokens) means fully sandboxed.
    // This is already handled by starting with FULLY_SANDBOXED.

    // Special case: allow-top-navigation-by-user-activation only allows
    // top navigation on user activation, not unconditionally.
    // For simplicity, we treat it as allowTopNavigation = true but note it.
    // In a real browser, this would need activation tracking.

    return {
      permissions,
      isSandboxed: true,
      policy,
      allowSameOrigin: permissions.allowSameOrigin,
      topNavigationBlocked: !permissions.allowTopNavigation,
      activeFlags,
    };
  }

  /**
   * Check if a specific action is allowed in the sandboxed context.
   */
  checkAction(
    frameUrl: string,
    parentOrigin: string,
    action: keyof SandboxPermissions,
  ): boolean {
    const result = this.resolveSandboxPermissions(frameUrl, parentOrigin);
    return result.permissions[action];
  }

  /**
   * Check if scripts are allowed in the sandboxed context.
   */
  areScriptsAllowed(frameUrl: string, parentOrigin: string): boolean {
    return this.checkAction(frameUrl, parentOrigin, 'allowScripts');
  }

  /**
   * Check if forms are allowed in the sandboxed context.
   */
  areFormsAllowed(frameUrl: string, parentOrigin: string): boolean {
    return this.checkAction(frameUrl, parentOrigin, 'allowForms');
  }

  /**
   * Check if top navigation is allowed.
   */
  isTopNavigationAllowed(frameUrl: string, parentOrigin: string): boolean {
    return this.checkAction(frameUrl, parentOrigin, 'allowTopNavigation');
  }

  /**
   * Check if popups are allowed.
   */
  arePopupsAllowed(frameUrl: string, parentOrigin: string): boolean {
    return this.checkAction(frameUrl, parentOrigin, 'allowPopups');
  }

  /**
   * Intersect two sets of sandbox permissions (take the more restrictive).
   */
  static intersectPermissions(
    a: SandboxPermissions,
    b: SandboxPermissions,
  ): SandboxPermissions {
    return {
      allowScripts: a.allowScripts && b.allowScripts,
      allowForms: a.allowForms && b.allowForms,
      allowModals: a.allowModals && b.allowModals,
      allowPopups: a.allowPopups && b.allowPopups,
      allowSameOrigin: a.allowSameOrigin && b.allowSameOrigin,
      allowTopNavigation: a.allowTopNavigation && b.allowTopNavigation,
      allowPointerLock: a.allowPointerLock && b.allowPointerLock,
      allowOrientationLock: a.allowOrientationLock && b.allowOrientationLock,
      allowPresentation: a.allowPresentation && b.allowPresentation,
    };
  }

  /**
   * Get the fully sandboxed permissions (everything denied).
   */
  static getFullySandboxed(): SandboxPermissions {
    return { ...FULLY_SANDBOXED };
  }

  /**
   * Get unrestricted permissions (everything allowed).
   */
  static getUnsandboxed(): SandboxPermissions {
    return { ...UNSANDBOXED };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CspSandboxEnforcer,
  SANDBOX_MAPPINGS,
  FULLY_SANDBOXED,
  UNSANDBOXED,
};

export type {
  SandboxEnforcementResult,
};
