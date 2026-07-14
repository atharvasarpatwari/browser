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
 *   Stage 1 — Tokenizer   : text → flat token stream  (html5-tokenizer.ts)
 *   Stage 2 — Tree builder: tokens → HtmlDocument tree
 *
 * Error recovery follows the WHATWG "tree construction error" model:
 * malformed input is accepted with ParseError nodes rather than throwing.
 *
 * Supported token types:
 *   Doctype, OpenTag, CloseTag, SelfClosingTag,
 *   Text, Comment, CdataSection, ProcessingInstruction
 */

import { Html5Tokenizer, type Token, type TokenKind } from './html5-tokenizer';
import { TreeBuilder } from './html5-tree-builder';

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

// TreeBuilder is imported from html5-tree-builder.ts

// ─────────────────────────────────────────────────────────────────────────────
// HTML PARSER  (public facade)
// ─────────────────────────────────────────────────────────────────────────────

class HtmlParser implements IHtmlParser {
  private readonly tokenizer   = new Html5Tokenizer();
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
    const tokens = this.tokenizer.tokenize(html);
    const { document } = this.treeBuilder.build(tokens, '');
    if (document.bodyElement) {
      return document.bodyElement.children;
    }
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
  TreeBuilder,
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