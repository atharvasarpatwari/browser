/**
 * @file html5/dom.ts
 * HTML5 DOM Node Types with full API.
 *
 * Backward-compatible with all existing types exported from html-parser.ts.
 * Adds: sibling pointers, namespace support, DOM API methods,
 * DocumentFragment, proper child management.
 */

import { fireMutation, cleanupRegistrations } from './mutation-observer';

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
  // Shadow DOM API (read-only view)
  readonly shadowRoot: any;         // ShadowRoot | null (open mode only)
  readonly assignedSlot: HtmlElement | null;  // The <slot> element this node is assigned to
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
  // Shadow DOM fields
  _shadowRoot: any;           // MutableShadowRoot | null
  _assignedSlot: MutableElement | null;  // The <slot> element this node is assigned to
  _internals: any;            // ElementInternals | null
  childNodes:  HtmlNode[];
  firstChild:  HtmlNode | null;
  lastChild:   HtmlNode | null;
  childElementCount: number;
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
    _shadowRoot: null,
    _assignedSlot: null,
    _internals: null,
    childNodes: [],
    firstChild: null,
    lastChild: null,
    childElementCount: 0,
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
  fireMutation({
    target: parent as unknown as HtmlNode,
    type: 'childList',
    addedNodes: [node as HtmlNode],
    previousSibling: last as HtmlNode | null,
    nextSibling: null,
  });
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
  fireMutation({
    target: parent as unknown as HtmlNode,
    type: 'childList',
    addedNodes: [newNode as HtmlNode],
    previousSibling: prev as HtmlNode | null,
    nextSibling: refNode,
  });
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
  fireMutation({
    target: parent as unknown as HtmlNode,
    type: 'childList',
    removedNodes: [node as HtmlNode],
    previousSibling: prev as HtmlNode | null,
    nextSibling: next as HtmlNode | null,
  });
  cleanupRegistrations(node as unknown as HtmlNode);
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
  fireMutation({
    target: parent as unknown as HtmlNode,
    type: 'childList',
    addedNodes: [newNode as HtmlNode],
    removedNodes: [oldNode as HtmlNode],
    previousSibling: prev as HtmlNode | null,
    nextSibling: next as HtmlNode | null,
  });
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
  // Preserve shadow DOM fields (shallow copy — shadow root is not deep-cloned here)
  clone._shadowRoot = (el as MutableElement)._shadowRoot ?? null;
  clone._assignedSlot = (el as MutableElement)._assignedSlot ?? null;
  clone._internals = (el as MutableElement)._internals ?? null;
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
  const ln = name.toLowerCase();
  const oldValue = el.attributes.get(ln) ?? null;
  el.attributes.set(ln, value);
  fireMutation({
    target: el as unknown as HtmlNode,
    type: 'attributes',
    attributeName: ln,
    oldValue,
  });
}

function elementRemoveAttribute(el: MutableElement, name: string): void {
  const ln = name.toLowerCase();
  const oldValue = el.attributes.get(ln) ?? null;
  el.attributes.delete(ln);
  fireMutation({
    target: el as unknown as HtmlNode,
    type: 'attributes',
    attributeName: ln,
    oldValue,
  });
}

function elementHasAttribute(el: MutableElement, name: string): boolean {
  return el.attributes.has(name.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE MUTATION METHODS  (standard DOM API)
// ─────────────────────────────────────────────────────────────────────────────

function nodeRemove(node: MutableNode): void {
  if (node.parent && 'children' in node.parent) {
    removeChild(node.parent as MutableParentNode, node);
  }
}

function nodeAppend(parent: MutableParentNode, ...nodes: MutableNode[]): void {
  for (const n of nodes) {
    if (n === null || n === undefined) continue;
    if (typeof n === 'string') {
      appendChild(parent, createMutableTextNode(n));
    } else {
      appendChild(parent, n);
    }
  }
}

function nodePrepend(parent: MutableParentNode, ...nodes: (MutableNode | string)[]): void {
  const children = getParentChildren(parent);
  const refNode = children.length > 0 ? children[0] as HtmlNode : null;
  for (const n of nodes) {
    if (n === null || n === undefined) continue;
    if (typeof n === 'string') {
      const textNode = createMutableTextNode(n);
      if (refNode) {
        insertBefore(parent, textNode, refNode);
      } else {
        appendChild(parent, textNode);
      }
    } else {
      if (refNode) {
        insertBefore(parent, n, refNode);
      } else {
        appendChild(parent, n);
      }
    }
  }
}

function nodeBefore(node: MutableNode, ...nodes: (MutableNode | string)[]): void {
  const parent = node.parent as MutableParentNode | null;
  if (!parent) return;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n === null || n === undefined) continue;
    if (typeof n === 'string') {
      insertBefore(parent, createMutableTextNode(n), node as HtmlNode);
    } else {
      insertBefore(parent, n, node as HtmlNode);
    }
  }
}

