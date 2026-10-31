import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument, DomElement, DomNode, LayoutBox, TextRun } from './dom-tree';
import { boxChildren } from './dom-tree';
import { listMarkerCommands } from './list-markers';
import { getTextMeasurer } from './formatting/text-measure';
import { DamageTracker } from './damage-tracker';
import {
  buildStackingContextTree,
  renderStackingContext,
  createsStackingContext,
  type StackingContext,
  type PaintCmd,
} from './formatting/stacking';
import { buildRenderObject, sortByPaintOrder, type RenderObject } from './render-tree';
import { Rasterizer, isParsableColor } from './rasterizer';
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
import { parseTransform, isPureTranslation4x4 } from './transform-parser';
import type { BlendMode } from './blend-modes';
import { paintControlContent } from './form-controls';
import { EMPTY_CLIP, clipFromAncestors, overflowClipRect } from './clip';
import { cssOpacity } from './formatting/stacking';

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
  | 'applyFilterList' | 'beginClipShape' | 'applyClipShape' | 'setBorderRadius' | 'fillRoundedRing'
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
  readonly translate: { x: number; y: number } | null;
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

/** The tallest page rasterised (rows): 1920 × 16,384 × 4 bytes ≈ 126 MB. Content below it cannot be scrolled to. */
const MAX_PAGE_HEIGHT = 16_384;

interface PaintConfig {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly backgroundColor: string;
  readonly showDebugBorders: boolean;
  readonly hardwareAcceleration: boolean;
}

