import type { IDomTree, DomNode, DomElement, DomTextNode, DomDocument } from '../rendering/dom-tree';
import { BLOCKED_URL_SCHEMES } from './blocked-url-schemes';

export interface HtmlSanitizerConfig {
  readonly strippedElements?: ReadonlySet<string>;
  readonly strippedAttributes?: ReadonlySet<string>;
  readonly strippedUrlSchemes?: ReadonlySet<string>;
  readonly keepScriptElements?: boolean;
}

const DEFAULT_STRIPPED_ELEMENTS = new Set([
  'script', 'iframe', 'object', 'embed', 'applet', 'base', 'template',
]);

const DEFAULT_STRIPPED_ATTRIBUTES = new Set([
  'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
  'onmousemove', 'onmouseout', 'onkeypress', 'onkeydown', 'onkeyup',
  'onfocus', 'onblur', 'onsubmit', 'onreset', 'onselect', 'onchange',
  'onload', 'onerror', 'onabort', 'onresize', 'onscroll', 'onunload',
  'onbeforeunload', 'onhashchange', 'onpopstate', 'onstorage',
  'onanimationend', 'onanimationiteration', 'onanimationstart',
  'ontransitionend', 'onpointerdown', 'onpointerup', 'onpointermove',
  'onpointerover', 'onpointerout', 'onpointercancel', 'onwheel',
  'oncontextmenu', 'ondrag', 'ondragstart', 'ondragend', 'ondragover',
  'ondragenter', 'ondragleave', 'ondrop', 'oninput', 'oninvalid',
  'onsearch', 'ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel',
  'onauxclick', 'onmessage', 'onmessageerror', 'onoffline', 'ononline',
  'onpagehide', 'onpageshow', 'onpageswap', 'onpagereveal',
  'oncontentvisibilityautostatechange', 'onformdata',
]);

const DEFAULT_STRIPPED_URL_SCHEMES = BLOCKED_URL_SCHEMES;

type SanitizeRoot = DomDocument | DomNode;

export class HtmlSanitizer {
  private readonly config: Required<HtmlSanitizerConfig>;
  private removedCount = 0;

  constructor(config?: HtmlSanitizerConfig) {
    this.config = {
      strippedElements: config?.strippedElements ?? DEFAULT_STRIPPED_ELEMENTS,
      strippedAttributes: config?.strippedAttributes ?? DEFAULT_STRIPPED_ATTRIBUTES,
      strippedUrlSchemes: config?.strippedUrlSchemes ?? DEFAULT_STRIPPED_URL_SCHEMES,
      keepScriptElements: config?.keepScriptElements ?? false,
    };
  }

  sanitize(root: SanitizeRoot, domTree: IDomTree): void {
    this.removedCount = 0;
    this.sanitizeNode(root, domTree);
  }

  getRemovedCount(): number {
    return this.removedCount;
  }

  private sanitizeNode(node: SanitizeRoot, domTree: IDomTree): void {
    if ('nodeType' in node && node.nodeType === 'element') {
      const el = node as DomElement;
      const tagName = el.tagName.toLowerCase();

      if (this.shouldRemoveElement(tagName)) {
        this.removeElement(el, domTree);
        return;
      }

      this.sanitizeAttributes(el, domTree);
    }

    const children = [...node.children];
    for (const child of children) {
      this.sanitizeNode(child, domTree);
    }
  }

  private shouldRemoveElement(tagName: string): boolean {
    if (this.config.keepScriptElements && tagName === 'script') return false;
    return this.config.strippedElements.has(tagName);
  }

  private removeElement(el: DomElement, domTree: IDomTree): void {
    const parent = el.parent;
    if (parent && parent.nodeType === 'element') {
      domTree.removeChild(parent as DomElement, el);
      this.removedCount++;
    }
  }

