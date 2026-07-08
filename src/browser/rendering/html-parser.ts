/**
 * @file src/browser/rendering/html-parser.ts
 * @session 11
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Convert a raw HTML string into a typed parse tree (HtmlDocument) that
 * every downstream rendering layer can traverse without touching raw text.
 *
 * Pipeline position
 * ─────────────────
 *   BrowserEngine receives PageLoadResult (raw HTML body)
 *        │
 *        ▼
 *   HtmlParser.parse(html)           ← this file
 *        │
 *        ├─▶ HtmlDocument (parse tree)
 *        │       │
 *        │       └─▶ css-parser.ts   (session 12) — <style> / <link> nodes
 *        │           dom-tree.ts     (session 13) — live DOM construction
 *        │           resource-loader (session  9) — discovered sub-resources
 *        │
 *        └─▶ SubResourceList          discovered <link>, <script>, <img> URLs
 *
 * Parsing model
 * ─────────────
 * Two-stage pipeline matching the WHATWG HTML parsing specification:
 *   Stage 1 — Tokenizer   : text → flat token stream
 *   Stage 2 — Tree builder: tokens → HtmlDocument tree
 *
 * Error recovery follows the WHATWG "tree construction error" model:
 * malformed input is accepted with ParseError nodes rather than throwing.
 *
 * Supported token types:
 *   Doctype, OpenTag, CloseTag, SelfClosingTag,
 *   Text, Comment, CdataSection, ProcessingInstruction
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IHtmlParser is the only type callers import.
 *  Encapsulation    Tokenizer and TreeBuilder are private inner-collaborators;
 *                   their state is fully hidden from callers.
 *  Single-Resp.     HtmlParser parses HTML only — no CSS, no JS, no network.
 *  Open / Closed    New void-element names: add to VOID_ELEMENTS set.
 *                   New raw-text elements: add to RAW_TEXT_ELEMENTS set.
 *                   HtmlParser itself never changes.
 *  Dependency-Inv.  HtmlParser has no dependencies on other project files —
 *                   it is a pure transformation: string → HtmlDocument.
 */

// ─────────────────────────────────────────────────────────────────────────────
// NODE TYPES
// ─────────────────────────────────────────────────────────────────────────────

enum NodeType {
  Document            = 'document',
  Element             = 'element',
  Text                = 'text',
  Comment             = 'comment',
  Doctype             = 'doctype',
  CdataSection        = 'cdata',
  ProcessingInstruction = 'pi',
  ParseError          = 'error',
}

// ─────────────────────────────────────────────────────────────────────────────
// NODE HIERARCHY  (Composite pattern)
// ─────────────────────────────────────────────────────────────────────────────

/** Base for every node in the parse tree. */
interface HtmlNode {
  readonly nodeType:  NodeType;
  readonly parent:    HtmlElement | HtmlDocument | null;
  /** Byte offset of this node's start in the original source. */
  readonly sourceOffset: number;
}

/** An HTML element: <tag attr="value">children</tag> */
interface HtmlElement extends HtmlNode {
  readonly nodeType:    NodeType.Element;
  readonly tagName:     string;           // always lower-cased
  readonly attributes:  ReadonlyMap<string, string>;
  readonly children:    readonly HtmlNode[];
  /** True for <img>, <br>, <input> etc. — no closing tag, no children. */
  readonly isVoid:      boolean;
  /** True for <script>, <style> — content is raw text, not parsed as HTML. */
  readonly isRawText:   boolean;
  /** For <script>: the inline script content or '' when src= is used. */
  readonly rawContent:  string;
}

interface HtmlTextNode extends HtmlNode {
  readonly nodeType: NodeType.Text;
  readonly text:     string;
}

interface HtmlComment extends HtmlNode {
  readonly nodeType: NodeType.Comment;
  readonly data:     string;
}

interface HtmlDoctype extends HtmlNode {
  readonly nodeType:   NodeType.Doctype;
  readonly name:       string;
  readonly publicId:   string;
  readonly systemId:   string;
}

