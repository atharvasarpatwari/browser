import type { IDisposable } from '../../app/dependency-container';

interface IXssProtectionService extends IDisposable {
  sanitize(input: string, context: XssContext): string;
  filterHtml(input: string): string;
  filterAttribute(input: string): string;
  filterUrl(input: string): string;
  filterJavaScript(input: string): string;
  detectXss(input: string, context: XssContext): XssDetectionResult;
  setMode(mode: XssProtectionMode): void;
  getMode(): XssProtectionMode;
  setBlockThreshold(threshold: number): void;
  getBlockedCount(): number;
  onEvent(handler: XssProtectionEventHandler): () => void;
}

type XssContext = 'html' | 'attribute' | 'url' | 'javascript' | 'style' | 'unknown';
type XssProtectionMode = 'block' | 'sanitize' | 'detect-only' | 'disabled';
type XssEventKind = 'blocked' | 'sanitized' | 'detected';
type XssProtectionEventHandler = (event: XssProtectionEvent) => void;

interface XssDetectionResult {
  readonly isMalicious: boolean;
  readonly score: number;
  readonly matches: readonly string[];
  readonly context: XssContext;
}

interface XssProtectionEvent {
  readonly kind: XssEventKind;
  readonly data?: Record<string, unknown>;
}

const XSS_PATTERNS: ReadonlyArray<{ pattern: RegExp; name: string; weight: number }> = [
  { pattern: /<script[\s>]/i, name: 'script-tag', weight: 10 },
  { pattern: /javascript\s*:/i, name: 'javascript-protocol', weight: 9 },
  { pattern: /on\w+\s*=\s*['"]?[^'"]*['"]?/i, name: 'event-handler', weight: 8 },
  { pattern: /<iframe[\s>]/i, name: 'iframe-tag', weight: 7 },
  { pattern: /<object[\s>]/i, name: 'object-tag', weight: 7 },
  { pattern: /<embed[\s>]/i, name: 'embed-tag', weight: 6 },
  { pattern: /<svg[\s>/]/i, name: 'svg-tag', weight: 5 },
  { pattern: /<math[\s>]/i, name: 'math-tag', weight: 5 },
  { pattern: /<link[\s>]/i, name: 'link-tag', weight: 5 },
  { pattern: /<style[\s>]/i, name: 'style-tag', weight: 5 },
  { pattern: /<form[\s>]/i, name: 'form-tag', weight: 4 },
  { pattern: /<input[\s>]/i, name: 'input-tag', weight: 3 },
  { pattern: /<base[\s>]/i, name: 'base-tag', weight: 6 },
  { pattern: /<meta[\s>]/i, name: 'meta-tag', weight: 4 },
  { pattern: /data\s*:\s*text\/html/i, name: 'data-html', weight: 7 },
  { pattern: /alert\s*\(/i, name: 'alert-function', weight: 5 },
  { pattern: /eval\s*\(/i, name: 'eval-function', weight: 8 },
  { pattern: /String\.fromCharCode/i, name: 'string-fromcharcode', weight: 4 },
  { pattern: /document\.cookie/i, name: 'document-cookie', weight: 3 },
  { pattern: /document\.location/i, name: 'document-location', weight: 3 },
  { pattern: /window\.location/i, name: 'window-location', weight: 3 },
  { pattern: /fetch\s*\(/i, name: 'fetch-call', weight: 2 },
  { pattern: /XMLHttpRequest/i, name: 'xmlhttprequest', weight: 2 },
  { pattern: /&#x?\w+;/i, name: 'html-entity-encoding', weight: 2 },
  { pattern: /\\x[0-9a-f]{2}/i, name: 'hex-encoding', weight: 3 },
  { pattern: /\\u[0-9a-f]{4}/i, name: 'unicode-escape', weight: 3 },
];

const HTML_META_CHARS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

class XssProtectionService implements IXssProtectionService {
  private _mode: XssProtectionMode = 'block';
  private _blockThreshold = 5;
  private _blockedCount = 0;
  private _handlers = new Set<XssProtectionEventHandler>();

  sanitize(input: string, context: XssContext): string {
    switch (context) {
      case 'html': return this.filterHtml(input);
      case 'attribute': return this.filterAttribute(input);
      case 'url': return this.filterUrl(input);
      case 'javascript': return this.filterJavaScript(input);
      default: return this.filterHtml(input);
    }
  }

  filterHtml(input: string): string {
    return input.replace(/[&<>"'/]/g, c => HTML_META_CHARS[c] ?? c);
  }

  filterAttribute(input: string): string {
    return input.replace(/["']/g, c => HTML_META_CHARS[c] ?? c)
      .replace(/javascript\s*:/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }

  filterUrl(input: string): string {
    return input.replace(/javascript\s*:/gi, '')
      .replace(/data\s*:\s*text\/html/gi, 'data:text/plain');
  }

  filterJavaScript(input: string): string {
    return input.replace(/<\/script>/gi, '<\\/script>')
      .replace(/[\r\n]/g, ' ');
  }

  detectXss(input: string, context: XssContext): XssDetectionResult {
    const matches: string[] = [];
    let score = 0;

    for (const { pattern, name, weight } of XSS_PATTERNS) {
      if (pattern.test(input)) {
        matches.push(name);
        score += weight;
      }
    }

    const isMalicious = score >= this._blockThreshold;

    if (isMalicious) {
      this._blockedCount++;
      this.emit({ kind: 'detected', data: { score, context, matches: [...matches] } });

      if (this._mode === 'block') {
        this.emit({ kind: 'blocked', data: { score, context } });
      } else if (this._mode === 'sanitize') {
        this.emit({ kind: 'sanitized', data: { score, context } });
      }
    }

    return { isMalicious, score, matches, context };
  }

  setMode(mode: XssProtectionMode): void {
    this._mode = mode;
  }

  getMode(): XssProtectionMode {
    return this._mode;
  }

  setBlockThreshold(threshold: number): void {
    this._blockThreshold = threshold;
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: XssProtectionEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: XssProtectionEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { XssProtectionService, XSS_PATTERNS };
export type { IXssProtectionService, XssContext, XssProtectionMode, XssDetectionResult, XssProtectionEvent, XssEventKind, XssProtectionEventHandler };
