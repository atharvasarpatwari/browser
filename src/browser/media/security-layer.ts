/**
 * @file security-layer.ts
 * @layer Browser Security — Runtime aggregation
 *
 * SecurityLayer is the production DI entry point for the media security layer.
 * It owns an instance of every security wrapper module (11 core modules from
 * 2026-07-29 plus the 7 enforcement protocol modules from 2026-08-06) and
 * exposes a small number of uniform decision APIs that the application
 * bootstrap wires into navigation and page rendering:
 *
 *   • checkNavigation     — top-level navigation gate (HTTPS/HSTS/DNS/PNA/XSS)
 *   • checkSubresource    — sub-resource gate (mixed content / CSRF / PNA)
 *   • applyResponseHeaders— response-time policy (COOP/COEP/CORP, clickjacking,
 *                           referrer-policy capture)
 *   • verifySubresourceIntegrity — SRI verification for loaded script/style
 *   • navigationGuard     — INavigationGuard implementation for the
 *                           NavigationController guard chain
 *
 * OOP principles applied:
 *   Facade / Single-Resp. — callers interact with one service, not 18.
 *   Composition          — the layer is a composite of the policy modules.
 *   Open/Closed          — new policy modules can be added without touching
 *                          callers; the layer is the only thing that changes.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { INavigationGuard } from '../navigation/navigation-controller';
import { SameOriginPolicy } from './same-origin-policy';
import { CorsService } from './cors';
import { CspService } from './csp';
import { SandboxService } from './sandbox';
import { HttpsService } from './https';
import { CertificateService } from './certificates';
import { MixedContentService } from './mixed-content';
import type { MixedContentResourceType } from './mixed-content';
import { XssProtectionService } from './xss-protection';
import { CsrfProtectionService } from './csrf-protection';
import { ClickjackingProtectionService } from './clickjacking-protection';
import { PermissionManagerService } from './permission-manager';
import { PERMISSION_LIST } from './permission-manager';
import { DnsRebindingProtectionService } from './dns-rebinding-protection';
import { HstsPreloadService } from './hsts-preload';
import { CertificateTransparencyService } from './certificate-transparency';
import { SubresourceIntegrityService } from './subresource-integrity';
import type { IntegrityVerificationResult } from './subresource-integrity';
import { PrivateNetworkAccessService } from './private-network-access';
import { CrossOriginPoliciesService, isSameSite } from './cross-origin-policies';
import type { CorpRequestMode } from './cross-origin-policies';
import { ReferrerPolicyService } from './referrer-policy';
import type { ReferrerPolicyValue } from './referrer-policy';

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Uniform decision emitted by every SecurityLayer check. */
type SecurityDecision = 'allow' | 'block' | 'warn' | 'upgrade';

/** Extra information a caller can supply for a navigation check. */
interface NavigationCheckContext {
  /** IP the hostname resolved to (from the DNS layer), if known. */
  readonly resolvedIp?: string;
  /** Source (initiator) IP for Private Network Access, if known. */
  readonly sourceIp?: string;
  /** Target IP for Private Network Access, if known. */
  readonly targetIp?: string;
  /** Whether the navigation originates from a secure context. */
  readonly isSecure?: boolean;
}

/** Outcome of a top-level navigation check. */
interface NavigationSecurityCheck {
  /** True when the navigation may proceed (allow or warn). */
  readonly allowed: boolean;
  readonly decision: SecurityDecision;
  /** Human-readable reason for block/warn/upgrade. */
  readonly reason?: string;
  /** Present when decision === 'upgrade' — the HTTPS URL to use instead. */
  readonly upgradeUrl?: string;
}

/** Extra information a caller can supply for a sub-resource check. */
interface SubresourceCheckContext {
  /** HTTP method for the request (e.g. 'GET', 'POST'). */
  readonly method?: string;
  /** CSRF token sent with a state-changing request. */
  readonly token?: string;
  /** Source (initiator) IP for Private Network Access, if known. */
  readonly sourceIp?: string;
  /** Resolved target IP for Private Network Access, if known. */
  readonly targetIp?: string;
  /** Whether the page is a secure context. */
  readonly isSecure?: boolean;
}

