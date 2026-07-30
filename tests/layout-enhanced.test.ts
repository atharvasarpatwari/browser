import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement, LayoutBox } from '../src/browser/rendering/dom-tree';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { classifyDisplay } from '../src/browser/rendering/formatting/types';
import { TableFormattingContext, generateAnonymousTableBoxes, classifyTableChild } from '../src/browser/rendering/formatting/table-context';
import { MultiColumnFormattingContext } from '../src/browser/rendering/formatting/multi-column-context';
import { getInitialValue, isInheritedProperty } from '../src/browser/rendering/css5/property-definitions';

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

// ─────────────────────────────────────────────────────────────────────────────
// ASPECT-RATIO PROPERTY
// ─────────────────────────────────────────────────────────────────────────────

describe('aspect-ratio', () => {
  it('should compute height from width when aspect-ratio is set', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    applyStyles(tree, tree.getElementById('d')!, {
      'aspect-ratio': '16/9',
      width: '320px',
      margin: '0',
    });
    const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const box = tree.getElementById('d')!.layoutBox!;
    expect(box.width).toBe(320);
    expect(box.height).toBe(180);
  });

  it('should compute width from height when aspect-ratio is set', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    applyStyles(tree, tree.getElementById('d')!, {
      'aspect-ratio': '4/3',
      height: '150px',
      margin: '0',
    });
    const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const box = tree.getElementById('d')!.layoutBox!;
    expect(box.height).toBe(150);
    expect(box.width).toBe(200);
  });

  it('should not affect layout when aspect-ratio is auto', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    applyStyles(tree, tree.getElementById('d')!, {
      display: 'block',
      'aspect-ratio': 'auto',
      width: '200px',
      margin: '0',
      padding: '0',
    });
    const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const box = tree.getElementById('d')!.layoutBox!;
    expect(box.width).toBe(200);
    expect(box.height).toBe(0);
  });

  it('should handle single-number aspect-ratio', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    applyStyles(tree, tree.getElementById('d')!, {
      'aspect-ratio': '2',
      width: '100px',
      margin: '0',
    });
    const engine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const box = tree.getElementById('d')!.layoutBox!;
    expect(box.width).toBe(100);
    expect(box.height).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TABLE FORMATTING CONTEXT — UNIT TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyTableChild', () => {
  it('should classify table display values', () => {
    expect(classifyTableChild('table-caption')).toBe('caption');
    expect(classifyTableChild('table-column-group')).toBe('col-group');
    expect(classifyTableChild('table-column')).toBe('col');
    expect(classifyTableChild('table-row-group')).toBe('row-group');
    expect(classifyTableChild('table-header-group')).toBe('row-group');
    expect(classifyTableChild('table-footer-group')).toBe('row-group');
    expect(classifyTableChild('table-row')).toBe('row');
    expect(classifyTableChild('table-cell')).toBe('cell');
    expect(classifyTableChild('block')).toBeNull();
    expect(classifyTableChild('inline')).toBeNull();
  });
});

describe('generateAnonymousTableBoxes', () => {
  function makeCell(id: string): DomElement {
    return {
      domId: id,
      nodeType: 'element',
      tagName: 'td',
      attributes: new Map(),
      computedStyle: new Map([['display', 'table-cell']]),
      layoutBox: null,
      imageData: null,
      naturalWidth: 0, naturalHeight: 0,
      loadingState: 'none',
      parent: null, children: [],
      _dirtyLayout: true, _dirtyPaint: true,
      willChange: null,
    };
  }

  function makeRow(id: string): DomElement {
    return {
      domId: id,
      nodeType: 'element',
      tagName: 'tr',
      attributes: new Map(),
      computedStyle: new Map([['display', 'table-row']]),
      layoutBox: null,
      imageData: null,
      naturalWidth: 0, naturalHeight: 0,
      loadingState: 'none',
      parent: null, children: [],
      _dirtyLayout: true, _dirtyPaint: true,
      willChange: null,
    };
  }

  function makeRowGroup(id: string): DomElement {
    return {
      domId: id,
      nodeType: 'element',
      tagName: 'tbody',
      attributes: new Map(),
      computedStyle: new Map([['display', 'table-row-group']]),
      layoutBox: null,
      imageData: null,
      naturalWidth: 0, naturalHeight: 0,
      loadingState: 'none',
      parent: null, children: [],
      _dirtyLayout: true, _dirtyPaint: true,
      willChange: null,
    };
  }

  it('should wrap bare cells in anonymous row and row-group', () => {
    const cells = [makeCell('c1'), makeCell('c2')];
    const result = generateAnonymousTableBoxes(cells);
    expect(result.length).toBe(1);
    const group = result[0] as DomElement;
    expect(group.computedStyle?.get('display')).toBe('table-row-group');
    expect(group.children.length).toBe(1);
    const row = group.children[0] as DomElement;
    expect(row.computedStyle?.get('display')).toBe('table-row');
    expect(row.children.length).toBe(2);
  });

  it('should keep existing row groups', () => {
    const group = makeRowGroup('g1');
    const row = makeRow('r1');
    group.children.push(row);
    const result = generateAnonymousTableBoxes([group]);
    expect(result.length).toBe(1);
    expect(result[0] as DomElement).toBe(group);
  });

  it('should wrap bare rows in anonymous row-group', () => {
    const row = makeRow('r1');
    const result = generateAnonymousTableBoxes([row]);
    expect(result.length).toBe(1);
    const group = result[0] as DomElement;
    expect(group.computedStyle?.get('display')).toBe('table-row-group');
    expect(group.children.length).toBe(1);
    expect(group.children[0] as DomElement).toBe(row);
  });
});

