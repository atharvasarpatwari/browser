import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument, DomElement, LayoutBox } from './dom-tree';

interface LayoutConfig {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly defaultFontSize: number;
}

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  viewportWidth: 1920,
  viewportHeight: 1080,
  defaultFontSize: 16,
};

interface ILayoutEngine extends IDisposable {
  layout(document: DomDocument, config?: Partial<LayoutConfig>): void;
  getLayoutBox(domId: string): LayoutBox | null;
  getElementAtPoint(x: number, y: number): DomElement | null;
  getConfig(): LayoutConfig;
  updateConfig(config: Partial<LayoutConfig>): void;
}

class LayoutEngine implements ILayoutEngine {
  private config: LayoutConfig;
  private readonly layoutBoxes = new Map<string, LayoutBox>();
  private readonly elementPositions: Array<{ element: DomElement; box: LayoutBox }> = [];

  constructor(config?: Partial<LayoutConfig>) {
    this.config = { ...DEFAULT_LAYOUT_CONFIG, ...config };
  }

  layout(document: DomDocument, config?: Partial<LayoutConfig>): void {
    if (config) this.config = { ...this.config, ...config };
    this.layoutBoxes.clear();
    this.elementPositions.length = 0;

    if (document.bodyElement) {
      this.layoutNode(document.bodyElement, 0, 0, this.config.viewportWidth);
    } else {
      let y = 0;
      for (const child of document.children) {
        if (child.nodeType === 'element') {
          y = this.layoutNode(child as DomElement, 0, y, this.config.viewportWidth);
        }
      }
    }
  }

  getLayoutBox(domId: string): LayoutBox | null {
    return this.layoutBoxes.get(domId) ?? null;
  }

  getElementAtPoint(x: number, y: number): DomElement | null {
    for (let i = this.elementPositions.length - 1; i >= 0; i--) {
      const { element, box } = this.elementPositions[i]!;
      if (
        x >= box.x && x <= box.x + box.width &&
        y >= box.y && y <= box.y + box.height
      ) {
        return element;
      }
    }
    return null;
  }

  getConfig(): LayoutConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<LayoutConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private layoutNode(node: DomElement, x: number, y: number, availableWidth: number): number {
    const style = node.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';
    const position = style.get('position') ?? 'static';

    if (display === 'none') return y;

    const marginLeft = this.parsePx(style.get('margin-left') ?? style.get('margin') ?? '0');
    const marginRight = this.parsePx(style.get('margin-right') ?? style.get('margin') ?? '0');
    const marginTop = this.parsePx(style.get('margin-top') ?? style.get('margin') ?? '0');
    const marginBottom = this.parsePx(style.get('margin-bottom') ?? style.get('margin') ?? '0');
    const paddingLeft = this.parsePx(style.get('padding-left') ?? style.get('padding') ?? '0');
    const paddingRight = this.parsePx(style.get('padding-right') ?? style.get('padding') ?? '0');
    const paddingTop = this.parsePx(style.get('padding-top') ?? style.get('padding') ?? '0');
    const paddingBottom = this.parsePx(style.get('padding-bottom') ?? style.get('padding') ?? '0');

    let width: number;
    const specWidth = style.get('width');
    if (specWidth && specWidth !== 'auto') {
      width = Math.min(this.parsePx(specWidth), availableWidth);
    } else {
      width = availableWidth;
    }

    let height: number;
    const specHeight = style.get('height');
    if (specHeight && specHeight !== 'auto') {
      height = this.parsePx(specHeight);
    } else {
      height = 20;
    }

    let posX = x + marginLeft;
    let posY: number;

    if (position === 'relative') {
      const top = this.parsePx(style.get('top') ?? '0');
      const left = this.parsePx(style.get('left') ?? '0');
      posX += left;
      posY = y + marginTop + top;
    } else {
      posY = y + marginTop;
    }

    const contentWidth = width - paddingLeft - paddingRight;
    const box: LayoutBox = {
      x: posX,
      y: posY,
      width: width + marginLeft + marginRight,
      height: 0,
      marginTop, marginRight, marginBottom, marginLeft,
      paddingTop, paddingRight, paddingBottom, paddingLeft,
    };

    let childY = posY + paddingTop;
    const isBlock = display === 'block' || display === 'flex' || display === 'grid';

    for (const child of node.children) {
      if (child.nodeType === 'text') {
        childY += 20;
        continue;
      }
      if (child.nodeType === 'element') {
        const childEl = child as DomElement;
        if (isBlock) {
          childY = this.layoutNode(childEl, posX + paddingLeft, childY, contentWidth);
        } else {
          this.layoutNode(childEl, posX + paddingLeft, posY + paddingTop, contentWidth);
        }
      }
    }

    const contentHeight = childY - posY - paddingTop + paddingBottom;
    height = Math.max(height, contentHeight);
    box.height = height + paddingTop + paddingBottom + marginTop + marginBottom;

    this.layoutBoxes.set(node.domId, box);
    this.elementPositions.push({ element: node, box });

    return posY + box.height + marginBottom;
  }

  private parsePx(value: string): number {
    if (!value || value === 'auto') return 0;
    const parsed = parseFloat(value);
    return isFinite(parsed) ? parsed : 0;
  }

  dispose(): void {
    this.layoutBoxes.clear();
    this.elementPositions.length = 0;
  }
}

export { LayoutEngine, DEFAULT_LAYOUT_CONFIG };
export type { ILayoutEngine, LayoutConfig };
