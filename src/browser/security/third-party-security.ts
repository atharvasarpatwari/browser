import type { IDisposable } from '../../app/dependency-container';
import type { SandboxPermissions } from './sandbox-manager';

type ThirdPartyPolicy = 'block' | 'isolate' | 'restrict' | 'allow';

interface ThirdPartySecurityConfig {
  readonly iframePolicy: ThirdPartyPolicy;
  readonly scriptPolicy: ThirdPartyPolicy;
  readonly cookiePolicy: ThirdPartyPolicy;
  readonly storagePolicy: ThirdPartyPolicy;
  readonly fetchPolicy: ThirdPartyPolicy;
  readonly popupPolicy: ThirdPartyPolicy;
  readonly allowTrustedOrigins: readonly string[];
  readonly enforceStrictCSP: boolean;
  readonly blockFingerprinting: boolean;
  readonly isolateIframes: boolean;
  readonly stripUserAgent: boolean;
}

interface OriginPermission {
  readonly origin: string;
  readonly iframeAllowed: boolean;
  readonly scriptAllowed: boolean;
  readonly cookieAllowed: boolean;
  readonly storageAllowed: boolean;
  readonly fetchAllowed: boolean;
  readonly popupAllowed: boolean;
}

interface BlockedThirdPartyRequest {
  readonly url: string;
  readonly origin: string;
  readonly targetUrl: string;
  readonly blockType: 'iframe' | 'script' | 'cookie' | 'storage' | 'fetch' | 'popup';
  readonly timestamp: number;
  readonly reason: string;
}

type ThirdPartySecurityEventType =
  | 'thirdPartyBlocked'
  | 'configChanged';

interface ThirdPartyBlockedEvent {
  readonly kind: 'thirdPartyBlocked';
  readonly blocked: BlockedThirdPartyRequest;
  readonly totalBlocked: number;
}

interface ConfigChangedEvent {
  readonly kind: 'configChanged';
  readonly config: ThirdPartySecurityConfig;
}

type ThirdPartySecurityEvent = ThirdPartyBlockedEvent | ConfigChangedEvent;
type ThirdPartySecurityEventHandler = (event: ThirdPartySecurityEvent) => void;

const DEFAULT_THIRD_PARTY_CONFIG: ThirdPartySecurityConfig = {
  iframePolicy: 'isolate',
  scriptPolicy: 'restrict',
  cookiePolicy: 'block',
  storagePolicy: 'block',
  fetchPolicy: 'restrict',
  popupPolicy: 'block',
  allowTrustedOrigins: [],
  enforceStrictCSP: true,
  blockFingerprinting: true,
  isolateIframes: true,
  stripUserAgent: true,
};

const ISOLATED_IFRAME_PERMISSIONS: SandboxPermissions = {
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

const RESTRICTED_IFRAME_PERMISSIONS: SandboxPermissions = {
  allowScripts: true,
  allowForms: true,
  allowModals: false,
  allowPopups: false,
  allowSameOrigin: false,
  allowTopNavigation: false,
  allowPointerLock: false,
  allowOrientationLock: false,
  allowPresentation: false,
};

const STRICT_CSP_DIRECTIVES: Record<string, string> = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data: blob:",
  'connect-src': "'self' ws: wss: https: http: stun: stuns: turn: turns: dns: https+dns: tls+dns: quic+dns:",
  'frame-src': "'self'",
  'font-src': "'self' data:",
  'media-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'frame-ancestors': "'none'",
};

const KNOWN_FINGERPRINTING_DOMAINS: readonly string[] = [
  'fingerprintjs.com', 'fpjs.io', 'fingerprint.com',
  'js.fingerprint.com', 'api.fpjs.io', 'cdn.jsdelivr.net/fingerprint',
  'clientjs.cdn', 'browserleaks.com', 'ipify.org',
  'api.ipify.org', 'ipinfo.io', 'geoiplookup.io',
  'deviceinfo.io', 'canvas-fingerprint', 'audio-fingerprint',
  'webgl-fingerprint', 'font-fingerprint',
];

function extractOrigin(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return url;
  }
}

