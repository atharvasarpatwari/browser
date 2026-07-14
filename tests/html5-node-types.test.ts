import { describe, it, expect } from 'vitest';
import {
  NodeType,
  Namespace,
  createMutableElement,
  createMutableTextNode,
  createMutableComment,
  createMutableDoctype,
  createMutableCdata,
  createMutableDocument,
  createParseError,
  appendChild,
  insertBefore,
  removeChild,
  replaceChild,
  cloneElement,
  hasChildNodes,
  contains,
  getParentChildren,
  elementGetAttribute,
  elementSetAttribute,
  elementRemoveAttribute,
  elementHasAttribute,
  type HtmlElement,
  type HtmlTextNode,
  type HtmlComment,
  type HtmlDoctype,
  type HtmlCdata,
  type HtmlDocument,
} from '../src/browser/rendering/html5/dom';
import { HtmlParser } from '../src/browser/rendering/html-parser';

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('Node Factory Functions', () => {
  it('should create a mutable element with correct defaults', () => {
    const el = createMutableElement('div');
    expect(el.nodeType).toBe(NodeType.Element);
    expect(el.tagName).toBe('div');
    expect(el.attributes.size).toBe(0);
    expect(el.children.length).toBe(0);
    expect(el.parent).toBeNull();
    expect(el.isVoid).toBe(false);
    expect(el.isRawText).toBe(false);
    expect(el.rawContent).toBe('');
    expect(el.nextSibling).toBeNull();
    expect(el.previousSibling).toBeNull();
    expect(el.namespaceURI).toBe(Namespace.HTML);
    expect(el.sourceOffset).toBe(0);
  });

  it('should lowercase tag names', () => {
    const el = createMutableElement('DIV');
    expect(el.tagName).toBe('div');
  });

  it('should accept custom attributes and offset', () => {
    const attrs = new Map([['id', 'test'], ['class', 'foo']]);
    const el = createMutableElement('span', attrs, 42);
    expect(el.attributes.get('id')).toBe('test');
    expect(el.attributes.get('class')).toBe('foo');
    expect(el.sourceOffset).toBe(42);
  });

  it('should create a mutable text node', () => {
    const text = createMutableTextNode('hello', 10);
    expect(text.nodeType).toBe(NodeType.Text);
    expect(text.text).toBe('hello');
    expect(text.sourceOffset).toBe(10);
    expect(text.parent).toBeNull();
  });

  it('should create a mutable comment node', () => {
    const comment = createMutableComment('a comment', 20);
    expect(comment.nodeType).toBe(NodeType.Comment);
    expect(comment.data).toBe('a comment');
    expect(comment.sourceOffset).toBe(20);
  });

  it('should create a mutable doctype', () => {
    const doctype = createMutableDoctype('html', '', '', 0);
    expect(doctype.nodeType).toBe(NodeType.Doctype);
    expect(doctype.name).toBe('html');
    expect(doctype.publicId).toBe('');
    expect(doctype.systemId).toBe('');
  });

  it('should create a mutable CDATA', () => {
    const cdata = createMutableCdata('raw data', 30);
    expect(cdata.nodeType).toBe(NodeType.CdataSection);
    expect(cdata.data).toBe('raw data');
    expect(cdata.sourceOffset).toBe(30);
  });

  it('should create a mutable document', () => {
    const doc = createMutableDocument();
    expect(doc.nodeType).toBe(NodeType.Document);
    expect(doc.children.length).toBe(0);
    expect(doc.doctype).toBeNull();
    expect(doc.htmlElement).toBeNull();
    expect(doc.headElement).toBeNull();
    expect(doc.bodyElement).toBeNull();
    expect(doc.errors.length).toBe(0);
    expect(doc.hasDoctype).toBe(false);
    expect(doc.declaredCharset).toBeNull();
    expect(doc.detectedCharset).toBeNull();
    expect(doc.metaCharset).toBeNull();
    expect(doc.firstChild).toBeNull();
    expect(doc.lastChild).toBeNull();
    expect(doc.childNodes).toBe(doc.children);
  });

  it('should create a parse error', () => {
    const err = createParseError('something went wrong', 55);
    expect(err.nodeType).toBe(NodeType.ParseError);
    expect(err.message).toBe('something went wrong');
    expect(err.sourceOffset).toBe(55);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHILD MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('appendChild', () => {
  it('should add a child and set parent', () => {
    const doc = createMutableDocument();
    const el = createMutableElement('div');
    appendChild(doc, el);
    expect(doc.children.length).toBe(1);
    expect(doc.children[0]).toBe(el);
    expect(el.parent).toBe(doc);
    expect(doc.firstChild).toBe(el);
    expect(doc.lastChild).toBe(el);
    expect(doc.childNodes).toBe(doc.children);
  });

  it('should maintain sibling pointers', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    const c = createMutableElement('c');
    appendChild(doc, a);
    appendChild(doc, b);
    appendChild(doc, c);
    expect(a.nextSibling).toBe(b);
    expect(b.nextSibling).toBe(c);
    expect(c.nextSibling).toBeNull();
    expect(c.previousSibling).toBe(b);
    expect(b.previousSibling).toBe(a);
    expect(a.previousSibling).toBeNull();
    expect(doc.firstChild).toBe(a);
    expect(doc.lastChild).toBe(c);
  });

  it('should nest elements', () => {
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(parent, child);
    expect(parent.children.length).toBe(1);
    expect(child.parent).toBe(parent);
  });
});

describe('insertBefore', () => {
  it('should insert before a reference node', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    const c = createMutableElement('c');
    appendChild(doc, a);
    appendChild(doc, c);
    insertBefore(doc, b, c);
    expect(doc.children).toEqual([a, b, c]);
    expect(b.previousSibling).toBe(a);
    expect(b.nextSibling).toBe(c);
    expect(a.nextSibling).toBe(b);
    expect(c.previousSibling).toBe(b);
  });

  it('should insert at beginning when refNode is first', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    appendChild(doc, a);
    insertBefore(doc, b, a);
    expect(doc.children).toEqual([b, a]);
    expect(doc.firstChild).toBe(b);
    expect(b.previousSibling).toBeNull();
  });

  it('should fall back to appendChild if refNode not found', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const orphan = createMutableElement('orphan');
    appendChild(doc, a);
    insertBefore(doc, orphan, createMutableElement('missing'));
    expect(doc.children).toEqual([a, orphan]);
  });
});

