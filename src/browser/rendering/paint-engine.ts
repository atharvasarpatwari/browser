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
import { buildRenderObject, sortByPaintOrder, type RenderObject } from './render-tree';
import { Rasterizer } from './rasterizer';
import { GpuRasterizer } from './gpu/gpu-rasterizer';
import { LayerCompositor } from './compositing/layer-compositor';
import { LayerTree } from './compositing/layer-tree';
import { LayerPromoter } from './compositing/layer-promoter';
import { parseGradient, isGradientValue } from './css-gradients';
import { parseBackgrounds } from './enhanced-backgrounds';
import { parseBorders, parseBorderRadius, renderBorderSide } from './borders-enhanced';
import { parseBoxShadow, parseTextShadow } from './shadows';
import { parseFilter } from './css-filters';
import { parseClipPath, parseMask } from './clip-mask';
import type { BlendMode } from './blend-modes';

type PaintCommandType =
  | 'clearRect' | 'fillRect' | 'strokeRect'
  | 'fillText' | 'strokeText'
  | 'drawImage' | 'beginPath' | 'closePath'
  | 'fill' | 'stroke' | 'setFillStyle'
  | 'setStrokeStyle' | 'setLineWidth'
  | 'setFont' | 'setTextAlign'
  | 'save' | 'restore' | 'clip' | 'setGlobalAlpha'
  | 'setFillGradient' | 'setBlendMode'
  | 'applyBoxShadow' | 'applyTextShadow'
  | 'applyFilterList' | 'applyClipShape' | 'setBorderRadius'
  | 'applyMask'
  | 'translate';

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
  readonly hardwareAcceleration: boolean;
}

const DEFAULT_PAINT_CONFIG: PaintConfig = {
  width: 1920,
  height: 1080,
  devicePixelRatio: 1,
  backgroundColor: '#ffffff',
  showDebugBorders: false,
  hardwareAcceleration: false,
};

interface IPaintEngine extends IDisposable {
  paint(document: DomDocument, config?: Partial<PaintConfig>): void;
  paintIncremental(document: DomDocument, damage: DamageTracker, config?: Partial<PaintConfig>): DamageTracker;
  getLayers(): readonly PaintLayer[];
  getLayerById(id: string): PaintLayer | null;
  compositeFrame(): PaintCommand[];
  rasterize(): ImageData;
  rasterizeAsync(): Promise<ImageData>;
  resize(width: number, height: number): void;
  getConfig(): PaintConfig;
  updateConfig(config: Partial<PaintConfig>): void;
  on(type: PaintEventType, handler: (event: PaintEventUnion) => void): void;
  off(type: PaintEventType, handler: (event: PaintEventUnion) => void): void;
  setOpacityResolver(resolver: ((el: DomElement) => number | null) | null): void;
  setTransformResolver(resolver: ((el: DomElement) => string | null) | null): void;
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
  private renderTree: RenderObject | null = null;
  private readonly elementCommands = new Map<DomElement, PaintCommand[]>();
  private rasterizer: Rasterizer | GpuRasterizer;

  // Compositing layer system
  private layerCompositor: LayerCompositor | null = null;
  private layerTree: LayerTree | null = null;
  private layerPromoter: LayerPromoter = new LayerPromoter();

  /** Overlay opacity resolver for animated values (e.g. CSS animations). */
  private _opacityResolver: ((el: DomElement) => number | null) | null = null;

  /** Overlay transform resolver for animated values (e.g. CSS animations). */
  private _transformResolver: ((el: DomElement) => string | null) | null = null;

  constructor(config?: Partial<PaintConfig>) {
    this.config = { ...DEFAULT_PAINT_CONFIG, ...config };
    this.rasterizer = this.createRasterizer();
  }

