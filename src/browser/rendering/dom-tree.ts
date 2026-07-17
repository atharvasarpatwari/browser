import type { IDisposable } from '../../app/dependency-container';
import type { HtmlDocument, HtmlElement, HtmlNode } from './html-parser';
import { NodeType } from './html-parser';

type DomNodeType = 'document' | 'element' | 'text' | 'comment';

interface DomNode {
  readonly domId: string;
  readonly nodeType: DomNodeType;
  readonly parent: DomNode | null;
  readonly children: DomNode[];
}

interface DomElement extends DomNode {
  readonly nodeType: 'element';
  readonly tagName: string;
  readonly attributes: ReadonlyMap<string, string>;
  computedStyle: ReadonlyMap<string, string> | null;
  layoutBox: LayoutBox | null;
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
  getDocument(): DomDocument | null;
}

let _domNodeSeq = 0;
function nextDomNodeId(): string {
  return `dom-${(++_domNodeSeq).toString(36)}`;
}

class DomTree implements IDomTree {
  private document: DomDocument | null = null;
  private readonly nodeIndex = new Map<string, DomNode>();
  private readonly mutations: DomMutation[] = [];
  private readonly idIndex = new Map<string, DomElement>();

  buildFromHtml(htmlDoc: HtmlDocument): DomDocument {
    this.nodeIndex.clear();
    this.idIndex.clear();
    this.mutations.length = 0;

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

  querySelector(_selector: string): DomElement | null {
    return null;
  }

  querySelectorAll(_selector: string): readonly DomElement[] {
    return [];
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

  getDocument(): DomDocument | null {
    return this.document;
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
      const domEl: DomElement = {
        domId: nextDomNodeId(),
        nodeType: 'element',
        tagName: el.tagName,
        attributes: el.attributes,
        parent,
        children: [],
        computedStyle: null,
        layoutBox: null,
      };

      for (const child of el.children) {
        const converted = this.convertNode(child, domEl);
        if (converted) domEl.children.push(converted);
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
  }
}

export { DomTree };
export type { IDomTree, DomDocument, DomNode, DomElement, DomTextNode, DomMutation, DomMutationType, LayoutBox, TextRun };
