import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument, DomElement, LayoutBox } from './dom-tree';

type PaintCommandType =
  | 'clearRect' | 'fillRect' | 'strokeRect'
  | 'fillText' | 'strokeText'
  | 'drawImage' | 'beginPath' | 'closePath'
  | 'fill' | 'stroke' | 'setFillStyle'
  | 'setStrokeStyle' | 'setLineWidth'
  | 'setFont' | 'setTextAlign'
  | 'save' | 'restore' | 'clip';

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

    if (document.bodyElement) {
      this.paintNode(document.bodyElement, 1);
    } else {
      for (const child of document.children) {
        if (child.nodeType === 'element') {
          this.paintNode(child as DomElement, 1);
        }
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

    const sortedLayers = [...this.layers].sort((a, b) => a.zIndex - b.zIndex);

    for (const layer of sortedLayers) {
      if (layer.opacity <= 0) continue;
      if (layer.opacity < 1) {
        allCommands.push({ type: 'save', params: [] });
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
      zIndex: 0,
      opacity: 1,
      commands: [
        { type: 'setFillStyle', params: [this.config.backgroundColor] },
        { type: 'fillRect', params: [0, 0, this.config.width, this.config.height] },
      ],
      bounds: null,
    };
  }

  private paintNode(node: DomElement, zIndex: number): void {
    const style = node.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';

    if (display === 'none') return;

    const commands: PaintCommand[] = [];
    const layoutBox: LayoutBox | null = (node as { layoutBox: LayoutBox | null }).layoutBox ?? null;

    if (layoutBox) {
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

      // ── Text label (debug — shows element tag) ──────────────────────────
      const color = style.get('color') ?? '#000000';
      const fontSize = style.get('font-size') ?? '16px';
      commands.push({ type: 'setFillStyle', params: [color] });
      commands.push({ type: 'setFont', params: [`${fontSize} sans-serif`] });
      commands.push({
        type: 'fillText',
        params: [
          `<${node.tagName}>`,
          layoutBox.x + layoutBox.borderLeft + layoutBox.paddingLeft + 4,
          layoutBox.y + layoutBox.borderTop + layoutBox.paddingTop + 16,
        ],
      });

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

    const layer: PaintLayer = {
      id: nextLayerId(),
      zIndex,
      opacity: parseFloat(style.get('opacity') ?? '1') || 1,
      commands,
      bounds: layoutBox,
    };

    this.layers.push(layer);
    this.emit({ kind: 'layerPainted', layerId: layer.id, commandCount: commands.length });

    for (const child of node.children) {
      if (child.nodeType === 'element') {
        this.paintNode(child as DomElement, zIndex + 1);
      }
    }
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