  paint(document: DomDocument, config?: Partial<PaintConfig>): void {
    if (config) this.config = { ...this.config, ...config };
    this.layers.length = 0;
    this.elementCommands.clear();

    // Build the stacking context tree
    const root = document.htmlElement ?? document.bodyElement;
    if (!root) return;

    this.stackingTree = buildStackingContextTree(root, this.stackingBuildOptions());
    this.renderTree = buildRenderObject(root);

    // Build compositing layer tree from stacking context
    if (this.layerCompositor) {
      this.layerTree = LayerTree.fromStackingContext(
        this.stackingTree,
        this.layerPromoter,
        { enableTiling: true, tileThreshold: 512 },
      );
    }

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

    this.stackingTree = buildStackingContextTree(root, this.stackingBuildOptions());
    this.renderTree = buildRenderObject(root);

    const allElements: DomElement[] = [];
    this.collectElements(root, allElements);
    const currentElements = new Set(allElements);

    for (const el of allElements) {
      const lb = el.layoutBox;
      if (!lb || lb.width === 0 && lb.height === 0) {
        continue;
      }
      const cached = this.elementCommands.get(el);
      if (cached && !el._dirtyPaint) {
        continue;
      }

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
      allCommands.push(...(ctxCommands as PaintCommand[]));
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
    return this.rasterizer.rasterize(commands);
  }

  async rasterizeAsync(): Promise<ImageData> {
    const commands = this.compositeFrame();
    return this.rasterizer.rasterizeAsync(commands);
  }

  resize(width: number, height: number): void {
    this.config = { ...this.config, width, height };
    this.rasterizer = this.createRasterizer();
  }

  getConfig(): PaintConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<PaintConfig>): void {
    this.config = { ...this.config, ...config };
    if ('hardwareAcceleration' in config || 'width' in config || 'height' in config) {
      this.rasterizer = this.createRasterizer();
    }
  }

