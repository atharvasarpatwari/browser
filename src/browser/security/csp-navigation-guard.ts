/**
 * @file src/browser/security/csp-navigation-guard.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforce CSP navigation restrictions via the NavigationController guard
 * interface. Handles:
 *   • frame-src directive enforcement (blocks navigation to disallowed frames)
 *   • form-action directive enforcement (blocks form submissions to disallowed URLs)
 *   • frame-ancestors directive enforcement (blocks embedding in disallowed frames)
 *   • navigation-to directive enforcement (CSP Level 3 navigation restrictions)
 *   • base-uri directive enforcement (blocks base tag hijacking)
 *   • Upgrade-Insecure-Requests enforcement (rewrites http: to https:)
 *   • Integration with CspPolicyStore and CspReporter
 *
 * Implements INavigationGuard so it plugs directly into the NavigationController
 * guard chain without modifying the controller itself.
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only enforces CSP navigation restrictions.
 *  Abstraction      Implements INavigationGuard — caller sees a navigation guard.
 *  Dependency-Inv.  Receives CspPolicyStore and CspReporter via constructor.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CspPolicy } from './csp-parser';
import type { CspEvaluationResult, CspEvalContext } from './csp-evaluator';
import type { CspReporter } from './csp-reporter';
import type { CspPolicyStore } from './csp-policy-store';
import { evaluateCsp } from './csp-evaluator';
import { getEffectiveSources } from './csp-parser';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES (mirroring NavigationController's guard interface)
// ─────────────────────────────────────────────────────────────────────────────

/** Simplified navigation request for CSP evaluation. */
interface CspNavigationRequest {
  readonly url: string;
  readonly type: string;
  readonly referrer?: string;
  readonly documentOrigin?: string;
  readonly userInitiated: boolean;
}

