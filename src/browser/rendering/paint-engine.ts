import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument, DomElement, LayoutBox, TextRun } from './dom-tree';
import { DamageTracker } from './damage-tracker';
import {
  buildStackingContextTree,
  renderStackingContext,
  createsStackingContext,
  type StackingContext,
  type PaintCmd,
} from './formatting/stacking';
import { Rasterizer } from './rasterizer';

type PaintCommandType =
  | 'clearRect' | 'fillRect' | 'strokeRect'
  | 'fillText' | 'strokeText'
  | 'drawImage' | 'beginPath' | 'closePath'
  | 'fill' | 'stroke' | 'setFillStyle'
  | 'setStrokeStyle' | 'setLineWidth'
  | 'setFont' | 'setTextAlign'
  | 'save' | 'restore' | 'clip' | 'setGlobalAlpha';

interface PaintCommand {
  readonly type: PaintCommandType;
  readonly params: readonly unknown[];
}

interface PaintLayer {
  readonly id: string;
  readonly zIndex: number;
  readonly opacity: number;
  readonly commands: readonly PaintCommand[];
  readonly bounds: LayoutBox | null;
}

type PaintEventType = 'layerPainted' | 'frameComposited' | 'viewportChanged';

interface PaintEvent {
  readonly kind: PaintEventType;
}

interface LayerPaintedEvent extends PaintEvent {
  readonly kind: 'layerPainted';
  readonly layerId: string;
  readonly commandCount: number;
}

interface FrameCompositedEvent extends PaintEvent {
  readonly kind: 'frameComposited';
  readonly layerCount: number;
  readonly totalCommands: number;
  readonly durationMs: number;
}

type PaintEventUnion = LayerPaintedEvent | FrameCompositedEvent;

interface PaintConfig {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly backgroundColor: string;
  readonly showDebugBorders: boolean;
}

const DEFAULT_PAINT_CONFIG: PaintConfig = {
  width: 1920,
  height: 1080,
  devicePixelRatio: 1,
  backgroundColor: '#ffffff',
  showDebugBorders: false,
};

interface IPaintEngine extends IDisposable {
  paint(document: DomDocument, config?: Partial<PaintConfig>): void;
  paintIncremental(document: DomDocument, damage: DamageTracker, config?: Partial<PaintConfig>): DamageTracker;
  getLayers(): readonly PaintLayer[];
  getLayerById(id: string): PaintLayer | null;
  compositeFrame(): PaintCommand[];
  rasterize(): ImageData;
  resize(width: number, height: number): void;
  getConfig(): PaintConfig;
  updateConfig(config: Partial<PaintConfig>): void;
  on(type: PaintEventType, handler: (event: PaintEventUnion) => void): void;
  off(type: PaintEventType, handler: (event: PaintEventUnion) => void): void;
}

let _layerSeq = 0;
function nextLayerId(): string {
  return `layer-${(++_layerSeq).toString(36)}`;
}

class PaintEngine implements IPaintEngine {
  private config: PaintConfig;
  private readonly layers: PaintLayer[] = [];
  private readonly eventListeners = new Map<PaintEventType, Set<(e: PaintEventUnion) => void>>();
  private stackingTree: StackingContext | null = null;
  private readonly elementCommands = new Map<DomElement, PaintCommand[]>();

  constructor(config?: Partial<PaintConfig>) {
    this.config = { ...DEFAULT_PAINT_CONFIG, ...config };
  }

  paint(document: DomDocument, config?: Partial<PaintConfig>): void {
    if (config) this.config = { ...this.config, ...config };
    this.layers.length = 0;
    this.elementCommands.clear();

    // Build the stacking context tree
    const root = document.htmlElement ?? document.bodyElement;
    if (!root) return;

    this.stackingTree = buildStackingContextTree(root);

    // Also build a flat list of PaintLayers for backward compat (getLayers/getLayerById)
    this.buildFlatLayers(root);

    // Clear all paint-dirty flags so incremental paint knows what changed
    this.clearAllPaintDirty(root);
  }

  private clearAllPaintDirty(node: DomElement): void {
    node._dirtyPaint = false;
    for (const child of node.children) {
      if (child.nodeType === 'element') {
        this.clearAllPaintDirty(child as DomElement);
      }
    }
  }

