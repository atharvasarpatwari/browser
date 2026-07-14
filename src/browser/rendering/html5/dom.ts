/**
 * @file html5/dom.ts
 * HTML5 DOM Node Types with full API.
 *
 * Backward-compatible with all existing types exported from html-parser.ts.
 * Adds: sibling pointers, namespace support, DOM API methods,
 * DocumentFragment, proper child management.
 */

// ─────────────────────────────────────────────────────────────────────────────
// NODE TYPES
// ─────────────────────────────────────────────────────────────────────────────

enum NodeType {
  Document              = 'document',
  Element               = 'element',
  Text                  = 'text',
  Comment               = 'comment',
  Doctype               = 'doctype',
  CdataSection          = 'cdata',
  ProcessingInstruction = 'pi',
  ParseError            = 'error',
}

// ─────────────────────────────────────────────────────────────────────────────
// NAMESPACES
// ─────────────────────────────────────────────────────────────────────────────

enum Namespace {
  HTML    = 'http://www.w3.org/1999/xhtml',
  SVG     = 'http://www.w3.org/2000/svg',
  MathML  = 'http://www.w3.org/1998/Math/MathML',
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE NODE
// ─────────────────────────────────────────────────────────────────────────────

/** Base for every node in the parse tree. */
interface HtmlNode {
  readonly nodeType:     NodeType;
  readonly parent:       HtmlParentNode | null;
  readonly sourceOffset: number;
  readonly nextSibling:  HtmlNode | null;
  readonly previousSibling: HtmlNode | null;
  readonly namespaceURI: Namespace | null;
}

type HtmlParentNode = HtmlElement | HtmlDocument | HtmlDocumentFragment | MutableElement | MutableDocument;

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlElement extends HtmlNode {
  readonly nodeType:    NodeType.Element;
  readonly tagName:     string;
  readonly attributes:  ReadonlyMap<string, string>;
  readonly children:    readonly HtmlNode[];
  readonly isVoid:      boolean;
  readonly isRawText:   boolean;
  readonly rawContent:  string;
  // DOM API
  readonly firstChild:  HtmlNode | null;
  readonly lastChild:   HtmlNode | null;
  readonly childNodes:  HtmlNode[];
  readonly childElementCount: number;
  // Attribute API
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT NODE
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlTextNode extends HtmlNode {
  readonly nodeType: NodeType.Text;
  readonly text:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENT NODE
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlComment extends HtmlNode {
  readonly nodeType: NodeType.Comment;
  readonly data:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCTYPE NODE
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlDoctype extends HtmlNode {
  readonly nodeType:   NodeType.Doctype;
  readonly name:       string;
  readonly publicId:   string;
  readonly systemId:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CDATA SECTION
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlCdata extends HtmlNode {
  readonly nodeType: NodeType.CdataSection;
  readonly data:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCESSING INSTRUCTION
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlProcessingInstruction extends HtmlNode {
  readonly nodeType: NodeType.ProcessingInstruction;
  readonly target:   string;
  readonly data:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE ERROR
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlParseError extends HtmlNode {
  readonly nodeType: NodeType.ParseError;
  readonly message:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlDocument {
  readonly nodeType:      NodeType.Document;
  readonly children:      readonly HtmlNode[];
  readonly doctype:       HtmlDoctype | null;
  readonly htmlElement:   HtmlElement | null;
  readonly headElement:   HtmlElement | null;
  readonly bodyElement:   HtmlElement | null;
  readonly errors:        readonly HtmlParseError[];
  readonly hasDoctype:    boolean;
  /** Charset declared in the document via <meta charset> or <meta http-equiv>. */
  readonly declaredCharset: string | null;
  /** Charset detected from BOM, Content-Type header, or prescan. */
  readonly detectedCharset: string | null;
  /** @deprecated Use declaredCharset or detectedCharset. Kept for backward compat. */
  readonly metaCharset:   string | null;
  // DOM API
  readonly firstChild:    HtmlNode | null;
  readonly lastChild:     HtmlNode | null;
  readonly childNodes:    HtmlNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT FRAGMENT
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlDocumentFragment {
  readonly nodeType:  NodeType;
  readonly children:  readonly HtmlNode[];
  readonly parent:    null;
  readonly sourceOffset: 0;
  readonly nextSibling:   null;
  readonly previousSibling: null;
  readonly namespaceURI:  null;
  readonly firstChild:    HtmlNode | null;
  readonly lastChild:     HtmlNode | null;
  readonly childNodes:    HtmlNode[];
  readonly childElementCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERED SUB-RESOURCES
// ─────────────────────────────────────────────────────────────────────────────

type DiscoveredResourceKind =
  | 'stylesheet' | 'script' | 'image' | 'font' | 'media' | 'document' | 'other';

interface DiscoveredResource {
  readonly url:        string;
  readonly kind:       DiscoveredResourceKind;
  readonly blocking:   boolean;
  readonly deferred:   boolean;
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
  parse(html: string, baseUrl?: string): HtmlParseResult;
  parseFragment(html: string, contextTag?: string): readonly HtmlNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL MUTABLE TYPES (used by tree builder, not exported publicly)
// ─────────────────────────────────────────────────────────────────────────────

/** Mutable element used internally during tree construction. */
interface MutableElement {
  nodeType:    NodeType.Element;
  tagName:     string;
  attributes:  Map<string, string>;
  children:    HtmlNode[];
  parent:      HtmlParentNode | null;
  isVoid:      boolean;
  isRawText:   boolean;
  rawContent:  string;
  sourceOffset: number;
  nextSibling:  HtmlNode | null;
  previousSibling: HtmlNode | null;
  namespaceURI: Namespace | null;
}

/** Mutable text node used internally. */
interface MutableTextNode {
  nodeType:     NodeType.Text;
  text:         string;
  parent:       HtmlParentNode | null;
  sourceOffset: number;
  nextSibling:  HtmlNode | null;
  previousSibling: HtmlNode | null;
  namespaceURI: Namespace | null;
}

/** Mutable comment node used internally. */
interface MutableComment {
  nodeType:     NodeType.Comment;
  data:         string;
  parent:       HtmlParentNode | null;
  sourceOffset: number;
  nextSibling:  HtmlNode | null;
  previousSibling: HtmlNode | null;
  namespaceURI: Namespace | null;
}

/** Mutable doctype used internally. */
interface MutableDoctype {
  nodeType:     NodeType.Doctype;
  name:         string;
  publicId:     string;
  systemId:     string;
  parent:       HtmlParentNode | null;
  sourceOffset: number;
  nextSibling:  HtmlNode | null;
  previousSibling: HtmlNode | null;
  namespaceURI: Namespace | null;
}

/** Mutable CDATA used internally. */
interface MutableCdata {
  nodeType:     NodeType.CdataSection;
  data:         string;
  parent:       HtmlParentNode | null;
  sourceOffset: number;
  nextSibling:  HtmlNode | null;
  previousSibling: HtmlNode | null;
  namespaceURI: Namespace | null;
}

/** Mutable document used internally. */
interface MutableDocument {
  nodeType:      NodeType.Document;
  children:      HtmlNode[];
  doctype:       HtmlDoctype | null;
  htmlElement:   HtmlElement | null;
  headElement:   HtmlElement | null;
  bodyElement:   HtmlElement | null;
  errors:        HtmlParseError[];
  hasDoctype:    boolean;
  declaredCharset: string | null;
  detectedCharset: string | null;
  metaCharset:   string | null;
  firstChild:    HtmlNode | null;
  lastChild:     HtmlNode | null;
  childNodes:    HtmlNode[];
  sourceOffset:  0;
  parent:        null;
  nextSibling:   null;
  previousSibling: null;
  namespaceURI:  null;
}

/** Mutable parse error used internally. */
interface MutableParseError {
  nodeType:     NodeType.ParseError;
  message:      string;
  parent:       null;
  sourceOffset: number;
  nextSibling:  null;
  previousSibling: null;
  namespaceURI: null;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL MUTABLE TYPES  (used by child management functions)
// ─────────────────────────────────────────────────────────────────────────────

/** All mutable node types — used by child management to write fields without casts. */
type MutableNode =
  | MutableElement
  | MutableTextNode
  | MutableComment
  | MutableDoctype
  | MutableCdata
  | MutableDocument
  | MutableParseError;

/** All mutable parent node types — elements and documents. */
type MutableParentNode = MutableElement | MutableDocument;

// ─────────────────────────────────────────────────────────────────────────────
// NODE FACTORY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function createMutableElement(
  tagName: string,
  attrs?: Map<string, string>,
  offset = 0,
): MutableElement {
  return {
    nodeType: NodeType.Element,
    tagName:  tagName.toLowerCase(),
    attributes: attrs ?? new Map(),
    children:   [],
    parent:     null,
    isVoid:     false,
    isRawText:  false,
    rawContent: '',
    sourceOffset: offset,
    nextSibling:  null,
    previousSibling: null,
    namespaceURI: Namespace.HTML,
  };
}

function createMutableTextNode(text: string, offset = 0): MutableTextNode {
  return {
    nodeType:     NodeType.Text,
    text,
    parent:       null,
    sourceOffset: offset,
    nextSibling:  null,
    previousSibling: null,
    namespaceURI: null,
  };
}

function createMutableComment(data: string, offset = 0): MutableComment {
  return {
    nodeType:     NodeType.Comment,
    data,
    parent:       null,
    sourceOffset: offset,
    nextSibling:  null,
    previousSibling: null,
    namespaceURI: null,
  };
}

function createMutableDoctype(
  name: string, publicId: string, systemId: string, offset = 0,
): MutableDoctype {
  return {
    nodeType:     NodeType.Doctype,
    name,
    publicId,
    systemId,
    parent:       null,
    sourceOffset: offset,
    nextSibling:  null,
    previousSibling: null,
    namespaceURI: null,
  };
}

function createMutableCdata(data: string, offset = 0): MutableCdata {
  return {
    nodeType:     NodeType.CdataSection,
    data,
    parent:       null,
    sourceOffset: offset,
    nextSibling:  null,
    previousSibling: null,
    namespaceURI: null,
  };
}

function createMutableDocument(): MutableDocument {
  const children: HtmlNode[] = [];
  return {
    nodeType:      NodeType.Document,
    children,
    doctype:       null,
    htmlElement:   null,
    headElement:   null,
    bodyElement:   null,
    errors:        [],
    hasDoctype:    false,
    declaredCharset: null,
    detectedCharset: null,
    metaCharset:   null,
    firstChild:    null,
    lastChild:     null,
    childNodes:    children,
    sourceOffset:  0,
    parent:        null,
    nextSibling:   null,
    previousSibling: null,
    namespaceURI:  null,
  };
}

function createParseError(message: string, offset = 0): HtmlParseError {
  return {
    nodeType:     NodeType.ParseError,
    message,
    sourceOffset: offset,
    parent:       null,
    nextSibling:  null,
    previousSibling: null,
    namespaceURI: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHILD MANAGEMENT UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function appendChild(parent: MutableParentNode, node: MutableNode): void {
  const children = getParentChildren(parent);
  const last = children.length > 0 ? children[children.length - 1] : null;
  node.parent = parent;
  node.previousSibling = last as HtmlNode | null;
  node.nextSibling = null;
  if (last) {
    (last as MutableNode).nextSibling = node as HtmlNode;
  }
  children.push(node);
  syncDocumentPointers(parent);
}

function insertBefore(parent: MutableParentNode, newNode: MutableNode, refNode: HtmlNode): void {
  const children = getParentChildren(parent);
  const idx = children.indexOf(refNode);
  if (idx < 0) {
    appendChild(parent, newNode);
    return;
  }
  const prev = idx > 0 ? children[idx - 1] : null;
  newNode.parent = parent;
  newNode.previousSibling = prev as HtmlNode | null;
  newNode.nextSibling = refNode;
  if (prev) {
    (prev as MutableNode).nextSibling = newNode as HtmlNode;
  }
  (refNode as MutableNode).previousSibling = newNode as HtmlNode;
  children.splice(idx, 0, newNode);
  syncDocumentPointers(parent);
}

function removeChild(parent: MutableParentNode, node: MutableNode): void {
  const children = getParentChildren(parent);
  const idx = children.indexOf(node);
  if (idx < 0) return;
  const prev = node.previousSibling as MutableNode | null;
  const next = node.nextSibling as MutableNode | null;
  if (prev) prev.nextSibling = next as HtmlNode | null;
  if (next) next.previousSibling = prev as HtmlNode | null;
  node.parent = null;
  node.previousSibling = null;
  node.nextSibling = null;
  children.splice(idx, 1);
  syncDocumentPointers(parent);
}

function replaceChild(
  parent: MutableParentNode, newNode: MutableNode, oldNode: MutableNode,
): void {
  const children = getParentChildren(parent);
  const idx = children.indexOf(oldNode);
  if (idx < 0) return;
  const prev = oldNode.previousSibling as MutableNode | null;
  const next = oldNode.nextSibling as MutableNode | null;
  newNode.parent = parent;
  newNode.previousSibling = prev as HtmlNode | null;
  newNode.nextSibling = next as HtmlNode | null;
  if (prev) prev.nextSibling = newNode as HtmlNode;
  if (next) next.previousSibling = newNode as HtmlNode;
  oldNode.parent = null;
  oldNode.previousSibling = null;
  oldNode.nextSibling = null;
  children[idx] = newNode;
  syncDocumentPointers(parent);
}

function syncDocumentPointers(parent: MutableParentNode): void {
  if ('firstChild' in parent && 'lastChild' in parent && 'childNodes' in parent) {
    const children = getParentChildren(parent);
    parent.firstChild = children.length > 0 ? children[0] : null;
    parent.lastChild = children.length > 0 ? children[children.length - 1] : null;
  }
}

function getParentChildren(parent: MutableParentNode): MutableNode[] {
  return parent.children as MutableNode[];
}

function cloneElement(el: HtmlElement, deep = false): MutableElement {
  const clone = createMutableElement(el.tagName, new Map(el.attributes), el.sourceOffset);
  clone.isVoid = el.isVoid;
  clone.isRawText = el.isRawText;
  clone.rawContent = el.rawContent;
  clone.namespaceURI = (el as MutableElement).namespaceURI ?? Namespace.HTML;
  if (deep) {
    for (const child of el.children) {
      if (child.nodeType === NodeType.Element) {
        const childClone = cloneElement(child as HtmlElement, true);
        appendChild(clone, childClone);
      } else if (child.nodeType === NodeType.Text) {
        const textClone = createMutableTextNode((child as HtmlTextNode).text, child.sourceOffset);
        appendChild(clone, textClone);
      } else if (child.nodeType === NodeType.Comment) {
        const commentClone = createMutableComment((child as HtmlComment).data, child.sourceOffset);
        appendChild(clone, commentClone);
      }
    }
  }
  return clone;
}

function hasChildNodes(node: HtmlNode): boolean {
  if ('children' in node) {
    return (node as MutableParentNode).children.length > 0;
  }
  return false;
}

function contains(parent: MutableParentNode, descendant: HtmlNode): boolean {
  const children = getParentChildren(parent);
  for (const child of children) {
    if (child === descendant) return true;
    if ('children' in child) {
      if (contains(child as MutableParentNode, descendant)) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM API IMPLEMENTATIONS (methods on elements)
// ─────────────────────────────────────────────────────────────────────────────

function elementGetAttribute(el: MutableElement, name: string): string | null {
  return el.attributes.get(name.toLowerCase()) ?? null;
}

function elementSetAttribute(el: MutableElement, name: string, value: string): void {
  el.attributes.set(name.toLowerCase(), value);
}

function elementRemoveAttribute(el: MutableElement, name: string): void {
  el.attributes.delete(name.toLowerCase());
}

function elementHasAttribute(el: MutableElement, name: string): boolean {
  return el.attributes.has(name.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  NodeType,
  Namespace,
  appendChild,
  insertBefore,
  removeChild,
  replaceChild,
  cloneElement,
  hasChildNodes,
  contains,
  getParentChildren,
  createMutableElement,
  createMutableTextNode,
  createMutableComment,
  createMutableDoctype,
  createMutableCdata,
  createMutableDocument,
  createParseError,
  elementGetAttribute,
  elementSetAttribute,
  elementRemoveAttribute,
  elementHasAttribute,
};

export type {
  HtmlNode,
  HtmlParentNode,
  HtmlElement,
  HtmlTextNode,
  HtmlComment,
  HtmlDoctype,
  HtmlCdata,
  HtmlProcessingInstruction,
  HtmlParseError,
  HtmlDocument,
  HtmlDocumentFragment,
  HtmlParseResult,
  HtmlParseError as HtmlParseErrorInterface,
  IHtmlParser,
  DiscoveredResource,
  DiscoveredResourceKind,
  MutableElement,
  MutableTextNode,
  MutableComment,
  MutableDoctype,
  MutableCdata,
  MutableDocument,
};
