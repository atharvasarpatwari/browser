import type { DomElement, DomNode, LayoutBox } from '../dom-tree';

export interface TableCell {
  element: DomElement;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  box: LayoutBox;
  contentWidth: number;
  contentHeight: number;
}

export interface TableRow {
  cells: TableCell[];
  height: number;
}

export interface ResolvedColumn {
  minWidth: number;
  maxWidth: number;
  finalWidth: number;
}

export type TableLayoutType = 'auto' | 'fixed';

export interface TableFormattingContextOptions {
  tableLayout: TableLayoutType;
  borderCollapse: 'separate' | 'collapse';
  borderSpacing: number;
  captionSide: 'top' | 'bottom';
  availableWidth: number;
  fontSize: number;
}

export function classifyTableChild(display: string): 'caption' | 'col-group' | 'col' | 'row-group' | 'row' | 'cell' | null {
  switch (display) {
    case 'table-caption': return 'caption';
    case 'table-column-group': return 'col-group';
    case 'table-column': return 'col';
    case 'table-row-group':
    case 'table-header-group':
    case 'table-footer-group': return 'row-group';
    case 'table-row': return 'row';
    case 'table-cell': return 'cell';
    default: return null;
  }
}

export function generateAnonymousTableBoxes(children: DomNode[]): DomNode[] {
  const result: DomNode[] = [];
  let lastRowGroup: DomElement | null = null;
  let lastRow: DomElement | null = null;
  let i = 0;

  function ensureRow(): DomElement {
    if (lastRow) return lastRow;
    const row = createAnonymousElement('table-row', 'anon-row-' + i);
    if (!lastRowGroup) {
      lastRowGroup = createAnonymousElement('table-row-group', 'anon-group-' + i);
      result.push(lastRowGroup);
    }
    lastRowGroup.children.push(row);
    lastRow = row;
    return row;
  }

  while (i < children.length) {
    const node = children[i];
    if (node.nodeType === 'text') {
      i++;
      continue;
    }
    if (node.nodeType !== 'element') { i++; continue; }
    const el = node as DomElement;
    const display = el.computedStyle?.get('display') ?? 'inline';
    const role = classifyTableChild(display);

    if (role === 'caption' || role === 'col-group' || role === 'col') {
      lastRowGroup = null;
      lastRow = null;
      result.push(node);
    } else if (role === 'row-group') {
      lastRowGroup = el;
      lastRow = null;
      result.push(node);
    } else if (role === 'row') {
      lastRow = el;
      if (!lastRowGroup) {
        lastRowGroup = createAnonymousElement('table-row-group', 'anon-group-' + i);
        result.push(lastRowGroup);
      }
      lastRowGroup.children.push(node);
    } else if (role === 'cell') {
      const row = ensureRow();
      row.children.push(node);
    } else {
      const row = ensureRow();
      row.children.push(node);
    }
    i++;
  }
  return result;
}

function createAnonymousElement(tagName: string, domId: string): DomElement {
  const style = new Map<string, string>();
  style.set('display', tagName === 'table-row-group' ? 'table-row-group'
    : tagName === 'table-row' ? 'table-row'
    : tagName === 'table-cell' ? 'table-cell'
    : 'inline');
  return {
    domId,
    nodeType: 'element',
    tagName,
    attributes: new Map(),
    computedStyle: style,
    usedStyle: null,
    layoutBox: null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    parent: null,
    children: [],
    _dirtyStyle: true,
    _dirtyLayout: true,
    _dirtyPaint: true,
    willChange: null,
  };
}

export class TableFormattingContext {
  private options: TableFormattingContextOptions;
  private rows: TableRow[] = [];
  private columns: ResolvedColumn[] = [];
  private captions: DomElement[] = [];
  private totalWidth = 0;
  private totalHeight = 0;

  constructor(options: TableFormattingContextOptions) {
    this.options = options;
  }

  addCaptions(elements: DomElement[]): void {
    this.captions.push(...elements);
  }

  addRow(cells: TableCell[]): void {
    this.rows.push({ cells, height: 0 });
    for (const cell of cells) {
      while (this.columns.length < cell.col + cell.colspan) {
        this.columns.push({ minWidth: 0, maxWidth: Infinity, finalWidth: 0 });
      }
    }
  }

  getRows(): readonly TableRow[] {
    return this.rows;
  }

  getColumns(): readonly ResolvedColumn[] {
    return this.columns;
  }

  getCaptions(): readonly DomElement[] {
    return this.captions;
  }

