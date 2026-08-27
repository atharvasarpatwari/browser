/**
 * paint-record.ts
 * ---------------
 * Rendering layer — Session 4 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Walks a laid-out LayoutBox tree (absolute-positioned contentRect on every
 * box, per layout-box.ts + text-shaping.ts) and produces a flat, ordered
 * display list of paint commands: fill rects (backgrounds), stroke rects
 * (borders), and draw-text commands (from line-box fragments).
 *
 * Scope for this session: painter's-algorithm document order only — each
 * box's background+border paints before its children, children paint in
 * tree order, text paints from line-box fragments. z-index / stacking
 * contexts are NOT applied yet (see TODO below) — that's session 5's job
 * (stacking-context.ts), which will re-order/re-group this same display
 * list rather than change how individual commands are built.
 */

import { BoxType, borderBoxRect, type LayoutBox, type Rect } from "./layout-box";
import type { ComputedStyleLike } from "./render-tree";

// ---------------------------------------------------------------------------
// Paint command types
// ---------------------------------------------------------------------------

export const enum PaintCommandKind {
  FillRect = "fill-rect",
  StrokeRect = "stroke-rect",
  DrawText = "draw-text",
  DrawImagePlaceholder = "draw-image-placeholder",
}

export interface FillRectCommand {
  readonly kind: PaintCommandKind.FillRect;
  readonly rect: Rect;
  readonly color: string;
  readonly sourceBox: LayoutBox;
}

/**
 * One rect + uniform color per border edge (top/right/bottom/left), rather
 * than a single stroked outline, since CSS borders can differ per side in
 * color/width. Emitted as up to four StrokeRect commands per box.
 */
export interface StrokeRectCommand {
  readonly kind: PaintCommandKind.StrokeRect;
  readonly rect: Rect;
  readonly color: string;
  readonly edge: "top" | "right" | "bottom" | "left";
  readonly sourceBox: LayoutBox;
}

export interface DrawTextCommand {
  readonly kind: PaintCommandKind.DrawText;
  readonly text: string;
  /** Baseline-relative origin: x is the left edge, y is the text baseline. */
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly fontSize: number;
  readonly sourceBox: LayoutBox;
}

export interface DrawImagePlaceholderCommand {
  readonly kind: PaintCommandKind.DrawImagePlaceholder;
  readonly rect: Rect;
  readonly sourceBox: LayoutBox;
}

export type PaintCommand =
  | FillRectCommand
  | StrokeRectCommand
  | DrawTextCommand
  | DrawImagePlaceholderCommand;

// ---------------------------------------------------------------------------
// Style value resolution helpers
// ---------------------------------------------------------------------------

interface PaintStyleLike {
  readonly backgroundColor?: unknown;
  readonly color?: unknown;
  readonly borderTopColor?: unknown;
  readonly borderRightColor?: unknown;
  readonly borderBottomColor?: unknown;
  readonly borderLeftColor?: unknown;
  readonly borderTopWidth?: unknown;
  readonly borderRightWidth?: unknown;
  readonly borderBottomWidth?: unknown;
  readonly borderLeftWidth?: unknown;
  readonly fontSize?: unknown;
}

const TRANSPARENT = "transparent";
const DEFAULT_TEXT_COLOR = "#000000";
const DEFAULT_BORDER_COLOR = "#000000";
const DEFAULT_FONT_SIZE = 16;