/** The page's vertical scroll: the bitmap shows `viewportHeight` rows of a `documentHeight` tall page, starting at `y`. */
interface PageScroll {
  readonly y: number;
  /** The largest `y` the page can scroll to. */
  readonly max: number;
  readonly viewportHeight: number;
  readonly documentHeight: number;
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
  /** Scrolls the page to `y` (clamped to the document); returns where it ended up. Takes effect on the next `rasterize()`. */
  setScroll(y: number): number;
  getScroll(): PageScroll;
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

/**
 * CSS Backgrounds §2.11.2: the canvas (everything below a short page) takes the root
 * element's background, or <body>'s when the root has none. It used to stay white.
 */
function propagatedCanvasBackground(document: DomDocument): string | null {
  for (const el of [document.htmlElement, document.bodyElement]) {
    const style = el?.computedStyle;
    if (!style) continue;
    let color = style.get('background-color') ?? 'transparent';
    const shorthand = style.get('background');
    if (isTransparent(color) && shorthand && !/url\(|gradient\(/.test(shorthand)) color = shorthand;
    // An unparsable colour would be drawn black over the whole screen; fall back to white.
    if (!isTransparent(color)) return isParsableColor(color) ? color : null;
  }
  return null;
}

function isTransparent(color: string): boolean {
  const c = color.replace(/\s+/g, '').toLowerCase();
  return c === '' || c === 'none' || c === 'transparent' || /^rgba\(\d+,\d+,\d+,0(\.0*)?\)$/.test(c);
}

/**
 * The x where `text-overflow: ellipsis` cuts a box's own text (its content box's right edge), or null.
 * ponytail: text owned by inline children (a <span> inside the clipped box) isn't ellipsized.
 */
function ellipsisEdge(box: LayoutBox, style: ReadonlyMap<string, string>): number | null {
  if ((style.get('text-overflow') ?? 'clip') !== 'ellipsis') return null;
  const ov = style.get('overflow-x') ?? style.get('overflow') ?? 'visible';
  if (ov === 'visible') return null;
  return box.x + box.width - box.borderRight - box.paddingRight;
}

/**
 * text-overflow: ellipsis over a box's own runs: on each line that crosses `edge`, the nearest
 * run at or before the crossing that can hold "…" is shortened to end in it, and every later run on
 * that line is dropped (null). When the crossing run was a space or too close to the edge for "…",
 * nothing was drawn: the line just ended at the clip (seen on the tablet).
 */
function ellipsizeRuns(runs: readonly TextRun[], edge: number): Map<number, TextRun | null> {
  const out = new Map<number, TextRun | null>();
  const lines = new Map<number, number[]>();
  runs.forEach((r, i) => { const l = lines.get(r.y) ?? []; l.push(i); lines.set(r.y, l); });
  for (const idxs of lines.values()) {
    const cross = idxs.findIndex((i) => { const r = runs[i]!; return r.width !== undefined && r.x + r.width > edge + 0.5; });
    if (cross < 0) continue;
    let placed = false;
    for (let k = cross; k >= 0 && !placed; k--) {
      const r = runs[idxs[k]!]!;
      if (!r.text.trim() || r.x >= edge) { out.set(idxs[k]!, null); continue; }
      const fit = fitWithEllipsis(r, edge - r.x);
      if (fit) { out.set(idxs[k]!, fit); placed = true; } else out.set(idxs[k]!, null);
    }
    for (let k = cross + 1; k < idxs.length; k++) out.set(idxs[k]!, null);
  }
  return out;
}

/** `run` shortened to fit `room` px with a trailing "…", or null when not even "…" fits. */
function fitWithEllipsis(run: TextRun, room: number): TextRun | null {
  const m = getTextMeasurer();
  const w = (t: string): number => m.measure(t, run.fontSize, run.fontFamily, run.fontWeight ?? 'normal').width;
  const chars = [...run.text];
  for (let n = chars.length; n >= 0; n--) {
    const text = chars.slice(0, n).join('').trimEnd() + '\u2026';
    const width = w(text);
    if (width <= room || n === 0) return width <= room ? { ...run, text, width, letterSpacing: undefined } : null;
  }
  return null;
}

/** Is `el` a `position: fixed` box or inside one? */
function isInFixedBox(el: DomElement): boolean {
  for (let n: DomNode | null = el; n && n.nodeType === 'element'; n = n.parent) {
    if ((n as DomElement).computedStyle?.get('position') === 'fixed') return true;
  }
  return false;
}

/** Straight-alpha source-over of `src` onto `dst` (same size). */
function blendOver(dst: Uint8ClampedArray, src: Uint8ClampedArray): void {
  for (let i = 0; i < dst.length; i += 4) {
    const a = src[i + 3]!;
    if (a === 0) continue;
    if (a === 255) { dst[i] = src[i]!; dst[i + 1] = src[i + 1]!; dst[i + 2] = src[i + 2]!; dst[i + 3] = 255; continue; }
    const k = a / 255, j = 1 - k;
    dst[i] = src[i]! * k + dst[i]! * j;
    dst[i + 1] = src[i + 1]! * k + dst[i + 1]! * j;
    dst[i + 2] = src[i + 2]! * k + dst[i + 2]! * j;
    dst[i + 3] = Math.max(dst[i + 3]!, a);
  }
}

class PaintEngine implements IPaintEngine {
  private config: PaintConfig;
  private readonly layers: PaintLayer[] = [];
  private readonly eventListeners = new Map<PaintEventType, Set<(e: PaintEventUnion) => void>>();
  private stackingTree: StackingContext | null = null;
  private renderTree: RenderObject | null = null;
  private readonly elementCommands = new Map<DomElement, PaintCommand[]>();
  private rasterizer: Rasterizer | GpuRasterizer;
  private scrollY = 0;
  private documentHeight = 0;
  /** The page's own canvas colour (root, else body background); null → config.backgroundColor. */
  private canvasBackground: string | null = null;
  /** A page taller than the viewport is rasterised whole, once, into this (scrolling then only crops it). */
  private tall: { readonly rasterizer: Rasterizer | GpuRasterizer; readonly height: number } | null = null;
  private fullFrame: ImageData | null = null;
  private fullFrameStale = true;
  /**
   * Elements in a `position: fixed` box. On a tall page they are left out of the page bitmap and
   * drawn over each scrolled crop from `fixedOverlay` (laid out in viewport coordinates already),
   * so they stay put. They used to scroll away with the page (httpforever's theme switcher).
   */
  private fixedElements = new Set<DomElement>();
  private fixedOverlay: ImageData | null = null;

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
    this.documentHeight = measureDocumentHeight(document);
    this.canvasBackground = propagatedCanvasBackground(document);
    this.fullFrameStale = true;

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
    for (const child of boxChildren(node)) {
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
    this.documentHeight = measureDocumentHeight(document);
    this.canvasBackground = propagatedCanvasBackground(document);
    this.fullFrameStale = true;

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
        { type: 'setFillStyle', params: [this.canvasBackground ?? this.config.backgroundColor] },
        { type: 'fillRect', params: [0, 0, this.config.width, this.config.height] },
      ],
      bounds: null,
      translate: null,
    });

    const allElements: DomElement[] = [];
    this.collectElements(root, allElements);
    this.fixedElements = new Set(allElements.filter(isInFixedBox));

    for (const el of allElements) {
      this.paintElement(el);
    }
  }

