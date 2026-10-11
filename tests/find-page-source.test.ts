import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement, DomNode } from '../src/browser/rendering/dom-tree';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { FindInPage } from '../src/browser/navigation-controls/find-in-page';
import { createDomFindSource, collectBlocks } from '../src/browser/navigation-controls/find-page-source';

function laidOut(html: string): DomDocument {
  const tree = new DomTree();
  const doc = tree.buildFromHtml(new HtmlParser().parse(html).document);
  new LayoutEngine().layout(doc, tree, { viewportWidth: 800, viewportHeight: 600 });
  return doc;
}

describe('createDomFindSource (against the real layout engine)', () => {
  const doc = laidOut('<html><body><h1>Hello World</h1><p>Second paragraph here</p></body></html>');
  const find = new FindInPage(createDomFindSource(() => doc));

  it('exposes one block per laid-out box, in document order', () => {
    const blocks = collectBlocks(doc);
    const texts = blocks.map((b) => b.runs.map((r) => r.text).join(''));
    expect(texts).toEqual(['Hello World', 'Second paragraph here']);
  });

  it('finds phrases across the per-word runs and positions them on the page', () => {
    const r = find.find('hello world');
    expect(r.total).toBe(1);
    const rects = r.matches[0]!.rects;
    expect(rects).toHaveLength(3); // "Hello", the space, "World"
    expect(rects[0]!.x).toBeLessThan(rects[2]!.x);
    for (const rect of rects) {
      expect(rect.y).toBeCloseTo(0, 5); // first line box starts at the top of the page
      expect(rect.height).toBeCloseTo(16 * 1.2, 5);
      expect(rect.width).toBeGreaterThan(0);
    }
  });

  it('puts later blocks lower on the page', () => {
    const first = find.find('hello').matches[0]!.rects[0]!;
    const second = find.find('paragraph').matches[0]!.rects[0]!;
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('derives run widths from the gap to the next run, so adjacent highlights tile', () => {
    const rects = find.find('hello world').matches[0]!.rects;
    expect(rects[0]!.x + rects[0]!.width).toBeCloseTo(rects[1]!.x, 5);
    expect(rects[1]!.x + rects[1]!.width).toBeCloseTo(rects[2]!.x, 5);
  });

  it('re-reads the live document each time', () => {
    let current: DomDocument | null = laidOut('<html><body><p>alpha page</p></body></html>');
    const f = new FindInPage(createDomFindSource(() => current));
    expect(f.find('alpha').total).toBe(1);
    current = laidOut('<html><body><p>beta page</p></body></html>');
    expect(f.find('alpha').total).toBe(0);
    expect(f.find('beta').total).toBe(1);
    current = null;
    expect(f.find('beta').total).toBe(0);
  });
});

describe('collectBlocks', () => {
  const el = (tagName: string, children: DomNode[] = [], runs?: Array<{ text: string; x: number; y: number; fontSize: number }>): DomElement =>
    ({
      nodeType: 'element', tagName, attributes: new Map(), children, parent: null,
      layoutBox: runs ? { textRuns: runs.map((r) => ({ ...r, fontFamily: 'x', color: '#000' })) } : null,
    }) as unknown as DomElement;

  it('skips boxes without text and survives very deep trees', () => {
    let node: DomNode = el('p', [], [{ text: 'deep text', x: 0, y: 12.8, fontSize: 16 }]);
    for (let i = 0; i < 20_000; i++) node = el('div', [node]);
    const blocks = collectBlocks(node);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.runs[0]!.text).toBe('deep text');
  });

  it('estimates nothing for the last run on a line and measures the rest', () => {
    const root = el('p', [], [
      { text: 'ab', x: 0, y: 12.8, fontSize: 16 },
      { text: 'cd', x: 30, y: 12.8, fontSize: 16 },
      { text: 'ef', x: 5, y: 33.8, fontSize: 16 }, // next line: no width derived from the previous line
    ]);
    const [block] = collectBlocks(root);
    expect(block!.runs.map((r) => r.width)).toEqual([30, undefined, undefined]);
  });
});
