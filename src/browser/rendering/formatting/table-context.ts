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
  /** Measured min-content / max-content border-box widths (auto layout, CSS 2.2 §17.5.2.2). */
  minContent?: number;
  maxContent?: number;
}

export interface TableRow {
  cells: TableCell[];
  height: number;
}

export interface ResolvedColumn {
  minWidth: number;
  maxWidth: number;
  finalWidth: number;
  /** Has a specified width (a cell's or a <col>'s): spare width goes to the others first. */
  fixed?: boolean;
}

export type TableLayoutType = 'auto' | 'fixed';

export interface TableFormattingContextOptions {
  tableLayout: TableLayoutType;
  borderCollapse: 'separate' | 'collapse';
  borderSpacing: number;
  captionSide: 'top' | 'bottom';
  availableWidth: number;
  fontSize: number;
  /** `width: auto`: the table shrinks to its columns' max-content when that fits. */
  autoWidth?: boolean;
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
  let lastAnonCell: DomElement | null = null;
  let i = 0;

  function anonCell(): DomElement {
    if (lastAnonCell) return lastAnonCell;
    const cell = createAnonymousElement('table-cell', 'anon-cell-' + i);
    ensureRow().children.push(cell);
    lastAnonCell = cell;
    return cell;
  }

  function ensureRow(): DomElement {
    if (lastRow) return lastRow;
    lastAnonCell = null;
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
      // Text directly in a table goes into an anonymous cell; whitespace between boxes doesn't.
      if (((node as { text?: string }).text ?? '').trim()) anonCell().children.push(node);
      i++;
      continue;
    }
    if (node.nodeType !== 'element') { i++; continue; }
    const el = node as DomElement;
    const display = el.computedStyle?.get('display') ?? 'inline';
    const role = classifyTableChild(display);

    if (role !== null) lastAnonCell = null;
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
      // Anything else (a <figure>'s <a><img>) is wrapped in an anonymous cell (CSS 2.2 §17.2.1).
      // It went straight into the row, where only cells are laid out, so it vanished.
      anonCell().children.push(node);
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

  /** Widths from <col>/<colgroup> elements, by column index. */
  private specifiedColumnWidths = new Map<number, number>();

  setColumnWidth(index: number, px: number): void {
    this.specifiedColumnWidths.set(index, px);
  }