  resolve(
    resolveLength: (value: string, fallback: string) => number,
  ): void {
    if (this.rows.length === 0) return;

    const colCount = this.columns.length;
    if (colCount === 0) return;

    for (let c = 0; c < colCount; c++) {
      this.columns[c] = { minWidth: 0, maxWidth: 0, finalWidth: 0 };
    }

    for (const row of this.rows) {
      for (const cell of row.cells) {
        const cellStyle = cell.element.computedStyle ?? new Map();
        const rawW = cellStyle.get('width');
        let cellMin = 0;
        let cellMax = 0;
        if (rawW && rawW !== 'auto') {
          cellMin = resolveLength(rawW, '0');
          cellMax = cellMin;
        } else {
          cellMin = 40;
          cellMax = this.options.availableWidth;
        }
        const col = cell.col;
        const span = cell.colspan;
        if (span <= 1) {
          this.columns[col].minWidth = Math.max(this.columns[col].minWidth, cellMin);
          this.columns[col].maxWidth = Math.max(this.columns[col].maxWidth, cellMax);
        } else {
          const perCol = cellMin / span;
          for (let s = 0; s < span && col + s < colCount; s++) {
            this.columns[col + s].minWidth = Math.max(this.columns[col + s].minWidth, perCol);
          }
        }
      }
    }

    const spacing = this.options.borderCollapse === 'separate' ? this.options.borderSpacing : 0;
    const totalSpacing = spacing * (colCount + 1);
    const availForCols = Math.max(0, this.options.availableWidth - totalSpacing);
    const totalMin = this.columns.reduce((s, c) => s + c.minWidth, 0);
    const totalMax = this.columns.reduce((s, c) => s + c.maxWidth, 0);

    if (this.options.tableLayout === 'fixed') {
      const fixedAvail = Math.max(0, this.options.availableWidth);
      for (const col of this.columns) {
        col.finalWidth = col.minWidth;
      }
      const used = this.columns.reduce((s, c) => s + c.finalWidth, 0);
      const remaining = Math.max(0, fixedAvail - used - totalSpacing);
      if (remaining > 0) {
        const equalShare = remaining / colCount;
        for (const col of this.columns) {
          col.finalWidth += equalShare;
        }
      }
    } else {
      if (totalMin >= availForCols) {
        for (const col of this.columns) {
          col.finalWidth = col.minWidth;
        }
      } else {
        const excess = availForCols - totalMin;
        const distributable = this.columns.filter(c => c.maxWidth > c.minWidth);
        if (distributable.length === 0) {
          const equalShare = excess / colCount;
          for (const col of this.columns) {
            col.finalWidth = col.minWidth + equalShare;
          }
        } else {
          const distributableMax = distributable.reduce((s, c) => s + (c.maxWidth - c.minWidth), 0);
          for (const col of this.columns) {
            if (col.maxWidth > col.minWidth) {
              const ratio = (col.maxWidth - col.minWidth) / distributableMax;
              col.finalWidth = col.minWidth + excess * ratio;
            } else {
              col.finalWidth = col.minWidth;
            }
          }
        }
      }
    }

    this.totalWidth = this.columns.reduce((s, c) => s + c.finalWidth, 0) + totalSpacing;

    for (const row of this.rows) {
      let rowHeight = 0;
      for (const cell of row.cells) {
        const cellStyle = cell.element.computedStyle ?? new Map();
        let cellW = 0;
        for (let s = 0; s < cell.colspan && cell.col + s < colCount; s++) {
          cellW += this.columns[cell.col + s].finalWidth;
        }
        cellW += spacing * (cell.colspan - 1);
        cell.contentWidth = Math.max(0, cellW);
        const rawH = cellStyle.get('height');
        if (rawH && rawH !== 'auto') {
          cell.contentHeight = resolveLength(rawH, '0');
        } else {
          cell.contentHeight = 20;
        }
        rowHeight = Math.max(rowHeight, cell.contentHeight);
      }
      row.height = rowHeight;
      this.totalHeight += rowHeight + spacing;
    }
  }

  layoutCells(
    contentX: number,
    contentY: number,
    layoutCell: (cell: DomElement, x: number, y: number, w: number, h: number) => void,
  ): void {
    const spacing = this.options.borderCollapse === 'separate' ? this.options.borderSpacing : 0;
    let y = contentY;
    if (this.options.captionSide === 'top') {
      for (const cap of this.captions) {
        layoutCell(cap, contentX, y, this.totalWidth, 20);
        y += 20 + spacing;
      }
    }
    y += spacing;
    for (const row of this.rows) {
      let xOffset = spacing;
      for (const cell of row.cells) {
        const cellX = contentX + xOffset;
        const cellY = y;
        let cellW = 0;
        for (let s = 0; s < cell.colspan && cell.col + s < this.columns.length; s++) {
          cellW += this.columns[cell.col + s].finalWidth;
        }
        cellW += spacing * (cell.colspan - 1);
        layoutCell(cell.element, cellX, cellY, Math.max(0, cellW), Math.max(0, cell.contentHeight));
        xOffset += cellW + spacing;
      }
      y += row.height + spacing;
    }
    if (this.options.captionSide === 'bottom') {
      y += spacing;
      for (const cap of this.captions) {
        layoutCell(cap, contentX, y, this.totalWidth, 20);
        y += 20 + spacing;
      }
    }
  }

  getTotalWidth(): number {
    return this.totalWidth;
  }

  getTotalHeight(): number {
    return this.totalHeight;
  }


}