interface HtmlCdata extends HtmlNode {
  readonly nodeType: NodeType.CdataSection;
  readonly data:     string;
}

interface HtmlProcessingInstruction extends HtmlNode {
  readonly nodeType: NodeType.ProcessingInstruction;
  readonly target:   string;
  readonly data:     string;
}

interface HtmlParseError extends HtmlNode {
  readonly nodeType: NodeType.ParseError;
  readonly message:  string;
}

interface HtmlDocument {
  readonly nodeType:  NodeType.Document;
  readonly children:  readonly HtmlNode[];
  readonly doctype:   HtmlDoctype | null;
  /** Convenience: the first <html> element, or null if absent. */
  readonly htmlElement: HtmlElement | null;
  /** Convenience: the <head> element, or null. */
  readonly headElement: HtmlElement | null;
  /** Convenience: the <body> element, or null. */
  readonly bodyElement: HtmlElement | null;
  /** All parse errors encountered (WHATWG parse-error model). */
  readonly errors:    readonly HtmlParseError[];
  /** Whether the document was served with an explicit <!DOCTYPE html>. */
  readonly hasDoctype: boolean;
  /** The declared charset from <meta charset="…"> or <meta http-equiv="content-type">, or null. */
  readonly metaCharset: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERED SUB-RESOURCES
// ─────────────────────────────────────────────────────────────────────────────

/** Resource type tags used by ResourceLoader (matching ResourceType enum). */
type DiscoveredResourceKind =
  | 'stylesheet' | 'script' | 'image' | 'font' | 'media' | 'document' | 'other';

interface DiscoveredResource {
  readonly url:        string;
  readonly kind:       DiscoveredResourceKind;
  /** true for render-blocking resources (<link rel="stylesheet"> in <head>). */
  readonly blocking:   boolean;
  /** true for <script defer> / <script async>. */
  readonly deferred:   boolean;
  /** The element that referenced this resource. */
  readonly sourceTag:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE RESULT
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlParseResult {
  readonly document:   HtmlDocument;
  readonly resources:  readonly DiscoveredResource[];
  readonly durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IHtmlParser {
  /**
   * Parse a complete HTML document string.
   * @param html        The raw HTML to parse.
   * @param baseUrl     Used to resolve relative URLs in discovered resources.
   */
  parse(html: string, baseUrl?: string): HtmlParseResult;

  /** Parse an HTML fragment (no <html>/<head>/<body> wrapping). */
  parseFragment(html: string, contextTag?: string): readonly HtmlNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elements that are self-closing by definition (WHATWG void elements).
 * They never have children and need no closing tag.
 */
const VOID_ELEMENTS = new Set<string>([
  'area','base','br','col','embed','hr','img','input',
  'link','meta','param','source','track','wbr',
]);

/**
 * Elements whose content is treated as raw text (not parsed as child HTML).
 * The tokenizer switches to "raw text" mode when it opens one of these.
 */
const RAW_TEXT_ELEMENTS = new Set<string>([
  'script','style','textarea','title',
]);

/**
 * <link rel="…"> → resource kind mapping.
 * Unknown rel values are treated as 'other'.
 */
const LINK_REL_MAP: ReadonlyMap<string, DiscoveredResourceKind> = new Map([
  ['stylesheet',   'stylesheet'],
  ['preload',      'other'],
  ['modulepreload','script'],
  ['icon',         'other'],
  ['shortcut icon','other'],
  ['manifest',     'other'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN  (internal — not exported)
// ─────────────────────────────────────────────────────────────────────────────

type TokenKind =
  | 'doctype' | 'open' | 'close' | 'selfclose'
  | 'text' | 'comment' | 'cdata' | 'pi' | 'eof';

interface Token {
  kind:       TokenKind;
  tagName?:   string;
  attrs?:     Map<string, string>;
  data?:      string;
  offset:     number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKENIZER  (Stage 1)
// ─────────────────────────────────────────────────────────────────────────────

class Tokenizer {
  private src:    string;
  private pos:    number;
  private tokens: Token[];

  constructor() {
    this.src    = '';
    this.pos    = 0;
    this.tokens = [];
  }

  tokenize(src: string): Token[] {
    this.src    = src;
    this.pos    = 0;
    this.tokens = [];

    while (this.pos < this.src.length) {
      if (this.src[this.pos] === '<') {
        this.readTag();
      } else {
        this.readText();
      }
    }

    this.tokens.push({ kind: 'eof', offset: this.pos });
    return this.tokens;
  }

  // ── Tag dispatch ──────────────────────────────────────────────────────────

  private readTag(): void {
    const start = this.pos;
    this.pos++; // consume '<'

    if (this.peek() === '!') {
      this.pos++;
      if (this.src.startsWith('--', this.pos)) {
        this.readComment(start);
      } else if (this.src.slice(this.pos, this.pos + 7).toUpperCase() === 'DOCTYPE') {
        this.readDoctype(start);
      } else if (this.src.startsWith('[CDATA[', this.pos)) {
        this.readCdata(start);
      } else {
        // Bogus comment
        const end = this.src.indexOf('>', this.pos);
        const data = end === -1
          ? this.src.slice(this.pos)
          : this.src.slice(this.pos, end);
        this.pos = end === -1 ? this.src.length : end + 1;
        this.tokens.push({ kind: 'comment', data, offset: start });
      }
    } else if (this.peek() === '?') {
      this.readPi(start);
    } else if (this.peek() === '/') {
      this.readCloseTag(start);
    } else {
      this.readOpenTag(start);
    }
  }

  private readComment(start: number): void {
    this.pos += 2; // skip '--'
    const end = this.src.indexOf('-->', this.pos);
    const data = end === -1
      ? this.src.slice(this.pos)
      : this.src.slice(this.pos, end);
    this.pos = end === -1 ? this.src.length : end + 3;
    this.tokens.push({ kind: 'comment', data, offset: start });
  }

  private readDoctype(start: number): void {
    this.pos += 7; // skip 'DOCTYPE'
    const end = this.src.indexOf('>', this.pos);
    const raw  = end === -1
      ? this.src.slice(this.pos)
      : this.src.slice(this.pos, end);
    this.pos = end === -1 ? this.src.length : end + 1;
    // Extract public/system ids (simplified)
    const parts = raw.trim().split(/\s+/);
    this.tokens.push({
      kind:    'doctype',
      tagName: (parts[0] ?? 'html').toLowerCase(),
      data:    raw.trim(),
      offset:  start,
    });
  }

  private readCdata(start: number): void {
    this.pos += 7; // skip '[CDATA['
    const end = this.src.indexOf(']]>', this.pos);
    const data = end === -1
      ? this.src.slice(this.pos)
      : this.src.slice(this.pos, end);
    this.pos = end === -1 ? this.src.length : end + 3;
    this.tokens.push({ kind: 'cdata', data, offset: start });
  }

  private readPi(start: number): void {
    this.pos++; // skip '?'
    const end = this.src.indexOf('?>', this.pos);
    const raw  = end === -1
      ? this.src.slice(this.pos)
      : this.src.slice(this.pos, end);
    this.pos = end === -1 ? this.src.length : end + 2;
    const space    = raw.search(/\s/);
    const target   = space === -1 ? raw : raw.slice(0, space);
    const data     = space === -1 ? '' : raw.slice(space + 1);
    this.tokens.push({ kind: 'pi', tagName: target.toLowerCase(), data, offset: start });
  }

  private readCloseTag(start: number): void {
    this.pos++; // skip '/'
    const end = this.src.indexOf('>', this.pos);
    const raw  = end === -1
      ? this.src.slice(this.pos)
      : this.src.slice(this.pos, end);
    this.pos = end === -1 ? this.src.length : end + 1;
    this.tokens.push({ kind: 'close', tagName: raw.trim().toLowerCase(), offset: start });
  }

  private readOpenTag(start: number): void {
    const end = this.src.indexOf('>', this.pos);
    const raw  = end === -1
      ? this.src.slice(this.pos)
      : this.src.slice(this.pos, end);
    this.pos = end === -1 ? this.src.length : end + 1;

    const selfClose = raw.endsWith('/');
    const content   = selfClose ? raw.slice(0, -1).trim() : raw.trim();

    const spaceIdx = content.search(/[\s\/]/);
    const tagName  = (spaceIdx === -1 ? content : content.slice(0, spaceIdx)).toLowerCase();
    const attrStr  = spaceIdx === -1 ? '' : content.slice(spaceIdx + 1);
    const attrs    = this.parseAttributes(attrStr);

    const isVoid = VOID_ELEMENTS.has(tagName);

    // For raw-text elements read the content until the matching close tag.
    if (RAW_TEXT_ELEMENTS.has(tagName) && !isVoid) {
      this.tokens.push({ kind: 'open', tagName, attrs, offset: start });
      const closePattern = new RegExp(`</${tagName}[\\s>]`, 'i');
      const closeIdx = closePattern.exec(this.src.slice(this.pos));
      let rawContent: string;
      if (closeIdx === null) {
        rawContent = this.src.slice(this.pos);
        this.pos   = this.src.length;
      } else {
        rawContent = this.src.slice(this.pos, this.pos + closeIdx.index);
        this.pos  += closeIdx.index;
      }
      if (rawContent.length > 0) {
        this.tokens.push({ kind: 'text', data: rawContent, offset: start });
      }
    } else if (isVoid || selfClose) {
      this.tokens.push({ kind: 'selfclose', tagName, attrs, offset: start });
    } else {
      this.tokens.push({ kind: 'open', tagName, attrs, offset: start });
    }
  }

  private readText(): void {
    const start = this.pos;
    const end   = this.src.indexOf('<', this.pos);
    const text  = end === -1
      ? this.src.slice(this.pos)
      : this.src.slice(this.pos, end);
    this.pos = end === -1 ? this.src.length : end;
    if (text.length > 0) {
      this.tokens.push({ kind: 'text', data: text, offset: start });
    }
  }

  // ── Attribute parsing ─────────────────────────────────────────────────────

  private parseAttributes(raw: string): Map<string, string> {
    const attrs = new Map<string, string>();
    const re    = /([^\s='"\/]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(raw)) !== null) {
      const name  = m[1]!.toLowerCase();
      const value = m[2] ?? m[3] ?? m[4] ?? '';
      attrs.set(name, value);
    }
    return attrs;
  }

  private peek(): string {
    return this.src[this.pos] ?? '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TREE BUILDER  (Stage 2)
// ─────────────────────────────────────────────────────────────────────────────

class TreeBuilder {
  private stack:   HtmlElement[];
  private errors:  HtmlParseError[];
  private children: HtmlNode[];   // root-level children

  constructor() {
    this.stack    = [];
    this.errors   = [];
    this.children = [];
  }

  build(
    tokens: Token[],
    baseUrl: string,
  ): { document: HtmlDocument; resources: DiscoveredResource[] } {

    this.stack    = [];
    this.errors   = [];
    this.children = [];
    const resources: DiscoveredResource[] = [];

    let doctype:     HtmlDoctype | null    = null;
    let htmlEl:      HtmlElement | null    = null;
    let headEl:      HtmlElement | null    = null;
    let bodyEl:      HtmlElement | null    = null;
    let metaCharset: string | null         = null;

    for (const token of tokens) {
      switch (token.kind) {

        case 'doctype': {
          const node: HtmlDoctype = {
            nodeType: NodeType.Doctype,
            name:     token.tagName ?? 'html',
            publicId: '',
            systemId: '',
            parent:   null,
            sourceOffset: token.offset,
          };
          doctype = node;
          this.appendNode(node);
          break;
        }

        case 'open':
        case 'selfclose': {
          const tag    = token.tagName!;
          const attrs  = token.attrs ?? new Map<string, string>();
          const isVoid = VOID_ELEMENTS.has(tag);
          const isRaw  = RAW_TEXT_ELEMENTS.has(tag);

          const element: HtmlElement = {
            nodeType:   NodeType.Element,
            tagName:    tag,
            attributes: attrs,
            children:   [],
            parent:     null,
            isVoid,
            isRawText:  isRaw,
            rawContent: '',
            sourceOffset: token.offset,
          };

          this.appendNode(element);

          if (!isVoid && token.kind !== 'selfclose') {
            this.stack.push(element);
          }

          // Track structural elements.
          if (tag === 'html' && htmlEl === null) htmlEl = element;
          if (tag === 'head' && headEl === null) headEl = element;
          if (tag === 'body' && bodyEl === null) bodyEl = element;

          // Meta charset.
          if (tag === 'meta' && metaCharset === null) {
            const charset = attrs.get('charset');
            if (charset) {
              metaCharset = charset.toLowerCase();
            } else if (attrs.get('http-equiv')?.toLowerCase() === 'content-type') {
              const ct = attrs.get('content') ?? '';
              const m  = /charset=([^\s;]+)/i.exec(ct);
              if (m) metaCharset = m[1]!.toLowerCase();
            }
          }

          // Resource discovery.
          const res = TreeBuilder.discoverResource(tag, attrs, baseUrl, headEl !== null && bodyEl === null);
          if (res) resources.push(res);
          break;
        }

        case 'close': {
          const tag = token.tagName!;
          // Pop to matching open tag (skip over mis-nested tags).
          for (let i = this.stack.length - 1; i >= 0; i--) {
            if (this.stack[i]!.tagName === tag) {
              this.stack.length = i;
              break;
            }
          }
          break;
        }

        case 'text': {
          const text = token.data ?? '';
          // Attach raw text content to the current raw-text element.
          const current = this.stack[this.stack.length - 1];
          if (current && current.isRawText) {
            (current as { rawContent: string }).rawContent = text;
          }
          if (text.trim().length === 0 && (current?.isRawText)) break;
          const node: HtmlTextNode = {
            nodeType: NodeType.Text,
            text,
            parent:   null,
            sourceOffset: token.offset,
          };
          this.appendNode(node);
          break;
        }

        case 'comment': {
          const node: HtmlComment = {
            nodeType: NodeType.Comment,
            data:     token.data ?? '',
            parent:   null,
            sourceOffset: token.offset,
          };
          this.appendNode(node);
          break;
        }

        case 'cdata': {
          const node: HtmlCdata = {
            nodeType: NodeType.CdataSection,
            data:     token.data ?? '',
            parent:   null,
            sourceOffset: token.offset,
          };
          this.appendNode(node);
          break;
        }

        case 'pi': {
          const node: HtmlProcessingInstruction = {
            nodeType: NodeType.ProcessingInstruction,
            target:   token.tagName ?? '',
            data:     token.data ?? '',
            parent:   null,
            sourceOffset: token.offset,
          };
          this.appendNode(node);
          break;
        }

        case 'eof':
          break;
      }
    }

    const document: HtmlDocument = {
      nodeType:    NodeType.Document,
      children:    this.children,
      doctype,
      htmlElement:  htmlEl,
      headElement:  headEl,
      bodyElement:  bodyEl,
      errors:       this.errors,
      hasDoctype:   doctype !== null,
      metaCharset,
    };

    return { document, resources };
  }

  // ── Node appending ────────────────────────────────────────────────────────

  private appendNode(node: HtmlNode): void {
    const parent = this.stack[this.stack.length - 1];
    if (parent) {
      (parent.children as HtmlNode[]).push(node);
      (node as { parent: HtmlElement }).parent = parent;
    } else {
      this.children.push(node);
    }
  }

  // ── Resource discovery ────────────────────────────────────────────────────

  private static discoverResource(
    tag:       string,
    attrs:     Map<string, string>,
    baseUrl:   string,
    inHead:    boolean,
  ): DiscoveredResource | null {
    const resolve = (href: string): string => {
      try { return new URL(href, baseUrl || undefined).href; }
      catch { return href; }
    };

    switch (tag) {
      case 'link': {
        const rel  = (attrs.get('rel') ?? '').toLowerCase().trim();
        const href = attrs.get('href');
        if (!href) return null;
        const kind = LINK_REL_MAP.get(rel) ?? 'other';
        return {
          url:      resolve(href),
          kind,
          blocking: rel === 'stylesheet' && inHead,
          deferred: false,
          sourceTag: 'link',
        };
      }
      case 'script': {
        const src = attrs.get('src');
        if (!src) return null;
        return {
          url:      resolve(src),
          kind:     'script',
          blocking: !attrs.has('defer') && !attrs.has('async') && inHead,
          deferred: attrs.has('defer') || attrs.has('async'),
          sourceTag: 'script',
        };
      }
      case 'img': {
        const src = attrs.get('src') ?? attrs.get('data-src');
        if (!src) return null;
        return { url: resolve(src), kind: 'image', blocking: false, deferred: false, sourceTag: 'img' };
      }
      case 'video':
      case 'audio': {
        const src = attrs.get('src');
        if (!src) return null;
        return { url: resolve(src), kind: 'media', blocking: false, deferred: true, sourceTag: tag };
      }
      case 'iframe': {
        const src = attrs.get('src');
        if (!src) return null;
        return { url: resolve(src), kind: 'document', blocking: false, deferred: true, sourceTag: 'iframe' };
      }
      default:
        return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML PARSER  (public facade)
// ─────────────────────────────────────────────────────────────────────────────

class HtmlParser implements IHtmlParser {
  private readonly tokenizer   = new Tokenizer();
  private readonly treeBuilder = new TreeBuilder();

  parse(html: string, baseUrl = ''): HtmlParseResult {
    const start  = Date.now();
    const tokens = this.tokenizer.tokenize(html);
    const { document, resources } = this.treeBuilder.build(tokens, baseUrl);
    return {
      document,
      resources,
      durationMs: Date.now() - start,
    };
  }

  parseFragment(html: string, _contextTag = 'div'): readonly HtmlNode[] {
    const tokens  = this.tokenizer.tokenize(html);
    const { document } = this.treeBuilder.build(tokens, '');
    return document.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES  (exported for css-parser, dom-tree, tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk the entire parse tree depth-first, calling `visitor` on every node.
 * Return false from `visitor` to stop traversal.
 */
function walkTree(
  root:    HtmlDocument | HtmlElement,
  visitor: (node: HtmlNode) => boolean | void,
): void {
  const queue: HtmlNode[] = [...root.children];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const cont = visitor(node);
    if (cont === false) return;
    if (node.nodeType === NodeType.Element) {
      const el = node as HtmlElement;
      queue.unshift(...el.children);
    }
  }
}

/**
 * Collect all elements with a given tag name from anywhere in the document.
 */
function getElementsByTagName(root: HtmlDocument | HtmlElement, tag: string): HtmlElement[] {
  const lower   = tag.toLowerCase();
  const results: HtmlElement[] = [];
  walkTree(root, node => {
    if (node.nodeType === NodeType.Element) {
      const el = node as HtmlElement;
      if (el.tagName === lower) results.push(el);
    }
  });
  return results;
}

/** Decode the five HTML character references that must always be unescaped. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'");
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  HtmlParser,
  NodeType,
  VOID_ELEMENTS,
  RAW_TEXT_ELEMENTS,
  walkTree,
  getElementsByTagName,
  decodeHtmlEntities,
};

export type {
  IHtmlParser,
  HtmlNode,
  HtmlElement,
  HtmlTextNode,
  HtmlComment,
  HtmlDoctype,
  HtmlCdata,
  HtmlProcessingInstruction,
  HtmlParseError,
  HtmlDocument,
  HtmlParseResult,
  DiscoveredResource,
  DiscoveredResourceKind,
};