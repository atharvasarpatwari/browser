/**
 * @file src/browser/security/csp-resource-enforcer.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforce CSP resource-loading directives at the network layer. Handles:
 *   • connect-src — XHR, fetch, WebSocket, EventSource
 *   • img-src — images, favicons, CSS images
 *   • font-src — web fonts, @font-face
 *   • style-src — stylesheets, @import, inline styles
 *   • media-src — audio, video
 *   • object-src — plugins, embed, object
 *   • child-src — workers, nested browsing contexts
 *   • worker-src — Web Workers, SharedWorkers, Service Workers
 *   • manifest-src — web app manifests
 *   • prefetch-src — prefetch/preload resources
 *
 * Integrates with the RequestManager and ResourceLoader by providing
 * a pre-flight check that can be called before any network request.
 *
 * Does NOT:
 *   • Make network requests (RequestManager's job)
 *   • Parse CSP headers (csp-parser.ts's job)
 *   • Store policies (csp-policy-store.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only enforces CSP resource-loading restrictions.
 *  Encapsulation    Violation list and reporter are private.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CspPolicy } from './csp-parser';
import type { CspEvalContext } from './csp-evaluator';
import type { CspReporter } from './csp-reporter';
import type { CspPolicyStore } from './csp-policy-store';
import { evaluateCsp } from './csp-evaluator';
import { getEffectiveSources } from './csp-parser';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Type of resource being loaded. */
type ResourceType =
  | 'connect'
  | 'image'
  | 'font'
  | 'style'
  | 'media'
  | 'object'
  | 'child'
  | 'worker'
  | 'manifest'
  | 'prefetch';

/** A resource load request to be checked against CSP. */
interface ResourceLoadRequest {
  /** The URL of the resource. */
  readonly url: string;
  /** The type of resource. */
  readonly resourceType: ResourceType;
  /** The origin of the page making the request. */
  readonly pageOrigin: string;
  /** The origin of the document (may differ for iframes). */
  readonly documentOrigin: string;
  /** The HTTP method (for connect-src). */
  readonly method?: string;
  /** Whether the request is initiated by a script. */
  readonly scriptInitiated?: boolean;
}

/** Result of a CSP resource check. */
interface ResourceCheckResult {
  /** Whether the resource load is allowed. */
  readonly allowed: boolean;
  /** The CSP directive that was checked. */
  readonly directive: string;
  /** The resource type. */
  readonly resourceType: ResourceType;
  /** The URL that was checked. */
  readonly url: string;
  /** Reason for denial, if blocked. */
  readonly reason?: string;
}

/** Maps resource types to CSP directive names. */
const RESOURCE_TYPE_TO_DIRECTIVE: ReadonlyMap<ResourceType, string> = new Map([
  ['connect', 'connect-src'],
  ['image', 'img-src'],
  ['font', 'font-src'],
  ['style', 'style-src'],
  ['media', 'media-src'],
  ['object', 'object-src'],
  ['child', 'child-src'],
  ['worker', 'worker-src'],
  ['manifest', 'manifest-src'],
  ['prefetch', 'prefetch-src'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CspResourceEnforcer {
  private readonly policyStore: CspPolicyStore;
  private readonly reporter: CspReporter | null;
  private violations: ResourceCheckResult[] = [];

  constructor(policyStore: CspPolicyStore, reporter?: CspReporter | null) {
    this.policyStore = policyStore;
    this.reporter = reporter ?? null;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Check if a resource load is allowed by CSP.
   */
  checkResource(request: ResourceLoadRequest): ResourceCheckResult {
    const policy = this.policyStore.getEnforcePolicy(request.pageOrigin);

    // No CSP policy → allow.
    if (!policy || !policy.directives.size) {
      return {
        allowed: true,
        directive: '',
        resourceType: request.resourceType,
        url: request.url,
      };
    }

    const directive = RESOURCE_TYPE_TO_DIRECTIVE.get(request.resourceType) ?? 'default-src';

    // Check if the directive has any sources defined.
    const sources = getEffectiveSources(policy, directive);
    if (!sources || sources.length === 0) {
      return {
        allowed: true,
        directive,
        resourceType: request.resourceType,
        url: request.url,
      };
    }

    const context: CspEvalContext = {
      pageOrigin: request.pageOrigin,
      userInitiated: request.scriptInitiated ?? false,
    };

    const result = evaluateCsp(policy, directive, request.url, context);

    const checkResult: ResourceCheckResult = {
      allowed: result.allowed,
      directive,
      resourceType: request.resourceType,
      url: request.url,
      reason: result.allowed ? undefined : `CSP ${directive} blocked`,
    };

    if (!result.allowed) {
      this.violations.push(checkResult);
      this.reporter?.reportViolation(result, {
        documentUri: request.documentOrigin,
        policy,
        disposition: 'enforce',
      });
    }

    return checkResult;
  }

  /**
   * Batch-check multiple resources.
   */
  checkResources(requests: readonly ResourceLoadRequest[]): ResourceCheckResult[] {
    return requests.map(r => this.checkResource(r));
  }

  /**
   * Check a fetch/XHR request (convenience method).
   */
  checkFetch(
    url: string,
    pageOrigin: string,
    documentOrigin: string,
    method = 'GET',
  ): ResourceCheckResult {
    return this.checkResource({
      url,
      resourceType: 'connect',
      pageOrigin,
      documentOrigin,
      method,
      scriptInitiated: true,
    });
  }

  /**
   * Check an image load (convenience method).
   */
  checkImage(url: string, pageOrigin: string, documentOrigin: string): ResourceCheckResult {
    return this.checkResource({
      url,
      resourceType: 'image',
      pageOrigin,
      documentOrigin,
    });
  }

  /**
   * Check a font load (convenience method).
   */
  checkFont(url: string, pageOrigin: string, documentOrigin: string): ResourceCheckResult {
    return this.checkResource({
      url,
      resourceType: 'font',
      pageOrigin,
      documentOrigin,
    });
  }

  /**
   * Check a style load (convenience method).
   */
  checkStyle(url: string, pageOrigin: string, documentOrigin: string): ResourceCheckResult {
    return this.checkResource({
      url,
      resourceType: 'style',
      pageOrigin,
      documentOrigin,
    });
  }

  /**
   * Check a WebSocket connection (convenience method).
   */
  checkWebSocket(url: string, pageOrigin: string, documentOrigin: string): ResourceCheckResult {
    return this.checkResource({
      url,
      resourceType: 'connect',
      pageOrigin,
      documentOrigin,
    });
  }

  /**
   * Get all recorded violations.
   */
  getViolations(): readonly ResourceCheckResult[] {
    return [...this.violations];
  }

  /**
   * Clear recorded violations.
   */
  clearViolations(): void {
    this.violations = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CspResourceEnforcer,
  RESOURCE_TYPE_TO_DIRECTIVE,
};

export type {
  ResourceType,
  ResourceLoadRequest,
  ResourceCheckResult,
};
