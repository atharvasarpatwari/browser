/**
 * @file LayerCompositor — Main compositing engine.
 *
 * Takes a LayerTree and produces the final image by:
 * 1. Rasterizing dirty layers (per-layer)
 * 2. Compositing layer textures in z-order using alpha blending
 *
 * Supports both GPU (WebGPU compute shaders) and software fallback.
 */

import type { PaintCommand } from '../paint-engine';
import { Rasterizer } from '../rasterizer';
import { CompositingLayer, type LayerBounds } from './compositing-layer';
import { LayerTree } from './layer-tree';
import { TileGrid } from './tile-grid';
import { compositeBuffer } from '../blend-modes';
import type { BlendMode } from '../blend-modes';
import { parseGradient, isGradientValue } from '../css-gradients';
import { parseBorders } from '../borders-enhanced';
import { parseBoxShadow, parseTextShadow } from '../shadows';
import { parseFilter } from '../css-filters';
import { parseClipPath } from '../clip-mask';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface CompositorConfig {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio?: number;
  readonly backgroundColor?: string;
  readonly enableGpu?: boolean;
  readonly enableTileCulling?: boolean;
  readonly tileThreshold?: number;
}

const DEFAULT_COMPOSITOR_CONFIG: Required<CompositorConfig> = {
  width: 1920,
  height: 1080,
  devicePixelRatio: 1,
  backgroundColor: '#ffffff',
  enableGpu: false,
  enableTileCulling: true,
  tileThreshold: 512,
};

// ─────────────────────────────────────────────────────────────────────────────
// LAYER COMPOSITOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main compositing engine.
 *
 * Rasterizes each dirty compositing layer independently, then composites
 * all layer textures together in z-order to produce the final framebuffer.
 */
export class LayerCompositor {
  private config: Required<CompositorConfig>;
  private softwareRasterizer: Rasterizer;
  private framebuffer: Uint8ClampedArray;

  constructor(config: Partial<CompositorConfig> = {}) {
    this.config = { ...DEFAULT_COMPOSITOR_CONFIG, ...config };
    this.softwareRasterizer = new Rasterizer({
      width: this.config.width,
      height: this.config.height,
      devicePixelRatio: this.config.devicePixelRatio,
      backgroundColor: this.config.backgroundColor,
    });
    this.framebuffer = new Uint8ClampedArray(this.config.width * this.config.height * 4);
    this.fillBackground();
  }

  /**
   * Full composite: re-rasterize all layers, composite to final buffer.
   */
  composite(tree: LayerTree): ImageData {
    // Update layer bounds from DOM
    tree.updateBounds();

    // Rasterize all layers
    const layers = tree.getCompositingOrder();
    for (const layer of layers) {
      if (!layer.isEmpty()) {
        this.rasterizeLayer(layer);
      }
    }

    // Composite to framebuffer
    this.fillBackground();
    this.compositeLayerStack(layers);

    // Clear all damage
    tree.clearAllDamage();

    return new ImageData(
      new Uint8ClampedArray(this.framebuffer),
      this.config.width,
      this.config.height,
    );
  }

  /**
   * Incremental composite: only re-rasterize dirty layers.
   * Clean layers reuse their cached buffers.
   */
  compositeIncremental(tree: LayerTree): ImageData {
    tree.updateBounds();

    const allLayers = tree.getCompositingOrder();
    const dirtyLayers = tree.getDirtyLayers();

    // Only re-rasterize dirty layers
    for (const layer of dirtyLayers) {
      if (!layer.isEmpty()) {
        this.rasterizeLayer(layer);
      }
    }

    // Full composite (all layers, using cached buffers for clean ones)
    this.fillBackground();
    this.compositeLayerStack(allLayers);

    // Clear damage on composited layers
    for (const layer of dirtyLayers) {
      layer.clearDamage();
    }

    return new ImageData(
      new Uint8ClampedArray(this.framebuffer),
      this.config.width,
      this.config.height,
    );
  }

