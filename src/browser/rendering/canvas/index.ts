/**
 * @file canvas/index.ts
 * Public exports for the Canvas 2D Graphics API.
 */

export { CanvasRenderingContext2D } from './canvas-context';
export { HTMLCanvasElement } from './canvas-element';
export { Path2D } from './canvas-path';
export { CanvasGradient } from './canvas-gradient';
export { CanvasPattern } from './canvas-pattern';
export type {
  CanvasPoint,
  CanvasFillRule,
  CanvasLineCap,
  CanvasLineJoin,
  CanvasTextAlign,
  CanvasTextBaseline,
  CanvasDirection,
  CanvasImageSmoothingQuality,
  DOMMatrix2DInit,
  ColorStop,
  PathCommand,
  CanvasContextState,
  TextMetrics,
} from './canvas-types';
