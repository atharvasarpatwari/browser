/**
 * @file src/browser/security/secure-context.ts
 *
 * Secure Contexts (W3C) enforcement helper.
 *
 * A page context is "potentially trustworthy" (secure) when it was delivered
 * in a way that provides confidentiality + integrity:
 *   • https / wss schemes
 *   • file: URLs (local content is user-owned)
 *   • Loopback hosts (localhost, 127.0.0.0/8, ::1) regardless of scheme
 *   • Browser-internal chrome schemes (nova:)
 *
 * Powerful APIs — geolocation, notifications, clipboard, camera, microphone —
 * MUST only be exposed/usable inside a secure context. The JS runtime exposes
 * the boolean as `window.isSecureContext`; the permission-gated web-API layer
 * consults the same helpers before prompting for / granting those permissions.
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only answers "is this URL/origin a secure context?".
 *  Pure functions    All helpers are side-effect-free.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Network schemes that are inherently trustworthy. */
const SECURE_SCHEMES = new Set(['https:', 'wss:', 'file:']);

/** Browser-internal schemes — trusted chrome UI, not remote content. */
const TRUSTED_INTERNAL_SCHEMES = new Set(['nova:']);

/** IPv4 loopback range check (127.0.0.0/8). */
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Permissions that are only usable inside a secure context (W3C Secure Contexts). */
const SECURE_CONTEXT_REQUIRED_PERMISSIONS: ReadonlySet<string> = new Set([
  'geolocation',
  'notifications',
  'clipboard-read',
  'clipboard-write',
  'camera',
  'microphone',
]);

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a full page URL denotes a secure context.
 * Falls back to origin-style parsing for inputs that are not full URLs.
 */
function isSecureContextUrl(url: string): boolean {
  try {
    return isSecureUrl(new URL(url));
  } catch {
    return isSecureContextOrigin(url);
  }
}

/**
 * Whether an origin string (e.g. "https://example.com") is a secure context.
 */
function isSecureContextOrigin(origin: string): boolean {
  if (!origin || typeof origin !== 'string') return false;
  const trimmed = origin.trim();
  if (!trimmed) return false;
  try {
    return isSecureUrl(new URL(trimmed));
  } catch {
    return false;
  }
}

/**
 * Whether the given permission name is privileged enough to require a
 * secure context before it may be offered to a page.
 */
function isSecureContextRequiredPermission(name: string): boolean {
  return SECURE_CONTEXT_REQUIRED_PERMISSIONS.has(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isSecureUrl(u: URL): boolean {
  const scheme = u.protocol.toLowerCase();

  if (SECURE_SCHEMES.has(scheme)) return true;
  if (TRUSTED_INTERNAL_SCHEMES.has(scheme)) return true;

  // Loopback hosts are potentially trustworthy on any scheme.
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '[::1]' || host === '::1' || host === '127.0.0.1') return true;
  if (LOOPBACK_IPV4.test(host)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  isSecureContextUrl,
  isSecureContextOrigin,
  isSecureContextRequiredPermission,
  SECURE_SCHEMES,
  TRUSTED_INTERNAL_SCHEMES,
};