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
  cloneNode,
  hasChildNodes,
  contains,
  getParentChildren,
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
  // Factories
  createDocumentFragment,
  createTextNode,
  createComment,
  type HtmlElement,
  type HtmlTextNode,
  type HtmlComment,
  type HtmlDoctype,
  type HtmlCdata,
  type HtmlDocument,
  type MutableElement,
  type MutableTextNode,
  type MutableComment,
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

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE MUTATION METHODS
// ─────────────────────────────────────────────────────────────────────────────

describe('nodeRemove', () => {
  it('should remove a node from its parent', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    appendChild(doc, a);
    appendChild(doc, b);
    nodeRemove(b);
    expect(doc.children.length).toBe(1);
    expect(doc.children[0]).toBe(a);
    expect(b.parent).toBeNull();
  });

  it('should do nothing if node has no parent', () => {
    const orphan = createMutableElement('orphan');
    nodeRemove(orphan); // should not throw
  });
});

describe('nodeAppend', () => {
  it('should append multiple nodes', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    nodeAppend(doc, a, b);
    expect(doc.children).toEqual([a, b]);
  });

  it('should accept string arguments (auto-create text nodes)', () => {
    const el = createMutableElement('div');
    nodeAppend(el, 'hello', ' ', 'world');
    expect(el.children.length).toBe(3);
    expect(getTextContent(el)).toBe('hello world');
  });

  it('should skip null and undefined', () => {
    const el = createMutableElement('div');
    nodeAppend(el, null as any, undefined as any, 'text');
    expect(el.children.length).toBe(1);
  });
});

describe('nodePrepend', () => {
  it('should prepend nodes at the beginning', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    appendChild(doc, a);
    nodePrepend(doc, b);
    expect(doc.children).toEqual([b, a]);
  });

  it('should prepend multiple nodes in order', () => {
    const doc = createMutableDocument();
    const c = createMutableElement('c');
    appendChild(doc, c);
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    nodePrepend(doc, a, b);
    expect(doc.children).toEqual([a, b, c]);
  });

  it('should accept string arguments', () => {
    const el = createMutableElement('div');
    nodePrepend(el, 'start');
    expect(el.children.length).toBe(1);
    expect(getTextContent(el)).toBe('start');
  });
});

describe('nodeBefore', () => {
  it('should insert nodes before the reference node', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    appendChild(doc, a);
    nodeBefore(a, b);
    expect(doc.children).toEqual([b, a]);
  });

  it('should do nothing if node has no parent', () => {
    const orphan = createMutableElement('orphan');
    const extra = createMutableElement('extra');
    nodeBefore(orphan, extra); // should not throw
    expect(orphan.parent).toBeNull();
  });
});

describe('nodeAfter', () => {
  it('should insert nodes after the reference node', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    appendChild(doc, a);
    nodeAfter(a, b);
    expect(doc.children).toEqual([a, b]);
  });

  it('should insert at end when reference is last', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    appendChild(doc, a);
    nodeAfter(a, b);
    expect(doc.lastChild).toBe(b);
  });

  it('should accept string arguments', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    appendChild(doc, a);
    nodeAfter(a, 'text');
    expect(doc.children.length).toBe(2);
    expect(getTextContent(doc.children[1] as any)).toBe('text');
  });
});