function readColor(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNonNegative(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PaintRecordOptions {
  /**
   * When false (default), boxes with opacity 0 or visibility:hidden still
   * occupy layout space (per render-tree.ts's documented behavior) but are
   * skipped for painting. Set true to include them anyway (useful for
   * devtools "force paint" style inspection in a later session).
   */
  readonly includeInvisible?: boolean;
}

/**
 * Builds a flat, paint-order-sorted display list from a laid-out box tree.
 */
export function buildPaintRecords(
  root: LayoutBox,
  options: PaintRecordOptions = {},
): PaintCommand[] {
  const commands: PaintCommand[] = [];
  paintBox(root, commands, options);
  return commands;
}

function shouldSkipPaint(style: ComputedStyleLike, options: PaintRecordOptions): boolean {
  if (options.includeInvisible) return false;
  if (style.visibility === "hidden" || style.visibility === "collapse") return true;
  if (style.opacity === 0) return true;
  return false;
}

function paintBox(
  box: LayoutBox,
  out: PaintCommand[],
  options: PaintRecordOptions,
): void {
  if (box.type === BoxType.TextRun) {
    // TextRun boxes are painted via their line-box fragments from the
    // containing inline formatting context (see paintInlineFragments),
    // never directly here — a TextRun reached in the tree walk has
    // already had its paint emitted by its parent's inlineLayout pass.
    return;
  }

  if (shouldSkipPaint(box.style, options)) return;

  paintBackgroundAndBorder(box, out);

  if (box.type === BoxType.Replaced) {
    out.push({
      kind: PaintCommandKind.DrawImagePlaceholder,
      rect: { ...box.contentRect },
      sourceBox: box,
    });
    return; // replaced elements don't recurse into normal-flow children
  }

  if (box.inlineLayout) {
    paintInlineFragments(box, out, options);
    return;
  }

  for (const child of box.children) {
    paintBox(child, out, options);
  }
}

function paintBackgroundAndBorder(box: LayoutBox, out: PaintCommand[]): void {
  const style = box.style as unknown as PaintStyleLike;
  const bg = readColor(style.backgroundColor, TRANSPARENT);
  if (bg !== TRANSPARENT) {
    out.push({
      kind: PaintCommandKind.FillRect,
      rect: borderBoxRect(box),
      color: bg,
      sourceBox: box,
    });
  }

  emitBorderEdge(box, out, "top", box.border.top, style.borderTopColor);
  emitBorderEdge(box, out, "right", box.border.right, style.borderRightColor);
  emitBorderEdge(box, out, "bottom", box.border.bottom, style.borderBottomColor);
  emitBorderEdge(box, out, "left", box.border.left, style.borderLeftColor);
}

function emitBorderEdge(
  box: LayoutBox,
  out: PaintCommand[],
  edge: "top" | "right" | "bottom" | "left",
  width: number,
  colorValue: unknown,
): void {
  if (width <= 0) return;
  const bb = borderBoxRect(box);
  const color = readColor(colorValue, DEFAULT_BORDER_COLOR);

  let rect: Rect;
  switch (edge) {
    case "top":
      rect = { x: bb.x, y: bb.y, width: bb.width, height: width };
      break;
    case "bottom":
      rect = { x: bb.x, y: bb.y + bb.height - width, width: bb.width, height: width };
      break;
    case "left":
      rect = { x: bb.x, y: bb.y, width, height: bb.height };
      break;
    case "right":
      rect = { x: bb.x + bb.width - width, y: bb.y, width, height: bb.height };
      break;
  }

  out.push({ kind: PaintCommandKind.StrokeRect, rect, color, edge, sourceBox: box });
}

/**
 * Paints an inline formatting context's content from its resolved
 * lineBoxes/fragments (text-shaping.ts output) rather than walking
 * box.children directly — a wrapped TextRun spans multiple fragments, and
 * this is the only place that has the per-fragment geometry to paint each
 * piece at its correct position.
 *
 * Non-text fragments (InlineBlock/Replaced atoms) recurse back into
 * paintBox using their own subtree, which by this point has correct
 * absolute coordinates (layout-box.ts's translateBoxSubtree, session-3
 * fix, guarantees this).
 */
function paintInlineFragments(
  container: LayoutBox,
  out: PaintCommand[],
  options: PaintRecordOptions,
): void {
  if (!container.inlineLayout) return;

  const paintedAtoms = new Set<LayoutBox>();

  for (const line of container.inlineLayout.lineBoxes) {
    for (const fragment of line.fragments) {
      if (fragment.box.type === BoxType.TextRun) {
        if (fragment.text.length === 0) continue;
        if (shouldSkipPaint(fragment.box.style, options)) continue;
        const style = fragment.box.style as unknown as PaintStyleLike;
        out.push({
          kind: PaintCommandKind.DrawText,
          text: fragment.text,
          x: fragment.rect.x,
          y: fragment.baseline,
          color: readColor(style.color, DEFAULT_TEXT_COLOR),
          fontSize: readNonNegative(style.fontSize, DEFAULT_FONT_SIZE),
          sourceBox: fragment.box,
        });
      } else {
        // InlineBlock / Replaced atom — paint its own box (background,
        // border, and recurse into its subtree) exactly once even though
        // wrapped-fragment de-duplication elsewhere only guards
        // contentRect assignment, not painting.
        if (paintedAtoms.has(fragment.box)) continue;
        paintedAtoms.add(fragment.box);
        paintBox(fragment.box, out, options);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export function countCommandsByKind(
  commands: readonly PaintCommand[],
): Record<PaintCommandKind, number> {
  const counts: Record<PaintCommandKind, number> = {
    [PaintCommandKind.FillRect]: 0,
    [PaintCommandKind.StrokeRect]: 0,
    [PaintCommandKind.DrawText]: 0,
    [PaintCommandKind.DrawImagePlaceholder]: 0,
  };
  for (const cmd of commands) {
    counts[cmd.kind]++;
  }
  return counts;
}
