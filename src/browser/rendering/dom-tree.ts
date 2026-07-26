import type { IDisposable } from '../../app/dependency-container';
import type { HtmlDocument, HtmlElement, HtmlNode } from './html-parser';
import { NodeType } from './html-parser';
import { querySelector as css5QuerySelector, querySelectorAll as css5QuerySelectorAll, type SelectableElement } from './css5/selector';

type DomNodeType = 'document' | 'element' | 'text' | 'comment';

interface DomNode {
  readonly domId: string;
  readonly nodeType: DomNodeType;
  readonly parent: DomNode | null;
  readonly children: DomNode[];
  _dirtyLayout: boolean;
  _dirtyPaint: boolean;
}

interface DomElement extends DomNode {
  readonly nodeType: 'element';
  readonly tagName: string;
  readonly attributes: ReadonlyMap<string, string>;
  computedStyle: ReadonlyMap<string, string> | null;
  layoutBox: LayoutBox | null;
  /** Decoded image data (populated after lazy load completes). */
  imageData: ImageData | null;
  /** Natural dimensions of the image (populated after load). */
  naturalWidth: number;
  naturalHeight: number;
  /** Lazy loading state. */
  loadingState: 'none' | 'lazy' | 'loading' | 'loaded' | 'error';
  /** Cached will-change computed value (populated by CSS cascade). */
  willChange: string | null;
}

interface DomTextNode extends DomNode {
  readonly nodeType: 'text';
  readonly text: string;
}

interface DomDocument {
  readonly domId: string;
  readonly nodeType: 'document';
  readonly parent: null;
  readonly children: DomNode[];
  readonly htmlElement: DomElement | null;
  readonly headElement: DomElement | null;
  readonly bodyElement: DomElement | null;
}

interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  height: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly paddingTop: number;
  readonly paddingRight: number;
  readonly paddingBottom: number;
  readonly paddingLeft: number;
  readonly borderTop: number;
  readonly borderRight: number;
  readonly borderBottom: number;
  readonly borderLeft: number;
  /** Text runs for rendering (populated by inline formatting context). */
  textRuns?: TextRun[];
}

/**
 * A positioned text segment for rendering.
 * Stored on LayoutBox by the layout engine for the paint engine to consume.
 */
interface TextRun {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly fontWeight?: string;
  readonly color: string;
}

type DomMutationType =
  | 'nodeInserted' | 'nodeRemoved' | 'attributeChanged'
  | 'textChanged' | 'styleChanged';

interface DomMutation {
  readonly type: DomMutationType;
  readonly targetDomId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

interface IDomTree extends IDisposable {
  buildFromHtml(htmlDoc: HtmlDocument): DomDocument;
  getNodeById(domId: string): DomNode | null;
  getElementById(id: string): DomElement | null;
  getElementsByTagName(tagName: string): readonly DomElement[];
  getElementsByClassName(names: string): readonly DomElement[];
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): readonly DomElement[];
  insertBefore(parent: DomElement, newChild: DomNode, referenceChild: DomNode | null): void;
  appendChild(parent: DomElement, child: DomNode): void;
  removeChild(parent: DomElement, child: DomNode): void;
  setAttribute(element: DomElement, name: string, value: string): void;
  removeAttribute(element: DomElement, name: string): void;
  setTextContent(node: DomElement | DomTextNode, text: string): void;
  setComputedStyle(element: DomElement, style: ReadonlyMap<string, string>): void;
  setLayoutBox(element: DomElement, box: LayoutBox): void;
  getMutations(): readonly DomMutation[];
  clearMutations(): void;
  processMutations(): void;
  markDirty(node: DomNode, kind: 'layout' | 'paint'): void;
  markSubtreeDirty(node: DomNode, kind: 'layout' | 'paint'): void;
  clearDirty(node: DomNode, kind: 'layout' | 'paint'): void;
  clearSubtreeDirty(node: DomNode, kind: 'layout' | 'paint'): void;
  getDocument(): DomDocument | null;
  /** WHATWG DOM § 4 — parentElement: parent if it's an Element, else null */
  getParentElement(node: DomNode): DomElement | null;
  /** WHATWG DOM § 4 — ownerDocument: the Document that owns this node */
  getOwnerDocument(node: DomNode): DomDocument | null;
  /** WHATWG DOM § 4 — isConnected: whether node is connected to a document */
  isConnected(node: DomNode): boolean;
}

let _domNodeSeq = 0;
function nextDomNodeId(): string {
  return `dom-${(++_domNodeSeq).toString(36)}`;
}

