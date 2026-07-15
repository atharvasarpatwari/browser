import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement } from '../src/browser/rendering/dom-tree';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import {
  parseTrackList,
  resolveTrackBase,
  parseGridPlacement,
  parseGridTemplateAreas,
  findAreaPlacement,
  GridFormattingContext,
} from '../src/browser/rendering/formatting/grid-context';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildDoc(html: string): { doc: DomDocument; tree: DomTree } {
  const parser = new HtmlParser();
  const tree = new DomTree();
  const result = parser.parse(html);
  const doc = tree.buildFromHtml(result.document);
  return { doc, tree };
}

function applyStyles(tree: DomTree, el: DomElement, entries: Record<string, string>): void {
  const existing = new Map(el.computedStyle ?? []);
  for (const [k, v] of Object.entries(entries)) existing.set(k, v);
  tree.setComputedStyle(el, existing);
}

function makeGridDoc(
  containerStyles: Record<string, string>,
  childCount: number,
  childStyles?: Record<string, string>,
): { doc: DomDocument; tree: DomTree; engine: LayoutEngine } {
  const children = Array.from({ length: childCount }, (_, i) =>
    `<div id="c${i}"></div>`
  ).join('');
  const { doc, tree } = buildDoc(`<html><body><div id="grid">${children}</div></body></html>`);
  applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
  applyStyles(tree, tree.getElementById('grid')!, {
    display: 'grid',
    margin: '0',
    ...containerStyles,
  });
  for (let i = 0; i < childCount; i++) {
    applyStyles(tree, tree.getElementById(`c${i}`)!, {
      display: 'block',
      margin: '0',
      ...childStyles,
    });
  }
  const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
  engine.layout(doc, tree);
  return { doc, tree, engine };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACK LIST PARSING
// ─────────────────────────────────────────────────────────────────────────────

describe('Grid Track List Parsing', () => {
  it('should parse simple pixel track list', () => {
    const defs = parseTrackList('100px 200px 300px');
    expect(defs).toHaveLength(3);
    expect(defs[0]!.value).toBe('100px');
    expect(defs[1]!.value).toBe('200px');
    expect(defs[2]!.value).toBe('300px');
  });

  it('should parse fr units', () => {
    const defs = parseTrackList('1fr 2fr 1fr');
    expect(defs).toHaveLength(3);
    expect(defs[0]!.value).toBe('1fr');
    expect(defs[1]!.value).toBe('2fr');
    expect(defs[2]!.value).toBe('1fr');
  });

  it('should parse auto keyword', () => {
    const defs = parseTrackList('auto');
    expect(defs).toHaveLength(1);
    expect(defs[0]!.value).toBe('auto');
  });

  it('should parse mixed values', () => {
    const defs = parseTrackList('100px 1fr auto 2fr');
    expect(defs).toHaveLength(4);
  });

  it('should parse repeat()', () => {
    const defs = parseTrackList('repeat(3, 1fr)');
    expect(defs).toHaveLength(3);
    expect(defs[0]!.value).toBe('1fr');
    expect(defs[1]!.value).toBe('1fr');
    expect(defs[2]!.value).toBe('1fr');
  });

  it('should parse minmax()', () => {
    const defs = parseTrackList('minmax(100px, 1fr)');
    expect(defs).toHaveLength(1);
    expect(defs[0]!.type).toBe('minmax');
  });

  it('should return empty for none', () => {
    const defs = parseTrackList('none');
    expect(defs).toHaveLength(0);
  });

  it('should handle line names', () => {
    const defs = parseTrackList('[col-start] 100px [col-end] 200px');
    expect(defs).toHaveLength(2);
    expect(defs[0]!.value).toBe('100px');
    expect(defs[1]!.value).toBe('200px');
  });
});

describe('Grid Track Base Resolution', () => {
  it('should resolve px', () => {
    const r = resolveTrackBase('100px', 16, 500);
    expect(r.px).toBe(100);
    expect(r.isFr).toBe(false);
  });

  it('should resolve percentage', () => {
    const r = resolveTrackBase('50%', 16, 400);
    expect(r.px).toBe(200);
  });

  it('should resolve fr', () => {
    const r = resolveTrackBase('2fr', 16, 400);
    expect(r.isFr).toBe(true);
    expect(r.fr).toBe(2);
  });

  it('should resolve em', () => {
    const r = resolveTrackBase('2em', 16, 400);
    expect(r.px).toBe(32);
  });

  it('should resolve auto as 0', () => {
    const r = resolveTrackBase('auto', 16, 400);
    expect(r.px).toBe(0);
    expect(r.isFr).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLACEMENT PARSING
// ─────────────────────────────────────────────────────────────────────────────

describe('Grid Placement Parsing', () => {
  it('should parse single value', () => {
    const r = parseGridPlacement('2', false);
    expect(r.start).toBe(2);
    expect(r.end).toBe(3);
  });

  it('should parse start / end', () => {
    const r = parseGridPlacement('1 / 3', false);
    expect(r.start).toBe(1);
    expect(r.end).toBe(3);
  });

  it('should parse auto', () => {
    const r = parseGridPlacement('auto', false);
    expect(r.start).toBe(-1);
    expect(r.end).toBe(-1);
  });

  it('should parse area shorthand (4 values)', () => {
    const r = parseGridPlacement('1 / 2 / 3 / 4', true);
    expect(r.start).toBe(1);
    expect(r.end).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GRID TEMPLATE AREAS
// ─────────────────────────────────────────────────────────────────────────────

describe('Grid Template Areas', () => {
  it('should parse simple areas', () => {
    const areas = parseGridTemplateAreas('"a a b" "a a c"');
    expect(areas.rows).toHaveLength(2);
    expect(areas.columns).toBe(3);
    expect(areas.rows[0]).toEqual(['a', 'a', 'b']);
    expect(areas.rows[1]).toEqual(['a', 'a', 'c']);
  });

  it('should find area placement', () => {
    const areas = parseGridTemplateAreas('"header header" "sidebar main" "footer footer"');
    const p = findAreaPlacement('header', areas);
    expect(p).not.toBeNull();
    expect(p!.colStart).toBe(1);
    expect(p!.colEnd).toBe(3);
    expect(p!.rowStart).toBe(1);
    expect(p!.rowEnd).toBe(2);
  });

  it('should find 2x2 area', () => {
    const areas = parseGridTemplateAreas('"a a b" "a a c"');
    const p = findAreaPlacement('a', areas);
    expect(p).not.toBeNull();
    expect(p!.colStart).toBe(1);
    expect(p!.colEnd).toBe(3);
    expect(p!.rowStart).toBe(1);
    expect(p!.rowEnd).toBe(3);
  });

  it('should return null for non-existent area', () => {
    const areas = parseGridTemplateAreas('"a a b" "a a c"');
    expect(findAreaPlacement('z', areas)).toBeNull();
  });

  it('should parse none', () => {
    const areas = parseGridTemplateAreas('none');
    expect(areas.rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GRID FORMATTING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

describe('GridFormattingContext', () => {
  function makeEl(id: string, styles: Record<string, string>): DomElement {
    const parser = new HtmlParser();
    const tree = new DomTree();
    const result = parser.parse(`<html><body><div id="${id}"></div></body></html>`);
    const doc = tree.buildFromHtml(result.document);
    const el = tree.getElementById(id)!;
    applyStyles(tree, el, styles);
    return el;
  }

  it('should resolve basic 3-column grid', () => {
    const items = [
      makeEl('a', { 'grid-column': '1', 'grid-row': '1', width: '100px' }),
      makeEl('b', { 'grid-column': '2', 'grid-row': '1', width: '100px' }),
      makeEl('c', { 'grid-column': '3', 'grid-row': '1', width: '100px' }),
    ];
    const ctx = new GridFormattingContext({
      columns: ['100px', '100px', '100px'],
      rows: ['auto'],
      columnGap: 0,
      rowGap: 0,
      availableWidth: 600,
      availableHeight: null,
      fontSize: 16,
      justifyItems: 'start',
      alignItems: 'start',
    });
    for (const item of items) {
      ctx.addItem({
        element: item,
        placement: { columnStart: parseInt(item.computedStyle?.get('grid-column') ?? '1'), columnEnd: parseInt(item.computedStyle?.get('grid-column') ?? '1') + 1, rowStart: 1, rowEnd: 2, isAutoColumn: false, isAutoRow: false },
        colOffset: 0, rowOffset: 0, areaWidth: 0, areaHeight: 0,
        marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
        alignSelf: 'auto', justifySelf: 'auto', hasExplicitWidth: false, hasExplicitHeight: false,
      });
    }
    ctx.resolve();
    const resolved = ctx.getItems();
    expect(resolved[0]!.colOffset).toBe(0);
    expect(resolved[1]!.colOffset).toBe(100);
    expect(resolved[2]!.colOffset).toBe(200);
  });

  it('should resolve 1fr 2fr columns', () => {
    const items = [
      makeEl('a', { 'grid-column': '1', 'grid-row': '1' }),
      makeEl('b', { 'grid-column': '2', 'grid-row': '1' }),
    ];
    const ctx = new GridFormattingContext({
      columns: ['1fr', '2fr'],
      rows: ['auto'],
      columnGap: 0,
      rowGap: 0,
      availableWidth: 300,
      availableHeight: null,
      fontSize: 16,
      justifyItems: 'start',
      alignItems: 'start',
    });
    for (const item of items) {
      ctx.addItem({
        element: item,
        placement: { columnStart: parseInt(item.computedStyle?.get('grid-column') ?? '1'), columnEnd: parseInt(item.computedStyle?.get('grid-column') ?? '1') + 1, rowStart: 1, rowEnd: 2, isAutoColumn: false, isAutoRow: false },
        colOffset: 0, rowOffset: 0, areaWidth: 0, areaHeight: 0,
        marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
        alignSelf: 'auto', justifySelf: 'auto', hasExplicitWidth: false, hasExplicitHeight: false,
      });
    }
    ctx.resolve();
    const tracks = ctx.getColTracks();
    expect(tracks[0]!.size).toBe(100);
    expect(tracks[1]!.size).toBe(200);
  });

  it('should handle column-gap', () => {
    const items = [
      makeEl('a', { 'grid-column': '1', 'grid-row': '1' }),
      makeEl('b', { 'grid-column': '2', 'grid-row': '1' }),
    ];
    const ctx = new GridFormattingContext({
      columns: ['1fr', '1fr'],
      rows: ['auto'],
      columnGap: 20,
      rowGap: 0,
      availableWidth: 220,
      availableHeight: null,
      fontSize: 16,
      justifyItems: 'start',
      alignItems: 'start',
    });
    for (const item of items) {
      ctx.addItem({
        element: item,
        placement: { columnStart: parseInt(item.computedStyle?.get('grid-column') ?? '1'), columnEnd: parseInt(item.computedStyle?.get('grid-column') ?? '1') + 1, rowStart: 1, rowEnd: 2, isAutoColumn: false, isAutoRow: false },
        colOffset: 0, rowOffset: 0, areaWidth: 0, areaHeight: 0,
        marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
        alignSelf: 'auto', justifySelf: 'auto', hasExplicitWidth: false, hasExplicitHeight: false,
      });
    }
    ctx.resolve();
    const tracks = ctx.getColTracks();
    expect(tracks[0]!.size).toBe(100);
    expect(tracks[1]!.size).toBe(100);
    expect(ctx.getItems()[1]!.colOffset).toBe(120);
  });

  it('should handle row-gap', () => {
    const items = [
      makeEl('a', { 'grid-column': '1', 'grid-row': '1' }),
      makeEl('b', { 'grid-column': '1', 'grid-row': '2' }),
    ];
    const ctx = new GridFormattingContext({
      columns: ['100px'],
      rows: ['50px', '50px'],
      columnGap: 0,
      rowGap: 10,
      availableWidth: 300,
      availableHeight: null,
      fontSize: 16,
      justifyItems: 'start',
      alignItems: 'start',
    });
    for (const item of items) {
      ctx.addItem({
        element: item,
        placement: { columnStart: 1, columnEnd: 2, rowStart: parseInt(item.computedStyle?.get('grid-row') ?? '1'), rowEnd: parseInt(item.computedStyle?.get('grid-row') ?? '1') + 1, isAutoColumn: false, isAutoRow: false },
        colOffset: 0, rowOffset: 0, areaWidth: 0, areaHeight: 0,
        marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
        alignSelf: 'auto', justifySelf: 'auto', hasExplicitWidth: false, hasExplicitHeight: false,
      });
    }
    ctx.resolve();
    expect(ctx.getItems()[1]!.rowOffset).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: Layout Engine Grid Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Grid Layout Integration', () => {

  describe('basic grid layout', () => {
    it('should place two items in separate columns', () => {
      const { tree } = makeGridDoc(
        { 'grid-template-columns': '200px 200px' },
        2,
        { width: '100', height: '50' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      expect(c0.x).toBe(0);
      expect(c1.x).toBe(200);
    });

    it('should place items in a row', () => {
      const { tree } = makeGridDoc(
        { 'grid-template-columns': '100px 100px 100px' },
        3,
        { width: '50', height: '50' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      const c2 = tree.getElementById('c2')!.layoutBox!;
      expect(c0.x).toBe(0);
      expect(c1.x).toBe(100);
      expect(c2.x).toBe(200);
      expect(c0.y).toBe(c1.y);
      expect(c1.y).toBe(c2.y);
    });

    it('should handle empty grid', () => {
      const { doc, tree } = buildDoc('<html><body><div id="grid"></div></body></html>');
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const box = tree.getElementById('grid')!.layoutBox!;
      expect(box.height).toBe(0);
    });
  });

  describe('explicit placement', () => {
    it('should place items in specific columns', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px 100px 100px',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0', 'grid-column': '1', 'grid-row': '1' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0', 'grid-column': '3', 'grid-row': '1' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      expect(a.x).toBe(0);
      expect(b.x).toBe(200);
    });

    it('should place items in specific rows', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px',
        'grid-template-rows': '50px 50px',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0', 'grid-column': '1', 'grid-row': '1' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0', 'grid-column': '1', 'grid-row': '2' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      expect(a.y).toBe(0);
      expect(b.y).toBe(50);
    });
  });

  describe('fr units', () => {
    it('should distribute space proportionally with fr', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '1fr 2fr',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 600, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      expect(a.x).toBe(0);
      expect(a.width).toBe(200);
      expect(b.x).toBe(200);
      expect(b.width).toBe(400);
    });
  });

  describe('gaps', () => {
    it('should apply column-gap', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px 100px',
        'column-gap': '20',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      expect(a.x).toBe(0);
      expect(b.x).toBe(120);
    });

    it('should apply row-gap', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px',
        'grid-template-rows': '50px 50px',
        'row-gap': '15',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0', 'grid-column': '1', 'grid-row': '1' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0', 'grid-column': '1', 'grid-row': '2' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      expect(a.y).toBe(0);
      expect(b.y).toBe(65);
    });

    it('should apply gap shorthand', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px 100px',
        gap: '10',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const b = tree.getElementById('b')!.layoutBox!;
      expect(b.x).toBe(110);
    });
  });

  describe('auto placement', () => {
    it('should auto-place items left to right, top to bottom', () => {
      const { tree } = makeGridDoc(
        { 'grid-template-columns': '100px 100px' },
        4,
        { width: '80', height: '40' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      const c2 = tree.getElementById('c2')!.layoutBox!;
      const c3 = tree.getElementById('c3')!.layoutBox!;
      expect(c0.x).toBe(0);  expect(c0.y).toBe(0);
      expect(c1.x).toBe(100); expect(c1.y).toBe(0);
      expect(c2.x).toBe(0);  expect(c2.y).toBe(40);
      expect(c3.x).toBe(100); expect(c3.y).toBe(40);
    });

    it('should auto-wrap to next row when columns exhausted', () => {
      const { tree } = makeGridDoc(
        { 'grid-template-columns': '100px' },
        3,
        { width: '80', height: '30' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c1 = tree.getElementById('c1')!.layoutBox!;
      const c2 = tree.getElementById('c2')!.layoutBox!;
      expect(c0.y).toBe(0);
      expect(c1.y).toBe(30);
      expect(c2.y).toBe(60);
    });
  });

  describe('grid-template-areas', () => {
    it('should layout items using named areas', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="header"></div><div id="sidebar"></div><div id="main"></div><div id="footer"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px 200px',
        'grid-template-rows': '40px 100px 40px',
        'grid-template-areas': '"header header" "sidebar main" "footer footer"',
      });
      applyStyles(tree, tree.getElementById('header')!, { display: 'block', margin: '0', 'grid-area': 'header' });
      applyStyles(tree, tree.getElementById('sidebar')!, { display: 'block', margin: '0', 'grid-area': 'sidebar' });
      applyStyles(tree, tree.getElementById('main')!, { display: 'block', margin: '0', 'grid-area': 'main' });
      applyStyles(tree, tree.getElementById('footer')!, { display: 'block', margin: '0', 'grid-area': 'footer' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const header = tree.getElementById('header')!.layoutBox!;
      const sidebar = tree.getElementById('sidebar')!.layoutBox!;
      const main = tree.getElementById('main')!.layoutBox!;
      const footer = tree.getElementById('footer')!.layoutBox!;
      // Header spans full width
      expect(header.x).toBe(0);
      expect(header.width).toBe(300);
      // Sidebar in col 1
      expect(sidebar.x).toBe(0);
      expect(sidebar.y).toBe(40);
      // Main in col 2
      expect(main.x).toBe(100);
      expect(main.y).toBe(40);
      // Footer below both
      expect(footer.x).toBe(0);
      expect(footer.y).toBe(140);
    });
  });

  describe('align-items and justify-items', () => {
    it('should stretch items by default', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px',
        'grid-template-rows': '100px',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      expect(a.width).toBe(100);
      expect(a.height).toBe(100);
    });
  });

  describe('mixed sizing', () => {
    it('should mix fr and px tracks', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div><div id="c"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px 1fr 1fr',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('c')!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 500, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      const c = tree.getElementById('c')!.layoutBox!;
      expect(a.width).toBe(100);
      expect(b.width).toBe(200);
      expect(c.width).toBe(200);
    });
  });

  describe('repeat()', () => {
    it('should expand repeat(4, 1fr) into 4 columns', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div><div id="c"></div><div id="d"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': 'repeat(4, 1fr)',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('c')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('d')!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 400, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      const c = tree.getElementById('c')!.layoutBox!;
      const d = tree.getElementById('d')!.layoutBox!;
      expect(a.x).toBe(0);
      expect(b.x).toBe(100);
      expect(c.x).toBe(200);
      expect(d.x).toBe(300);
      expect(a.width).toBe(100);
    });
  });

  describe('spans', () => {
    it('should handle column span', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px 100px 100px',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0', 'grid-column': '1 / 3' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0', 'grid-column': '3' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      expect(a.x).toBe(0);
      expect(a.width).toBe(200);
      expect(b.x).toBe(200);
    });

    it('should handle row span', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px',
        'grid-template-rows': '50px 50px',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0', 'grid-row': '1 / 3' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0', 'grid-column': '1', 'grid-row': '1' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      expect(a.height).toBe(100);
    });
  });

  describe('margins', () => {
    it('should respect item margins', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '100px 100px',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0', 'margin-left': '10' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0', 'margin-left': '20' });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      expect(a.x).toBe(10);
      expect(b.x).toBe(120);
    });
  });

  describe('percentage sizing', () => {
    it('should resolve percentage column widths', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div><div id="b"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '25% 75%',
      });
      applyStyles(tree, tree.getElementById('a')!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('b')!, { display: 'block', margin: '0' });
      const engine = new LayoutEngine({ viewportWidth: 400, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      const b = tree.getElementById('b')!.layoutBox!;
      expect(a.x).toBe(0);
      expect(a.width).toBe(100);
      expect(b.x).toBe(100);
      expect(b.width).toBe(300);
    });
  });

  describe('implicit rows', () => {
    it('should create implicit rows for auto-placed items', () => {
      const { tree } = makeGridDoc(
        { 'grid-template-columns': '100px' },
        5,
        { width: '80', height: '30' },
      );
      const c0 = tree.getElementById('c0')!.layoutBox!;
      const c4 = tree.getElementById('c4')!.layoutBox!;
      expect(c0.y).toBe(0);
      expect(c4.y).toBe(120);
    });
  });

  describe('grid with body element', () => {
    it('should work with display: grid on a div', () => {
      const { tree } = makeGridDoc(
        { 'grid-template-columns': '1fr 1fr 1fr', 'grid-template-rows': '80px' },
        3,
        { width: '100', height: '60' },
      );
      const grid = tree.getElementById('grid')!.layoutBox!;
      expect(grid.width).toBe(1000);
      expect(grid.height).toBe(80);
    });
  });

  describe('justify-self and align-self', () => {
    it('should center an item with justify-self: center', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '200px',
        'grid-template-rows': '100px',
      });
      applyStyles(tree, tree.getElementById('a')!, {
        display: 'block', margin: '0',
        width: '50',
        'justify-self': 'center',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      expect(a.x).toBe(75);
    });

    it('should end-align an item with justify-self: end', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '200px',
        'grid-template-rows': '100px',
      });
      applyStyles(tree, tree.getElementById('a')!, {
        display: 'block', margin: '0',
        width: '50',
        'justify-self': 'end',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      expect(a.x).toBe(150);
    });

    it('should center vertically with align-self: center', () => {
      const { doc, tree } = buildDoc(
        '<html><body><div id="grid"><div id="a"></div></div></body></html>'
      );
      applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
      applyStyles(tree, tree.getElementById('grid')!, {
        display: 'grid',
        margin: '0',
        'grid-template-columns': '200px',
        'grid-template-rows': '100px',
      });
      applyStyles(tree, tree.getElementById('a')!, {
        display: 'block', margin: '0',
        height: '30',
        'align-self': 'center',
      });
      const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
      engine.layout(doc, tree);
      const a = tree.getElementById('a')!.layoutBox!;
      expect(a.y).toBe(35);
    });
  });
});
