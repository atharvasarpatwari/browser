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

export {
  parseTransform, identity2D, identity4x4, isIdentity2D, isIdentity4x4,
  multiply2D, multiply4x4, to4x4, applyTransform2D, applyTransform,
  lerpNumber, lerpColor, lerpMatrices, decomposeMatrix,
} from './transform-parser';
export type { DOMMatrix2D, DOMMatrix4x4 } from './transform-parser';

export {
  ScrollCompositor, createScrollableContainer, scrollTo, scrollBy,
  clampScroll, getScrollTransform, isScrollable, getMaxScrollX, getMaxScrollY,
} from './scroll-compositor';
export type { ScrollableContainer } from './scroll-compositor';

export {
  KeyframeEffect, AnimationTimeline, Animation, createAnimation,
} from './animation-engine';
export type {
  Keyframe, KeyframeEffectOptions, AnimationPlayState, AnimationEventMap,
} from './animation-engine';

export { CompositorThread, FrameStatus } from './compositor-thread';
export type { CompositorFrameSnapshot, FrameResult, FrameCallback } from './compositor-thread';