  private createRasterizer(): Rasterizer | GpuRasterizer {
    if (this.config.hardwareAcceleration) {
      return new GpuRasterizer({
        width: this.config.width,
        height: this.config.height,
        devicePixelRatio: this.config.devicePixelRatio,
        backgroundColor: this.config.backgroundColor,
      });
    }
    return new Rasterizer({
      width: this.config.width,
      height: this.config.height,
      devicePixelRatio: this.config.devicePixelRatio,
      backgroundColor: this.config.backgroundColor,
    });
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
    if (cached) {
      this.syncStackingBgCommands(node, cached);
      return cached;
    }

    const commands: PaintCommand[] = [];
    const style = node.computedStyle ?? new Map();
    const layoutBox: LayoutBox | null = (node as { layoutBox: LayoutBox | null }).layoutBox ?? null;

    if (layoutBox && layoutBox.width > 0 && layoutBox.height > 0) {
      const bx = layoutBox.x + layoutBox.borderLeft;
      const by = layoutBox.y + layoutBox.borderTop;
      const bw = layoutBox.width - layoutBox.borderLeft - layoutBox.borderRight;
      const bh = layoutBox.height - layoutBox.borderTop - layoutBox.borderBottom;

      // ── Background (enhanced with gradients + multi-layer) ────────────
      // The computed-style pipeline always resolves `background-color` (default
      // `transparent`) alongside the `background` shorthand. Fall back to the
      // shorthand when the longhand is transparent so `background:#ff0` paints.
      let bgColor = style.get('background-color') ?? 'transparent';
      if (bgColor === 'transparent') {
        const bgShorthand = style.get('background');
        if (bgShorthand && bgShorthand !== 'none' && bgShorthand !== 'transparent') {
          bgColor = bgShorthand;
        }
      }
      const bgImage = style.get('background-image') ?? 'none';
      const bgSize = style.get('background-size') ?? 'auto';
      const bgPos = style.get('background-position') ?? '0% 0%';

      let bgX = bx, bgY = by, bgW = bw, bgH = bh;
      if (bgSize !== 'auto') {
        const sizeParts = bgSize.split(/\s+/);
        if (sizeParts[0] && sizeParts[0] !== 'auto') {
          if (sizeParts[0].endsWith('%')) bgW = bw * parseFloat(sizeParts[0]) / 100;
          else bgW = parseFloat(sizeParts[0]) || bw;
        }
        if (sizeParts[1]) {
          if (sizeParts[1].endsWith('%')) bgH = bh * parseFloat(sizeParts[1]) / 100;
          else bgH = parseFloat(sizeParts[1]) || bh;
        }
      }
      if (bgPos !== '0% 0%') {
        const posParts = bgPos.split(/\s+/);
        if (posParts[0] && posParts[0].endsWith('%')) bgX = bx + (bw - bgW) * parseFloat(posParts[0]) / 100;
        if (posParts[1] && posParts[1].endsWith('%')) bgY = by + (bh - bgH) * parseFloat(posParts[1]) / 100;
      }

      if (isGradientValue(bgImage)) {
        const grad = parseGradient(bgImage);
        if (grad) {
          commands.push({ type: 'setFillGradient', params: [grad, bgX, bgY, bgW, bgH] });
        } else {
          commands.push({ type: 'setFillStyle', params: [bgColor] });
          commands.push({ type: 'fillRect', params: [bgX, bgY, bgW, bgH] });
        }
      } else if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
        commands.push({ type: 'setFillStyle', params: [bgColor] });
        commands.push({ type: 'fillRect', params: [bgX, bgY, bgW, bgH] });
      } else if (bgColor !== 'transparent') {
        commands.push({ type: 'setFillStyle', params: [bgColor] });
        commands.push({ type: 'fillRect', params: [bgX, bgY, bgW, bgH] });
      }

      // ── Overflow clip rect (apply before borders/content) ────────────
      const overflowX = style.get('overflow-x') ?? style.get('overflow') ?? 'visible';
      const overflowY = style.get('overflow-y') ?? overflowX;
      if (overflowX === 'hidden' || overflowX === 'scroll' || overflowX === 'auto' ||
          overflowY === 'hidden' || overflowY === 'scroll' || overflowY === 'auto') {
        const cx = layoutBox.x + layoutBox.borderLeft + layoutBox.paddingLeft;
        const cy = layoutBox.y + layoutBox.borderTop + layoutBox.paddingTop;
        const cw = layoutBox.width - layoutBox.borderLeft - layoutBox.borderRight - layoutBox.paddingLeft - layoutBox.paddingRight;
        const ch = layoutBox.height - layoutBox.borderTop - layoutBox.borderBottom - layoutBox.paddingTop - layoutBox.paddingBottom;
        if (cw > 0 && ch > 0) {
          commands.push({ type: 'clip', params: [cx, cy, cw, ch] });
        }
      }

      // ── Box shadow (rendered before borders, behind element) ──────────
      const boxShadowVal = style.get('box-shadow');
      if (boxShadowVal && boxShadowVal !== 'none') {
        const shadows = parseBoxShadow(boxShadowVal);
        for (const shadow of shadows) {
          if (!shadow.inset) {
            commands.push({ type: 'applyBoxShadow', params: [shadow, bx, by, bw, bh] });
          }
        }
      }

      // ── Borders (enhanced with radius, per-side colors, dashed/dotted) ─
      const borderInfo = parseBorders(style, layoutBox.width, layoutBox.height);
      const hasAnyBorder = borderInfo.top.width > 0 || borderInfo.right.width > 0 ||
        borderInfo.bottom.width > 0 || borderInfo.left.width > 0;
      if (hasAnyBorder) {
        const borderSides: { w: number; x: number; y: number; rw: number; rh: number; color: string; style: string }[] = [
          { w: borderInfo.top.width, x: layoutBox.x, y: layoutBox.y, rw: layoutBox.width, rh: borderInfo.top.width, color: colorToString(borderInfo.top.color), style: borderInfo.top.style },
          { w: borderInfo.bottom.width, x: layoutBox.x, y: layoutBox.y + layoutBox.height - borderInfo.bottom.width, rw: layoutBox.width, rh: borderInfo.bottom.width, color: colorToString(borderInfo.bottom.color), style: borderInfo.bottom.style },
          { w: borderInfo.left.width, x: layoutBox.x, y: layoutBox.y + borderInfo.top.width, rw: borderInfo.left.width, rh: layoutBox.height - borderInfo.top.width - borderInfo.bottom.width, color: colorToString(borderInfo.left.color), style: borderInfo.left.style },
          { w: borderInfo.right.width, x: layoutBox.x + layoutBox.width - borderInfo.right.width, y: layoutBox.y + borderInfo.top.width, rw: borderInfo.right.width, rh: layoutBox.height - borderInfo.top.width - borderInfo.bottom.width, color: colorToString(borderInfo.right.color), style: borderInfo.right.style },
        ];
        const hasRadius = borderInfo.radius.topLeft.w > 0 || borderInfo.radius.topRight.w > 0 ||
          borderInfo.radius.bottomLeft.w > 0 || borderInfo.radius.bottomRight.w > 0;
        if (hasRadius) {
          commands.push({ type: 'setBorderRadius', params: [borderInfo.radius, layoutBox.x, layoutBox.y, layoutBox.width, layoutBox.height] });
        }
        for (const s of borderSides) {
          if (s.w <= 0) continue;
          if (s.style === 'dashed' || s.style === 'dotted') {
            commands.push({ type: 'setFillStyle', params: [s.color] });
            const dashLen = s.style === 'dotted' ? s.w : s.w * 3;
            const gapLen = s.w * 2;
            const isHoriz = s.rw > s.rh;
            const total = isHoriz ? s.rw : s.rh;
            for (let start = 0; start < total; start += dashLen + gapLen) {
              const segW = isHoriz ? Math.min(dashLen, total - start) : s.rw;
              const segH = isHoriz ? s.rh : Math.min(dashLen, total - start);
              const segX = isHoriz ? s.x + start : s.x;
              const segY = isHoriz ? s.y : s.y + start;
              commands.push({ type: 'fillRect', params: [segX, segY, segW, segH] });
            }
          } else {
            commands.push({ type: 'setFillStyle', params: [s.color] });
            commands.push({ type: 'fillRect', params: [s.x, s.y, s.rw, s.rh] });
          }
        }
      }

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
        const textShadowVal = style.get('text-shadow');
        const textShadows = textShadowVal ? parseTextShadow(textShadowVal) : [];
        for (const run of textRuns) {
          const weight = run.fontWeight ?? 'normal';
          if (textShadows.length > 0) {
            for (const ts of textShadows) {
              commands.push({ type: 'applyTextShadow', params: [ts, run.text, run.x, run.y, run.color, `${weight} ${run.fontSize}px ${run.fontFamily}`] });
            }
          }
          commands.push({ type: 'setFillStyle', params: [run.color] });
          commands.push({ type: 'setFont', params: [`${weight} ${run.fontSize}px ${run.fontFamily}`] });
          commands.push({
            type: 'fillText',
            params: [run.text, run.x, run.y],
          });
        }
      }