function makeCellWithStyle(id: string, style: Record<string, string>): DomElement {
  return {
    domId: id,
    nodeType: 'element',
    tagName: 'td',
    attributes: new Map(),
    computedStyle: new Map(Object.entries(style)),
    layoutBox: null,
    imageData: null,
    naturalWidth: 0, naturalHeight: 0,
    loadingState: 'none',
    parent: null, children: [],
    _dirtyLayout: true, _dirtyPaint: true,
    willChange: null,
  };
}

describe('TableFormattingContext', () => {
  it('should compute column widths', () => {
    const ctx = new TableFormattingContext({
      tableLayout: 'auto',
      borderCollapse: 'separate',
      borderSpacing: 0,
      captionSide: 'top',
      availableWidth: 500,
      fontSize: 16,
    });
    const cell1 = makeCellWithStyle('c1', { width: '100px' });
    const cell2 = makeCellWithStyle('c2', { width: '150px' });
    ctx.addRow([
      { element: cell1, row: 0, col: 0, rowspan: 1, colspan: 1, box: null as never, contentWidth: 0, contentHeight: 0 },
      { element: cell2, row: 0, col: 1, rowspan: 1, colspan: 1, box: null as never, contentWidth: 0, contentHeight: 0 },
    ]);
    ctx.resolve((v, f) => { const n = parseFloat(v); return isFinite(n) ? n : 0; });
    expect(ctx.getColumns().length).toBe(2);
    ctx.getColumns().forEach(c => expect(c.finalWidth).toBeGreaterThan(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TABLE LAYOUT — INTEGRATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyDisplay table', () => {
  it('should return table for table display', () => {
    expect(classifyDisplay('table')).toBe('table');
  });
});

describe('table layout integration', () => {
  it('should layout a simple table', () => {
    const { doc, tree } = buildDoc('<html><body><table id="t"><tr><td>A</td><td>B</td></tr></table></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    const tr = tree.getElementById('t')!.children.find(c => c.nodeType === 'element') as DomElement;
    if (tr) applyStyles(tree, tr, { display: 'table-row' });
    const tds = tr?.children.filter(c => c.nodeType === 'element') as DomElement[] ?? [];
    tds.forEach(td => applyStyles(tree, td, { display: 'table-cell' }));
    const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const tableEl = tree.getElementById('t')!;
    expect(tableEl.layoutBox).not.toBeNull();
    const tableBox = tableEl.layoutBox!;
    expect([tableBox.x, tableBox.y]).toEqual([0, 0]);
    expect(tableBox.width).toBeGreaterThan(0);
    expect(tableBox.height).toBeGreaterThan(0);
    const trEl = tableEl.children.find(c => c.nodeType === 'element') as DomElement;
    if (trEl) {
      for (const td of trEl.children) {
        const cellEl = td as DomElement;
        expect(cellEl.layoutBox).not.toBeNull();
      }
    }
  });

  it('should compute table width within available width', () => {
    const { doc, tree } = buildDoc('<html><body><table id="t"><tr><td>A</td></tr></table></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    const tbl = tree.getElementById('t')!;
    applyStyles(tree, tbl, { display: 'table', margin: '0', width: '400px' });
    const tr = tbl.children.find(c => c.nodeType === 'element') as DomElement;
    if (tr) applyStyles(tree, tr, { display: 'table-row' });
    const td = (tr?.children.find(c => c.nodeType === 'element') ?? null) as DomElement | null;
    if (td) applyStyles(tree, td, { display: 'table-cell' });
    const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const box = tree.getElementById('t')!.layoutBox!;
    expect(box.width).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-COLUMN FORMATTING CONTEXT — UNIT TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('MultiColumnFormattingContext', () => {
  it('should create balanced columns from content height', () => {
    const ctx = new MultiColumnFormattingContext({
      columnCount: 3,
      columnWidth: 0,
      columnGap: 20,
      columnRuleWidth: 0,
      columnRuleStyle: 'none',
      columnRuleColor: 'transparent',
      availableWidth: 600,
      availableHeight: null,
      fontSize: 16,
    });
    ctx.resolve(300);
    const cols = ctx.getColumns();
    expect(cols.length).toBe(3);
    cols.forEach(c => expect(c.width).toBeGreaterThan(0));
    expect(cols[1].x).toBeGreaterThan(cols[0].x);
  });

  it('should use explicit column-width when set', () => {
    const ctx = new MultiColumnFormattingContext({
      columnCount: 0,
      columnWidth: 150,
      columnGap: 10,
      columnRuleWidth: 0,
      columnRuleStyle: 'none',
      columnRuleColor: 'transparent',
      availableWidth: 500,
      availableHeight: null,
      fontSize: 16,
    });
    ctx.resolve(200);
    const cols = ctx.getColumns();
    expect(cols.length).toBeGreaterThanOrEqual(3);
    cols.forEach(c => expect(c.width).toBeCloseTo(150, 0));
  });

  it('should use explicit column-count when column-width is not set', () => {
    const ctx = new MultiColumnFormattingContext({
      columnCount: 4,
      columnWidth: 0,
      columnGap: 10,
      columnRuleWidth: 0,
      columnRuleStyle: 'none',
      columnRuleColor: 'transparent',
      availableWidth: 500,
      availableHeight: null,
      fontSize: 16,
    });
    ctx.resolve(200);
    const cols = ctx.getColumns();
    expect(cols.length).toBe(4);
  });

  it('should calculate total height', () => {
    const ctx = new MultiColumnFormattingContext({
      columnCount: 2,
      columnWidth: 0,
      columnGap: 0,
      columnRuleWidth: 0,
      columnRuleStyle: 'none',
      columnRuleColor: 'transparent',
      availableWidth: 400,
      availableHeight: null,
      fontSize: 16,
    });
    ctx.resolve(200);
    expect(ctx.getTotalHeight()).toBeGreaterThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-COLUMN LAYOUT — INTEGRATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('multi-column layout integration', () => {
  it('should apply column-count property and adjust box height', () => {
    const { doc, tree } = buildDoc('<html><body><div id="mc">text</div></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    applyStyles(tree, tree.getElementById('mc')!, {
      'column-count': '3',
      'column-gap': '20px',
    });
    const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const box = tree.getElementById('mc')!.layoutBox!;
    expect(box.width).toBe(800);
    expect(box.height).toBeGreaterThan(0);
  });

  it('should create multi-column context accessible via engine', () => {
    const { doc, tree } = buildDoc('<html><body><div id="mc">content</div></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    applyStyles(tree, tree.getElementById('mc')!, {
      'column-count': '2',
      'column-gap': '10px',
    });
    const engine = new LayoutEngine({ viewportWidth: 600, viewportHeight: 400, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const mcCtx = engine.getMultiColumnContext(tree.getElementById('mc')!.domId);
    expect(mcCtx).toBeDefined();
    expect(mcCtx!.getColumnCount()).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OVERFLOW / SCROLLABLE CONTAINERS
// ─────────────────────────────────────────────────────────────────────────────

describe('overflow scrollable containers', () => {
  it('should create scroll container when overflow is scroll', () => {
    const { doc, tree } = buildDoc('<html><body><div id="s"></div></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    applyStyles(tree, tree.getElementById('s')!, {
      overflow: 'scroll',
      width: '100px',
      height: '100px',
      margin: '0',
    });
    const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    engine.layout(doc, tree);
    const containers = engine.getScrollContainers();
    expect(containers.size).toBeGreaterThanOrEqual(1);
  });

  it('should not create scroll container when overflow is visible', () => {
    const { doc, tree } = buildDoc('<html><body><div id="s"></div></body></html>');
    applyStyles(tree, doc.bodyElement!, { display: 'block', margin: '0' });
    applyStyles(tree, tree.getElementById('s')!, {
      overflow: 'visible',
      width: '100px',
      height: '100px',
      margin: '0',
    });
    const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    engine.layout(doc, tree);
    expect(engine.getScrollContainers().size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MIXED FEATURES — PROPERTY DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('property definitions', () => {
  it('should define aspect-ratio property', () => {
    expect(getInitialValue('aspect-ratio')).toBe('auto');
    expect(isInheritedProperty('aspect-ratio')).toBe(false);
  });

  it('should define multi-column properties', () => {
    expect(getInitialValue('column-count')).toBe('auto');
    expect(getInitialValue('column-width')).toBe('auto');
    expect(getInitialValue('column-gap')).toBe('normal');
    expect(getInitialValue('column-rule-width')).toBe('medium');
    expect(getInitialValue('column-rule-style')).toBe('none');
    expect(getInitialValue('column-rule-color')).toBe('currentcolor');
    expect(getInitialValue('column-fill')).toBe('balance');
    expect(getInitialValue('column-span')).toBe('none');
  });
});