/** Outcome of a sub-resource check. */
interface SubresourceSecurityCheck {
  readonly allowed: boolean;
  readonly decision: SecurityDecision;
  readonly reason?: string;
}

/** Extra information for response-header processing. */
interface ResponseHeadersContext {
  /** True when this response is being embedded in a frame. */
  readonly framed?: boolean;
  /** Origin of the embedding (top-level) page for clickjacking checks. */
  readonly topOrigin?: string;
  /** Origin of the page that requested this resource (for CORP). */
  readonly pageOrigin?: string;
  /** Request mode used to classify CORP enforcement. */
  readonly requestMode?: CorpRequestMode;
  /** Origin of the opener window (for COOP evaluation). */
  readonly openerOrigin?: string;
}

/** Outcome of response-header processing. */
interface ResponseSecurityCheck {
  readonly allowed: boolean;
  readonly decision: SecurityDecision;
  readonly reason?: string;
}

/** Aggregate counters and toggles across the whole security layer. */
interface SecurityLayerStats {
  readonly dnsRebindingBlocked: number;
  readonly pnaBlocked: number;
  readonly mixedContentBlocked: number;
  readonly xssBlocked: number;
  readonly csrfBlocked: number;
  readonly clickjackingBlocked: number;
  readonly ctBlocked: number;
  readonly sriBlocked: number;
  readonly cspViolations: number;
  readonly hstsPreloadedHosts: number;
  readonly hstsEnabled: boolean;
  readonly httpsEnforced: boolean;
  readonly referrerComputed: number;
  readonly referrerTruncated: number;
  readonly trackedPermissionKinds: number;
}

/** A unified event forwarded from any of the 18 underlying modules. */
interface SecurityLayerEvent {
  readonly kind: string;
  /** Name of the module that produced the event. */
  readonly service: string;
  readonly data?: Record<string, unknown>;
}

