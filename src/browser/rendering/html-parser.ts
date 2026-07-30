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
import { TreeBuilder } from './html5/tree-builder';
import { decodeBytes, type SniffOptions } from './html5/encoding';
import { NodeType } from './html5/dom';
import { VOID_ELEMENTS, RAW_TEXT_ELEMENTS } from './html5/constants';

// ─────────────────────────────────────────────────────────────────────────────
// NODE TYPES  (re-exported from html5/dom.ts)
// ─────────────────────────────────────────────────────────────────────────────

export { NodeType } from './html5/dom';

// ─────────────────────────────────────────────────────────────────────────────
// NODE INTERFACES  (re-exported from html5/dom.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  HtmlNode,
  HtmlElement,
  HtmlTextNode,
  HtmlComment,
  HtmlDoctype,
  HtmlCdata,
  HtmlProcessingInstruction,
  HtmlParseError,
  HtmlDocument,
  DiscoveredResourceKind,
  DiscoveredResource,
} from './html5/dom';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS  (re-exported from html5/constants.ts)
// ─────────────────────────────────────────────────────────────────────────────

export { VOID_ELEMENTS, RAW_TEXT_ELEMENTS } from './html5/constants';

// ─────────────────────────────────────────────────────────────────────────────
// PARSE RESULT
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlParseResult {
  readonly document:   HtmlDocument;
  readonly resources:  readonly DiscoveredResource[];
  readonly durationMs: number;
}

/** Options for parsing raw bytes. */
interface ParseBytesOptions {
  /** Content-Type header value, e.g. "text/html; charset=windows-1252". */
  contentType?: string;
  /** Page URL (used for relative URL resolution). */
  url?: string;
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

  /**
   * Parse raw bytes, auto-detecting encoding via BOM, Content-Type header,
   * or <meta charset> prescan.
   */
  parseBytes(data: Uint8Array, options?: ParseBytesOptions): HtmlParseResult;

  /** Write HTML into the current parser stream (document.write). */
  write(html: string): void;

  /** Clear the document and reset parser state (document.open). */
  open(): void;

  /** Get the current document state (used for DOM rebuild after write). */
  getCurrentDocument(): HtmlDocument;
}

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
      document: document as HtmlDocument,
      resources,
      durationMs: Date.now() - start,
    };
  }

  parseFragment(html: string, _contextTag = 'div'): readonly HtmlNode[] {
    const tokens = this.tokenizer.tokenize(html);
    const { document } = this.treeBuilder.build(tokens, '');
    if (document.bodyElement) {
      return document.bodyElement.children as readonly HtmlNode[];
    }
    return document.children as readonly HtmlNode[];
  }

  /**
   * document.write() — append HTML to the current parser stream.
   * Must be called after an initial parse() to keep the parser state.
   */
  write(html: string): void {
    const tokens = this.tokenizer.tokenize(html);
    for (const token of tokens) {
      this.treeBuilder.processToken(token);
    }
  }

  /** document.open() — clear the document and reset the parser state. */
  open(): void {
    this.treeBuilder.open();
  }

  /** Get the current document from the tree builder (post-write). */
  getCurrentDocument(): HtmlDocument {
    return this.treeBuilder.getCurrentDocument() as HtmlDocument;
  }

  parseBytes(data: Uint8Array, options?: ParseBytesOptions): HtmlParseResult {
    const start = Date.now();
    const { text, charset, source } = decodeBytes(data, options);

    const sniffOptions: SniffOptions = options
      ? { contentType: options.contentType, url: options.url }
      : undefined;
    const tokens = this.tokenizer.tokenize(text);
    const { document, resources } = this.treeBuilder.build(tokens, options?.url ?? '');

    const doc = document as HtmlDocument;
    // Set detectedCharset from the encoding sniffing step
    (doc as any).detectedCharset = charset;
    // If the document didn't declare a charset via <meta>, set metaCharset to the detected one
    if (!doc.declaredCharset) {
      (doc as any).metaCharset = charset;
    }

    return {
      document: doc,
      resources,
      durationMs: Date.now() - start,
    };
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
  walkTree,
  getElementsByTagName,
  decodeHtmlEntities,
};

export type {
  IHtmlParser,
  HtmlParseResult,
  ParseBytesOptions,
};