  /**
   * Resize the compositor.
   */
  resize(width: number, height: number): void {
    if (width === this.config.width && height === this.config.height) return;
    (this.config as { width: number }).width = width;
    (this.config as { height: number }).height = height;
    this.softwareRasterizer = new Rasterizer({
      width,
      height,
      devicePixelRatio: this.config.devicePixelRatio,
      backgroundColor: this.config.backgroundColor,
    });
    this.framebuffer = new Uint8ClampedArray(width * height * 4);
    this.fillBackground();
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.framebuffer = new Uint8ClampedArray(0);
  }

  // ── PER-LAYER RASTERIZATION ──────────────────────────────────────

  /**
   * Rasterize a single compositing layer.
   * If the layer has tiles, rasterize only dirty tiles.
   * Otherwise, rasterize the full layer.
   */
  private rasterizeLayer(layer: CompositingLayer): void {
    if (layer.tiles) {
      this.rasterizeLayerTiles(layer);
    } else {
      this.rasterizeLayerFull(layer);
    }
  }

  /**
   * Rasterize a full layer (no tiling).
   */
  private rasterizeLayerFull(layer: CompositingLayer): void {
    const { width, height } = layer.bounds;
    if (width <= 0 || height <= 0) return;

    // Build paint commands for this layer
    const commands = this.buildLayerCommands(layer);
    if (commands.length === 0) {
      layer.softwareBuffer = new Uint8ClampedArray(width * height * 4);
      return;
    }

    // Create a temporary rasterizer at layer size
    const tempRasterizer = new Rasterizer({
      width,
      height,
      backgroundColor: 'transparent',
    });

    // Translate commands to layer-local coordinates
    const localCommands = this.translateCommands(commands, -layer.bounds.x, -layer.bounds.y);

    // Rasterize
    tempRasterizer.rasterize(localCommands);
    layer.softwareBuffer = tempRasterizer.getPixels();

    // Cache dimensions
    layer.gpuTextureWidth = width;
    layer.gpuTextureHeight = height;
  }

  /**
   * Rasterize only the dirty tiles of a layer.
   */
  private rasterizeLayerTiles(layer: CompositingLayer): void {
    const tiles = layer.tiles!;
    const dirtyTiles = tiles.getDirtyTiles();
    if (dirtyTiles.length === 0) return;

    // Full layer commands (for tile rasterization)
    const commands = this.buildLayerCommands(layer);

    for (const tile of dirtyTiles) {
      // Create a temporary rasterizer at tile size
      const tempRasterizer = new Rasterizer({
        width: tile.width,
        height: tile.height,
        backgroundColor: 'transparent',
      });

      // Translate commands to tile-local coordinates
      const offsetX = -layer.bounds.x - tile.x;
      const offsetY = -layer.bounds.y - tile.y;
      const localCommands = this.translateCommands(commands, offsetX, offsetY);

      // Clip to tile bounds (set clip region)
      const clipped = this.clipCommandsToTile(localCommands, tile.width, tile.height);

      tempRasterizer.rasterize(clipped);
      tile.buffer = tempRasterizer.getPixels();
    }

    tiles.clearDirtyFlags();

    // Flatten tiles into layer buffer
    layer.softwareBuffer = tiles.flattenToBuffer();
    layer.gpuTextureWidth = layer.bounds.width;
    layer.gpuTextureHeight = layer.bounds.height;
  }

  // ── COMPOSITING ─────────────────────────────────────────────────

  /**
   * Composite all layers in z-order onto the framebuffer.
   * Uses source-over alpha blending.
   */
  private compositeLayerStack(layers: CompositingLayer[]): void {
    for (const layer of layers) {
      if (layer.isEmpty()) continue;
      if (!layer.softwareBuffer && !layer.tiles) continue;

      // Apply transform (handle translation component)
      let destX = layer.bounds.x;
      let destY = layer.bounds.y;
      if (layer.transformMatrix) {
        destX += layer.transformMatrix.m41;
        destY += layer.transformMatrix.m42;
      }
      destX -= layer.scrollOffset.x;
      destY -= layer.scrollOffset.y;

      // Skip off-screen layers if tile culling is enabled
      if (this.config.enableTileCulling) {
        const viewport = { x: 0, y: 0, width: this.config.width, height: this.config.height };
        const translatedBounds: LayerBounds = { x: destX, y: destY, width: layer.bounds.width, height: layer.bounds.height };
        if (!this.isLayerInViewport(translatedBounds, viewport)) continue;
      }

      const srcBuf = layer.softwareBuffer ?? layer.tiles?.flattenToBuffer();
      if (!srcBuf) continue;

      const opacity = layer.isGrouped ? layer.groupOpacity : 1;
      const blendMode = layer.sourceElement.computedStyle?.get('mix-blend-mode');
      this.alphaCompositeDstOverSrc(
        this.framebuffer,
        this.config.width,
        srcBuf,
        layer.bounds.width,
        layer.bounds.height,
        destX,
        destY,
        opacity,
        blendMode,
      );
    }
  }