function nodeAfter(node: MutableNode, ...nodes: (MutableNode | string)[]): void {
  const parent = node.parent as MutableParentNode | null;
  if (!parent) return;
  const children = getParentChildren(parent);
  const idx = children.indexOf(node);
  const refIdx = idx + 1;
  const refNode = refIdx < children.length ? children[refIdx] as HtmlNode : null;
  for (const n of nodes) {
    if (n === null || n === undefined) continue;
    if (typeof n === 'string') {
      const textNode = createMutableTextNode(n);
      if (refNode) {
        insertBefore(parent, textNode, refNode);
      } else {
        appendChild(parent, textNode);
      }
    } else {
      if (refNode) {
        insertBefore(parent, n, refNode);
      } else {
        appendChild(parent, n);
      }
    }
  }
}

function nodeReplaceWith(node: MutableNode, ...nodes: (MutableNode | string)[]): void {
  const parent = node.parent as MutableParentNode | null;
  if (!parent) return;
  if (nodes.length === 0) {
    nodeRemove(node);
    return;
  }
  const children = getParentChildren(parent);
  // Insert all new nodes before the old node
  for (const n of nodes) {
    if (n === null || n === undefined) continue;
    if (typeof n === 'string') {
      insertBefore(parent, createMutableTextNode(n), node as HtmlNode);
    } else {
      insertBefore(parent, n, node as HtmlNode);
    }
  }
  // Now remove the old node
  nodeRemove(node);
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT-ONLY CHILD ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────

function getFirstChildElement(parent: MutableParentNode): MutableElement | null {
  const children = getParentChildren(parent);
  for (const child of children) {
    if (child.nodeType === NodeType.Element) return child as MutableElement;
  }
  return null;
}

function getLastChildElement(parent: MutableParentNode): MutableElement | null {
  const children = getParentChildren(parent);
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].nodeType === NodeType.Element) return children[i] as MutableElement;
  }
  return null;
}

function getNextElementSibling(node: MutableNode): MutableElement | null {
  let current = node.nextSibling as MutableNode | null;
  while (current) {
    if (current.nodeType === NodeType.Element) return current as MutableElement;
    current = current.nextSibling as MutableNode | null;
  }
  return null;
}

function getPreviousElementSibling(node: MutableNode): MutableElement | null {
  let current = node.previousSibling as MutableNode | null;
  while (current) {
    if (current.nodeType === NodeType.Element) return current as MutableElement;
    current = current.previousSibling as MutableNode | null;
  }
  return null;
}

