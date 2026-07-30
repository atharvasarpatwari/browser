import type { LayoutBox } from '../dom-tree';

export interface MultiColumnOptions {
  columnCount: number;
  columnWidth: number;
  columnGap: number;
  columnRuleWidth: number;
  columnRuleStyle: string;
  columnRuleColor: string;
  availableWidth: number;
  availableHeight: number | null;
  fontSize: number;
}

export interface ColumnBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class MultiColumnFormattingContext {
  private options: MultiColumnOptions;
  private columns: ColumnBox[] = [];
  private totalContentHeight = 0;
  private balanced = false;

  constructor(options: MultiColumnOptions) {
    this.options = options;
  }

  resolve(contentHeight: number): void {
    this.totalContentHeight = contentHeight;
    let colCount = this.options.columnCount;
    let colWidth = this.options.columnWidth;
    const gap = this.options.columnGap;
    const availWidth = this.options.availableWidth;

    if (colCount <= 0 && colWidth <= 0) {
      colCount = 1;
      colWidth = availWidth;
    } else if (colCount <= 0) {
      colCount = Math.max(1, Math.floor((availWidth + gap) / (colWidth + gap)));
    } else if (colWidth <= 0) {
      colWidth = Math.max(1, (availWidth - gap * (colCount - 1)) / colCount);
    }

    const totalGap = gap * Math.max(0, colCount - 1);
    if (colCount * colWidth + totalGap > availWidth) {
      colWidth = Math.max(1, (availWidth - totalGap) / colCount);
    }

    let colHeight: number;
    if (this.options.availableHeight != null) {
      colHeight = this.options.availableHeight;
    } else {
      const maxColHeight = Math.ceil(contentHeight / colCount);
      colHeight = Math.max(maxColHeight, 50);
      this.balanced = true;
    }

    this.columns = [];
    for (let c = 0; c < colCount; c++) {
      this.columns.push({
        x: c * (colWidth + gap),
        y: 0,
        width: colWidth,
        height: colHeight,
      });
    }
  }

  getColumns(): readonly ColumnBox[] {
    return this.columns;
  }

  getColumnCount(): number {
    return this.columns.length;
  }

  getTotalHeight(): number {
    if (this.columns.length === 0) return 0;
    return this.columns[this.columns.length - 1].height;
  }

  getTotalWidth(): number {
    if (this.columns.length === 0) return 0;
    const last = this.columns[this.columns.length - 1];
    return last.x + last.width;
  }

  isBalanced(): boolean {
    return this.balanced;
  }
}
