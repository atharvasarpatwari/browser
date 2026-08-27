/**
 * compositor.ts
 * -------------
 * Rendering layer — Session 6 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Takes the stacking tree from stacking-context.ts (session 5) and produces
 * a composite plan: an ordered list of compositing layers (one segment per
 * stacking context, in Appendix E paint order) with per-layer command
 * lists, bounds, isolation flags, viewport culling, and statistics.
 *
 * Layer segmentation mirrors flattenStackingOrder exactly: a context's
 * commands may split into multiple consecutive segments around negative-z
 * children (its background paints before them, its flow content after).
 *
 * A layer "needs isolation" when its source context has group semantics
 * (opacity < 1 or a transform): its commands must render into their own
 * buffer first and blend as a group rather than painting straight onto
 * the backdrop.
 */

import { type LayoutBox, type Rect } from "./layout-box";
import type { StackingNode } from "./stacking-context";
import { PaintCommandKind, type PaintCommand } from "./paint-record";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Approximate on-screen rectangle occupied by any paint command. */
export function commandRect(command: PaintCommand): Rect {
  switch (command.kind) {
    case PaintCommandKind.FillRect:
    case PaintCommandKind.StrokeRect:
    case PaintCommandKind.DrawImagePlaceholder:
      return command.rect;
    case PaintCommandKind.DrawText: {
      // Deterministic estimate: average glyph advance ≈ 0.6em, line box
      // ≈ 1.2em with the baseline sitting at ~1em from the top edge.
      const width = command.text.length * command.fontSize * 0.6;
      const height = command.fontSize * 1.2;
      return { x: command.x, y: command.y - command.fontSize, width, height };
    }
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function unionRect(target: Rect | null, add: Rect): Rect {
  if (!target) return { ...add };
  const x = Math.min(target.x, add.x);
  const y = Math.min(target.y, add.y);
  const right = Math.max(target.x + target.width, add.x + add.width);
  const bottom = Math.max(target.y + target.height, add.y + add.height);
  return { x, y, width: right - x, height: bottom - y };
}

function clipToBounds(commands: readonly PaintCommand[], viewport: Rect | undefined): PaintCommand[] {
  const kept: PaintCommand[] = [];
  for (const cmd of commands) {
    if (viewport && !intersects(commandRect(cmd), viewport)) continue;
    kept.push(cmd);
  }
  return kept;
}

function boundsOf(commands: readonly PaintCommand[]): Rect {
  let bounds: Rect | null = null;
  for (const cmd of commands) bounds = unionRect(bounds, commandRect(cmd));
  return bounds ?? { x: 0, y: 0, width: 0, height: 0 };
}

// ---------------------------------------------------------------------------
// Composite plan types
// ---------------------------------------------------------------------------

export interface CompositeLayer {
  /** Sequential id ("layer-1", "layer-2", ...) in paint order. */
  readonly id: string;
  /** Union of member command rects (after culling). */
  readonly bounds: Rect;
  /** Commands painted within this layer, in final paint order. */
  readonly commands: readonly PaintCommand[];
  /**
   * True when the group must render into its own buffer and blend with
   * group semantics (source context has opacity < 1 or a transform).
   */
  readonly needsIsolation: boolean;
  /** Box forming the layer's stacking context; null for base segments. */
  readonly sourceBox: LayoutBox | null;
}

export interface CompositeStats {
  readonly totalCommandsIn: number;
  readonly totalCommandsOut: number;
  readonly culledCommands: number;
  readonly layerCount: number;
}

export interface CompositePlan {
  /** Layers in final paint order (Appendix E). */
  readonly layers: readonly CompositeLayer[];
  /** Effective culling viewport; unbounded rect when no viewport given. */
  readonly viewport: Rect;
  readonly stats: CompositeStats;
}

export interface PlanCompositingOptions {
  /**
   * Cull commands whose rect lies fully outside this rect. Omit to skip
   * culling entirely.
   */
  readonly viewport?: Rect;
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

const UNBOUNDED: Rect = {
  x: Number.NEGATIVE_INFINITY,
  y: Number.NEGATIVE_INFINITY,
  width: Number.POSITIVE_INFINITY,
  height: Number.POSITIVE_INFINITY,
};

/**
 * Builds a composite plan from a stacking tree. Layers appear in final
 * paint order; each contains only commands owned directly by its stacking
 * context (child contexts become their own layers).
 */
export function planCompositing(
  rootNode: StackingNode,
  options: PlanCompositingOptions = {},
): CompositePlan {
  const viewport = options.viewport;
  const layers: CompositeLayer[] = [];
  let commandsIn = 0;

  const needsIsolationOf = (node: StackingNode): boolean => {
    if (node.isRoot) return false;
    const style = node.box.style;
    if (typeof style.opacity === "number" && style.opacity < 1) return true;
    const transform = style.transform;
    return typeof transform === "string" && transform.length > 0 && transform !== "none";
  };

  /** Emits one layer segment for `owner`, applying culling; skips empties. */
  const sink = (owner: StackingNode, commands: PaintCommand[]): void => {
    if (commands.length === 0) return;
    commandsIn += commands.length;
    const kept = clipToBounds(commands, viewport);
    if (kept.length === 0) return;
    layers.push({
      id: `layer-${layers.length + 1}`,
      bounds: boundsOf(kept),
      commands: kept,
      needsIsolation: needsIsolationOf(owner),
      sourceBox: owner.isRoot ? null : owner.box,
    });
  };

  // Walk identical to flattenStackingOrder, but sinking per-context chunks.
  const emit = (node: StackingNode): void => {
    const chunk: PaintCommand[] = [];

    // Step 1: the context element's own background/border/placeholder.
    for (const item of node.items) {
      if (item.kind === "command" && item.command.sourceBox === node.box) {
        chunk.push(item.command);
      }
    }
    sink(node, chunk);
    chunk.length = 0;

    // Step 2: negative-z child contexts (z ascending, doc-order ties).
    const negatives = node.children
      .filter((c) => c.zIndex < 0)
      .sort((a, b) => a.zIndex - b.zIndex);
    for (const child of negatives) emit(child);

    // Step 3: document-order content + z=0/auto child contexts.
    for (const item of node.items) {
      if (item.kind === "command") {
        if (item.command.sourceBox !== node.box) chunk.push(item.command);
      } else if (item.node.zIndex === 0) {
        sink(node, chunk);
        chunk.length = 0;
        emit(item.node);
      }
    }

    // Step 4: positive-z child contexts (z ascending, doc-order ties).
    const positives = node.children
      .filter((c) => c.zIndex > 0)
      .sort((a, b) => a.zIndex - b.zIndex);
    for (const child of positives) {
      sink(node, chunk);
      chunk.length = 0;
      emit(child);
    }

    sink(node, chunk);
  };

  emit(rootNode);

  const totalOut = layers.reduce((sum, l) => sum + l.commands.length, 0);
  const stats: CompositeStats = {
    totalCommandsIn: commandsIn,
    totalCommandsOut: totalOut,
    culledCommands: commandsIn - totalOut,
    layerCount: layers.length,
  };

  return { layers, viewport: viewport ?? UNBOUNDED, stats };
}

// ---------------------------------------------------------------------------
// Standalone culling utility
// ---------------------------------------------------------------------------

/** Splits commands into those intersecting the viewport and the rest. */
export function cullCommands(
  commands: readonly PaintCommand[],
  viewport: Rect,
): { kept: PaintCommand[]; culled: PaintCommand[] } {
  const kept: PaintCommand[] = [];
  const culled: PaintCommand[] = [];
  for (const cmd of commands) {
    if (intersects(commandRect(cmd), viewport)) kept.push(cmd);
    else culled.push(cmd);
  }
  return { kept, culled };
}