  private isLayerInViewport(bounds: LayerBounds, viewport: { x: number; y: number; width: number; height: number }): boolean {
    return !(
      bounds.x + bounds.width < viewport.x ||
      bounds.x > viewport.x + viewport.width ||
      bounds.y + bounds.height < viewport.y ||
      bounds.y > viewport.y + viewport.height
    );
  }

  /**
   * Alpha composite source over destination (source-over blend mode).
   *
   * dst = dst * (1 - src.a * opacity) + src * opacity
   *
   * Both buffers are RGBA, 4 bytes per pixel.
   */
  private alphaCompositeDstOverSrc(
    dst: Uint8ClampedArray,
    dstWidth: number,
    src: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    dstX: number,
    dstY: number,
    opacity: number,
    blendMode?: string,
  ): void {
    const dstHeight = dst.length / (dstWidth * 4);

    if (blendMode && blendMode !== 'normal' && blendMode !== 'source-over') {
      const dstImg = new ImageData(new Uint8ClampedArray(dst), dstWidth, dstHeight);
      const srcImg = new ImageData(new Uint8ClampedArray(src), srcWidth, srcHeight);
      compositeBuffer(dstImg, srcImg, blendMode as BlendMode, 0, 0);
      for (let i = 0; i < dst.length; i++) dst[i] = dstImg.data[i];
      return;
    }

    // Clip source to framebuffer bounds
    const clippedX = Math.max(0, dstX);
    const clippedY = Math.max(0, dstY);
    const clippedRight = Math.min(dstWidth, dstX + srcWidth);
    const clippedBottom = Math.min(dstHeight, dstY + srcHeight);

    for (let sy = clippedY; sy < clippedBottom; sy++) {
      for (let sx = clippedX; sx < clippedRight; sx++) {
        const srcLocalX = sx - dstX;
        const srcLocalY = sy - dstY;
        const srcIdx = (srcLocalY * srcWidth + srcLocalX) * 4;
        const dstIdx = (sy * dstWidth + sx) * 4;

        const srcR = src[srcIdx]!;
        const srcG = src[srcIdx + 1]!;
        const srcB = src[srcIdx + 2]!;
        const srcA = (src[srcIdx + 3]! / 255) * opacity;

        if (srcA <= 0) continue;
        if (srcA >= 1) {
          dst[dstIdx] = srcR;
          dst[dstIdx + 1] = srcG;
          dst[dstIdx + 2] = srcB;
          dst[dstIdx + 3] = src[srcIdx + 3]!;
          continue;
        }

        const dstR = dst[dstIdx]!;
        const dstG = dst[dstIdx + 1]!;
        const dstB = dst[dstIdx + 2]!;
        const dstA = dst[dstIdx + 3]! / 255;

        const outA = srcA + dstA * (1 - srcA);
        if (outA <= 0) continue;

        dst[dstIdx] = (srcR * srcA + dstR * dstA * (1 - srcA)) / outA | 0;
        dst[dstIdx + 1] = (srcG * srcA + dstG * dstA * (1 - srcA)) / outA | 0;
        dst[dstIdx + 2] = (srcB * srcA + dstB * dstA * (1 - srcA)) / outA | 0;
        dst[dstIdx + 3] = outA * 255 | 0;
      }
    }
  }

  // ── COMMAND HELPERS ─────────────────────────────────────────────

