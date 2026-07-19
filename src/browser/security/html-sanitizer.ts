import type { IDomTree, DomNode, DomElement, DomTextNode, DomDocument } from '../rendering/dom-tree';

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

const DEFAULT_STRIPPED_URL_SCHEMES = new Set([
  'javascript:', 'vbscript:', 'data:', 'livescript:',
]);

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
    }

    for (const attr of attrsToRemove) {
      domTree.removeAttribute(el, attr);
      this.removedCount++;
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