describe('removeChild', () => {
  it('should remove a child and fix siblings', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    const c = createMutableElement('c');
    appendChild(doc, a);
    appendChild(doc, b);
    appendChild(doc, c);
    removeChild(doc, b);
    expect(doc.children).toEqual([a, c]);
    expect(a.nextSibling).toBe(c);
    expect(c.previousSibling).toBe(a);
    expect(b.parent).toBeNull();
    expect(b.nextSibling).toBeNull();
    expect(b.previousSibling).toBeNull();
  });

  it('should update firstChild and lastChild', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    appendChild(doc, a);
    appendChild(doc, b);
    removeChild(doc, a);
    expect(doc.firstChild).toBe(b);
    removeChild(doc, b);
    expect(doc.firstChild).toBeNull();
    expect(doc.lastChild).toBeNull();
  });

  it('should handle removing the only child', () => {
    const doc = createMutableDocument();
    const only = createMutableElement('only');
    appendChild(doc, only);
    removeChild(doc, only);
    expect(doc.children.length).toBe(0);
    expect(doc.firstChild).toBeNull();
    expect(doc.lastChild).toBeNull();
  });
});

describe('replaceChild', () => {
  it('should replace a child and maintain siblings', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const old = createMutableElement('old');
    const b = createMutableElement('b');
    const replacement = createMutableElement('new');
    appendChild(doc, a);
    appendChild(doc, old);
    appendChild(doc, b);
    replaceChild(doc, replacement, old);
    expect(doc.children).toEqual([a, replacement, b]);
    expect(a.nextSibling).toBe(replacement);
    expect(replacement.nextSibling).toBe(b);
    expect(replacement.previousSibling).toBe(a);
    expect(b.previousSibling).toBe(replacement);
    expect(old.parent).toBeNull();
  });

  it('should replace the first child', () => {
    const doc = createMutableDocument();
    const old = createMutableElement('old');
    const replacement = createMutableElement('new');
    appendChild(doc, old);
    replaceChild(doc, replacement, old);
    expect(doc.children).toEqual([replacement]);
    expect(doc.firstChild).toBe(replacement);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLONE
// ─────────────────────────────────────────────────────────────────────────────

describe('cloneElement', () => {
  it('should shallow clone an element', () => {
    const el = createMutableElement('div', new Map([['id', 'test']]), 10);
    el.isVoid = true;
    el.isRawText = true;
    el.rawContent = 'raw';
    const clone = cloneElement(el);
    expect(clone.tagName).toBe('div');
    expect(clone.attributes.get('id')).toBe('test');
    expect(clone.sourceOffset).toBe(10);
    expect(clone.isVoid).toBe(true);
    expect(clone.isRawText).toBe(true);
    expect(clone.rawContent).toBe('raw');
    expect(clone.children.length).toBe(0);
    expect(clone).not.toBe(el);
  });

  it('should deep clone children', () => {
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    const text = createMutableTextNode('hello');
    const comment = createMutableComment('world');
    appendChild(parent, child);
    appendChild(parent, text);
    appendChild(parent, comment);
    const clone = cloneElement(parent, true);
    expect(clone.children.length).toBe(3);
    expect(clone.children[0]).not.toBe(child);
    expect((clone.children[0] as any).tagName).toBe('span');
    expect((clone.children[1] as any).text).toBe('hello');
    expect((clone.children[2] as any).data).toBe('world');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TREE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

describe('hasChildNodes', () => {
  it('should return true when element has children', () => {
    const el = createMutableElement('div');
    expect(hasChildNodes(el)).toBe(false);
    appendChild(el, createMutableElement('span'));
    expect(hasChildNodes(el)).toBe(true);
  });

  it('should return false for text nodes', () => {
    const text = createMutableTextNode('hello');
    expect(hasChildNodes(text)).toBe(false);
  });
});

describe('contains', () => {
  it('should find direct children', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    appendChild(doc, a);
    expect(contains(doc, a)).toBe(true);
  });

  it('should find nested descendants', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    const c = createMutableElement('c');
    appendChild(doc, a);
    appendChild(a, b);
    appendChild(b, c);
    expect(contains(doc, c)).toBe(true);
  });

  it('should return false for unrelated nodes', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const orphan = createMutableElement('orphan');
    appendChild(doc, a);
    expect(contains(doc, orphan)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM API (Element methods)
// ─────────────────────────────────────────────────────────────────────────────

describe('Element DOM API', () => {
  it('getAttribute should return attribute value or null', () => {
    const el = createMutableElement('div', new Map([['id', 'test']]));
    expect(elementGetAttribute(el, 'id')).toBe('test');
    expect(elementGetAttribute(el, 'missing')).toBeNull();
  });

  it('setAttribute should add or update an attribute', () => {
    const el = createMutableElement('div');
    elementSetAttribute(el, 'class', 'foo');
    expect(elementGetAttribute(el, 'class')).toBe('foo');
    elementSetAttribute(el, 'class', 'bar');
    expect(elementGetAttribute(el, 'class')).toBe('bar');
  });

  it('removeAttribute should delete an attribute', () => {
    const el = createMutableElement('div', new Map([['id', 'test']]));
    elementRemoveAttribute(el, 'id');
    expect(elementGetAttribute(el, 'id')).toBeNull();
  });

  it('hasAttribute should check existence', () => {
    const el = createMutableElement('div', new Map([['id', 'test']]));
    expect(elementHasAttribute(el, 'id')).toBe(true);
    expect(elementHasAttribute(el, 'class')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NODETYPE ENUM CONSISTENCY
// ─────────────────────────────────────────────────────────────────────────────

describe('NodeType enum', () => {
  it('should have correct values', () => {
    expect(NodeType.Document).toBe('document');
    expect(NodeType.Element).toBe('element');
    expect(NodeType.Text).toBe('text');
    expect(NodeType.Comment).toBe('comment');
    expect(NodeType.Doctype).toBe('doctype');
    expect(NodeType.CdataSection).toBe('cdata');
    expect(NodeType.ProcessingInstruction).toBe('pi');
    expect(NodeType.ParseError).toBe('error');
  });
});

describe('Namespace enum', () => {
  it('should have correct URIs', () => {
    expect(Namespace.HTML).toBe('http://www.w3.org/1999/xhtml');
    expect(Namespace.SVG).toBe('http://www.w3.org/2000/svg');
    expect(Namespace.MathML).toBe('http://www.w3.org/1998/Math/MathML');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: Full parse cycle produces correct node types
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration with HtmlParser', () => {
  it('should produce nodes with correct nodeType values', () => {
    const parser = new HtmlParser();
    const { document } = parser.parse('<!DOCTYPE html><html><head><title>Test</title></head><body><p>Hello</p><!-- comment --></body></html>');

    expect(document.nodeType).toBe(NodeType.Document);
    expect(document.doctype).not.toBeNull();
    expect(document.doctype!.nodeType).toBe(NodeType.Doctype);
    expect(document.htmlElement).not.toBeNull();
    expect(document.htmlElement!.nodeType).toBe(NodeType.Element);
    expect(document.htmlElement!.tagName).toBe('html');
    expect(document.headElement).not.toBeNull();
    expect(document.headElement!.tagName).toBe('head');
    expect(document.bodyElement).not.toBeNull();
    expect(document.bodyElement!.tagName).toBe('body');
  });

  it('should have sibling pointers on tree nodes', () => {
    const parser = new HtmlParser();
    const { document } = parser.parse('<html><head></head><body></body></html>');

    const html = document.htmlElement!;
    expect(html.children.length).toBeGreaterThanOrEqual(2);
    const head = html.children[0] as HtmlElement;
    const body = html.children[1] as HtmlElement;
    expect(head.nextSibling).toBe(body);
    expect(body.previousSibling).toBe(head);
    expect(head.parent).toBe(html);
  });

  it('should track firstChild and lastChild on document', () => {
    const parser = new HtmlParser();
    const { document } = parser.parse('<html><head></head><body></body></html>');

    expect(document.firstChild).not.toBeNull();
    expect(document.firstChild!.nodeType).toBe(NodeType.Element);
    expect(document.lastChild).not.toBeNull();
    expect(document.childNodes).toBe(document.children);
  });
});