      // ── Inset box shadows (after content) ─────────────────────────────
      if (boxShadowVal && boxShadowVal !== 'none') {
        const shadows = parseBoxShadow(boxShadowVal);
        for (const shadow of shadows) {
          if (shadow.inset) {
            commands.push({ type: 'applyBoxShadow', params: [shadow, bx, by, bw, bh] });
          }
        }
      }

      // ── Filter effects ──────────────────────────────────────────────
      const filterVal = style.get('filter');
      if (filterVal && filterVal !== 'none') {
        const filters = parseFilter(filterVal);
        if (filters.length > 0) {
          commands.push({ type: 'applyFilterList', params: [filters, layoutBox.x, layoutBox.y, layoutBox.width, layoutBox.height] });
        }
      }

      // ── Clip-path ──────────────────────────────────────────────────
      const clipPathVal = style.get('clip-path');
      if (clipPathVal && clipPathVal !== 'none') {
        const clipInfo = parseClipPath(clipPathVal);
        if (clipInfo.shape.type !== 'none') {
          commands.push({ type: 'applyClipShape', params: [clipInfo.shape, layoutBox.x, layoutBox.y, layoutBox.width, layoutBox.height] });
        }
      }

      // ── Mask-image ────────────────────────────────────────────────
      const maskImage = style.get('mask-image');
      if (maskImage && maskImage !== 'none') {
        const maskInfo = parseMask(maskImage);
        if (maskInfo.length > 0 && maskInfo[0].image !== 'none') {
          commands.push({ type: 'applyMask', params: [maskInfo, layoutBox.x, layoutBox.y, layoutBox.width, layoutBox.height] });
        }
      }

      // ── Blend mode ─────────────────────────────────────────────────
      const blendModeVal = style.get('mix-blend-mode');
      if (blendModeVal) {
        commands.push({ type: 'setBlendMode', params: [blendModeVal] });
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
    this.syncStackingBgCommands(node, commands);

    return commands;
  }