  /**
   * Incremental paint: only re-paint elements whose paint commands are stale
   * (missing or different layout box). Returns a paintDamage tracker.
   */
  paintIncremental(document: DomDocument, layoutDamage: DamageTracker, config?: Partial<PaintConfig>): DamageTracker {
    if (config) this.config = { ...this.config, ...config };
    const paintDamage = new DamageTracker();

    const root = document.htmlElement ?? document.bodyElement;
    if (!root) return paintDamage;

    this.stackingTree = buildStackingContextTree(root);

    const allElements: DomElement[] = [];
    this.collectElements(root, allElements);
    const currentElements = new Set(allElements);

    for (const el of allElements) {
      const lb = el.layoutBox;
      if (!lb || lb.width === 0 && lb.height === 0) continue;

      const cached = this.elementCommands.get(el);
      if (cached && !el._dirtyPaint) continue;

      this.elementCommands.delete(el);
      this.getElementPaintCommands(el);
      paintDamage.addBox(lb);
      el._dirtyPaint = false;
    }

    for (const [el] of this.elementCommands) {
      if (!currentElements.has(el)) this.elementCommands.delete(el);
    }

    this.buildFlatLayers(root);

    if (!paintDamage.isEmpty()) paintDamage.compact();
    return paintDamage;
  }

  /**
   * Build a flat layer list for backward-compatible getLayers/getLayerById.
   * This traverses the DOM in document order, same as before.
   */
  private buildFlatLayers(root: DomElement): void {
    // Background layer
    this.layers.push({
      id: nextLayerId(),
      zIndex: -1,
      opacity: 1,
      commands: [
        { type: 'setFillStyle', params: [this.config.backgroundColor] },
        { type: 'fillRect', params: [0, 0, this.config.width, this.config.height] },
      ],
      bounds: null,
    });

    const allElements: DomElement[] = [];
    this.collectElements(root, allElements);

    for (const el of allElements) {
      this.paintElement(el);
    }
  }

  private collectElements(node: DomElement, list: DomElement[]): void {
    const style = node.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';
    if (display === 'none') return;

    list.push(node);
    for (const child of node.children) {
      if (child.nodeType === 'element') {
        this.collectElements(child as DomElement, list);
      }
    }
  }

  getLayers(): readonly PaintLayer[] {
    return [...this.layers];
  }

  getLayerById(id: string): PaintLayer | null {
    return this.layers.find(l => l.id === id) ?? null;
  }

  compositeFrame(): PaintCommand[] {
    const allCommands: PaintCommand[] = [
      { type: 'clearRect', params: [0, 0, this.config.width, this.config.height] },
      { type: 'setFillStyle', params: [this.config.backgroundColor] },
      { type: 'fillRect', params: [0, 0, this.config.width, this.config.height] },
    ];

    if (this.stackingTree) {
      // Render using the stacking context tree (spec-compliant paint order)
      const ctxCommands = renderStackingContext(this.stackingTree, (el) => {
        return this.getElementPaintCommands(el);
      });
      allCommands.push(...ctxCommands);
    } else {
      // Fallback: flat sort (shouldn't happen but safe)
      const sortedLayers = [...this.layers].sort((a, b) => a.zIndex - b.zIndex);
      for (const layer of sortedLayers) {
        if (layer.opacity <= 0) continue;
        if (layer.opacity < 1) {
          allCommands.push({ type: 'save', params: [] });
          allCommands.push({ type: 'setGlobalAlpha', params: [layer.opacity] });
        }
        allCommands.push(...layer.commands);
        if (layer.opacity < 1) {
          allCommands.push({ type: 'restore', params: [] });
        }
      }
    }

    return allCommands;
  }

  rasterize(): ImageData {
    const commands = this.compositeFrame();
    const rasterizer = new Rasterizer({
      width: this.config.width,
      height: this.config.height,
      backgroundColor: 'transparent',
    });
    return rasterizer.rasterize(commands);
  }

  resize(width: number, height: number): void {
    this.config = { ...this.config, width, height };
  }