  /**
   * Build paint commands for a layer from its stacking context.
   */
  private buildLayerCommands(layer: CompositingLayer): PaintCommand[] {
    // Use cached commands if available and not dirty
    if (layer.commands.length > 0 && !layer.isDirty) {
      return layer.commands;
    }

    const commands: PaintCommand[] = [];
    const ctx = layer.stackingContext;

    // Collect all element commands for this layer
    this.collectContextCommands(ctx, commands);

    layer.commands = commands;
    return commands;
  }

  /**
   * Collect paint commands from a stacking context tree.
   */
  private collectContextCommands(ctx: import('../formatting/stacking').StackingContext, out: PaintCommand[]): void {
    // Background/borders of the context-forming element
    for (const cmd of ctx.bgCommands) {
      out.push(cmd as PaintCommand);
    }

    // Block entries
    for (const el of ctx.blockEntries) {
      this.addElementCommands(el, out);
    }

    // Float entries
    for (const el of ctx.floatEntries) {
      this.addElementCommands(el, out);
    }

    // Inline entries
    for (const el of ctx.inlineEntries) {
      this.addElementCommands(el, out);
    }

    // Positioned auto entries
    for (const el of ctx.positionedAutoEntries) {
      this.addElementCommands(el, out);
    }

    // Recurse into child contexts
    for (const child of ctx.children) {
      this.collectContextCommands(child, out);
    }
  }

  /**
   * Generate paint commands for a single element.
   */
  private addElementCommands(el: import('../dom-tree').DomElement, out: PaintCommand[]): void {
    const box = el.layoutBox;
    if (!box || box.width === 0 || box.height === 0) return;

    const style = el.computedStyle ?? new Map();
    const bx = box.x + box.borderLeft;
    const by = box.y + box.borderTop;
    const bw = box.width - box.borderLeft - box.borderRight;
    const bh = box.height - box.borderTop - box.borderBottom;

    // Background (enhanced with gradients)
    const bgColor = style.get('background-color') ?? style.get('background') ?? 'transparent';
    const bgImage = style.get('background-image') ?? 'none';

    if (isGradientValue(bgImage)) {
      const grad = parseGradient(bgImage);
      if (grad) {
        out.push({ type: 'setFillGradient', params: [grad, bx, by, bw, bh] });
      } else {
        out.push({ type: 'setFillStyle', params: [bgColor] });
        out.push({ type: 'fillRect', params: [bx, by, bw, bh] });
      }
    } else if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
      out.push({ type: 'setFillStyle', params: [bgColor] });
      out.push({ type: 'fillRect', params: [bx, by, bw, bh] });
    } else if (bgColor !== 'transparent') {
      out.push({ type: 'setFillStyle', params: [bgColor] });
      out.push({ type: 'fillRect', params: [bx, by, bw, bh] });
    }

    // Outset box shadows
    const bsVal = style.get('box-shadow');
    if (bsVal && bsVal !== 'none') {
      const shadows = parseBoxShadow(bsVal);
      for (const shadow of shadows) {
        if (!shadow.inset) {
          out.push({ type: 'applyBoxShadow', params: [shadow, bx, by, bw, bh] });
        }
      }
    }

    // Borders (enhanced)
    const borderInfo = parseBorders(style, box.width, box.height);
    const hasAnyBorder = borderInfo.top.width > 0 || borderInfo.right.width > 0 ||
      borderInfo.bottom.width > 0 || borderInfo.left.width > 0;
    if (hasAnyBorder) {
      const borderColor = style.get('border-color') ?? style.get('border-top-color') ?? '#000000';
      const topS = [
        { w: borderInfo.top.width, x: box.x, y: box.y, rw: box.width, rh: borderInfo.top.width },
        { w: borderInfo.bottom.width, x: box.x, y: box.y + box.height - borderInfo.bottom.width, rw: box.width, rh: borderInfo.bottom.width },
        { w: borderInfo.left.width, x: box.x, y: box.y + borderInfo.top.width, rw: borderInfo.left.width, rh: box.height - borderInfo.top.width - borderInfo.bottom.width },
        { w: borderInfo.right.width, x: box.x + box.width - borderInfo.right.width, y: box.y + borderInfo.top.width, rw: borderInfo.right.width, rh: box.height - borderInfo.top.width - borderInfo.bottom.width },
      ];
      const hasRadius = borderInfo.radius.topLeft.w > 0 || borderInfo.radius.topRight.w > 0 ||
        borderInfo.radius.bottomLeft.w > 0 || borderInfo.radius.bottomRight.w > 0;
      if (hasRadius) {
        out.push({ type: 'setBorderRadius', params: [borderInfo.radius, box.x, box.y, box.width, box.height] });
      }
      for (const s of topS) {
        if (s.w <= 0) continue;
        out.push({ type: 'setFillStyle', params: [borderColor] });
        out.push({ type: 'fillRect', params: [s.x, s.y, s.rw, s.rh] });
      }
    }

