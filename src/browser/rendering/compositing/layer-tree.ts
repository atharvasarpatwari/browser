/**
 * @file LayerTree — Tree of compositing layers mirroring the stacking context tree.
 *
 * Built from the stacking context tree + layer promoter. Manages layer lookup,
 * compositing order, and dirty layer tracking.
 */

import type { DomElement } from '../dom-tree';
import type { StackingContext } from '../formatting/stacking';
import { CompositingLayer, type CompositingLayerConfig } from './compositing-layer';
import { LayerPromoter, type PromotionHint } from './layer-promoter';
import type { ViewportRect } from './tile-grid';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface LayerTreeNode {
  readonly layer: CompositingLayer;
  readonly children: LayerTreeNode[];
  readonly nonPromotedElements: DomElement[];
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER TREE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the tree of compositing layers.
 *
 * Built from the stacking context tree by analyzing each context with the
 * LayerPromoter. Promoted contexts become CompositingLayer nodes; non-promoted
 * elements are collected into their nearest promoted ancestor's layer.
 */
export class LayerTree {
  readonly root: CompositingLayer;
  private readonly layerMap: Map<string, CompositingLayer>;
  private readonly elementMap: Map<DomElement, CompositingLayer>;
  private readonly allLayers: CompositingLayer[];
  private readonly rootNode: LayerTreeNode;

  private constructor(
    root: CompositingLayer,
    rootNode: LayerTreeNode,
    allLayers: CompositingLayer[],
    layerMap: Map<string, CompositingLayer>,
    elementMap: Map<DomElement, CompositingLayer>,
  ) {
    this.root = root;
    this.rootNode = rootNode;
    this.allLayers = allLayers;
    this.layerMap = layerMap;
    this.elementMap = elementMap;
  }

  /**
   * Build a LayerTree from a stacking context tree.
   *
   * @param stackingTree - Root stacking context from buildStackingContextTree()
   * @param promoter - Layer promotion analyzer
   * @param config - Optional layer configuration
   * @returns The root layer tree node
   */
  static fromStackingContext(
    stackingTree: StackingContext,
    promoter: LayerPromoter,
    config?: Partial<CompositingLayerConfig>,
  ): LayerTree {
    const layerMap = new Map<string, CompositingLayer>();
    const elementMap = new Map<DomElement, CompositingLayer>();
    const allLayers: CompositingLayer[] = [];

    const { layer: rootLayer, node: rootNode } = buildLayerNode(
      stackingTree,
      promoter,
      config,
      layerMap,
      elementMap,
      allLayers,
    );

    return new LayerTree(rootLayer, rootNode, allLayers, layerMap, elementMap);
  }

  /**
   * Find a layer by its ID.
   */
  findLayerById(id: string): CompositingLayer | null {
    return this.layerMap.get(id) ?? null;
  }

  /**
   * Find the compositing layer that owns a given DOM element.
   */
  findLayerByElement(el: DomElement): CompositingLayer | null {
    return this.elementMap.get(el) ?? null;
  }

  /**
   * Get all layers flattened in compositing order.
   *
   * Order: depth-first traversal, within each level sorted by z-index ascending.
   * This matches the CSS 2.2 stacking context paint order.
   */
  getCompositingOrder(): CompositingLayer[] {
    const order: CompositingLayer[] = [];
    this.collectLayersInOrder(this.rootNode, order);
    return order;
  }

  /**
   * Get only dirty layers that need re-rasterization.
   */
  getDirtyLayers(): CompositingLayer[] {
    return this.allLayers.filter(l => l.isDirty && !l.isEmpty());
  }

  /**
   * Get layers visible within a viewport rect.
   */
  getVisibleLayers(viewport: ViewportRect): CompositingLayer[] {
    return this.allLayers.filter(l => !l.isEmpty() && l.isVisuallyContained(viewport));
  }

  /**
   * Recalculate bounds for all layers from their source element's layoutBox.
   */
  updateBounds(): void {
    for (const layer of this.allLayers) {
      layer.updateBounds();
    }
  }

  /**
   * Clear all damage on all layers.
   */
  clearAllDamage(): void {
    for (const layer of this.allLayers) {
      layer.clearDamage();
    }
  }

  /**
   * Total number of compositing layers.
   */
  get layerCount(): number {
    return this.allLayers.length;
  }

  /**
   * All layers (read-only).
   */
  get layers(): readonly CompositingLayer[] {
    return this.allLayers;
  }

  /**
   * Dispose all layers and release resources.
   */
  dispose(): void {
    for (const layer of this.allLayers) {
      layer.dispose();
    }
    this.allLayers.length = 0;
    this.layerMap.clear();
    this.elementMap.clear();
  }

  // ── PRIVATE ─────────────────────────────────────────────────────────

  private collectLayersInOrder(node: LayerTreeNode, out: CompositingLayer[]): void {
    // The node's layer paints in its z-order position
    out.push(node.layer);

    // Children sorted by z-index (already sorted from buildLayerNode)
    for (const child of node.children) {
      this.collectLayersInOrder(child, out);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildLayerNode(
  ctx: StackingContext,
  promoter: LayerPromoter,
  config: Partial<CompositingLayerConfig> | undefined,
  layerMap: Map<string, CompositingLayer>,
  elementMap: Map<DomElement, CompositingLayer>,
  allLayers: CompositingLayer[],
): { layer: CompositingLayer; node: LayerTreeNode } {
  const hint = promoter.getHint(ctx);
  const layer = new CompositingLayer(ctx.element, ctx, config);

  layerMap.set(layer.id, layer);
  elementMap.set(ctx.element, layer);
  allLayers.push(layer);

  const children: LayerTreeNode[] = [];
  const nonPromoted: DomElement[] = [];

  for (const childCtx of ctx.children) {
    const childHint = promoter.getHint(childCtx);
    if (childHint.shouldPromote) {
      const { layer: childLayer, node: childNode } = buildLayerNode(
        childCtx,
        promoter,
        config,
        layerMap,
        elementMap,
        allLayers,
      );
      // Register child layer as owned by this layer's element
      elementMap.set(childCtx.element, childLayer);
      children.push(childNode);
    } else {
      // Non-promoted: this child's content stays in the parent layer
      nonPromoted.push(childCtx.element);
      // Also collect the child's non-promoted descendants
      collectNonPromotedElements(childCtx, nonPromoted);
    }
  }

  // Sort children by z-index ascending (stable sort preserves DOM order)
  children.sort((a, b) => a.layer.zIndex - b.layer.zIndex);

  return {
    layer,
    node: { layer, children, nonPromotedElements: nonPromoted },
  };
}

/**
 * Collect all elements from a non-promoted stacking context subtree.
 * These elements will be painted as part of the nearest promoted ancestor's layer.
 */
function collectNonPromotedElements(ctx: StackingContext, out: DomElement[]): void {
  // Collect direct entries
  for (const el of ctx.blockEntries) out.push(el);
  for (const el of ctx.floatEntries) out.push(el);
  for (const el of ctx.inlineEntries) out.push(el);
  for (const el of ctx.positionedAutoEntries) out.push(el);

  // Recurse into child stacking contexts (all are non-promoted since we're here)
  for (const childCtx of ctx.children) {
    out.push(childCtx.element);
    collectNonPromotedElements(childCtx, out);
  }
}