  getConfig(): PaintConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<PaintConfig>): void {
    this.config = { ...this.config, ...config };
  }

  on(type: PaintEventType, handler: (event: PaintEventUnion) => void): void {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
    this.eventListeners.get(type)!.add(handler);
  }

  off(type: PaintEventType, handler: (event: PaintEventUnion) => void): void {
    this.eventListeners.get(type)?.delete(handler);
  }

  private emit(event: PaintEventUnion): void {
    const handlers = this.eventListeners.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[PaintEngine] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  // ── ELEMENT PAINTING ──────────────────────────────────────────────────

  /**
   * Generate paint commands for a single element (background, borders, text).
   * Also populates bgCommands on the stacking context if the element forms one.
   */
  private getElementPaintCommands(node: DomElement): PaintCommand[] {
    const cached = this.elementCommands.get(node);
    if (cached) return cached;

    const commands: PaintCommand[] = [];
    const style = node.computedStyle ?? new Map();
    const layoutBox: LayoutBox | null = (node as { layoutBox: LayoutBox | null }).layoutBox ?? null;

    if (layoutBox && layoutBox.width > 0 && layoutBox.height > 0) {
      // ── Background (content + padding area) ─────────────────────────────
      const bgColor = style.get('background-color') ?? style.get('background') ?? 'transparent';
      if (bgColor !== 'transparent') {
        commands.push({ type: 'setFillStyle', params: [bgColor] });
        commands.push({
          type: 'fillRect',
          params: [
            layoutBox.x + layoutBox.borderLeft,
            layoutBox.y + layoutBox.borderTop,
            layoutBox.width - layoutBox.borderLeft - layoutBox.borderRight,
            layoutBox.height - layoutBox.borderTop - layoutBox.borderBottom,
          ],
        });
      }

      // ── Borders ─────────────────────────────────────────────────────────
      this.paintBorders(commands, layoutBox, style);

      // ── Image (lazy-loaded or eager) ────────────────────────────────────
      if (node.imageData && node.loadingState === 'loaded') {
        const imgData = node.imageData;
        const objectFit = style.get('object-fit') ?? 'fill';
        const contentX = layoutBox.x + layoutBox.borderLeft + layoutBox.paddingLeft;
        const contentY = layoutBox.y + layoutBox.borderTop + layoutBox.paddingTop;
        const contentW = layoutBox.width - layoutBox.borderLeft - layoutBox.borderRight - layoutBox.paddingLeft - layoutBox.paddingRight;
        const contentH = layoutBox.height - layoutBox.borderTop - layoutBox.borderBottom - layoutBox.paddingTop - layoutBox.paddingBottom;

        let drawW = contentW;
        let drawH = contentH;
        let drawX = contentX;
        let drawY = contentY;

        if (objectFit === 'contain') {
          const scale = Math.min(contentW / imgData.width, contentH / imgData.height);
          drawW = imgData.width * scale;
          drawH = imgData.height * scale;
          drawX = contentX + (contentW - drawW) / 2;
          drawY = contentY + (contentH - drawH) / 2;
        } else if (objectFit === 'cover') {
          const scale = Math.max(contentW / imgData.width, contentH / imgData.height);
          drawW = imgData.width * scale;
          drawH = imgData.height * scale;
          drawX = contentX + (contentW - drawW) / 2;
          drawY = contentY + (contentH - drawH) / 2;
        } else if (objectFit === 'none') {
          drawW = imgData.width;
          drawH = imgData.height;
        } else if (objectFit === 'scale-down') {
          const scale = Math.min(1, Math.min(contentW / imgData.width, contentH / imgData.height));
          drawW = imgData.width * scale;
          drawH = imgData.height * scale;
          drawX = contentX + (contentW - drawW) / 2;
          drawY = contentY + (contentH - drawH) / 2;
        }
        // 'fill' uses contentW/contentH as-is

        commands.push({
          type: 'drawImage',
          params: [imgData, drawX, drawY, drawW, drawH],
        });
      }

      // ── Placeholder for unloaded lazy images ──────────────────────────
      if (node.loadingState === 'lazy' && node.tagName.toLowerCase() === 'img') {
        const contentX = layoutBox.x + layoutBox.borderLeft + layoutBox.paddingLeft;
        const contentY = layoutBox.y + layoutBox.borderTop + layoutBox.paddingTop;
        const contentW = layoutBox.width - layoutBox.borderLeft - layoutBox.borderRight - layoutBox.paddingLeft - layoutBox.paddingRight;
        const contentH = layoutBox.height - layoutBox.borderTop - layoutBox.borderBottom - layoutBox.paddingTop - layoutBox.paddingBottom;
        commands.push({ type: 'setFillStyle', params: ['#f0f0f0'] });
        commands.push({ type: 'fillRect', params: [contentX, contentY, contentW, contentH] });
        // Draw a placeholder icon (image symbol)
        commands.push({ type: 'setFillStyle', params: ['#cccccc'] });
        const iconW = Math.min(40, contentW * 0.3);
        const iconH = Math.min(30, contentH * 0.3);
        const iconX = contentX + (contentW - iconW) / 2;
        const iconY = contentY + (contentH - iconH) / 2;
        commands.push({ type: 'fillRect', params: [iconX, iconY, iconW, iconH] });
      }

      // ── Text runs (actual text content from inline formatting context) ───
      const textRuns = layoutBox.textRuns;
      if (textRuns && textRuns.length > 0) {
        for (const run of textRuns) {
          const weight = run.fontWeight ?? 'normal';
          commands.push({ type: 'setFillStyle', params: [run.color] });
          commands.push({ type: 'setFont', params: [`${weight} ${run.fontSize}px ${run.fontFamily}`] });
          commands.push({
            type: 'fillText',
            params: [run.text, run.x, run.y],
          });
        }
      }

      // ── Debug outer border (border box outline) ─────────────────────────
      if (this.config.showDebugBorders) {
        commands.push({ type: 'setStrokeStyle', params: ['rgba(0,0,255,0.3)'] });
        commands.push({ type: 'setLineWidth', params: [1] });
        commands.push({
          type: 'strokeRect',
          params: [
            layoutBox.x,
            layoutBox.y,
            layoutBox.width,
            layoutBox.height,
          ],
        });
      }
    }

    this.elementCommands.set(node, commands);

    // If this element creates a stacking context, populate bgCommands
    // by finding it in the tree and setting its bg commands
    if (this.stackingTree) {
      const ctx = this.findStackingContext(this.stackingTree, node);
      if (ctx) {
        ctx.bgCommands = commands;
      }
    }

    return commands;
  }

  /**
   * Find a stacking context for the given element in the tree.
   */
  private findStackingContext(
    ctx: StackingContext,
    el: DomElement,
  ): StackingContext | null {
    if (ctx.element === el) return ctx;
    for (const child of ctx.children) {
      const found = this.findStackingContext(child, el);
      if (found) return found;
    }
    return null;
  }

  /**
   * Paint a single element into the flat layer list (for backward compat).
   */
  private paintElement(node: DomElement): void {
    const style = node.computedStyle ?? new Map();
    const position = style.get('position') ?? 'static';
    const isPos = position === 'relative' || position === 'absolute'
      || position === 'fixed' || position === 'sticky';
    const zIndex = getZIndex(node);

    let layerZIndex: number;
    if (isPos) {
      layerZIndex = zIndex >= 0 ? 1000 + zIndex : zIndex;
    } else {
      layerZIndex = 0;
    }

    const commands = this.getElementPaintCommands(node);

    const layer: PaintLayer = {
      id: nextLayerId(),
      zIndex: layerZIndex,
      opacity: parseFloat(style.get('opacity') ?? '1') || 1,
      commands,
      bounds: (node as { layoutBox: LayoutBox | null }).layoutBox ?? null,
    };

    this.layers.push(layer);
    this.emit({ kind: 'layerPainted', layerId: layer.id, commandCount: commands.length });
  }

  /**
   * Paints solid borders on all four sides of the border box.
   */
  private paintBorders(commands: PaintCommand[], box: LayoutBox, style: ReadonlyMap<string, string>): void {
    const borderWidths = [box.borderTop, box.borderRight, box.borderBottom, box.borderLeft];
    const hasBorders = borderWidths.some(w => w > 0);
    if (!hasBorders) return;

    const borderColor = style.get('border-color')
      ?? style.get('border-top-color')
      ?? '#000000';

    const sides: Array<{ width: number; x: number; y: number; w: number; h: number }> = [
      { width: box.borderTop, x: box.x, y: box.y, w: box.width, h: box.borderTop },
      { width: box.borderBottom, x: box.x, y: box.y + box.height - box.borderBottom, w: box.width, h: box.borderBottom },
      { width: box.borderLeft, x: box.x, y: box.y + box.borderTop, w: box.borderLeft, h: box.height - box.borderTop - box.borderBottom },
      { width: box.borderRight, x: box.x + box.width - box.borderRight, y: box.y + box.borderTop, w: box.borderRight, h: box.height - box.borderTop - box.borderBottom },
    ];

    for (const side of sides) {
      if (side.width <= 0) continue;
      commands.push({ type: 'setFillStyle', params: [borderColor] });
      commands.push({ type: 'fillRect', params: [side.x, side.y, side.w, side.h] });
    }
  }

  dispose(): void {
    this.layers.length = 0;
    this.elementCommands.clear();
    this.stackingTree = null;
    this.eventListeners.clear();
  }
}

// ── Helpers (kept for backward compat in flat layer mode) ────────────────

function getZIndex(element: DomElement): number {
  const style = element.computedStyle ?? new Map();
  const zRaw = style.get('z-index');
  if (!zRaw || zRaw === 'auto') return 0;
  const z = parseInt(zRaw, 10);
  return isNaN(z) ? 0 : z;
}

export { PaintEngine, DEFAULT_PAINT_CONFIG };
export type { IPaintEngine, PaintLayer, PaintCommand, PaintCommandType, PaintConfig, PaintEventUnion, PaintEventType };