    // Text runs with text-shadow
    const textShadowVal = style.get('text-shadow');
    const textShadows = textShadowVal ? parseTextShadow(textShadowVal) : [];
    if (box.textRuns && box.textRuns.length > 0) {
      for (const run of box.textRuns) {
        const weight = run.fontWeight ?? 'normal';
        if (textShadows.length > 0) {
          for (const ts of textShadows) {
            out.push({ type: 'applyTextShadow', params: [ts, run.text, run.x, run.y, run.color, `${weight} ${run.fontSize}px ${run.fontFamily}`] });
          }
        }
        out.push({ type: 'setFillStyle', params: [run.color] });
        out.push({ type: 'setFont', params: [`${weight} ${run.fontSize}px ${run.fontFamily}`] });
        out.push({ type: 'fillText', params: [run.text, run.x, run.y] });
      }
    }

    // Inset box shadows
    if (bsVal && bsVal !== 'none') {
      const shadows = parseBoxShadow(bsVal);
      for (const shadow of shadows) {
        if (shadow.inset) {
          out.push({ type: 'applyBoxShadow', params: [shadow, bx, by, bw, bh] });
        }
      }
    }

    // Filter effects
    const filterVal = style.get('filter');
    if (filterVal && filterVal !== 'none') {
      const filters = parseFilter(filterVal);
      if (filters.length > 0) {
        out.push({ type: 'applyFilterList', params: [filters, box.x, box.y, box.width, box.height] });
      }
    }

    // Clip-path
    const clipPathVal = style.get('clip-path');
    if (clipPathVal && clipPathVal !== 'none') {
      const clipInfo = parseClipPath(clipPathVal);
      if (clipInfo.shape.type !== 'none') {
        out.push({ type: 'applyClipShape', params: [clipInfo.shape, box.x, box.y, box.width, box.height] });
      }
    }

