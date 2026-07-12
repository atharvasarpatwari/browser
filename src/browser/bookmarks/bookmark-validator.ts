import type { IDisposable } from '../../app/dependency-container';

const BLOCKED_SCHEMES: readonly string[] = [
  'javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:',
];

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 512;

interface BookmarkValidationResult {
  readonly valid: boolean;
  readonly sanitizedUrl: string;
  readonly sanitizedTitle: string;
  readonly error?: string;
}

interface IBookmarkValidator extends IDisposable {
  validateUrl(url: string): { valid: boolean; sanitized: string; error?: string };
  validateTitle(title: string): { valid: boolean; sanitized: string; error?: string };
  validateBookmark(url: string, title: string): BookmarkValidationResult;
}

function sanitizeTitle(title: string): string {
  let t = title.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > MAX_TITLE_LENGTH) t = t.slice(0, MAX_TITLE_LENGTH);
  return t;
}

function sanitizeUrl(url: string): string {
  let u = url.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  u = u.trim();
  return u;
}

function isBlockedScheme(url: string): boolean {
  const lower = url.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lower.startsWith(scheme)) return true;
  }
  return false;
}

function isDangerousUrl(url: string): boolean {
  if (isBlockedScheme(url)) return true;
  if (url.length > MAX_URL_LENGTH) return true;
  if (/[<>"'`]/.test(url)) return true;
  return false;
}

function generateSecureId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `bm-${crypto.randomUUID().slice(0, 8)}`;
  }
  const array = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < 12; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return `bm-${Array.from(array, b => b.toString(16).padStart(2, '0')).join('')}`;
}

class BookmarkValidator implements IBookmarkValidator {
  validateUrl(url: string): { valid: boolean; sanitized: string; error?: string } {
    const sanitized = sanitizeUrl(url);
    if (!sanitized) return { valid: false, sanitized: '', error: 'URL is empty' };
    if (isDangerousUrl(sanitized)) return { valid: false, sanitized, error: `Blocked scheme or dangerous URL` };
    try {
      if (sanitized.includes('://') || sanitized.startsWith('//')) {
        new URL(sanitized);
      }
    } catch {
      return { valid: false, sanitized, error: 'Invalid URL format' };
    }
    return { valid: true, sanitized };
  }

  validateTitle(title: string): { valid: boolean; sanitized: string; error?: string } {
    const sanitized = sanitizeTitle(title);
    if (!sanitized) return { valid: false, sanitized: '', error: 'Title is empty' };
    return { valid: true, sanitized };
  }

  validateBookmark(url: string, title: string): BookmarkValidationResult {
    const urlResult = this.validateUrl(url);
    const titleResult = this.validateTitle(title || urlResult.sanitized);
    if (!urlResult.valid) {
      return { valid: false, sanitizedUrl: urlResult.sanitized, sanitizedTitle: titleResult.sanitized, error: urlResult.error };
    }
    if (!titleResult.valid) {
      return { valid: false, sanitizedUrl: urlResult.sanitized, sanitizedTitle: '', error: titleResult.error };
    }
    return { valid: true, sanitizedUrl: urlResult.sanitized, sanitizedTitle: titleResult.sanitized };
  }

  dispose(): void {}
}

export { BookmarkValidator, generateSecureId, sanitizeUrl, sanitizeTitle, isBlockedScheme, isDangerousUrl };
export type { IBookmarkValidator, BookmarkValidationResult };
