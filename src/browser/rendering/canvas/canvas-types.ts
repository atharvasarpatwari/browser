/**
 * @file canvas/canvas-types.ts
 * Core types for the Canvas 2D Graphics API.
 */

// ─────────────────────────────────────────────────────────────────────────────
// BASIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export type CanvasFillRule = 'nonzero' | 'evenodd';

export type CanvasLineCap = 'butt' | 'round' | 'square';
export type CanvasLineJoin = 'miter' | 'round' | 'bevel';
export type CanvasTextAlign = 'start' | 'end' | 'left' | 'right' | 'center';
export type CanvasTextBaseline = 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom';
export type CanvasDirection = 'ltr' | 'rtl' | 'inherit';
export type CanvasImageSmoothingQuality = 'low' | 'medium' | 'high';

// ─────────────────────────────────────────────────────────────────────────────
// 2D AFFINE TRANSFORM MATRIX
// ─────────────────────────────────────────────────────────────────────────────

export interface DOMMatrix2DInit {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  f?: number;
}

export interface DOMMatrix extends DOMMatrix2DInit {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH COMMANDS (internal representation)
// ─────────────────────────────────────────────────────────────────────────────

export type PathCommand =
  | { readonly type: 'moveTo'; readonly x: number; readonly y: number }
  | { readonly type: 'lineTo'; readonly x: number; readonly y: number }
  | { readonly type: 'quadraticCurveTo'; readonly cpx: number; readonly cpy: number; readonly x: number; readonly y: number }
  | { readonly type: 'bezierCurveTo'; readonly cp1x: number; readonly cp1y: number; readonly cp2x: number; readonly cp2y: number; readonly x: number; readonly y: number }
  | { readonly type: 'arc'; readonly cx: number; readonly cy: number; readonly r: number; readonly startAngle: number; readonly endAngle: number; readonly ccw: boolean }
  | { readonly type: 'ellipse'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number; readonly rotation: number; readonly startAngle: number; readonly endAngle: number; readonly ccw: boolean }
  | { readonly type: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly type: 'arcTo'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly r: number }
  | { readonly type: 'closePath' };

// ─────────────────────────────────────────────────────────────────────────────
// COLOR STOP (for gradients)
// ─────────────────────────────────────────────────────────────────────────────

export interface ColorStop {
  readonly offset: number;
  readonly color: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT STATE
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasContextState {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  globalAlpha: number;
  globalCompositeOperation: string;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  direction: CanvasDirection;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: CanvasImageSmoothingQuality;
  lineDashOffset: number;
  lineDash: readonly number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT METRICS
// ─────────────────────────────────────────────────────────────────────────────

export interface TextMetrics {
  readonly width: number;
  readonly actualBoundingBoxAscent: number;
  readonly actualBoundingBoxDescent: number;
  readonly actualBoundingBoxLeft: number;
  readonly actualBoundingBoxRight: number;
  readonly fontBoundingBoxAscent: number;
  readonly fontBoundingBoxDescent: number;
}

// Forward-declare to avoid circular deps
import type { CanvasGradient } from './canvas-gradient';
import type { CanvasPattern } from './canvas-pattern';