    // Blend mode
    const blendModeVal = style.get('mix-blend-mode');
    if (blendModeVal) {
      out.push({ type: 'setBlendMode', params: [blendModeVal] });
    }
  }

  /**
   * Translate paint commands by an offset.
   */
  private translateCommands(
    commands: readonly PaintCommand[],
    offsetX: number,
    offsetY: number,
  ): PaintCommand[] {
    if (offsetX === 0 && offsetY === 0) return [...commands];

    return commands.map(cmd => {
      if (cmd.type === 'fillRect' || cmd.type === 'clearRect' || cmd.type === 'strokeRect') {
        const [x, y, w, h] = cmd.params as [number, number, number, number];
        return { type: cmd.type, params: [x + offsetX, y + offsetY, w, h] };
      }
      if (cmd.type === 'fillText' || cmd.type === 'strokeText') {
        const [text, x, y] = cmd.params as [string, number, number];
        return { type: cmd.type, params: [text, x + offsetX, y + offsetY] };
      }
      if (cmd.type === 'drawImage') {
        const [img, x, y, w, h] = cmd.params as [unknown, number, number, number, number];
        return { type: cmd.type, params: [img, x + offsetX, y + offsetY, w, h] };
      }
      if (cmd.type === 'setFillGradient') {
        const [grad, gx, gy, gw, gh] = cmd.params as [unknown, number, number, number, number];
        return { type: cmd.type, params: [grad, gx + offsetX, gy + offsetY, gw, gh] };
      }
      if (cmd.type === 'applyBoxShadow') {
        const [shadow, sx, sy, sw, sh] = cmd.params as [unknown, number, number, number, number];
        return { type: cmd.type, params: [shadow, sx + offsetX, sy + offsetY, sw, sh] };
      }
      if (cmd.type === 'applyTextShadow') {
        const [ts, text, tx, ty, color, fontStr] = cmd.params as [unknown, string, number, number, string, string];
        return { type: cmd.type, params: [ts, text, tx + offsetX, ty + offsetY, color, fontStr] };
      }
      if (cmd.type === 'applyFilterList') {
        const [filters, fx, fy, fw, fh] = cmd.params as [unknown, number, number, number, number];
        return { type: cmd.type, params: [filters, fx + offsetX, fy + offsetY, fw, fh] };
      }
      if (cmd.type === 'applyClipShape') {
        const [shape, cx, cy, cw, ch] = cmd.params as [unknown, number, number, number, number];
        return { type: cmd.type, params: [shape, cx + offsetX, cy + offsetY, cw, ch] };
      }
      if (cmd.type === 'setBorderRadius') {
        const [rad, rx, ry, rw, rh] = cmd.params as [unknown, number, number, number, number];
        return { type: cmd.type, params: [rad, rx + offsetX, ry + offsetY, rw, rh] };
      }
      return cmd;
    });
  }

  /**
   * Clip commands to tile bounds (reject commands entirely outside).
   */
  private clipCommandsToTile(
    commands: readonly PaintCommand[],
    tileW: number,
    tileH: number,
  ): PaintCommand[] {
    return commands.filter(cmd => {
      if (cmd.type === 'fillRect' || cmd.type === 'clearRect' || cmd.type === 'strokeRect') {
        const [x, y, w, h] = cmd.params as [number, number, number, number];
        if (x + w <= 0 || y + h <= 0 || x >= tileW || y >= tileH) return false;
        return true;
      }
      if (cmd.type === 'fillText' || cmd.type === 'strokeText') {
        const [, x, y] = cmd.params as [string, number, number];
        return x >= -100 && x <= tileW + 100 && y >= -100 && y <= tileH + 100;
      }
      if (cmd.type === 'setFillGradient') {
        const [, gx, gy, gw, gh] = cmd.params as [unknown, number, number, number, number];
        return gx + gw > 0 && gy + gh > 0 && gx < tileW && gy < tileH;
      }
      if (cmd.type === 'applyBoxShadow') {
        const [, sx, sy, sw, sh] = cmd.params as [unknown, number, number, number, number];
        return sx + sw > 0 && sy + sh > 0 && sx < tileW && sy < tileH;
      }
      return true;
    });
  }

  /**
   * Fill the framebuffer with the background color.
   */
  private fillBackground(): void {
    const bg = this.parseColor(this.config.backgroundColor);
    for (let i = 0; i < this.framebuffer.length; i += 4) {
      this.framebuffer[i] = bg.r;
      this.framebuffer[i + 1] = bg.g;
      this.framebuffer[i + 2] = bg.b;
      this.framebuffer[i + 3] = 255;
    }
  }

  /**
   * Parse a CSS color string to RGB.
   */
  private parseColor(color: string): { r: number; g: number; b: number } {
    if (!color || color === 'transparent') return { r: 0, g: 0, b: 0 };

    // #rrggbb
    const hex6 = color.match(/^#([0-9a-f]{6})$/i);
    if (hex6) {
      const n = parseInt(hex6[1]!, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    // #rgb
    const hex3 = color.match(/^#([0-9a-f]{3})$/i);
    if (hex3) {
      const r = parseInt(hex3[1]![0]! + hex3[1]![0]!, 16);
      const g = parseInt(hex3[1]![1]! + hex3[1]![1]!, 16);
      const b = parseInt(hex3[1]![2]! + hex3[1]![2]!, 16);
      return { r, g, b };
    }

    // rgb(r, g, b)
    const rgb = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgb) {
      return { r: parseInt(rgb[1]!), g: parseInt(rgb[2]!), b: parseInt(rgb[3]!) };
    }

    // white fallback
    return { r: 255, g: 255, b: 255 };
  }
}