/**
 * Remove a leading "www." prefix from a hostname, if present.
 * Useful when comparing origins where www and non-www variants
 * should be treated as the same party.
 *
 * @example
 *   stripWwwPrefix("www.example.com")  → "example.com"
 *   stripWwwPrefix("example.com")      → "example.com"
 *   stripWwwPrefix("www.com")          → "www.com"   (preserved — not a subdomain)
 *   stripWwwPrefix("www-something.com")→ "www-something.com" (not "www." prefix)
 */
function stripWwwPrefix(hostname: string): string {
  if (hostname.startsWith('www.') && hostname.length > 4) {
    const rest = hostname.slice(4);
    // Only strip when the remainder still contains a dot (i.e. a real domain
    // follows).  "www.com" → rest is "com" (no dot) → preserved.
    if (rest.includes('.')) return rest;
  }
  return hostname;
}

function isThirdParty(requestOrigin: string, pageOrigin: string): boolean {
  if (!requestOrigin || !pageOrigin) return false;
  try {
    const r = new URL(requestOrigin);
    const p = new URL(pageOrigin);
    return stripWwwPrefix(r.hostname) !== stripWwwPrefix(p.hostname);
  } catch {
    return true;
  }
}

interface IThirdPartySecurityManager extends IDisposable {
  readonly config: ThirdPartySecurityConfig;
  readonly totalBlocked: number;
  readonly blockedRequests: readonly BlockedThirdPartyRequest[];
  updateConfig(partial: Partial<ThirdPartySecurityConfig>): void;
  checkIframeAllowed(origin: string, pageOrigin: string): { allowed: boolean; sandbox?: SandboxPermissions; reason?: string };
  checkScriptAllowed(origin: string, pageOrigin: string): { allowed: boolean; reason?: string };
  checkCookieAccess(origin: string, pageOrigin: string): { allowed: boolean; reason?: string };
  checkStorageAccess(origin: string, pageOrigin: string): { allowed: boolean; reason?: string };
  checkFetchAllowed(origin: string, pageOrigin: string, targetUrl: string): { allowed: boolean; reason?: string };
  checkPopupAllowed(origin: string, pageOrigin: string): { allowed: boolean; reason?: string };
  isTrustedOrigin(origin: string): boolean;
  addTrustedOrigin(origin: string): void;
  removeTrustedOrigin(origin: string): void;
  getStrictCSPDirectives(): Record<string, string>;
  shouldBlockFingerprinting(url: string): boolean;
  getIframeSandboxPermissions(origin: string, pageOrigin: string): SandboxPermissions;
  on(type: ThirdPartySecurityEventType, handler: ThirdPartySecurityEventHandler): void;
  off(type: ThirdPartySecurityEventType, handler: ThirdPartySecurityEventHandler): void;
}

class ThirdPartySecurityManager implements IThirdPartySecurityManager {
  private _config: ThirdPartySecurityConfig;
  private _blockedRequests: BlockedThirdPartyRequest[] = [];
  private readonly eventHandlers = new Map<ThirdPartySecurityEventType, Set<ThirdPartySecurityEventHandler>>();

  constructor(config?: Partial<ThirdPartySecurityConfig>) {
    this._config = { ...DEFAULT_THIRD_PARTY_CONFIG, ...config };
  }

  get config(): ThirdPartySecurityConfig { return { ...this._config }; }
  get totalBlocked(): number { return this._blockedRequests.length; }
  get blockedRequests(): readonly BlockedThirdPartyRequest[] { return [...this._blockedRequests]; }

  updateConfig(partial: Partial<ThirdPartySecurityConfig>): void {
    this._config = { ...this._config, ...partial };
    this.emit({ kind: 'configChanged', config: this._config });
  }

  checkIframeAllowed(origin: string, pageOrigin: string): { allowed: boolean; sandbox?: SandboxPermissions; reason?: string } {
    if (this.isTrustedOrigin(origin)) return { allowed: true };
    if (!isThirdParty(origin, pageOrigin)) return { allowed: true };

    switch (this._config.iframePolicy) {
      case 'block': {
        this.recordBlocked(origin, origin, 'iframe', 'Third-party iframes are blocked');
        return { allowed: false, reason: 'Third-party iframes are blocked by policy' };
      }
      case 'isolate': {
        return {
          allowed: true,
          sandbox: ISOLATED_IFRAME_PERMISSIONS,
          reason: 'Isolated with minimal permissions',
        };
      }
      case 'restrict': {
        return {
          allowed: true,
          sandbox: RESTRICTED_IFRAME_PERMISSIONS,
          reason: 'Restricted permissions applied',
        };
      }
      case 'allow': return { allowed: true };
    }
  }