/**
 * Wraps a DomElement to satisfy the SelectableElement interface
 * expected by the CSS5 selector engine. Filters out non-element
 * children (text, comment nodes) and caches instances via WeakMap.
 */
class SelectableDomNode implements SelectableElement {
  readonly tagName: string;
  readonly attributes: ReadonlyMap<string, string>;

  private readonly _element: DomElement;
  private readonly _domTree: DomTree;
  private _parent: SelectableElement | null = undefined as unknown as SelectableElement | null;
  private _children: SelectableElement[] = undefined as unknown as SelectableElement[];
  private _resolved = false;

  constructor(element: DomElement, domTree: DomTree) {
    this._element = element;
    this._domTree = domTree;
    this.tagName = element.tagName;
    this.attributes = element.attributes;
  }

  get parent(): SelectableElement | null {
    if (!this._resolved) this._resolve();
    return this._parent;
  }

  get children(): readonly SelectableElement[] {
    if (!this._resolved) this._resolve();
    return this._children;
  }

  /** Return the original DomElement this adapter wraps. */
  get domElement(): DomElement {
    return this._element;
  }

  private _resolve(): void {
    this._resolved = true;
    const p = this._element.parent;
    this._parent = (p != null && p.nodeType === 'element')
      ? this._domTree.toSelectable(p as DomElement)
      : null;
    this._children = this._element.children
      .filter((c): c is DomElement => c.nodeType === 'element')
      .map(c => this._domTree.toSelectable(c as DomElement));
  }
}

class DomTree implements IDomTree {
  private document: DomDocument | null = null;
  private readonly nodeIndex = new Map<string, DomNode>();
  private readonly mutations: DomMutation[] = [];
  private readonly idIndex = new Map<string, DomElement>();
  private selectableCache = new WeakMap<DomElement, SelectableDomNode>();

  buildFromHtml(htmlDoc: HtmlDocument): DomDocument {
    this.nodeIndex.clear();
    this.idIndex.clear();
    this.mutations.length = 0;
    this.selectableCache = new WeakMap();

    const doc = this.convertDocument(htmlDoc);
    this.document = doc;
    this.indexNode(doc);
    return doc;
  }

  getNodeById(domId: string): DomNode | null {
    return this.nodeIndex.get(domId) ?? null;
  }

  getElementById(id: string): DomElement | null {
    return this.idIndex.get(id) ?? null;
  }

  getElementsByTagName(tagName: string): readonly DomElement[] {
    const lower = tagName.toLowerCase();
    return [...this.nodeIndex.values()].filter(
      (n): n is DomElement => n.nodeType === 'element' && (n as DomElement).tagName === lower,
    );
  }