type SecurityLayerEventHandler = (event: SecurityLayerEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ISecurityLayer {
  // ── Owned policy modules (all 18, reachable for fine-grained control) ──────
  readonly sameOrigin: SameOriginPolicy;
  readonly cors: CorsService;
  readonly csp: CspService;
  readonly sandbox: SandboxService;
  readonly https: HttpsService;
  readonly certificates: CertificateService;
  readonly mixedContent: MixedContentService;
  readonly xss: XssProtectionService;
  readonly csrf: CsrfProtectionService;
  readonly clickjacking: ClickjackingProtectionService;
  readonly permissions: PermissionManagerService;
  readonly dnsRebinding: DnsRebindingProtectionService;
  readonly hstsPreload: HstsPreloadService;
  readonly certificateTransparency: CertificateTransparencyService;
  readonly subresourceIntegrity: SubresourceIntegrityService;
  readonly privateNetworkAccess: PrivateNetworkAccessService;
  readonly crossOriginPolicies: CrossOriginPoliciesService;
  readonly referrerPolicy: ReferrerPolicyService;

  // ── Decision APIs ─────────────────────────────────────────────────────────
  checkNavigation(url: string, context?: NavigationCheckContext): NavigationSecurityCheck;
  checkSubresource(
    pageUrl: string,
    resourceUrl: string,
    resourceType: MixedContentResourceType,
    context?: SubresourceCheckContext,
  ): SubresourceSecurityCheck;
  applyResponseHeaders(
    url: string,
    headers: ReadonlyMap<string, string>,
    context?: ResponseHeadersContext,
  ): ResponseSecurityCheck;
  verifySubresourceIntegrity(integrity: string, content: string | Uint8Array): IntegrityVerificationResult;
  computeReferrer(policy: ReferrerPolicyValue, sourceUrl: string, targetUrl: string): string | null;
  getReferrerForPage(pageOrigin: string, targetUrl: string): string | null;
  getStats(): SecurityLayerStats;

  // ── Navigation guard (plugs into NavigationController) ────────────────────
  readonly navigationGuard: INavigationGuard;

  // ── Events / lifecycle ────────────────────────────────────────────────────
  onEvent(handler: SecurityLayerEventHandler): () => void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class SecurityLayer implements ISecurityLayer, IDisposable {
  readonly sameOrigin = new SameOriginPolicy();
  readonly cors = new CorsService();
  readonly csp = new CspService();
  readonly sandbox = new SandboxService();
  readonly https = new HttpsService();
  readonly certificates = new CertificateService();
  readonly mixedContent = new MixedContentService();
  readonly xss = new XssProtectionService();
  readonly csrf = new CsrfProtectionService();
  readonly clickjacking = new ClickjackingProtectionService();
  readonly permissions = new PermissionManagerService();
  readonly dnsRebinding = new DnsRebindingProtectionService();
  readonly hstsPreload = new HstsPreloadService();
  readonly certificateTransparency = new CertificateTransparencyService();
  readonly subresourceIntegrity = new SubresourceIntegrityService();
  readonly privateNetworkAccess = new PrivateNetworkAccessService();
  readonly crossOriginPolicies = new CrossOriginPoliciesService();
  readonly referrerPolicy = new ReferrerPolicyService();

  private readonly coopHeaderByOrigin = new Map<string, string | null>();
  private readonly coepHeaderByOrigin = new Map<string, string | null>();
  private readonly referrerPolicyByOrigin = new Map<string, ReferrerPolicyValue>();

  private readonly handlers = new Set<SecurityLayerEventHandler>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    this.forwardEvents(this.sameOrigin, 'same-origin');
    this.forwardEvents(this.cors, 'cors');
    this.forwardEvents(this.csp, 'csp');
    this.forwardEvents(this.sandbox, 'sandbox');
    this.forwardEvents(this.https, 'https');
    this.forwardEvents(this.certificates, 'certificates');
    this.forwardEvents(this.mixedContent, 'mixed-content');
    this.forwardEvents(this.xss, 'xss');
    this.forwardEvents(this.csrf, 'csrf');
    this.forwardEvents(this.clickjacking, 'clickjacking');
    this.forwardEvents(this.permissions, 'permissions');
    this.forwardEvents(this.dnsRebinding, 'dns-rebinding');
    this.forwardEvents(this.hstsPreload, 'hsts-preload');
    this.forwardEvents(this.certificateTransparency, 'certificate-transparency');
    this.forwardEvents(this.subresourceIntegrity, 'subresource-integrity');
    this.forwardEvents(this.privateNetworkAccess, 'private-network-access');
    this.forwardEvents(this.crossOriginPolicies, 'cross-origin-policies');
    this.forwardEvents(this.referrerPolicy, 'referrer-policy');
  }

  // ── Decision: navigation ───────────────────────────────────────────────────

  checkNavigation(url: string, context: NavigationCheckContext = {}): NavigationSecurityCheck {
    try {
      if (!isHttpLike(url)) {
        return { allowed: true, decision: 'allow' };
      }

      // 1. HSTS preload — hard requirement for well-known hosts.
      if (this.hstsPreload.isEnabled()) {
        const preload = this.hstsPreload.checkUrl(url);
        if (preload.shouldUpgrade && preload.upgradedUrl) {
          return {
            allowed: false,
            decision: 'upgrade',
            upgradeUrl: preload.upgradedUrl,
            reason: `HSTS preload: ${url} must be loaded over HTTPS`,
          };
        }
      }

      // 2. HTTPS enforcement — HTTPS-only mode upgrades every http navigation.
      //    Loopback hosts (localhost/127.x/::1) are exempt, matching Chromium:
      //    local dev servers must stay reachable over plain HTTP.
      if (this.https.isEnforceHttps() && url.startsWith('http://') && !isLoopbackHost(url)) {
        const target = this.https.upgradeUrl(url);
        return {
          allowed: false,
          decision: 'upgrade',
          upgradeUrl: target,
          reason: `HTTPS required for ${url}; use ${target}`,
        };
      }

      // 2b. HSTS store upgrade (relevant when enforceHttps is disabled).
      const upgraded = this.https.checkAndUpgrade(url);
      if (upgraded !== url) {
        return {
          allowed: false,
          decision: 'upgrade',
          upgradeUrl: upgraded,
          reason: `HSTS requires HTTPS for ${url}; use ${upgraded}`,
        };
      }

      const host = parseHost(url);
      if (host) {
        // 3. DNS rebinding — only actionable when the caller resolved the IP.
        if (context.resolvedIp && !this.dnsRebinding.isIpLiteral(host)) {
          const dnsDecision = this.dnsRebinding.checkResolvedHost(host, context.resolvedIp);
          if (dnsDecision === 'blocked') {
            return { allowed: false, decision: 'block', reason: `DNS rebinding blocked for ${host}` };
          }
          if (dnsDecision === 'warn') {
            return { allowed: true, decision: 'warn', reason: `DNS rebinding warning for ${host}` };
          }
        }

        // 4. Private Network Access.
        if (context.sourceIp && context.targetIp) {
          const pna = this.privateNetworkAccess.checkRequest(
            context.sourceIp,
            context.targetIp,
            context.isSecure ?? true,
          );
          if (pna === 'blocked') {
            return { allowed: false, decision: 'block', reason: `Private Network Access blocked: ${host}` };
          }
          if (pna === 'warn') {
            return { allowed: true, decision: 'warn', reason: `Private Network Access warning: ${host}` };
          }
        }
      }

      // 5. XSS in navigation URLs — flagged (warn) to avoid false-positive blocking.
      const xss = this.xss.detectXss(url, 'url');
      if (xss.isMalicious) {
        return {
          allowed: true,
          decision: 'warn',
          reason: `Suspicious URL detected: ${xss.matches.slice(0, 3).join(', ')}`,
        };
      }

      return { allowed: true, decision: 'allow' };
    } catch (err) {
      console.error('[SecurityLayer] checkNavigation error — allowing navigation:', err);
      return { allowed: true, decision: 'allow' };
    }
  }

  // ── Decision: sub-resource ─────────────────────────────────────────────────

  checkSubresource(
    pageUrl: string,
    resourceUrl: string,
    resourceType: MixedContentResourceType,
    context: SubresourceCheckContext = {},
  ): SubresourceSecurityCheck {
    try {
      if (!isHttpLike(pageUrl) && !isHttpLike(resourceUrl)) {
        return { allowed: true, decision: 'allow' };
      }

      // 1. Mixed content.
      const mixed = this.mixedContent.checkAndBlock(pageUrl, resourceUrl, resourceType);
      if (mixed === 'blocked') {
        return { allowed: false, decision: 'block', reason: `Mixed content blocked: ${resourceUrl}` };
      }
      if (mixed === 'upgraded') {
        return { allowed: true, decision: 'warn', reason: `Mixed content upgraded: ${resourceUrl}` };
      }

      const pageOrigin = parseOrigin(pageUrl);

      // 2. CSRF protection for state-changing requests.
      if (context.method) {
        const method = context.method.toUpperCase();
        if (this.csrf.getProtectedMethods().includes(method) && pageOrigin && pageOrigin !== 'null') {
          const csrfDecision = this.csrf.validateRequest(pageOrigin, method, context.token);
          if (csrfDecision === 'blocked') {
            return {
              allowed: false,
              decision: 'block',
              reason: `CSRF protection blocked ${method} ${resourceUrl}`,
            };
          }
        }
      }

      // 3. Private Network Access.
      if (context.sourceIp && context.targetIp) {
        const pna = this.privateNetworkAccess.checkRequest(
          context.sourceIp,
          context.targetIp,
          context.isSecure ?? true,
        );
        if (pna === 'blocked') {
          return { allowed: false, decision: 'block', reason: `Private Network Access blocked: ${resourceUrl}` };
        }
        if (pna === 'warn') {
          return { allowed: true, decision: 'warn', reason: `Private Network Access warning: ${resourceUrl}` };
        }
      }

      return { allowed: true, decision: 'allow' };
    } catch (err) {
      console.error('[SecurityLayer] checkSubresource error — allowing resource:', err);
      return { allowed: true, decision: 'allow' };
    }
  }

  // ── Decision: response headers ─────────────────────────────────────────────

  applyResponseHeaders(
    url: string,
    headers: ReadonlyMap<string, string>,
    context: ResponseHeadersContext = {},
  ): ResponseSecurityCheck {
    try {
      const origin = parseOrigin(url);
      const coopRaw = headers.get('cross-origin-opener-policy') ?? null;
      const coepRaw = headers.get('cross-origin-embedder-policy') ?? null;

      // Record per-origin cross-origin policies for later CORP enforcement.
      if (coopRaw !== null) {
        this.coopHeaderByOrigin.set(origin, coopRaw);
      }
      if (coepRaw !== null) {
        this.coepHeaderByOrigin.set(origin, coepRaw);
      }

      // Capture the page's Referrer-Policy for sub-resource referrer computation.
      const rpRaw = headers.get('referrer-policy') ?? null;
      if (rpRaw !== null) {
        this.referrerPolicyByOrigin.set(origin, this.referrerPolicy.parsePolicy(rpRaw));
      }

      // Feed policies into the evaluator so isolation decisions surface as events.
      if (coopRaw !== null) {
        this.crossOriginPolicies.evaluateCoop(coopRaw, context.openerOrigin ?? '', origin);
      }
      if (coepRaw !== null) {
        this.crossOriginPolicies.evaluateCoep(coepRaw);
      }

      // Clickjacking — only relevant when this response is embedded in a frame.
      if (context.framed && context.topOrigin) {
        const xfo = headers.get('x-frame-options') ?? null;
        const frameAncestors = extractFrameAncestors(headers.get('content-security-policy') ?? null);
        const decision = this.clickjacking.evaluateResponse(url, xfo, frameAncestors, context.topOrigin);
        if (decision === 'blocked') {
          return {
            allowed: false,
            decision: 'block',
            reason: 'Framing blocked by X-Frame-Options / CSP frame-ancestors',
          };
        }
      }

      // CORP enforcement — a cross-origin response must satisfy the embedding
      // page's COEP policy (require-corp / credentialless).
      const corpRaw = headers.get('cross-origin-resource-policy') ?? null;
      if (corpRaw !== null && context.pageOrigin) {
        const pageCoepRaw = this.coepHeaderByOrigin.get(context.pageOrigin) ?? null;
        const pageCoep = this.crossOriginPolicies.parseCoep(pageCoepRaw);
        if (pageCoep === 'require-corp' || pageCoep === 'credentialless') {
          const sameSite = isSameSite(context.pageOrigin, origin);
          const corpDecision = this.crossOriginPolicies.checkSubresource(
            context.pageOrigin,
            origin,
            corpRaw,
            context.requestMode ?? 'no-cors',
            sameSite,
            pageCoepRaw,
          );
          if (corpDecision === 'blocked') {
            return { allowed: false, decision: 'block', reason: `CORP blocked cross-origin resource: ${url}` };
          }
        }
      }

      return { allowed: true, decision: 'allow' };
    } catch (err) {
      console.error('[SecurityLayer] applyResponseHeaders error:', err);
      return { allowed: true, decision: 'allow' };
    }
  }

  // ── Decision: SRI ──────────────────────────────────────────────────────────

  verifySubresourceIntegrity(integrity: string, content: string | Uint8Array): IntegrityVerificationResult {
    return this.subresourceIntegrity.verify(integrity, content);
  }

  // ── Referrer computation ───────────────────────────────────────────────────

  computeReferrer(policy: ReferrerPolicyValue, sourceUrl: string, targetUrl: string): string | null {
    return this.referrerPolicy.computeReferrer(policy, sourceUrl, targetUrl);
  }

  /** Referrer for a request from a page whose Referrer-Policy was captured. */
  getReferrerForPage(pageOrigin: string, targetUrl: string): string | null {
    const policy = this.referrerPolicyByOrigin.get(pageOrigin) ?? this.referrerPolicy.getDefaultPolicy();
    return this.referrerPolicy.computeReferrer(policy, pageOrigin, targetUrl);
  }

  // ── Aggregate stats ────────────────────────────────────────────────────────

  getStats(): SecurityLayerStats {
    return {
      dnsRebindingBlocked: this.dnsRebinding.getBlockedCount(),
      pnaBlocked: this.privateNetworkAccess.getBlockedCount(),
      mixedContentBlocked: this.mixedContent.getBlockedCount(),
      xssBlocked: this.xss.getBlockedCount(),
      csrfBlocked: this.csrf.getBlockedCount(),
      clickjackingBlocked: this.clickjacking.getBlockedCount(),
      ctBlocked: this.certificateTransparency.getBlockedCount(),
      sriBlocked: this.subresourceIntegrity.getBlockedCount(),
      cspViolations: this.csp.getViolationCount(),
      hstsPreloadedHosts: this.hstsPreload.getPreloadCount(),
      hstsEnabled: this.hstsPreload.isEnabled(),
      httpsEnforced: this.https.isEnforceHttps(),
      referrerComputed: this.referrerPolicy.getReferrerCount(),
      referrerTruncated: this.referrerPolicy.getTruncatedCount(),
      trackedPermissionKinds: PERMISSION_LIST.length,
    };
  }

  // ── Navigation guard ───────────────────────────────────────────────────────

  readonly navigationGuard: INavigationGuard = {
    name: 'SecurityLayer',
    canNavigate: async (request) => this.checkNavigation(request.url).allowed,
    blockedReason: (request) => {
      const check = this.checkNavigation(request.url);
      if (check.decision === 'upgrade' && check.upgradeUrl) {
        return `${check.reason ?? 'Blocked by security layer'}. Navigate to ${check.upgradeUrl} instead.`;
      }
      return check.reason ?? 'Blocked by security layer.';
    },
  };

  // ── Events / lifecycle ─────────────────────────────────────────────────────

  onEvent(handler: SecurityLayerEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.handlers.clear();
    this.sameOrigin.dispose();
    this.cors.dispose();
    this.csp.dispose();
    this.sandbox.dispose();
    this.https.dispose();
    this.certificates.dispose();
    this.mixedContent.dispose();
    this.xss.dispose();
    this.csrf.dispose();
    this.clickjacking.dispose();
    this.permissions.dispose();
    this.dnsRebinding.dispose();
    this.hstsPreload.dispose();
    this.certificateTransparency.dispose();
    this.subresourceIntegrity.dispose();
    this.privateNetworkAccess.dispose();
    this.crossOriginPolicies.dispose();
    this.referrerPolicy.dispose();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private forwardEvents(
    service: {
      onEvent(handler: (event: { readonly kind: string; readonly data?: Record<string, unknown> }) => void): () => void;
    },
    serviceName: string,
  ): void {
    const unsubscribe = service.onEvent((event) => {
      for (const handler of this.handlers) {
        handler({ kind: event.kind, service: serviceName, data: event.data });
      }
    });
    this.unsubscribers.push(unsubscribe);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isHttpLike(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Loopback/private-local hosts are exempt from HTTPS enforcement (like Chrome). */
function isLoopbackHost(url: string): boolean {
  const host = parseHost(url);
  if (!host) return false;
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '127.0.0.1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function parseHost(url: string): string | null {
  const parsed = parseUrl(url);
  return parsed ? parsed.hostname || null : null;
}

function parseOrigin(url: string): string {
  const parsed = parseUrl(url);
  return parsed ? parsed.origin : '';
}

/** Extracts the `frame-ancestors` source list from a CSP header, if present. */
function extractFrameAncestors(cspHeader: string | null): string | null {
  if (!cspHeader) {
    return null;
  }
  const match = /frame-ancestors\s+([^;]*)/i.exec(cspHeader);
  return match ? match[1].trim() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { SecurityLayer };
export type {
  ISecurityLayer,
  SecurityDecision,
  NavigationCheckContext,
  NavigationSecurityCheck,
  SubresourceCheckContext,
  SubresourceSecurityCheck,
  ResponseHeadersContext,
  ResponseSecurityCheck,
  SecurityLayerStats,
  SecurityLayerEvent,
  SecurityLayerEventHandler,
};