  /**
   * If the element forms a stacking context, keep its context's bgCommands
   * in sync with the (possibly cached) paint commands. The stacking tree is
   * rebuilt every incremental paint, so this must run on cache hits too or
   * animated opacity/transform groups would paint nothing after the first
   * two frames.
   */
  private syncStackingBgCommands(node: DomElement, commands: PaintCommand[]): void {
    if (this.stackingTree) {
      const ctx = this.findStackingContext(this.stackingTree, node);
      if (ctx) {
        ctx.bgCommands = commands;
      }
    }
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

    const animatedOpacity = this._opacityResolver?.(node);
    const layer: PaintLayer = {
      id: nextLayerId(),
      zIndex: layerZIndex,
      opacity: (animatedOpacity ?? parseFloat(style.get('opacity') ?? '1')) || 1,
      commands,
      bounds: (node as { layoutBox: LayoutBox | null }).layoutBox ?? null,
    };

    this.layers.push(layer);
    this.emit({ kind: 'layerPainted', layerId: layer.id, commandCount: commands.length });
  }

  dispose(): void {
    this.layers.length = 0;
    this.elementCommands.clear();
    this.stackingTree = null;
    this.renderTree = null;
    this.eventListeners.clear();
    this.layerTree?.dispose();
    this.layerTree = null;
    this.layerCompositor?.dispose();
    this.layerCompositor = null;
    if ('dispose' in this.rasterizer) {
      (this.rasterizer as GpuRasterizer).dispose();
    }
  }

  // ── COMPOSITOR INTEGRATION ───────────────────────────────────────

  /**
   * Set a LayerCompositor for compositing-layer-based rendering.
   * When set, paint() will also build a LayerTree.
   */
  setLayerCompositor(compositor: LayerCompositor): void {
    this.layerCompositor = compositor;
  }

  /**
   * Set an overlay opacity resolver (e.g. CSS animation values). The resolver
   * returns the current animated opacity for an element or null to fall back
   * to the computed style.
   */
  setOpacityResolver(resolver: ((el: DomElement) => number | null) | null): void {
    this._opacityResolver = resolver;
  }

  setTransformResolver(resolver: ((el: DomElement) => string | null) | null): void {
    this._transformResolver = resolver;
  }

  private stackingBuildOptions() {
    const opts: { opacityResolver?: (el: DomElement) => number | null; transformResolver?: (el: DomElement) => string | null } = {};
    if (this._opacityResolver) opts.opacityResolver = this._opacityResolver;
    if (this._transformResolver) opts.transformResolver = this._transformResolver;
    return Object.keys(opts).length ? opts : undefined;
  }

  /**
   * Get the current LayerCompositor, if any.
   */
  getLayerCompositor(): LayerCompositor | null {
    return this.layerCompositor;
  }

  /**
   * Get the current LayerTree (built during paint()).
   */
  getLayerTree(): LayerTree | null {
    return this.layerTree;
  }

  /**
   * Get or set the layer promoter for controlling which elements become layers.
   */
  getLayerPromoter(): LayerPromoter {
    return this.layerPromoter;
  }

  setLayerPromoter(promoter: LayerPromoter): void {
    this.layerPromoter = promoter;
  }

  /**
   * Composite using the LayerCompositor for per-layer textures.
   * Returns an ImageData with composited layers.
   *
   * Falls back to flat compositeFrame() if no compositor is set.
   */
  compositeFrameWithLayers(): ImageData {
    if (!this.layerCompositor || !this.layerTree) {
      // Fallback: use flat compositing
      const commands = this.compositeFrame();
      return this.rasterizer.rasterize(commands);
    }
    return this.layerCompositor.composite(this.layerTree);
  }

  /**
   * Incremental composite using layers — only dirty layers are re-rasterized.
   */
  compositeFrameIncrementalLayers(): ImageData {
    if (!this.layerCompositor || !this.layerTree) {
      const commands = this.compositeFrame();
      return this.rasterizer.rasterize(commands);
    }
    return this.layerCompositor.compositeIncremental(this.layerTree);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getZIndex(element: DomElement): number {
  const style = element.computedStyle ?? new Map();
  const zRaw = style.get('z-index');
  if (!zRaw || zRaw === 'auto') return 0;
  const z = parseInt(zRaw, 10);
  return isNaN(z) ? 0 : z;
}

/** Convert RGBA object to CSS rgba() string */
function colorToString(c: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${c.a})`;
}

export { PaintEngine, DEFAULT_PAINT_CONFIG };
export type { IPaintEngine, PaintLayer, PaintCommand, PaintCommandType, PaintConfig, PaintEventUnion, PaintEventType };