  getElementsByClassName(names: string): readonly DomElement[] {
    const tokens = names.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const root = this.document?.bodyElement ?? this.document?.htmlElement;
    if (!root) return [];
    const result: DomElement[] = [];
    const queue: DomNode[] = [root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node.nodeType === 'element') {
        const el = node as DomElement;
        const classAttr = el.attributes.get('class') ?? '';
        const classSet = new Set(classAttr.split(/\s+/));
        if (tokens.every(t => classSet.has(t))) {
          result.push(el);
        }
      }
      for (const child of node.children) {
        queue.push(child);
      }
    }
    return result;
  }

  querySelector(selector: string): DomElement | null {
    const root = this.document?.bodyElement ?? this.document?.htmlElement;
    if (!root) return null;
    const selectable = this.toSelectable(root);
    const result = css5QuerySelector(selectable, selector);
    return result instanceof SelectableDomNode ? result.domElement : null;
  }

  querySelectorAll(selector: string): readonly DomElement[] {
    const root = this.document?.bodyElement ?? this.document?.htmlElement;
    if (!root) return [];
    const selectable = this.toSelectable(root);
    const results = css5QuerySelectorAll(selectable, selector);
    return results
      .map(r => r instanceof SelectableDomNode ? r.domElement : null)
      .filter((e): e is DomElement => e !== null);
  }

  toSelectable(element: DomElement): SelectableDomNode {
    let cached = this.selectableCache.get(element);
    if (!cached) {
      cached = new SelectableDomNode(element, this);
      this.selectableCache.set(element, cached);
    }
    return cached;
  }

  insertBefore(parent: DomElement, newChild: DomNode, referenceChild: DomNode | null): void {
    const idx = referenceChild ? parent.children.indexOf(referenceChild) : parent.children.length;
    parent.children.splice(idx, 0, newChild);
    (newChild as { parent: DomNode | null }).parent = parent;
    this.indexNode(newChild);
    this.mutations.push({ type: 'nodeInserted', targetDomId: parent.domId, data: { childId: newChild.domId, index: idx } });
  }

  appendChild(parent: DomElement, child: DomNode): void {
    parent.children.push(child);
    (child as { parent: DomNode | null }).parent = parent;
    this.indexNode(child);
    this.mutations.push({ type: 'nodeInserted', targetDomId: parent.domId, data: { childId: child.domId } });
  }

  removeChild(parent: DomElement, child: DomNode): void {
    const idx = parent.children.indexOf(child);
    if (idx !== -1) parent.children.splice(idx, 1);
    (child as { parent: DomNode | null }).parent = null;
    this.nodeIndex.delete(child.domId);
    if (child.nodeType === 'element') {
      const id = (child as DomElement).attributes.get('id');
      if (id && this.idIndex.get(id) === child) {
        this.idIndex.delete(id);
      }
    }
    this.mutations.push({ type: 'nodeRemoved', targetDomId: parent.domId, data: { childId: child.domId } });
  }

  setAttribute(element: DomElement, name: string, value: string): void {
    const attrs = new Map(element.attributes);
    attrs.set(name, value);
    (element as { attributes: ReadonlyMap<string, string> }).attributes = attrs;
    if (name === 'id') {
      this.idIndex.set(value, element);
    }
    this.mutations.push({ type: 'attributeChanged', targetDomId: element.domId, data: { name, value } });
  }

  removeAttribute(element: DomElement, name: string): void {
    const attrs = new Map(element.attributes);
    const oldValue = attrs.get(name);
    attrs.delete(name);
    (element as { attributes: ReadonlyMap<string, string> }).attributes = attrs;
    if (name === 'id' && oldValue !== undefined) {
      this.idIndex.delete(oldValue);
    }
    this.mutations.push({ type: 'attributeChanged', targetDomId: element.domId, data: { name, value: null } });
  }

  setTextContent(node: DomElement | DomTextNode, text: string): void {
    if (node.nodeType === 'text') {
      (node as { text: string }).text = text;
    }
    this.mutations.push({ type: 'textChanged', targetDomId: node.domId, data: { text } });
  }

  setComputedStyle(element: DomElement, style: ReadonlyMap<string, string>): void {
    element.computedStyle = style;
    this.mutations.push({ type: 'styleChanged', targetDomId: element.domId, data: {} });
  }

  setLayoutBox(element: DomElement, box: LayoutBox): void {
    element.layoutBox = box;
  }

  getMutations(): readonly DomMutation[] {
    return [...this.mutations];
  }

  clearMutations(): void {
    this.mutations.length = 0;
  }

  processMutations(): void {
    for (const mut of this.mutations) {
      const el = this.nodeIndex.get(mut.targetDomId);
      if (el) {
        this.markDirty(el, 'layout');
      }
    }
    this.mutations.length = 0;
  }

  markDirty(node: DomNode, kind: 'layout' | 'paint'): void {
    if (kind === 'layout') {
      if (node._dirtyLayout) return;
      node._dirtyLayout = true;
      node._dirtyPaint = true;
      let p = node.parent;
      while (p) {
        if (p._dirtyLayout) break;
        p._dirtyLayout = true;
        p._dirtyPaint = true;
        p = p.parent;
      }
    } else {
      if (node._dirtyPaint) return;
      node._dirtyPaint = true;
      let p = node.parent;
      while (p) {
        if (p._dirtyPaint) break;
        p._dirtyPaint = true;
        p = p.parent;
      }
    }
  }

  markSubtreeDirty(node: DomNode, kind: 'layout' | 'paint'): void {
    const stack: DomNode[] = [node];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (kind === 'layout') {
        n._dirtyLayout = true;
        n._dirtyPaint = true;
      } else {
        n._dirtyPaint = true;
      }
      for (const c of n.children) stack.push(c);
    }
    this.markDirty(node, kind);
  }

  clearDirty(node: DomNode, kind: 'layout' | 'paint'): void {
    if (kind === 'layout') node._dirtyLayout = false;
    else node._dirtyPaint = false;
  }

  clearSubtreeDirty(node: DomNode, kind: 'layout' | 'paint'): void {
    const stack: DomNode[] = [node];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (kind === 'layout') n._dirtyLayout = false;
      else n._dirtyPaint = false;
      for (const c of n.children) stack.push(c);
    }
  }

  getDocument(): DomDocument | null {
    return this.document;
  }

  /** WHATWG DOM § 4.2 — parentElement: the parent if it's an Element, else null */
  getParentElement(node: DomNode): DomElement | null {
    const p = node.parent;
    if (p && p.nodeType === 'element') return p as DomElement;
    return null;
  }

  /** WHATWG DOM § 4.2 — ownerDocument: the Document that owns this node, or null for Documents */
  getOwnerDocument(node: DomNode): DomDocument | null {
    if (node.nodeType === 'document') return null;
    let current: DomNode | null = node;
    while (current) {
      if (current.nodeType === 'document') return current as DomDocument;
      current = current.parent;
    }
    return null;
  }

  /** WHATWG DOM § 4.2 — isConnected: whether the node is connected to a document */
  isConnected(node: DomNode): boolean {
    if (node.nodeType === 'document') return true;
    let current: DomNode | null = node;
    while (current) {
      if (current.nodeType === 'document') return true;
      current = current.parent;
    }
    return false;
  }

  private convertDocument(htmlDoc: HtmlDocument): DomDocument {
    const id = nextDomNodeId();
    const children: DomNode[] = [];

    for (const child of htmlDoc.children) {
      const converted = this.convertNode(child, null);
      if (converted) children.push(converted);
    }

    let htmlElement: DomElement | null = null;
    let headElement: DomElement | null = null;
    let bodyElement: DomElement | null = null;

    if (htmlDoc.htmlElement) {
      htmlElement = this.findDomElement(children, htmlDoc.htmlElement.tagName, htmlDoc.htmlElement.attributes.get('id') ?? null);
    }
    if (htmlDoc.headElement) {
      headElement = this.findDomElement(children, 'head');
    }
    if (htmlDoc.bodyElement) {
      bodyElement = this.findDomElement(children, 'body');
    }

    // Reassign parent for top-level children now that the document exists
    const doc: DomDocument = { domId: id, nodeType: 'document', parent: null, children, htmlElement, headElement, bodyElement };
    for (const child of doc.children) {
      (child as { parent: DomNode | null }).parent = doc;
    }
    return doc;
  }

  private findDomElement(children: DomNode[], tagName: string, id?: string | null): DomElement | null {
    for (const child of children) {
      if (child.nodeType === 'element') {
        const el = child as DomElement;
        if (el.tagName === tagName && (id === null || el.attributes.get('id') === id)) return el;
        const found = this.findDomElement(el.children, tagName, id);
        if (found) return found;
      }
    }
    return null;
  }

  private convertNode(node: HtmlNode, parent: DomNode | null): DomNode | null {
    if (node.nodeType === 'element' as NodeType) {
      const el = node as HtmlElement;
      const loadingAttr = el.attributes.get('loading');
      const loadingState: DomElement['loadingState'] =
        loadingAttr === 'lazy' ? 'lazy' : 'none';

      const domEl: DomElement = {
        domId: nextDomNodeId(),
        nodeType: 'element',
        tagName: el.tagName,
        attributes: el.attributes,
        parent,
        children: [],
        computedStyle: null,
        layoutBox: null,
        imageData: null,
        naturalWidth: 0,
        naturalHeight: 0,
        loadingState,
        willChange: null,
        _dirtyLayout: true,
        _dirtyPaint: true,
      };

      for (const child of el.children) {
        const converted = this.convertNode(child, domEl);
        if (converted) domEl.children.push(converted);
      }

      if (el.rawContent && domEl.children.length === 0) {
        const textNode: DomTextNode = {
          domId: nextDomNodeId(),
          nodeType: 'text',
          parent: domEl,
          children: [],
          text: el.rawContent,
          _dirtyLayout: true,
          _dirtyPaint: true,
        };
        domEl.children.push(textNode);
      }

      const id = el.attributes.get('id');
      if (id) this.idIndex.set(id, domEl);

      return domEl;
    }

    if (node.nodeType === NodeType.Text) {
      const textNode = node as unknown as { text: string };
      const result: DomTextNode = {
        domId: nextDomNodeId(),
        nodeType: 'text',
        parent,
        children: [],
        text: textNode.text,
        _dirtyLayout: true,
        _dirtyPaint: true,
      };
      return result;
    }

    return null;
  }

  private indexNode(node: DomNode): void {
    this.nodeIndex.set(node.domId, node);
    for (const child of node.children) {
      this.indexNode(child);
    }
  }

  dispose(): void {
    this.document = null;
    this.nodeIndex.clear();
    this.idIndex.clear();
    this.mutations.length = 0;
    this.selectableCache = new WeakMap();
  }
}

export { DomTree };
export type { IDomTree, DomDocument, DomNode, DomElement, DomTextNode, DomMutation, DomMutationType, LayoutBox, TextRun };