/** Result of a CSP navigation check. */
interface CspNavigationResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly upgradedUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Navigation types that map to specific CSP directives. */
const NAV_TYPE_TO_DIRECTIVE: ReadonlyMap<string, string> = new Map([
  ['push', 'navigation-to'],
  ['replace', 'navigation-to'],
  ['back', 'navigation-to'],
  ['forward', 'navigation-to'],
  ['reload', 'navigation-to'],
  ['hash-change', 'navigation-to'],
  ['form-submit', 'form-action'],
  ['iframe-navigate', 'frame-src'],
  ['sub-frame', 'frame-src'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CspNavigationGuard {
  private readonly policyStore: CspPolicyStore;
  private readonly reporter: CspReporter | null;
  private violations: CspEvaluationResult[] = [];

  constructor(policyStore: CspPolicyStore, reporter?: CspReporter | null) {
    this.policyStore = policyStore;
    this.reporter = reporter ?? null;
  }

  // ── Navigation Guard Interface ───────────────────────────────────────────

  /**
   * Check if a navigation is allowed by CSP.
   * Compatible with NavigationController's INavigationGuard interface.
   */
  async canNavigate(request: CspNavigationRequest): Promise<boolean> {
    const result = this.checkNavigation(request);
    return result.allowed;
  }

  /**
   * Check a navigation request and return detailed results.
   */
  checkNavigation(request: CspNavigationRequest): CspNavigationResult {
    const origin = request.documentOrigin || this.extractOrigin(request.url);
    const policy = this.policyStore.getEnforcePolicy(origin);

    // No CSP policy → allow.
    if (!policy || !policy.directives.size) {
      return { allowed: true };
    }

    // Check Upgrade-Insecure-Requests.
    if (policy.upgradeInsecureRequests) {
      const upgraded = this.tryUpgrade(request.url);
      if (upgraded !== request.url) {
        return { allowed: true, upgradedUrl: upgraded };
      }
    }

    // Determine which directive to check based on navigation type.
    const directive = this.getDirectiveForNavType(request.type);

    // Check frame-src for sub-frame navigations.
    if (request.type === 'sub-frame' || request.type === 'iframe-navigate') {
      return this.checkFrameSrc(request, policy, origin);
    }

    // Check form-action for form submissions.
    if (request.type === 'form-submit') {
      return this.checkFormAction(request, policy, origin);
    }

    // Check navigation-to for top-level navigations.
    if (directive) {
      return this.checkDirective(request, directive, policy, origin);
    }

    // Default: allow.
    return { allowed: true };
  }

  /**
   * Check frame-ancestors directive (for embedding decisions).
   * Returns whether the given frame can embed content from the specified URL.
   */
  checkFrameAncestors(
    frameUrl: string,
    ancestorOrigins: readonly string[],
    pageOrigin: string,
  ): CspNavigationResult {
    const policy = this.policyStore.getEnforcePolicy(this.extractOrigin(frameUrl));
    if (!policy) return { allowed: true };

    const sources = getEffectiveSources(policy, 'frame-ancestors');
    if (!sources || sources.length === 0) return { allowed: true };

    // 'none' blocks all embedding.
    const hasNone = sources.some(s => s.kind === 'keyword' && s.raw === "'none'");
    if (hasNone) {
      return { allowed: false, reason: "frame-ancestors 'none'" };
    }

    // Check each ancestor origin against the source list.
    for (const ancestorOrigin of ancestorOrigins) {
      let matched = false;
      for (const source of sources) {
        if (this.matchSourceAgainstOrigin(source, ancestorOrigin, pageOrigin)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return {
          allowed: false,
          reason: `frame-ancestors: ${ancestorOrigin} not in source list`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check base-uri directive (for base tag hijacking prevention).
   */
  checkBaseUri(
    baseUrl: string,
    targetUrl: string,
    pageOrigin: string,
  ): CspNavigationResult {
    const origin = this.extractOrigin(baseUrl);
    const policy = this.policyStore.getEnforcePolicy(origin);
    if (!policy) return { allowed: true };

    return this.checkDirective(
      { url: targetUrl, type: 'base-uri', userInitiated: false },
      'base-uri',
      policy,
      pageOrigin,
    );
  }

  /**
   * Get all recorded violations.
   */
  getViolations(): readonly CspEvaluationResult[] {
    return [...this.violations];
  }

  /**
   * Clear recorded violations.
   */
  clearViolations(): void {
    this.violations = [];
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private checkDirective(
    request: CspNavigationRequest,
    directiveName: string,
    policy: CspPolicy,
    pageOrigin: string,
  ): CspNavigationResult {
    const context: CspEvalContext = {
      pageOrigin,
      userInitiated: request.userInitiated,
    };

    const result = evaluateCsp(policy, directiveName, request.url, context);

    if (!result.allowed) {
      this.violations.push(result);
      this.reporter?.reportViolation(result, {
        documentUri: request.referrer ?? pageOrigin,
        policy,
        disposition: 'enforce',
      });
      return { allowed: false, reason: `CSP ${directiveName} blocked` };
    }

    return { allowed: true };
  }

  private checkFrameSrc(
    request: CspNavigationRequest,
    policy: CspPolicy,
    pageOrigin: string,
  ): CspNavigationResult {
    return this.checkDirective(request, 'frame-src', policy, pageOrigin);
  }

  private checkFormAction(
    request: CspNavigationRequest,
    policy: CspPolicy,
    pageOrigin: string,
  ): CspNavigationResult {
    return this.checkDirective(request, 'form-action', policy, pageOrigin);
  }

  private getDirectiveForNavType(navType: string): string | null {
    return NAV_TYPE_TO_DIRECTIVE.get(navType) ?? 'navigation-to';
  }

  private tryUpgrade(url: string): string {
    if (url.startsWith('http://')) {
      return 'https://' + url.slice(7);
    }
    return url;
  }

  private extractOrigin(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.origin;
    } catch {
      return '';
    }
  }

  private matchSourceAgainstOrigin(
    source: import('./csp-parser').CspSourceExpression,
    targetOrigin: string,
    pageOrigin: string,
  ): boolean {
    switch (source.kind) {
      case 'wildcard':
        return true;
      case 'keyword':
        if (source.raw === "'self'") return targetOrigin === pageOrigin;
        return false;
      case 'scheme': {
        try {
          const url = new URL(targetOrigin);
          return url.protocol === source.scheme + ':';
        } catch {
          return false;
        }
      }
      case 'host':
      case 'host-path':
      case 'host-port': {
        try {
          const url = new URL(targetOrigin);
          if (source.host && !this.matchHost(source.host, url.hostname)) return false;
          if (source.port !== undefined && source.port !== parseInt(url.port || '0', 10)) return false;
          return true;
        } catch {
          return false;
        }
      }
      default:
        return false;
    }
  }

  private matchHost(pattern: string, target: string): boolean {
    if (pattern === target) return true;
    if (pattern.startsWith('*.')) {
      const baseDomain = pattern.slice(1);
      return target.endsWith(baseDomain) || target === pattern.slice(2);
    }
    if (target.endsWith('.' + pattern)) return true;
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CspNavigationGuard,
  NAV_TYPE_TO_DIRECTIVE,
};

export type {
  CspNavigationRequest,
  CspNavigationResult,
};