  addRow(cells: TableCell[]): void {
    for (const cell of cells) cell.row = this.rows.length;
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
      const w = this.specifiedColumnWidths.get(c);
      this.columns[c] = w !== undefined ? { minWidth: w, maxWidth: w, finalWidth: 0, fixed: true } : { minWidth: 0, maxWidth: 0, finalWidth: 0 };
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
          // Measured content widths; every auto cell used to be 40 px min / the full width max,
          // so columns were shared out regardless of what they held.
          cellMin = cell.minContent ?? 40;
          cellMax = Math.max(cellMin, cell.maxContent ?? this.options.availableWidth);
        }
        const col = cell.col;
        const span = cell.colspan;
        if (span <= 1) {
          const column = this.columns[col]!;
          if (rawW && rawW !== 'auto') {
            // A specified width fixes the column (the widest specification wins).
            column.minWidth = column.fixed ? Math.max(column.minWidth, cellMin) : Math.max(cellMin, cell.minContent ?? 0);
            column.maxWidth = Math.max(column.minWidth, column.fixed ? column.maxWidth : 0);
            column.fixed = true;
          } else if (!column.fixed) {
            column.minWidth = Math.max(column.minWidth, cellMin);
            column.maxWidth = Math.max(column.maxWidth, cellMax);
          } else {
            column.minWidth = Math.max(column.minWidth, cellMin);
            column.maxWidth = Math.max(column.maxWidth, column.minWidth);
          }
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
      // Fixed layout (CSS 2.2 §17.5.2.1): specified columns keep their width, the rest share what
      // is left equally. Content doesn't count (it widened empty-looking columns before).
      const fixedAvail = Math.max(0, this.options.availableWidth);
      for (const col of this.columns) col.finalWidth = col.fixed ? col.minWidth : 0;
      const used = this.columns.reduce((s, c) => s + c.finalWidth, 0);
      const remaining = Math.max(0, fixedAvail - used - totalSpacing);
      const open = this.columns.filter((c) => !c.fixed);
      const takers = open.length > 0 ? open : this.columns;
      if (remaining > 0) for (const col of takers) col.finalWidth += remaining / takers.length;
    } else {
      if (totalMin >= availForCols) {
        for (const col of this.columns) {
          col.finalWidth = col.minWidth;
        }
      } else if (this.options.autoWidth && totalMax <= availForCols) {
        // An auto-width table whose content fits is as wide as its content (a small table no
        // longer stretches across the page).
        for (const col of this.columns) {
          col.finalWidth = col.maxWidth;
        }
      } else {
        const excess = availForCols - totalMin;
        // Spare width goes to auto columns, not to ones with a specified width (CSS 2.2
        // §17.5.2.2): a `width:100px` cell's column grew to 246px beside a one-word column.
        const auto = this.columns.filter((c) => !c.fixed);
        if (auto.length > 0 && auto.length < this.columns.length) {
          const room = availForCols - this.columns.reduce((s, c) => s + (c.fixed ? c.minWidth : 0), 0);
          const autoMin = auto.reduce((s, c) => s + c.minWidth, 0);
          const autoMax = auto.reduce((s, c) => s + Math.max(c.maxWidth, c.minWidth), 0);
          for (const col of this.columns) {
            if (col.fixed) { col.finalWidth = col.minWidth; continue; }
            const share = autoMax > autoMin ? (Math.max(col.maxWidth, col.minWidth) - col.minWidth) / (autoMax - autoMin) : 1 / auto.length;
            col.finalWidth = col.minWidth + Math.max(0, room - autoMin) * share;
          }
          this.totalWidth = this.columns.reduce((s, c) => s + c.finalWidth, 0) + totalSpacing;
          this.finishRows(resolveLength, spacing, colCount);
          return;
        }
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
    this.finishRows(resolveLength, spacing, colCount);
  }

  private finishRows(resolveLength: (value: string, fallback: string) => number, spacing: number, colCount: number): void {
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

  /**
   * Lays out captions and cells. `layoutCell` may return the height the content took: rows grow
   * to their tallest cell and `stretchCell` gives every cell that height. Rows were fixed at 20px
   * (or the CSS height), so taller content overflowed onto what followed, and captions were laid
   * out at the columns' width: 0 for a table with none (Wikipedia's <figure>), one word a line.
   */
  layoutCells(
    contentX: number,
    contentY: number,
    layoutCell: (cell: DomElement, x: number, y: number, w: number, h: number) => number | void,
    stretchCell?: (cell: DomElement, h: number) => void,
    moveCell?: (cell: DomElement, dy: number) => void,
  ): void {
    const spacing = this.options.borderCollapse === 'separate' ? this.options.borderSpacing : 0;
    const captionWidth = this.totalWidth > 0 ? this.totalWidth : this.options.availableWidth;
    let y = contentY;
    // caption-side is the caption's own (inherited) property: Wikipedia sets `bottom` on <figcaption>.
    const sideOf = (cap: DomElement): string => cap.computedStyle?.get('caption-side') ?? this.options.captionSide;
    const captions = (side: string): void => {
      for (const cap of this.captions) {
        if (sideOf(cap) !== side) continue;
        const h = layoutCell(cap, contentX, y, captionWidth, 20);
        y += (typeof h === 'number' ? h : 20) + spacing;
      }
    };
    captions('top');
    y += spacing;

    // Cells sit at their column's x (a running offset put a cell after a rowspan in the spanned
    // column), are laid out once at the first row's y, then moved to their row once every row's
    // height is known: a rowspan cell stretches over its rows and grows the last if it needs to.
    const cols = this.columns;
    const colX = (c: number): number => {
      let x = contentX + spacing;
      for (let i = 0; i < c && i < cols.length; i++) x += cols[i]!.finalWidth + spacing;
      return x;
    };
    const spanWidth = (cell: TableCell): number => {
      let w = spacing * (cell.colspan - 1);
      for (let s2 = 0; s2 < cell.colspan && cell.col + s2 < cols.length; s2++) w += cols[cell.col + s2]!.finalWidth;
      return Math.max(0, w);
    };
    const top = y;
    const heights = new Map<TableCell, number>();
    for (const row of this.rows) {
      for (const cell of row.cells) {
        const h = layoutCell(cell.element, colX(cell.col), top, spanWidth(cell), Math.max(0, cell.contentHeight));
        heights.set(cell, typeof h === 'number' ? h : cell.contentHeight);
      }
    }
    for (const row of this.rows) {
      for (const cell of row.cells) if (cell.rowspan <= 1) row.height = Math.max(row.height, heights.get(cell)!);
    }
    const lastRow = this.rows.length - 1;
    const spanned = (cell: TableCell): number => {
      let h = 0;
      const end = Math.min(lastRow, cell.row + cell.rowspan - 1);
      for (let r = cell.row; r <= end; r++) h += this.rows[r]!.height + (r > cell.row ? spacing : 0);
      return h;
    };
    for (const row of this.rows) {
      for (const cell of row.cells) {
        if (cell.rowspan <= 1) continue;
        const need = heights.get(cell)! - spanned(cell);
        if (need > 0) this.rows[Math.min(lastRow, cell.row + cell.rowspan - 1)]!.height += need;
      }
    }
    const rowY: number[] = [];
    for (const row of this.rows) { rowY.push(y); y += row.height + spacing; }
    for (const row of this.rows) {
      for (const cell of row.cells) {
        const dy = rowY[cell.row]! - top;
        if (dy) moveCell?.(cell.element, dy);
        stretchCell?.(cell.element, cell.rowspan > 1 ? spanned(cell) : row.height);
      }
    }
    if (this.captions.some((cap) => sideOf(cap) === 'bottom')) {
      y += spacing;
      captions('bottom');
    }
    this.totalHeight = y - contentY;
  }

  getTotalWidth(): number {
    return this.totalWidth;
  }

  getTotalHeight(): number {
    return this.totalHeight;
  }


}
