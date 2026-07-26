/**
 * @file src/browser/security/blocked-url-schemes.ts
 *
 * Single source of truth for URL schemes that are dangerous and should be
 * blocked across all entry points (setAttribute, fetch, link navigation, etc.).
 *
 * Used by:
 *   - html-sanitizer.ts (DOM tree sanitization)
 *   - dom-bindings.ts (setAttribute guard)
 *   - fetch-api.ts (fetch-level blocking)
 *   - url-parser.ts (navigation blocking)
 */

/** Schemes that execute code or exfiltrate data — blocked everywhere. */
const _BLOCKED_URL_SCHEMES: string[] = [
  'javascript:',
  'vbscript:',
  'data:',
  'livescript:',
  'blob:',
];

export const BLOCKED_URL_SCHEMES: ReadonlySet<string> = new Set(_BLOCKED_URL_SCHEMES);

/** Event handler attribute prefix — stripped on all elements. */
export const EVENT_HANDLER_PREFIX = 'on';

/** URL-bearing attributes that need scheme validation. */
export const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href', 'src', 'action', 'formaction', 'poster', 'background',
  'dynsrc', 'lowsrc', 'ping', 'data-src', 'srcset', 'xlink:href',
]);

/**
 * Check if a URL string starts with a blocked scheme (case-insensitive, trimmed).
 */
export function isBlockedUrlScheme(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  for (const scheme of _BLOCKED_URL_SCHEMES) {
    if (trimmed.startsWith(scheme)) return true;
  }
  return false;
}

/**
 * Check if an attribute name is an event handler (on*).
 */
export function isEventHandlerAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(EVENT_HANDLER_PREFIX) && lower.length > 2;
}

/**
 * Check if an attribute is a URL attribute that needs scheme validation.
 */
export function isUrlAttribute(name: string): boolean {
  return URL_ATTRIBUTES.has(name.toLowerCase());
}
