import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';

describe('DomTree', () => {
  const parser = new HtmlParser();
  const tree = new DomTree();

  it('should build a DomDocument from HtmlDocument', () => {
    const parseResult = parser.parse('<html><head></head><body><p>Hello</p></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    expect(doc.nodeType).toBe('document');
    expect(doc.htmlElement).not.toBeNull();
    expect(doc.headElement).not.toBeNull();
    expect(doc.bodyElement).not.toBeNull();
  });

  it('should create element nodes', () => {
    const parseResult = parser.parse('<html><body><div id="main"><span>text</span></div></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    expect(doc.bodyElement!.children.length).toBeGreaterThan(0);
    const div = doc.bodyElement!.children[0] as any;
    expect(div.tagName).toBe('div');
  });

  it('should create text nodes', () => {
    const parseResult = parser.parse('<html><body><p>hello world</p></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    const p = doc.bodyElement!.children[0] as any;
    expect(p.children.length).toBeGreaterThan(0);
    const textNode = p.children[0] as any;
    expect(textNode.nodeType).toBe('text');
    expect(textNode.text).toBe('hello world');
  });

  it('should index nodes by domId', () => {
    const parseResult = parser.parse('<html><body><p>Hello</p></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    const p = doc.bodyElement!.children[0] as any;
    const retrieved = tree.getNodeById(p.domId);
    expect(retrieved).not.toBeNull();
    expect(retrieved).toBe(p);
  });

  it('should index elements by id attribute', () => {
    const parseResult = parser.parse('<html><body><div id="main-content"></div></body></html>');
    tree.buildFromHtml(parseResult.document);
    const el = tree.getElementById('main-content');
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe('div');
  });

  it('getElementsByTagName should return matching elements', () => {
    const parseResult = parser.parse('<html><body><p>1</p><p>2</p></body></html>');
    tree.buildFromHtml(parseResult.document);
    const paragraphs = tree.getElementsByTagName('p');
    expect(paragraphs).toHaveLength(2);
  });

  it('appendChild should add a node and record mutation', () => {
    const parseResult = parser.parse('<html><body><div id="parent"></div></body></html>');
    tree.buildFromHtml(parseResult.document);
    const parent = tree.getElementById('parent')!;

    const newChild: any = {
      domId: 'test-new',
      nodeType: 'element',
      tagName: 'span',
      attributes: new Map(),
      parent: null,
      children: [],
      computedStyle: null,
      layoutBox: null,
    };

    tree.appendChild(parent, newChild);
    expect(parent.children).toHaveLength(1);
    expect(newChild.parent).toBe(parent);

    const mutations = tree.getMutations();
    expect(mutations.some(m => m.type === 'nodeInserted')).toBe(true);
  });

  it('removeChild should remove a node and record mutation', () => {
    const parseResult = parser.parse('<html><body><div id="parent"><p id="child">x</p></div></body></html>');
    tree.buildFromHtml(parseResult.document);
    const parent = tree.getElementById('parent')!;
    const child = tree.getElementById('child')!;

    tree.removeChild(parent, child);
    expect(parent.children).toHaveLength(0);
    expect(child.parent).toBeNull();

    const mutations = tree.getMutations();
    expect(mutations.some(m => m.type === 'nodeRemoved')).toBe(true);
  });

  it('setAttribute should update attributes and index by id', () => {
    const parseResult = parser.parse('<html><body><div></div></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    const div = doc.bodyElement!.children[0] as any;

    tree.setAttribute(div, 'id', 'new-id');
    expect(tree.getElementById('new-id')).toBe(div);
  });

  it('removeAttribute should delete from idIndex', () => {
    const parseResult = parser.parse('<html><body><div id="remove-me"></div></body></html>');
    tree.buildFromHtml(parseResult.document);
    const div = tree.getElementById('remove-me')!;

    tree.removeAttribute(div, 'id');
    expect(tree.getElementById('remove-me')).toBeNull();
  });

  it('setTextContent should record a textChanged mutation', () => {
    const parseResult = parser.parse('<html><body><p>old</p></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    const p = doc.bodyElement!.children[0] as any;
    const textNode = p.children[0] as any;

    tree.clearMutations();
    tree.setTextContent(textNode, 'new');
    const mutations = tree.getMutations();
    expect(mutations.some(m => m.type === 'textChanged')).toBe(true);
  });

  it('setComputedStyle should update style and emit mutation', () => {
    const parseResult = parser.parse('<html><body><p>text</p></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    const p = doc.bodyElement!.children[0] as any;

    tree.clearMutations();
    const style = new Map([['color', 'red']]);
    tree.setComputedStyle(p, style);
    expect(p.computedStyle!.get('color')).toBe('red');
    const mutations = tree.getMutations();
    expect(mutations.some(m => m.type === 'styleChanged')).toBe(true);
  });

  it('setLayoutBox should set layout info', () => {
    const parseResult = parser.parse('<html><body><p>text</p></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    const p = doc.bodyElement!.children[0] as any;

    const box = { x: 10, y: 20, width: 100, height: 50, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0 };
    tree.setLayoutBox(p, box);
    expect(p.layoutBox).toEqual(box);
  });

  it('getMutations should return a copy', () => {
    const parseResult = parser.parse('<html><body><p>text</p></body></html>');
    tree.buildFromHtml(parseResult.document);
    const mutations = tree.getMutations();
    expect(Array.isArray(mutations)).toBe(true);
  });

  it('clearMutations should empty the mutation list', () => {
    const parseResult = parser.parse('<html><body><p>text</p></body></html>');
    tree.buildFromHtml(parseResult.document);
    tree.clearMutations();
    expect(tree.getMutations()).toHaveLength(0);
  });

  it('getDocument should return the current document', () => {
    const parseResult = parser.parse('<html><body><p>text</p></body></html>');
    const doc = tree.buildFromHtml(parseResult.document);
    expect(tree.getDocument()).toBe(doc);
  });

  it('getDocument should return null after dispose', () => {
    const parseResult = parser.parse('<html><body><p>text</p></body></html>');
    tree.buildFromHtml(parseResult.document);
    tree.dispose();
    expect(tree.getDocument()).toBeNull();
  });

  it('dispose should clear all indices and mutations', () => {
    const parseResult = parser.parse('<html><body><div id="x"><p>a</p><p>b</p></div></body></html>');
    tree.buildFromHtml(parseResult.document);
    tree.dispose();
    expect(tree.getNodeById('any')).toBeNull();
    expect(tree.getElementById('x')).toBeNull();
    expect(tree.getElementsByTagName('p')).toHaveLength(0);
    expect(tree.getMutations()).toHaveLength(0);
  });

  it('insertBefore should add node at correct position', () => {
    const parseResult = parser.parse('<html><body><div id="parent"><p id="first">1</p><p id="second">2</p></div></body></html>');
    tree.buildFromHtml(parseResult.document);
    const parent = tree.getElementById('parent')!;
    const second = tree.getElementById('second')!;

    const newNode: any = {
      domId: 'inserted',
      nodeType: 'element',
      tagName: 'span',
      attributes: new Map(),
      parent: null,
      children: [],
      computedStyle: null,
      layoutBox: null,
    };

    tree.insertBefore(parent, newNode, second);
    expect(parent.children).toHaveLength(3);
    expect(parent.children[1]).toBe(newNode);
    expect(newNode.parent).toBe(parent);
  });

  it('insertBefore with null reference should append', () => {
    const parseResult = parser.parse('<html><body><div id="parent"><p>1</p></div></body></html>');
    tree.buildFromHtml(parseResult.document);
    const parent = tree.getElementById('parent')!;

    const newNode: any = {
      domId: 'last',
      nodeType: 'element',
      tagName: 'span',
      attributes: new Map(),
      parent: null,
      children: [],
      computedStyle: null,
      layoutBox: null,
    };

    tree.insertBefore(parent, newNode, null);
    expect(parent.children).toHaveLength(2);
    expect(parent.children[parent.children.length - 1]).toBe(newNode);
  });

  // ── querySelector / querySelectorAll ─────────────────────────────────────

  describe('querySelector', () => {
    it('should find element by tag name', () => {
      const parseResult = parser.parse('<html><body><div><p>Hello</p></div></body></html>');
      tree.buildFromHtml(parseResult.document);
      const p = tree.querySelector('p');
      expect(p).not.toBeNull();
      expect(p!.tagName).toBe('p');
    });

    it('should find element by ID', () => {
      const parseResult = parser.parse('<html><body><div id="target">Found</div></body></html>');
      tree.buildFromHtml(parseResult.document);
      const el = tree.querySelector('#target');
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('div');
    });

    it('should find element by class', () => {
      const parseResult = parser.parse('<html><body><span class="highlight">Text</span></body></html>');
      tree.buildFromHtml(parseResult.document);
      const el = tree.querySelector('.highlight');
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('span');
    });

    it('should find first matching element in document order', () => {
      const parseResult = parser.parse('<html><body><p>First</p><p>Second</p></body></html>');
      tree.buildFromHtml(parseResult.document);
      const p = tree.querySelector('p');
      expect(p).not.toBeNull();
      const text = p!.children.find(c => c.nodeType === 'text') as any;
      expect(text.text).toBe('First');
    });

    it('should find nested element with descendant combinator', () => {
      const parseResult = parser.parse('<html><body><div><span class="deep">Nested</span></div></body></html>');
      tree.buildFromHtml(parseResult.document);
      const el = tree.querySelector('div .deep');
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('span');
    });

    it('should find element with child combinator', () => {
      const parseResult = parser.parse('<html><body><div><p>Direct child</p></div></body></html>');
      tree.buildFromHtml(parseResult.document);
      const el = tree.querySelector('div > p');
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('p');
    });

    it('should not match non-existent elements', () => {
      const parseResult = parser.parse('<html><body><div>Content</div></body></html>');
      tree.buildFromHtml(parseResult.document);
      expect(tree.querySelector('table')).toBeNull();
    });

    it('should return null for empty document', () => {
      const parseResult = parser.parse('<html><head></head><body></body></html>');
      tree.buildFromHtml(parseResult.document);
      expect(tree.querySelector('div')).toBeNull();
    });

    it('should find element with attribute selector', () => {
      const parseResult = parser.parse('<html><body><a href="https://example.com">Link</a></body></html>');
      tree.buildFromHtml(parseResult.document);
      const el = tree.querySelector('a[href]');
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('a');
    });

    it('should find element with attribute value selector', () => {
      const parseResult = parser.parse('<html><body><a href="https://example.com">Link</a></body></html>');
      tree.buildFromHtml(parseResult.document);
      const el = tree.querySelector('[href="https://example.com"]');
      expect(el).not.toBeNull();
      expect(el!.tagName).toBe('a');
    });
  });

  describe('querySelectorAll', () => {
    it('should find all matching elements', () => {
      const parseResult = parser.parse('<html><body><p>1</p><p>2</p><p>3</p></body></html>');
      tree.buildFromHtml(parseResult.document);
      const all = tree.querySelectorAll('p');
      expect(all).toHaveLength(3);
    });

    it('should return empty array for no matches', () => {
      const parseResult = parser.parse('<html><body><div>Content</div></body></html>');
      tree.buildFromHtml(parseResult.document);
      const all = tree.querySelectorAll('table');
      expect(all).toHaveLength(0);
    });

    it('should find elements by class across subtree', () => {
      const parseResult = parser.parse('<html><body><div><span class="x">A</span></div><span class="x">B</span></body></html>');
      tree.buildFromHtml(parseResult.document);
      const all = tree.querySelectorAll('.x');
      expect(all).toHaveLength(2);
    });

    it('should find elements with descendant combinator', () => {
      const parseResult = parser.parse('<html><body><div><span>Deep</span></div><span>Shallow</span></body></html>');
      tree.buildFromHtml(parseResult.document);
      const all = tree.querySelectorAll('div span');
      expect(all).toHaveLength(1);
      expect(all[0].tagName).toBe('span');
    });

    it('should find elements with multiple class selectors', () => {
      const parseResult = parser.parse('<html><body><div class="a b">AB</div><div class="a">A</div><div class="b">B</div></body></html>');
      tree.buildFromHtml(parseResult.document);
      const all = tree.querySelectorAll('.a.b');
      expect(all).toHaveLength(1);
      expect(all[0].tagName).toBe('div');
    });
  });
});