  checkScriptAllowed(origin: string, pageOrigin: string): { allowed: boolean; reason?: string } {
    if (this.isTrustedOrigin(origin)) return { allowed: true };
    if (!isThirdParty(origin, pageOrigin)) return { allowed: true };

    switch (this._config.scriptPolicy) {
      case 'block': {
        this.recordBlocked(origin, origin, 'script', 'Third-party scripts are blocked');
        return { allowed: false, reason: 'Third-party scripts are blocked by policy' };
      }
      case 'restrict': {
        if (this.shouldBlockFingerprinting(origin)) {
          this.recordBlocked(origin, origin, 'script', 'Fingerprinting script blocked');
          return { allowed: false, reason: 'Fingerprinting script blocked' };
        }
        return { allowed: true, reason: 'Restricted script execution' };
      }
      case 'isolate': return { allowed: true, reason: 'Isolated script execution' };
      case 'allow': return { allowed: true };
    }
  }

  checkCookieAccess(origin: string, pageOrigin: string): { allowed: boolean; reason?: string } {
    if (this.isTrustedOrigin(origin)) return { allowed: true };
    if (!isThirdParty(origin, pageOrigin)) return { allowed: true };

    switch (this._config.cookiePolicy) {
      case 'block': {
        this.recordBlocked(origin, origin, 'cookie', 'Third-party cookies are blocked');
        return { allowed: false, reason: 'Third-party cookies are blocked by policy' };
      }
      case 'restrict': return { allowed: true, reason: 'SameSite=Lax enforced for third-party cookies' };
      case 'isolate': return { allowed: true, reason: 'Partitioned storage for third-party cookies' };
      case 'allow': return { allowed: true };
    }
  }

  checkStorageAccess(origin: string, pageOrigin: string): { allowed: boolean; reason?: string } {
    if (this.isTrustedOrigin(origin)) return { allowed: true };
    if (!isThirdParty(origin, pageOrigin)) return { allowed: true };

    switch (this._config.storagePolicy) {
      case 'block': {
        this.recordBlocked(origin, origin, 'storage', 'Third-party storage access blocked');
        return { allowed: false, reason: 'Third-party storage (localStorage/sessionStorage/IndexedDB) is blocked by policy' };
      }
      case 'restrict': {
        return { allowed: true, reason: 'Storage access restricted to ephemeral partition' };
      }
      case 'isolate': return { allowed: true, reason: 'Isolated ephemeral storage' };
      case 'allow': return { allowed: true };
    }
  }

  checkFetchAllowed(origin: string, pageOrigin: string, targetUrl: string): { allowed: boolean; reason?: string } {
    if (this.isTrustedOrigin(origin)) return { allowed: true };
    if (!isThirdParty(origin, pageOrigin)) return { allowed: true };

    switch (this._config.fetchPolicy) {
      case 'block': {
        this.recordBlocked(origin, targetUrl, 'fetch', 'Third-party fetch blocked');
        return { allowed: false, reason: 'Third-party network requests are blocked by policy' };
      }
      case 'restrict': {
        if (this.shouldBlockFingerprinting(targetUrl)) {
          this.recordBlocked(origin, targetUrl, 'fetch', 'Fingerprinting endpoint blocked');
          return { allowed: false, reason: 'Fingerprinting endpoint blocked' };
        }
        return { allowed: true, reason: 'Restricted fetch with referrer stripping' };
      }
      case 'isolate': return { allowed: true, reason: 'Isolated fetch' };
      case 'allow': return { allowed: true };
    }
  }

