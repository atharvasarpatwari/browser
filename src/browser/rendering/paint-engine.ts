import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument, DomElement, LayoutBox, TextRun } from './dom-tree';

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
  getLayers(): readonly PaintLayer[];
  getLayerById(id: string): PaintLayer | null;
  compositeFrame(): PaintCommand[];
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

// ─────────────────────────────────────────────────────────────────────────────
// STACKING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

interface StackingEntry {
  element: DomElement;
  zIndex: number;
  stackingLevel: number; // which phase: 0=bg, 1=neg-z, 2=block, 3=float, 4=inline, 5=pos-auto, 6=pos-z, 7=child-pos-z
}

/**
 * Per CSS 2.2 §4.4 and §9.9, determine the stacking level of an element
 * within its stacking context.
 *
 * Stacking levels:
 *   1. Background/borders of element forming the context (level 0)
 *   2. Child stacking contexts with negative z-index (level 1)
 *   3. In-flow non-inline-level, non-positioned descendants (level 2)
 *   4. Float non-positioned descendants (level 3)
 *   5. In-flow inline-level, non-positioned descendants (level 4)
 *   6. Positioned descendants with z-index: auto or 0 (level 5)
 *   7. Child stacking contexts with positive z-index (level 6)
 */
function getStackingLevel(element: DomElement): number {
  const style = element.computedStyle ?? new Map();
  const position = style.get('position') ?? 'static';
  const zIndexRaw = style.get('z-index');
  const isPositioned = position === 'relative' || position === 'absolute'
    || position === 'fixed' || position === 'sticky';

  if (isPositioned) {
    if (zIndexRaw && zIndexRaw !== 'auto') {
      const z = parseInt(zIndexRaw, 10);
      if (z < 0) return 1; // negative z-index
      if (z > 0) return 6; // positive z-index
      return 5; // z-index: 0
    }
    return 5; // z-index: auto → positioned with auto z
  }
  return 2; // non-positioned
}

function getZIndex(element: DomElement): number {
  const style = element.computedStyle ?? new Map();
  const zRaw = style.get('z-index');
  if (!zRaw || zRaw === 'auto') return 0;
  const z = parseInt(zRaw, 10);
  return isNaN(z) ? 0 : z;
}

function isPositioned(element: DomElement): boolean {
  const style = element.computedStyle ?? new Map();
  const pos = style.get('position') ?? 'static';
  return pos === 'relative' || pos === 'absolute' || pos === 'fixed' || pos === 'sticky';
}

class PaintEngine implements IPaintEngine {
  private config: PaintConfig;
  private readonly layers: PaintLayer[] = [];
  private readonly eventListeners = new Map<PaintEventType, Set<(e: PaintEventUnion) => void>>();

  constructor(config?: Partial<PaintConfig>) {
    this.config = { ...DEFAULT_PAINT_CONFIG, ...config };
  }

  paint(document: DomDocument, config?: Partial<PaintConfig>): void {
    if (config) this.config = { ...this.config, ...config };
    this.layers.length = 0;

    const bgLayer = this.createBackgroundLayer();
    this.layers.push(bgLayer);

    // Collect all elements and their stacking contexts
    const allElements: DomElement[] = [];
    if (document.bodyElement) {
      this.collectElements(document.bodyElement, allElements);
    } else {
      for (const child of document.children) {
        if (child.nodeType === 'element') {
          this.collectElements(child as DomElement, allElements);
        }
      }
    }

    // Assign z-index and paint each element
    for (const el of allElements) {
      this.paintNode(el);
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

    // Sort by stacking level first, then by z-index within the level
    const sortedLayers = [...this.layers].sort((a, b) => {
      const diff = a.zIndex - b.zIndex;
      return diff !== 0 ? diff : 0; // stable within same z-index
    });

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

    return allCommands;
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

  private createBackgroundLayer(): PaintLayer {
    return {
      id: nextLayerId(),
      zIndex: -1,
      opacity: 1,
      commands: [
        { type: 'setFillStyle', params: [this.config.backgroundColor] },
        { type: 'fillRect', params: [0, 0, this.config.width, this.config.height] },
      ],
      bounds: null,
    };
  }

  /**
   * Paint a single element. The zIndex in the layer is set from CSS z-index,
   * accounting for stacking context.
   */
  private paintNode(node: DomElement): void {
    const style = node.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';

    if (display === 'none') return;

    const commands: PaintCommand[] = [];
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

    // ── Compute layer z-index from CSS ───────────────────────────────────
    // Positioned elements go on top of non-positioned elements.
    // Within positioned, z-index sorts. Negative z goes behind normal.
    const position = style.get('position') ?? 'static';
    const isPos = position === 'relative' || position === 'absolute'
      || position === 'fixed' || position === 'sticky';
    const zIndex = getZIndex(node);

    // Encode into layer zIndex:
    // - Non-positioned: 0
    // - Positioned with z-index auto/0: 1000 + (0)
    // - Positioned with z-index N: 1000 + N
    // - Positioned with negative z-index N: N (stays negative, goes below 0)
    let layerZIndex: number;
    if (isPos) {
      layerZIndex = zIndex >= 0 ? 1000 + zIndex : zIndex;
    } else {
      layerZIndex = 0;
    }

    const layer: PaintLayer = {
      id: nextLayerId(),
      zIndex: layerZIndex,
      opacity: parseFloat(style.get('opacity') ?? '1') || 1,
      commands,
      bounds: layoutBox,
    };

    this.layers.push(layer);
    this.emit({ kind: 'layerPainted', layerId: layer.id, commandCount: commands.length });
  }

  /**
   * Paints solid borders on all four sides of the border box.
   * Reads border-*-width and border-*-color from computed style.
   */
  private paintBorders(commands: PaintCommand[], box: LayoutBox, style: ReadonlyMap<string, string>): void {
    const borderWidths = [box.borderTop, box.borderRight, box.borderBottom, box.borderLeft];
    const hasBorders = borderWidths.some(w => w > 0);
    if (!hasBorders) return;

    const borderColor = style.get('border-color')
      ?? style.get('border-top-color')
      ?? '#000000';

    const sides: Array<{ width: number; x: number; y: number; w: number; h: number }> = [
      // Top border
      { width: box.borderTop, x: box.x, y: box.y, w: box.width, h: box.borderTop },
      // Bottom border
      { width: box.borderBottom, x: box.x, y: box.y + box.height - box.borderBottom, w: box.width, h: box.borderBottom },
      // Left border (between top and bottom)
      { width: box.borderLeft, x: box.x, y: box.y + box.borderTop, w: box.borderLeft, h: box.height - box.borderTop - box.borderBottom },
      // Right border (between top and bottom)
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
    this.eventListeners.clear();
  }
}

export { PaintEngine, DEFAULT_PAINT_CONFIG };
export type { IPaintEngine, PaintLayer, PaintCommand, PaintCommandType, PaintConfig, PaintEventUnion, PaintEventType };
