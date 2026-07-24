/**
 * @file Compositing module barrel exports.
 */

export { CompositingLayer } from './compositing-layer';
export type { CompositingLayerConfig, LayerBounds } from './compositing-layer';
export { LayerTree } from './layer-tree';
export { LayerPromoter } from './layer-promoter';
export type { PromotionHint } from './layer-promoter';
export { LayerCompositor } from './layer-compositor';
export type { CompositorConfig } from './layer-compositor';
export { TileGrid, TILE_SIZE } from './tile-grid';
export type { Tile, ViewportRect } from './tile-grid';
export { LayerDamageTracker } from './layer-damage-tracker';