  private sanitizeAttributes(el: DomElement, domTree: IDomTree): void {
    const attrsToRemove: string[] = [];
    const attrsToSanitize: Array<{ name: string; newValue: string }> = [];

    for (const [name, value] of el.attributes) {
      const lowerName = name.toLowerCase();

      if (this.isEventAttribute(lowerName)) {
        attrsToRemove.push(name);
        continue;
      }

      if (this.isUrlAttribute(lowerName) && this.containsDangerousUrl(value)) {
        attrsToRemove.push(name);
        continue;
      }

      // CSS injection: sanitize style attribute values
      if (lowerName === 'style' && containsDangerousCss(value)) {
        attrsToSanitize.push({ name, newValue: sanitizeStyleAttribute(value) });
      }
    }

    for (const attr of attrsToRemove) {
      domTree.removeAttribute(el, attr);
      this.removedCount++;
    }

    for (const { name, newValue } of attrsToSanitize) {
      domTree.setAttribute(el, name, newValue);
    }
  }

  private isEventAttribute(name: string): boolean {
    return this.config.strippedAttributes.has(name) || name.startsWith('on');
  }

  private isUrlAttribute(name: string): boolean {
    return name === 'href' || name === 'src' || name === 'action' ||
           name === 'formaction' || name === 'poster' || name === 'background' ||
           name === 'dynsrc' || name === 'lowsrc' || name === 'ping' ||
           name === 'data-src' || name === 'srcset' || name === 'xlink:href';
  }

  private containsDangerousUrl(value: string): boolean {
    const trimmed = value.trim().toLowerCase();
    for (const scheme of this.config.strippedUrlSchemes) {
      if (trimmed.startsWith(scheme)) return true;
    }
    return false;
  }
}

export function sanitizeHtmlTree(root: SanitizeRoot, domTree: IDomTree, config?: HtmlSanitizerConfig): number {
  const sanitizer = new HtmlSanitizer(config);
  sanitizer.sanitize(root, domTree);
  return sanitizer.getRemovedCount();
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS INJECTION SANITIZATION
// ─────────────────────────────────────────────────────────────────────────────

/** Patterns that indicate CSS injection attacks. */
const DANGEROUS_CSS_PATTERNS: RegExp[] = [
  /expression\s*\(/i,                    // IE CSS expressions: expression(alert(1))
  /url\s*\(\s*['"]?\s*javascript\s*:/i,  // url(javascript:...) — script execution
  /url\s*\(\s*['"]?\s*data\s*:/i,        // url(data:...) — data exfiltration
  /url\s*\(\s*['"]?\s*vbscript\s*:/i,    // url(vbscript:...) — IE script
  /-moz-binding\s*:/i,                   // Firefox XBL binding attacks
  /behavior\s*:\s*url/i,                 // IE behavior attachment
  /@import\s+['"]?\s*javascript\s*:/i,   // @import with javascript:
  /@import\s+['"]?\s*data\s*:/i,         // @import with data:
  /expression\s*\(\s*['"]?eval/i,        // Nested eval in expression
  /behavior\s*:\s*url\s*\(\s*['"]?\s*http/i, // External behavior
];

/**
 * Check if a CSS value string contains a dangerous pattern.
 * Returns true if the value should be blocked.
 */
export function containsDangerousCss(value: string): boolean {
  for (const pattern of DANGEROUS_CSS_PATTERNS) {
    if (pattern.test(value)) return true;
  }
  return false;
}

/**
 * Sanitize a CSS property value, removing dangerous patterns.
 * Returns the sanitized value, or empty string if the entire value is dangerous.
 */
export function sanitizeCssValue(value: string): string {
  if (containsDangerousCss(value)) {
    return '';
  }
  return value;
}

/**
 * Sanitize a style attribute value (e.g., from setAttribute or inline style).
 * Strips dangerous CSS injection patterns.
 */
export function sanitizeStyleAttribute(value: string): string {
  const declarations = value.split(';');
  const safe: string[] = [];
  for (const decl of declarations) {
    if (!containsDangerousCss(decl)) {
      safe.push(decl);
    }
  }
  return safe.join(';');
}
