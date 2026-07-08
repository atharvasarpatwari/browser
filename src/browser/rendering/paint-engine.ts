import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument, DomElement, DomNode, LayoutBox } from './dom-tree';

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
      const bgColor = style.get('background-color') ?? style.get('background') ?? 'transparent';
      if (bgColor !== 'transparent') {
        commands.push({ type: 'setFillStyle', params: [bgColor] });
        commands.push({
          type: 'fillRect',
          params: [
            layoutBox.x + layoutBox.paddingLeft,
            layoutBox.y + layoutBox.paddingTop,
            layoutBox.width - layoutBox.paddingLeft - layoutBox.paddingRight,
            layoutBox.height - layoutBox.paddingTop - layoutBox.paddingBottom,
          ],
        });
      }

      const color = style.get('color') ?? '#000000';
      const fontSize = style.get('font-size') ?? '16px';
      commands.push({ type: 'setFillStyle', params: [color] });
      commands.push({ type: 'setFont', params: [`${fontSize} sans-serif`] });
      commands.push({
        type: 'fillText',
        params: [
          `<${node.tagName}>`,
          layoutBox.x + layoutBox.paddingLeft + 4,
          layoutBox.y + layoutBox.paddingTop + 16,
        ],
      });

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
      opacity: 1,
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

  dispose(): void {
    this.layers.length = 0;
    this.eventListeners.clear();
  }
}

export { PaintEngine, DEFAULT_PAINT_CONFIG };
export type { IPaintEngine, PaintLayer, PaintCommand, PaintCommandType, PaintConfig, PaintEventUnion, PaintEventType };