function getChildElementCount(parent: MutableParentNode): number {
  const children = getParentChildren(parent);
  let count = 0;
  for (const child of children) {
    if (child.nodeType === NodeType.Element) count++;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL ATTRIBUTE METHODS
// ─────────────────────────────────────────────────────────────────────────────

function elementToggleAttribute(el: MutableElement, name: string, force?: boolean): boolean {
  const lower = name.toLowerCase();
  const has = el.attributes.has(lower);
  if (force !== undefined) {
    if (force) {
      el.attributes.set(lower, el.attributes.get(lower) ?? '');
      return true;
    } else {
      el.attributes.delete(lower);
      return false;
    }
  }
  if (has) {
    el.attributes.delete(lower);
    return false;
  } else {
    el.attributes.set(lower, '');
    return true;
  }
}

function elementGetAttributeNames(el: MutableElement): string[] {
  return [...el.attributes.keys()];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT CONTENT / NODE ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────

function getTextContent(node: HtmlNode): string {
  switch (node.nodeType) {
    case NodeType.Text:
      return (node as HtmlTextNode).text;
    case NodeType.Comment:
      return (node as HtmlComment).data;
    case NodeType.CdataSection:
      return (node as HtmlCdata).data;
    case NodeType.ProcessingInstruction:
      return (node as HtmlProcessingInstruction).data;
    case NodeType.Element:
    case NodeType.Document:
    case NodeType.DocumentFragment: {
      let result = '';
      const parent = node as MutableParentNode;
      const children = getParentChildren(parent);
      for (const child of children) {
        result += getTextContent(child);
      }
      return result;
    }
    default:
      return '';
  }
}

function setTextContent(node: MutableNode, value: string): void {
  switch (node.nodeType) {
    case NodeType.Text: {
      const oldValue = (node as MutableTextNode).text;
      (node as MutableTextNode).text = value;
      fireMutation({
        target: node as unknown as HtmlNode,
        type: 'characterData',
        oldValue,
      });
      break;
    }
    case NodeType.Comment: {
      const oldValue = (node as MutableComment).data;
      (node as MutableComment).data = value;
      fireMutation({
        target: node as unknown as HtmlNode,
        type: 'characterData',
        oldValue,
      });
      break;
    }
    case NodeType.CdataSection: {
      const oldValue = (node as MutableCdata).data;
      (node as MutableCdata).data = value;
      fireMutation({
        target: node as unknown as HtmlNode,
        type: 'characterData',
        oldValue,
      });
      break;
    }
    case NodeType.Element:
    case NodeType.Document: {
      const parent = node as MutableParentNode;
      const children = getParentChildren(parent);
      // Remove all existing children
      while (children.length > 0) {
        removeChild(parent, children[0] as MutableNode);
      }
      // Add single text node if non-empty
      if (value) {
        appendChild(parent, createMutableTextNode(value));
      }
      break;
    }
  }
}

function getNodeName(node: HtmlNode): string {
  switch (node.nodeType) {
    case NodeType.Element:
      return (node as HtmlElement).tagName.toUpperCase();
    case NodeType.Text:
      return '#text';
    case NodeType.Comment:
      return '#comment';
    case NodeType.Doctype:
      return (node as HtmlDoctype).name.toUpperCase() || 'html';
    case NodeType.CdataSection:
      return '#cdata-section';
    case NodeType.ProcessingInstruction:
      return (node as HtmlProcessingInstruction).target;
    case NodeType.Document:
      return '#document';
    case NodeType.ParseError:
      return '#error';
    default:
      return '';
  }
}

function getNodeValue(node: HtmlNode): string | null {
  switch (node.nodeType) {
    case NodeType.Text:
      return (node as HtmlTextNode).text;
    case NodeType.Comment:
      return (node as HtmlComment).data;
    case NodeType.CdataSection:
      return (node as HtmlCdata).data;
    case NodeType.ProcessingInstruction:
      return (node as HtmlProcessingInstruction).data;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZE  (merge adjacent text nodes)
// ─────────────────────────────────────────────────────────────────────────────

function normalize(parent: MutableParentNode): void {
  const children = getParentChildren(parent);
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.nodeType === NodeType.Text) {
      // Check next sibling
      const next = child.nextSibling as MutableNode | null;
      if (next && next.nodeType === NodeType.Text) {
        // Merge: append next text to current
        (child as MutableTextNode).text += (next as MutableTextNode).text;
        removeChild(parent, next);
        // Don't increment i — check if there's another text sibling
        continue;
      }
    }
    // If this node is a parent, normalize it recursively
    if ('children' in child) {
      normalize(child as MutableParentNode);
    }
    i++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC cloneNode  (handles all node types)
// ─────────────────────────────────────────────────────────────────────────────

function cloneNode(node: HtmlNode, deep = false): MutableNode {
  switch (node.nodeType) {
    case NodeType.Element: {
      const el = node as HtmlElement;
      const clone = createMutableElement(el.tagName, new Map(el.attributes), el.sourceOffset);
      clone.isVoid = el.isVoid;
      clone.isRawText = el.isRawText;
      clone.rawContent = el.rawContent;
      clone.namespaceURI = (el as MutableElement).namespaceURI ?? Namespace.HTML;
      if (deep) {
        for (const child of el.children) {
          appendChild(clone, cloneNode(child, true));
        }
      }
      return clone;
    }
    case NodeType.Text: {
      const t = node as HtmlTextNode;
      return createMutableTextNode(t.text, t.sourceOffset);
    }
    case NodeType.Comment: {
      const c = node as HtmlComment;
      return createMutableComment(c.data, c.sourceOffset);
    }
    case NodeType.Doctype: {
      const d = node as HtmlDoctype;
      return createMutableDoctype(d.name, d.publicId, d.systemId, d.sourceOffset);
    }
    case NodeType.CdataSection: {
      const c = node as HtmlCdata;
      return createMutableCdata(c.data, c.sourceOffset);
    }
    case NodeType.Document: {
      // Documents are cloned shallow by default — deep clone copies children
      const clone = createMutableDocument();
      if (deep) {
        const doc = node as HtmlDocument;
        for (const child of doc.children) {
          appendChild(clone, cloneNode(child, true));
        }
        clone.doctype = doc.doctype;
        clone.htmlElement = doc.htmlElement;
        clone.headElement = doc.headElement;
        clone.bodyElement = doc.bodyElement;
        clone.hasDoctype = doc.hasDoctype;
        clone.declaredCharset = doc.declaredCharset;
        clone.detectedCharset = doc.detectedCharset;
        clone.metaCharset = doc.metaCharset;
      }
      return clone;
    }
    default:
      // For ParseError, ProcessingInstruction — return a shallow copy as-is
      return node as unknown as MutableNode;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT FRAGMENT + DOCUMENT FACTORY METHODS
// ─────────────────────────────────────────────────────────────────────────────

function createDocumentFragment(): MutableElement {
  const frag = createMutableElement('');
  return frag;
}

function createTextNode(text: string, offset = 0): MutableTextNode {
  return createMutableTextNode(text, offset);
}

function createComment(data: string, offset = 0): MutableComment {
  return createMutableComment(data, offset);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  NodeType,
  Namespace,
  // Core child management
  appendChild,
  insertBefore,
  removeChild,
  replaceChild,
  cloneElement,
  cloneNode,
  hasChildNodes,
  contains,
  getParentChildren,
  // Factory functions
  createMutableElement,
  createMutableTextNode,
  createMutableComment,
  createMutableDoctype,
  createMutableCdata,
  createMutableDocument,
  createParseError,
  createDocumentFragment,
  createTextNode,
  createComment,
  // Element attribute API
  elementGetAttribute,
  elementSetAttribute,
  elementRemoveAttribute,
  elementHasAttribute,
  elementToggleAttribute,
  elementGetAttributeNames,
  // Convenience mutation methods
  nodeRemove,
  nodeAppend,
  nodePrepend,
  nodeBefore,
  nodeAfter,
  nodeReplaceWith,
  // Element-only child accessors
  getFirstChildElement,
  getLastChildElement,
  getNextElementSibling,
  getPreviousElementSibling,
  getChildElementCount,
  // Text content / node accessors
  getTextContent,
  setTextContent,
  getNodeName,
  getNodeValue,
  // Normalize
  normalize,
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

// Re-export MutationObserver types
export {
  MutationObserver,
} from './mutation-observer';
export type {
  MutationRecord,
  MutationObserverInit,
  MutationCallback,
} from './mutation-observer';

// Re-export Shadow DOM types
export {
  attachShadow,
  getRootNode,
  isShadowRoot,
  findShadowRoot,
  assignSlots,
  getAssignedNodes,
  getSlotName,
  DEFAULT_SLOT_NAME,
  attachInternals,
  computeComposedPath,
  retarget,
  cloneShadowTree,
} from './shadow';
export type {
  ShadowRoot,
  ShadowRootMode,
  ShadowRootInit,
  MutableShadowRoot,
  EventPathItem,
  ElementInternals,
  ValidityStateFlags,
} from './shadow';