describe('nodeReplaceWith', () => {
  it('should replace a node with one or more nodes', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    const c = createMutableElement('c');
    appendChild(doc, a);
    appendChild(doc, b);
    appendChild(doc, c);
    nodeReplaceWith(b, createMutableElement('new'));
    expect(doc.children.length).toBe(3);
    expect((doc.children[1] as any).tagName).toBe('new');
  });

  it('should replace with multiple nodes', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const old = createMutableElement('old');
    const b = createMutableElement('b');
    appendChild(doc, a);
    appendChild(doc, old);
    appendChild(doc, b);
    const x = createMutableElement('x');
    const y = createMutableElement('y');
    nodeReplaceWith(old, x, y);
    expect(doc.children).toEqual([a, x, y, b]);
  });

  it('should remove node when called with no arguments', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    appendChild(doc, a);
    nodeReplaceWith(a);
    expect(doc.children.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT-ONLY CHILD ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────

describe('Element-only child accessors', () => {
  it('getFirstChildElement should skip text nodes', () => {
    const parent = createMutableElement('div');
    const text = createMutableTextNode('hello');
    const el = createMutableElement('span');
    appendChild(parent, text);
    appendChild(parent, el);
    expect(getFirstChildElement(parent)).toBe(el);
  });

  it('getLastChildElement should skip text nodes', () => {
    const parent = createMutableElement('div');
    const el = createMutableElement('span');
    const text = createMutableTextNode('hello');
    appendChild(parent, el);
    appendChild(parent, text);
    expect(getLastChildElement(parent)).toBe(el);
  });

  it('getNextElementSibling should skip text nodes', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const text = createMutableTextNode(' ');
    const b = createMutableElement('b');
    appendChild(doc, a);
    appendChild(doc, text);
    appendChild(doc, b);
    expect(getNextElementSibling(a)).toBe(b);
  });

  it('getPreviousElementSibling should skip text nodes', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const text = createMutableTextNode(' ');
    const b = createMutableElement('b');
    appendChild(doc, a);
    appendChild(doc, text);
    appendChild(doc, b);
    expect(getPreviousElementSibling(b)).toBe(a);
  });

  it('getChildElementCount should count only element children', () => {
    const parent = createMutableElement('div');
    appendChild(parent, createMutableTextNode('a'));
    appendChild(parent, createMutableElement('span'));
    appendChild(parent, createMutableTextNode('b'));
    appendChild(parent, createMutableElement('p'));
    expect(getChildElementCount(parent)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE ATTRIBUTE / GET ATTRIBUTE NAMES
// ─────────────────────────────────────────────────────────────────────────────

describe('elementToggleAttribute', () => {
  it('should add attribute if missing', () => {
    const el = createMutableElement('div');
    const result = elementToggleAttribute(el, 'hidden');
    expect(result).toBe(true);
    expect(elementHasAttribute(el, 'hidden')).toBe(true);
  });

  it('should remove attribute if present', () => {
    const el = createMutableElement('div', new Map([['hidden', '']]));
    const result = elementToggleAttribute(el, 'hidden');
    expect(result).toBe(false);
    expect(elementHasAttribute(el, 'hidden')).toBe(false);
  });

  it('should force-set with force=true', () => {
    const el = createMutableElement('div');
    const result = elementToggleAttribute(el, 'hidden', true);
    expect(result).toBe(true);
    expect(elementHasAttribute(el, 'hidden')).toBe(true);
  });

  it('should force-remove with force=false', () => {
    const el = createMutableElement('div', new Map([['hidden', '']]));
    const result = elementToggleAttribute(el, 'hidden', false);
    expect(result).toBe(false);
    expect(elementHasAttribute(el, 'hidden')).toBe(false);
  });
});

describe('elementGetAttributeNames', () => {
  it('should return all attribute names', () => {
    const el = createMutableElement('div', new Map([['id', 'test'], ['class', 'foo']]));
    const names = elementGetAttributeNames(el);
    expect(names).toContain('id');
    expect(names).toContain('class');
    expect(names.length).toBe(2);
  });

  it('should return empty array for no attributes', () => {
    const el = createMutableElement('div');
    expect(elementGetAttributeNames(el)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEXT CONTENT / NODE ACCESSORS
// ─────────────────────────────────────────────────────────────────────────────

describe('getTextContent', () => {
  it('should return text for text nodes', () => {
    const text = createMutableTextNode('hello');
    expect(getTextContent(text)).toBe('hello');
  });

  it('should return data for comment nodes', () => {
    const comment = createMutableComment('a comment');
    expect(getTextContent(comment)).toBe('a comment');
  });

  it('should return data for CDATA nodes', () => {
    const cdata = createMutableCdata('raw data');
    expect(getTextContent(cdata)).toBe('raw data');
  });

  it('should concatenate all descendant text for elements', () => {
    const el = createMutableElement('div');
    appendChild(el, createMutableTextNode('hello'));
    const span = createMutableElement('span');
    appendChild(span, createMutableTextNode(' world'));
    appendChild(el, span);
    appendChild(el, createMutableTextNode('!'));
    expect(getTextContent(el)).toBe('hello world!');
  });
});

describe('setTextContent', () => {
  it('should set text on text nodes', () => {
    const text = createMutableTextNode('old');
    setTextContent(text, 'new');
    expect(text.text).toBe('new');
  });

  it('should replace all children on elements with a single text node', () => {
    const el = createMutableElement('div');
    appendChild(el, createMutableElement('span'));
    appendChild(el, createMutableTextNode('text'));
    setTextContent(el, 'new text');
    expect(el.children.length).toBe(1);
    expect(getTextContent(el)).toBe('new text');
  });

  it('should clear children if value is empty', () => {
    const el = createMutableElement('div');
    appendChild(el, createMutableTextNode('text'));
    setTextContent(el, '');
    expect(el.children.length).toBe(0);
  });
});

describe('getNodeName', () => {
  it('should return uppercase tag for elements', () => {
    const el = createMutableElement('div');
    expect(getNodeName(el)).toBe('DIV');
  });

  it('should return #text for text nodes', () => {
    expect(getNodeName(createMutableTextNode('x'))).toBe('#text');
  });

  it('should return #comment for comments', () => {
    expect(getNodeName(createMutableComment('x'))).toBe('#comment');
  });

  it('should return #document for documents', () => {
    expect(getNodeName(createMutableDocument())).toBe('#document');
  });

  it('should return #cdata-section for CDATA', () => {
    expect(getNodeName(createMutableCdata('x'))).toBe('#cdata-section');
  });
});

describe('getNodeValue', () => {
  it('should return text for text nodes', () => {
    expect(getNodeValue(createMutableTextNode('hello'))).toBe('hello');
  });

  it('should return data for comments', () => {
    expect(getNodeValue(createMutableComment('data'))).toBe('data');
  });

  it('should return null for elements', () => {
    expect(getNodeValue(createMutableElement('div'))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZE
// ─────────────────────────────────────────────────────────────────────────────

describe('normalize', () => {
  it('should merge adjacent text nodes', () => {
    const el = createMutableElement('div');
    const t1 = createMutableTextNode('hello');
    const t2 = createMutableTextNode(' world');
    appendChild(el, t1);
    appendChild(el, t2);
    normalize(el);
    expect(el.children.length).toBe(1);
    expect(getTextContent(el)).toBe('hello world');
  });

  it('should not merge text nodes separated by elements', () => {
    const el = createMutableElement('div');
    const t1 = createMutableTextNode('a');
    const span = createMutableElement('span');
    const t2 = createMutableTextNode('b');
    appendChild(el, t1);
    appendChild(el, span);
    appendChild(el, t2);
    normalize(el);
    expect(el.children.length).toBe(3);
  });

  it('should recursively normalize nested elements', () => {
    const outer = createMutableElement('div');
    const inner = createMutableElement('span');
    appendChild(outer, inner);
    appendChild(inner, createMutableTextNode('x'));
    appendChild(inner, createMutableTextNode('y'));
    normalize(outer);
    expect(inner.children.length).toBe(1);
    expect(getTextContent(inner)).toBe('xy');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC cloneNode
// ─────────────────────────────────────────────────────────────────────────────

describe('cloneNode', () => {
  it('should clone elements (shallow)', () => {
    const el = createMutableElement('div', new Map([['id', 'test']]));
    const clone = cloneNode(el) as MutableElement;
    expect(clone.tagName).toBe('div');
    expect(clone.attributes.get('id')).toBe('test');
    expect(clone.children.length).toBe(0);
  });

  it('should clone elements (deep)', () => {
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    const text = createMutableTextNode('hello');
    appendChild(parent, child);
    appendChild(parent, text);
    const clone = cloneNode(parent, true) as MutableElement;
    expect(clone.children.length).toBe(2);
    expect(clone).not.toBe(parent);
    expect(clone.children[0]).not.toBe(child);
  });

  it('should clone text nodes', () => {
    const text = createMutableTextNode('hello');
    const clone = cloneNode(text) as MutableTextNode;
    expect(clone.text).toBe('hello');
    expect(clone).not.toBe(text);
  });

  it('should clone comment nodes', () => {
    const comment = createMutableComment('data');
    const clone = cloneNode(comment) as MutableComment;
    expect(clone.data).toBe('data');
    expect(clone).not.toBe(comment);
  });

  it('should clone doctype nodes', () => {
    const doctype = createMutableDoctype('html', 'public', 'system');
    const clone = cloneNode(doctype);
    expect(clone.nodeType).toBe(NodeType.Doctype);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT FRAGMENT + FACTORY METHODS
// ─────────────────────────────────────────────────────────────────────────────

describe('createDocumentFragment', () => {
  it('should create a fragment element', () => {
    const frag = createDocumentFragment();
    expect(frag.nodeType).toBe(NodeType.Element);
    expect(frag.tagName).toBe('');
    expect(frag.children.length).toBe(0);
  });
});

describe('createTextNode', () => {
  it('should create a text node', () => {
    const text = createTextNode('hello');
    expect(text.nodeType).toBe(NodeType.Text);
    expect(text.text).toBe('hello');
  });
});

describe('createComment', () => {
  it('should create a comment node', () => {
    const comment = createComment('data');
    expect(comment.nodeType).toBe(NodeType.Comment);
    expect(comment.data).toBe('data');
  });
});