  checkPopupAllowed(origin: string, pageOrigin: string): { allowed: boolean; reason?: string } {
    if (this.isTrustedOrigin(origin)) return { allowed: true };
    if (!isThirdParty(origin, pageOrigin)) {
      if (this._config.popupPolicy === 'block') {
        this.recordBlocked(origin, origin, 'popup', 'Popups are blocked by policy');
        return { allowed: false, reason: 'Popups are blocked by policy' };
      }
      return { allowed: true };
    }

    switch (this._config.popupPolicy) {
      case 'block': {
        this.recordBlocked(origin, origin, 'popup', 'Third-party popup blocked');
        return { allowed: false, reason: 'Third-party popups are blocked by policy' };
      }
      case 'restrict': return { allowed: true, reason: 'Popup allowed with opener set to null' };
      case 'isolate': return { allowed: true, reason: 'Isolated popup with no opener' };
      case 'allow': return { allowed: true };
    }
  }

  isTrustedOrigin(origin: string): boolean {
    return this._config.allowTrustedOrigins.includes(origin);
  }

  addTrustedOrigin(origin: string): void {
    if (!this._config.allowTrustedOrigins.includes(origin)) {
      this._config = {
        ...this._config,
        allowTrustedOrigins: [...this._config.allowTrustedOrigins, origin],
      };
    }
  }

  removeTrustedOrigin(origin: string): void {
    this._config = {
      ...this._config,
      allowTrustedOrigins: this._config.allowTrustedOrigins.filter(o => o !== origin),
    };
  }

  getStrictCSPDirectives(): Record<string, string> {
    return this._config.enforceStrictCSP ? { ...STRICT_CSP_DIRECTIVES } : {};
  }

  shouldBlockFingerprinting(url: string): boolean {
    if (!this._config.blockFingerprinting) return false;
    const lower = url.toLowerCase();
    return KNOWN_FINGERPRINTING_DOMAINS.some(d => lower.includes(d));
  }

  getIframeSandboxPermissions(origin: string, pageOrigin: string): SandboxPermissions {
    if (this.isTrustedOrigin(origin)) {
      return {
        allowScripts: true, allowForms: true, allowModals: true,
        allowPopups: true, allowSameOrigin: true, allowTopNavigation: true,
        allowPointerLock: true, allowOrientationLock: true, allowPresentation: true,
      };
    }
    if (!isThirdParty(origin, pageOrigin)) {
      return {
        allowScripts: true, allowForms: true, allowModals: true,
        allowPopups: true, allowSameOrigin: true, allowTopNavigation: false,
        allowPointerLock: true, allowOrientationLock: true, allowPresentation: true,
      };
    }
    switch (this._config.iframePolicy) {
      case 'isolate': return { ...ISOLATED_IFRAME_PERMISSIONS, allowSameOrigin: false };
      case 'restrict': return { ...RESTRICTED_IFRAME_PERMISSIONS };
      default: return { ...ISOLATED_IFRAME_PERMISSIONS };
    }
  }

  on(type: ThirdPartySecurityEventType, handler: ThirdPartySecurityEventHandler): void {
    if (!this.eventHandlers.has(type)) this.eventHandlers.set(type, new Set());
    this.eventHandlers.get(type)!.add(handler);
  }

  off(type: ThirdPartySecurityEventType, handler: ThirdPartySecurityEventHandler): void {
    this.eventHandlers.get(type)?.delete(handler);
  }

  private recordBlocked(origin: string, targetUrl: string, blockType: BlockedThirdPartyRequest['blockType'], reason: string): void {
    const blocked: BlockedThirdPartyRequest = {
      url: targetUrl,
      origin,
      targetUrl,
      blockType,
      timestamp: Date.now(),
      reason,
    };
    this._blockedRequests.push(blocked);
    this.emit({ kind: 'thirdPartyBlocked', blocked, totalBlocked: this._blockedRequests.length });
  }

  private emit(event: ThirdPartySecurityEvent): void {
    const handlers = this.eventHandlers.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error('[ThirdPartySecurity] Handler threw:', err);
      }
    }
  }

  dispose(): void {
    this._blockedRequests = [];
    this.eventHandlers.clear();
  }
}

export { ThirdPartySecurityManager, DEFAULT_THIRD_PARTY_CONFIG, ISOLATED_IFRAME_PERMISSIONS, RESTRICTED_IFRAME_PERMISSIONS, STRICT_CSP_DIRECTIVES, extractOrigin, stripWwwPrefix };
export type { IThirdPartySecurityManager, ThirdPartySecurityConfig, ThirdPartyPolicy, BlockedThirdPartyRequest, ThirdPartySecurityEvent, ThirdPartySecurityEventType, OriginPermission };