  private collectElements(node: DomElement, list: DomElement[]): void {
    const style = node.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';
    if (display === 'none') return;

    list.push(node);
    for (const child of boxChildren(node)) {
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

  /** `part`: 'page' leaves out fixed boxes, 'fixed' draws only them (no background). */
  compositeFrame(part: 'all' | 'page' | 'fixed' = 'all'): PaintCommand[] {
    const height = this.rasterHeight();
    const allCommands: PaintCommand[] = part === 'fixed' ? [] : [
      { type: 'clearRect', params: [0, 0, this.config.width, height] },
      { type: 'setFillStyle', params: [this.canvasBackground ?? this.config.backgroundColor] },
      { type: 'fillRect', params: [0, 0, this.config.width, height] },
    ];

    if (this.stackingTree) {
      // Render using the stacking context tree (spec-compliant paint order)
      // A stacking context's own background (bgCommands) bypasses the callback: without `include`
      // the animated cards on httpforever (opacity makes them contexts) went into the fixed
      // overlay, opaque, and covered their own text on every frame after the first.
      const include = part === 'all' ? undefined : (el: DomElement) => this.fixedElements.has(el) === (part === 'fixed');
      const ctxCommands = renderStackingContext(this.stackingTree, (el) => {
        if (include && !include(el)) return [];
        return this.getElementPaintCommands(el);
      }, include);
      allCommands.push(...(ctxCommands as PaintCommand[]));
    } else {
      // Fallback: flat sort (shouldn't happen but safe)
      const sortedLayers = [...this.layers].sort((a, b) => a.zIndex - b.zIndex);
      for (const layer of sortedLayers) {
        if (layer.opacity <= 0) continue;

        const hasTranslate = layer.translate && (layer.translate.x !== 0 || layer.translate.y !== 0);
        const needsSave = layer.opacity < 1 || hasTranslate;

        if (needsSave) {
          allCommands.push({ type: 'save', params: [] });
        }
        if (layer.opacity < 1) {
          allCommands.push({ type: 'setGlobalAlpha', params: [layer.opacity] });
        }
        if (hasTranslate) {
          allCommands.push({ type: 'translate', params: [layer.translate!.x, layer.translate!.y] });
        }
        allCommands.push(...layer.commands);
        if (needsSave) {
          allCommands.push({ type: 'restore', params: [] });
        }
      }
    }

    return allCommands;
  }

  /**
   * The bitmap of the page as scrolled: the viewport-sized frame. A page taller than the viewport is rasterised whole
   * (up to MAX_PAGE_HEIGHT rows) the first time and after each change; scrolling only crops a window out of it, so a
   * scroll tick costs a copy, not a repaint. The software rasteriser draws in absolute pixels, which is why the page
   * is not simply shifted.
   */
  rasterize(): ImageData {
    const height = this.rasterHeight();
    if (height <= this.config.height) return this.rasterizer.rasterize(this.compositeFrame());

    if (this.fullFrameStale || !this.fullFrame || this.fullFrame.height !== height) {
      if (this.tall?.height !== height) this.tall = { rasterizer: this.createRasterizer(height), height };
      const split = this.fixedElements.size > 0;
      this.fullFrame = this.tall!.rasterizer.rasterize(this.compositeFrame(split ? 'page' : 'all'));
      this.fixedOverlay = split
        ? new Rasterizer({ width: this.config.width, height: this.config.height, devicePixelRatio: this.config.devicePixelRatio, backgroundColor: 'transparent' })
          .rasterize(this.compositeFrame('fixed'))
        : null;
      this.fullFrameStale = false;
    }
    const { width } = this.fullFrame;
    const from = this.getScroll().y * width * 4;
    const frame = new ImageData(this.fullFrame.data.slice(from, from + this.config.height * width * 4), width, this.config.height);
    if (this.fixedOverlay) blendOver(frame.data, this.fixedOverlay.data);
    return frame;
  }

  /** Rows rasterised: the document's height, at least the viewport and at most MAX_PAGE_HEIGHT. */
  private rasterHeight(): number {
    return Math.min(MAX_PAGE_HEIGHT, Math.max(this.config.height, Math.ceil(this.documentHeight)));
  }

  async rasterizeAsync(): Promise<ImageData> {
    const commands = this.compositeFrame();
    return this.rasterizer.rasterizeAsync(commands);
  }

  resize(width: number, height: number): void {
    this.config = { ...this.config, width, height };
    this.rasterizer = this.createRasterizer();
    this.tall = null;
    this.fullFrameStale = true;
  }

  setScroll(y: number): number {
    this.scrollY = Math.max(0, Math.min(Number.isFinite(y) ? Math.round(y) : 0, this.maxScroll()));
    return this.scrollY;
  }

  getScroll(): PageScroll {
    const max = this.maxScroll();
    return { y: Math.min(this.scrollY, max), max, viewportHeight: this.config.height, documentHeight: this.documentHeight };
  }

  private maxScroll(): number {
    return this.rasterHeight() - this.config.height;
  }

  getConfig(): PaintConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<PaintConfig>): void {
    this.config = { ...this.config, ...config };
    this.fullFrameStale = true;
    if ('hardwareAcceleration' in config || 'width' in config || 'height' in config) {
      this.rasterizer = this.createRasterizer();
      this.tall = null;
    }
  }

  private createRasterizer(height: number = this.config.height): Rasterizer | GpuRasterizer {
    if (this.config.hardwareAcceleration) {
      return new GpuRasterizer({
        width: this.config.width,
        height,
        devicePixelRatio: this.config.devicePixelRatio,
        backgroundColor: this.config.backgroundColor,
      });
    }
    return new Rasterizer({
      width: this.config.width,
      height,
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

    let commands: PaintCommand[] = [];
    const style = node.computedStyle ?? new Map();
    const layoutBox: LayoutBox | null = (node as { layoutBox: LayoutBox | null }).layoutBox ?? null;
    // visibility is inherited, so a visible child of a hidden parent still paints itself.
    const visible = style.get('visibility') !== 'hidden' && style.get('visibility') !== 'collapse';
    const outerClip = visible && layoutBox ? clipFromAncestors(node) : null;

    if (layoutBox && layoutBox.width > 0 && layoutBox.height > 0 && visible && outerClip !== EMPTY_CLIP) {
      const bx = layoutBox.x + layoutBox.borderLeft;
      const by = layoutBox.y + layoutBox.borderTop;
      const bw = layoutBox.width - layoutBox.borderLeft - layoutBox.borderRight;
      const bh = layoutBox.height - layoutBox.borderTop - layoutBox.borderBottom;

      // clip-path: the rasterizer keeps the pixels under the element from here, and applyClipShape
      // (after the element's content) puts them back outside the shape.
      const clipPathStart = style.get('clip-path');
      if (clipPathStart && clipPathStart !== 'none') {
        commands.push({ type: 'beginClipShape', params: [layoutBox.x, layoutBox.y, layoutBox.width, layoutBox.height] });
      }

      // ── Box shadow: behind the element (before its background), around its border box ──
      // It was painted after the background and over the whole padding box, so the shadow colour
      // veiled the element itself.
      const boxShadowVal = style.get('box-shadow');
      if (boxShadowVal && boxShadowVal !== 'none') {
        for (const shadow of parseBoxShadow(boxShadowVal)) {
          if (!shadow.inset) {
            commands.push({ type: 'applyBoxShadow', params: [shadow, layoutBox.x, layoutBox.y, layoutBox.width, layoutBox.height] });
          }
        }
      }

      // Rounded corners (border-radius) clip this element's background and borders. The radius was
      // only sent when the element had a border, never cleared, and the rasterizer ignored it, so
      // every rounded button, card and radio button painted square.
      const borderInfo = parseBorders(style, layoutBox.width, layoutBox.height);
      const hasRadius = borderInfo.radius.topLeft.w > 0 || borderInfo.radius.topRight.w > 0 ||
        borderInfo.radius.bottomLeft.w > 0 || borderInfo.radius.bottomRight.w > 0;
      if (hasRadius) {
        commands.push({ type: 'setBorderRadius', params: [borderInfo.radius, layoutBox.x, layoutBox.y, layoutBox.width, layoutBox.height] });
      }

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


      // ── Borders (enhanced with radius, per-side colors, dashed/dotted) ─
      const hasAnyBorder = borderInfo.top.width > 0 || borderInfo.right.width > 0 ||
        borderInfo.bottom.width > 0 || borderInfo.left.width > 0;
      if (hasAnyBorder) {
        const borderSides: { w: number; x: number; y: number; rw: number; rh: number; color: string; style: string }[] = [
          { w: borderInfo.top.width, x: layoutBox.x, y: layoutBox.y, rw: layoutBox.width, rh: borderInfo.top.width, color: colorToString(borderInfo.top.color), style: borderInfo.top.style },
          { w: borderInfo.bottom.width, x: layoutBox.x, y: layoutBox.y + layoutBox.height - borderInfo.bottom.width, rw: layoutBox.width, rh: borderInfo.bottom.width, color: colorToString(borderInfo.bottom.color), style: borderInfo.bottom.style },
          { w: borderInfo.left.width, x: layoutBox.x, y: layoutBox.y + borderInfo.top.width, rw: borderInfo.left.width, rh: layoutBox.height - borderInfo.top.width - borderInfo.bottom.width, color: colorToString(borderInfo.left.color), style: borderInfo.left.style },
          { w: borderInfo.right.width, x: layoutBox.x + layoutBox.width - borderInfo.right.width, y: layoutBox.y + borderInfo.top.width, rw: borderInfo.right.width, rh: layoutBox.height - borderInfo.top.width - borderInfo.bottom.width, color: colorToString(borderInfo.right.color), style: borderInfo.right.style },
        ];
        // A rounded border in one colour and style is drawn as a ring (outer rounded box minus the
        // inner one). Four straight strips clipped to the rounded box left only stubs: radio
        // buttons became four dashes.
        const t = borderInfo.top, rt = borderInfo.right, b = borderInfo.bottom, lf = borderInfo.left;
        const uniform = hasRadius && [rt, b, lf].every((sd) => colorToString(sd.color) === colorToString(t.color) && sd.style === t.style)
          && t.style !== 'dashed' && t.style !== 'dotted';
        if (uniform) {
          commands.push({ type: 'setFillStyle', params: [colorToString(t.color)] });
          commands.push({ type: 'fillRoundedRing', params: [borderInfo.radius, layoutBox.x, layoutBox.y, layoutBox.width, layoutBox.height, t.width, rt.width, b.width, lf.width] });
        }
        for (const s of uniform ? [] : borderSides) {
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

      if (hasRadius) commands.push({ type: 'setBorderRadius', params: [null, 0, 0, 0, 0] });

      // ── Own content (image, control, text) is clipped by the element's own overflow ──
      const ownClip = overflowClipRect(node);
      commands.push({ type: 'save', params: [] });
      if (ownClip) commands.push({ type: 'clip', params: [ownClip.x, ownClip.y, ownClip.w, ownClip.h] });

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

      // ── Form control content: value/placeholder, tick, chosen option ──
      commands.push(...paintControlContent(node, layoutBox, style));

      // ── Text runs (actual text content from inline formatting context) ───
      const textRuns = layoutBox.textRuns;
      if (textRuns && textRuns.length > 0) {
        const textShadowVal = style.get('text-shadow');
        const textShadows = textShadowVal ? parseTextShadow(textShadowVal) : [];
        const ellipsisAt = ellipsisEdge(layoutBox, style);
        const ellipsized = ellipsisAt !== null ? ellipsizeRuns(textRuns, ellipsisAt) : null;
        for (let ri = 0; ri < textRuns.length; ri++) {
          let run = textRuns[ri]!;
          // text-overflow: ellipsis (see ellipsizeRuns): a replaced run, or one dropped past the cut.
          if (ellipsized) {
            const r = ellipsized.get(ri);
            if (r === null) continue;
            if (r) run = r;
          }
          const weight = run.fontWeight ?? 'normal';
          if (textShadows.length > 0) {
            for (const ts of textShadows) {
              commands.push({ type: 'applyTextShadow', params: [ts, run.text, run.x, run.y, run.color, `${weight} ${run.fontSize}px ${run.fontFamily}`] });
            }
          }
          commands.push({ type: 'setFillStyle', params: [run.color] });
          commands.push({ type: 'setFont', params: [`${weight} ${run.fontSize}px ${run.fontFamily}`] });
          if (run.letterSpacing) {
            // letter-spacing: each character at its own position (it was ignored).
            let cx = run.x;
            const m = getTextMeasurer();
            for (const ch of run.text) {
              const w = m.measure(ch, run.fontSize, run.fontFamily, weight).width;
              if (ch.trim()) commands.push({ type: 'fillText', params: [ch, cx, run.y, w] });
              cx += w + run.letterSpacing;
            }
          } else {
            commands.push({
              type: 'fillText',
              params: run.width !== undefined ? [run.text, run.x, run.y, run.width] : [run.text, run.x, run.y],
            });
          }
          // text-decoration: was never painted (links had no underline). A whitespace run is
          // decorated only between two decorated runs on its line (the spaces inside one link):
          // skipping every space broke a link's underline into one piece per word.
          const prev = textRuns[ri - 1], next = textRuns[ri + 1];
          const decorates = !!run.text.trim() ||
            (!!prev?.decoration && !!next?.decoration && prev.y === run.y && next.y === run.y);
          if (run.decoration && run.width && decorates) {
            const thickness = Math.max(1, Math.round(run.fontSize / 16));
            commands.push({ type: 'setFillStyle', params: [run.decoration.color] });
            if (run.decoration.underline) commands.push({ type: 'fillRect', params: [run.x, run.y + Math.round(run.fontSize * 0.12), run.width, thickness] });
            if (run.decoration.lineThrough) commands.push({ type: 'fillRect', params: [run.x, run.y - Math.round(run.fontSize * 0.3), run.width, thickness] });
          }
        }
      }
      commands.push({ type: 'restore', params: [] });

      // ── List marker (outside the item's own clip: it sits left of the content box) ──
      if (style.get('display') === 'list-item' && style.get('list-style-position') !== 'inside') commands.push(...listMarkerCommands(node, layoutBox, style));

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

    // Scope this element's state (border radius, blend mode, clips) to itself: rasterizer state
    // used to carry over, so after one 1px `overflow:hidden` box every later draw was clipped away
    // (Wikipedia painted nothing below its header), and a rounded box rounded what followed it.
    if (commands.length > 0) {
      const head: PaintCommand[] = [{ type: 'save', params: [] }];
      if (outerClip) head.push({ type: 'clip', params: [outerClip.x, outerClip.y, outerClip.w, outerClip.h] });
      commands = [...head, ...commands, { type: 'restore', params: [] }];
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

    // Get animated transform for this element
    let translate: { x: number; y: number } | null = null;
    const animatedTransform = this._transformResolver?.(node);
    if (animatedTransform && animatedTransform !== 'none') {
      const parsed = parseTransform(animatedTransform);
      if (parsed && isPureTranslation4x4(parsed.matrix)) {
        translate = { x: parsed.matrix.m41, y: parsed.matrix.m42 };
      }
    }

    const layer: PaintLayer = {
      id: nextLayerId(),
      zIndex: layerZIndex,
      opacity: animatedOpacity ?? cssOpacity(style.get('opacity')),
      commands,
      bounds: (node as { layoutBox: LayoutBox | null }).layoutBox ?? null,
      translate,
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

/** The bottom edge of the laid-out document: the root or body box, whichever reaches further. */
function measureDocumentHeight(document: DomDocument): number {
  let bottom = 0;
  for (const el of [document.htmlElement, document.bodyElement]) {
    const box = el?.layoutBox;
    if (box) bottom = Math.max(bottom, box.y + box.height);
  }
  return bottom;
}

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
export type { IPaintEngine, PaintLayer, PaintCommand, PaintCommandType, PaintConfig, PaintEventUnion, PaintEventType, PageScroll };
