/**
 * render-devtools-bridge.ts
 * -------------------------
 * Rendering layer — Session 9 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Inspectable bridge between the rendering pipeline and the DevTools panels.
 * Consumes a PipelineSnapshot (from repaint-scheduler.ts, session 8) and
 * produces serializable snapshots of every pipeline stage for DevTools to
 * render in its panels: paint command lists, stacking context trees,
 * compositing layer details, layout box trees, and per-frame performance
 * metrics.
 *
 * Read-only — never mutates pipeline state. All outputs are plain objects
 * safe to serialize over IPC to a DevTools frontend.
 */

import type { PipelineSnapshot, FrameMetrics } from "./repaint-scheduler";
import { PaintCommandKind, type PaintCommand } from "./paint-record";
import type { StackingNode } from "./stacking-context";
import type { CompositeLayer, CompositePlan } from "./compositor";
import type { LayoutBox } from "./layout-box";
import { BoxType } from "./layout-box";

// ---------------------------------------------------------------------------
// Serializable snapshot types
// ---------------------------------------------------------------------------

export interface PaintCommandSnapshot {
  readonly kind: string;
  readonly summary: string;
  /** Approximate bounding area for DevTools overlay highlights. */
  readonly bounds: { x: number; y: number; width: number; height: number } | null;
}

export interface StackingContextSnapshot {
  readonly zIndex: number;
  readonly isRoot: boolean;
  readonly boxLabel: string;
  readonly commandCount: number;
  readonly childCount: number;
  readonly children: readonly StackingContextSnapshot[];
}

export interface LayerSnapshot {
  readonly id: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly commandCount: number;
  readonly needsIsolation: boolean;
  readonly hasSourceBox: boolean;
}

export interface LayoutNodeSnapshot {
  readonly type: string;
  readonly label: string;
  readonly contentRect: { x: number; y: number; width: number; height: number };
  readonly childCount: number;
  readonly hasInlineLayout: boolean;
  readonly children: readonly LayoutNodeSnapshot[];
}

export interface PerformanceSnapshot {
  readonly frameNumber: number;
  readonly durationMs: number;
  readonly paintCommandCount: number;
  readonly layerCount: number;
  readonly culledCommands: number;
  readonly pixelCount: number;
  readonly completedAt: number;
}

export interface DevToolsSnapshot {
  /** ISO-8601 timestamp of when this snapshot was taken. */
  readonly timestamp: string;
  /** Performance metrics for the frame. */
  readonly performance: PerformanceSnapshot;
  /** Flattened paint command list (summary + bounds for overlay). */
  readonly paintCommands: readonly PaintCommandSnapshot[];
  /** Stacking context tree. */
  readonly stackingContext: StackingContextSnapshot | null;
  /** Compositing layers. */
  readonly layers: readonly LayerSnapshot[];
  /** Layout box tree (first 3 levels deep to avoid huge dumps). */
  readonly layoutTree: LayoutNodeSnapshot | null;
  /** Aggregate stats. */
  readonly stats: {
    readonly totalPaintCommands: number;
    readonly totalLayers: number;
    readonly totalStackingContexts: number;
    readonly totalLayoutBoxes: number;
  };
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class RenderDevToolsBridge {
  private _history: DevToolsSnapshot[] = [];
  private _maxHistory = 30;
  private _enabled = true;

  /** Whether the bridge is collecting snapshots. */
  isEnabled(): boolean {
    return this._enabled;
  }

  /** Enable or disable snapshot collection. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  /** Maximum snapshots to retain. */
  setMaxHistory(max: number): void {
    this._maxHistory = max;
    while (this._history.length > this._maxHistory) this._history.shift();
  }

  /** Collected snapshot history (most recent last). */
  get history(): readonly DevToolsSnapshot[] {
    return this._history;
  }

  /**
   * Capture a DevTools snapshot from a pipeline snapshot.
   * Returns null if the bridge is disabled or the snapshot is empty.
   */
  capture(snapshot: PipelineSnapshot): DevToolsSnapshot | null {
    if (!this._enabled) return null;
    if (!snapshot.metrics) return null;

    const paintCommands = snapshot.paintCommands.map(cmdToSnapshot);
    const stackingContext = snapshot.stackRoot
      ? stackingNodeToSnapshot(snapshot.stackRoot)
      : null;
    const layers = snapshot.compositePlan
      ? snapshot.compositePlan.layers.map(layerToSnapshot)
      : [];
    const layoutTree = snapshot.layoutRoot
      ? layoutNodeToSnapshot(snapshot.layoutRoot, 0, 3)
      : null;

    const totalLayoutBoxes = snapshot.layoutRoot
      ? countLayoutBoxes(snapshot.layoutRoot)
      : 0;
    const totalStacking = stackingContext
      ? countStackingContexts(stackingContext)
      : 0;

    const devtoolsSnapshot: DevToolsSnapshot = {
      timestamp: new Date().toISOString(),
      performance: { ...snapshot.metrics },
      paintCommands,
      stackingContext,
      layers,
      layoutTree,
      stats: {
        totalPaintCommands: paintCommands.length,
        totalLayers: layers.length,
        totalStackingContexts: totalStacking,
        totalLayoutBoxes,
      },
    };

    this._history.push(devtoolsSnapshot);
    if (this._history.length > this._maxHistory) this._history.shift();

    return devtoolsSnapshot;
  }

  /**
   * Get the most recent snapshot, or null if none captured yet.
   */
  latest(): DevToolsSnapshot | null {
    return this._history.length > 0
      ? this._history[this._history.length - 1]!
      : null;
  }

  /**
   * Get snapshot at a specific frame index (0-based, from history start).
   */
  getSnapshot(index: number): DevToolsSnapshot | null {
    return this._history[index] ?? null;
  }

  /**
   * Clear all collected snapshots.
   */
  clear(): void {
    this._history.length = 0;
  }

  /**
   * Summary stats across all collected frames.
   */
  frameStats(): {
    totalFrames: number;
    avgDurationMs: number;
    maxDurationMs: number;
    avgCommandCount: number;
    avgLayerCount: number;
  } {
    const h = this._history;
    if (h.length === 0) {
      return { totalFrames: 0, avgDurationMs: 0, maxDurationMs: 0, avgCommandCount: 0, avgLayerCount: 0 };
    }
    let totalDur = 0;
    let maxDur = 0;
    let totalCmds = 0;
    let totalLayers = 0;
    for (const s of h) {
      totalDur += s.performance.durationMs;
      if (s.performance.durationMs > maxDur) maxDur = s.performance.durationMs;
      totalCmds += s.performance.paintCommandCount;
      totalLayers += s.performance.layerCount;
    }
    return {
      totalFrames: h.length,
      avgDurationMs: totalDur / h.length,
      maxDurationMs: maxDur,
      avgCommandCount: totalCmds / h.length,
      avgLayerCount: totalLayers / h.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Conversion helpers (pipeline types → serializable snapshots)
// ---------------------------------------------------------------------------

function cmdToSnapshot(cmd: PaintCommand): PaintCommandSnapshot {
  switch (cmd.kind) {
    case PaintCommandKind.FillRect:
      return {
        kind: "fill-rect",
        summary: `fill ${cmd.color} ${cmd.rect.width}×${cmd.rect.height}`,
        bounds: { x: cmd.rect.x, y: cmd.rect.y, width: cmd.rect.width, height: cmd.rect.height },
      };
    case PaintCommandKind.StrokeRect:
      return {
        kind: "stroke-rect",
        summary: `stroke ${cmd.color} ${cmd.edge} ${cmd.rect.width}×${cmd.rect.height}`,
        bounds: { x: cmd.rect.x, y: cmd.rect.y, width: cmd.rect.width, height: cmd.rect.height },
      };
    case PaintCommandKind.DrawText:
      return {
        kind: "draw-text",
        summary: `text "${cmd.text}" ${cmd.fontSize}px`,
        bounds: {
          x: cmd.x,
          y: cmd.y - cmd.fontSize,
          width: cmd.text.length * cmd.fontSize * 0.6,
          height: cmd.fontSize * 1.2,
        },
      };
    case PaintCommandKind.DrawImagePlaceholder:
      return {
        kind: "image-placeholder",
        summary: `image ${cmd.rect.width}×${cmd.rect.height}`,
        bounds: { x: cmd.rect.x, y: cmd.rect.y, width: cmd.rect.width, height: cmd.rect.height },
      };
  }
}

function stackingNodeToSnapshot(node: StackingNode): StackingContextSnapshot {
  const ownCmds = node.items.filter(
    (i) => i.kind === "command" && i.command.sourceBox === node.box,
  ).length;
  return {
    zIndex: node.zIndex,
    isRoot: node.isRoot,
    boxLabel: node.box.renderNode?.domNode?.nodeName ?? node.box.type,
    commandCount: ownCmds,
    childCount: node.children.length,
    children: node.children.map(stackingNodeToSnapshot),
  };
}

function layerToSnapshot(layer: CompositeLayer): LayerSnapshot {
  return {
    id: layer.id,
    bounds: { ...layer.bounds },
    commandCount: layer.commands.length,
    needsIsolation: layer.needsIsolation,
    hasSourceBox: layer.sourceBox !== null,
  };
}

function layoutNodeToSnapshot(
  box: LayoutBox,
  depth: number,
  maxDepth: number,
): LayoutNodeSnapshot {
  const label =
    box.renderNode?.domNode?.nodeName?.toLowerCase() ?? box.type;
  const children =
    depth < maxDepth
      ? box.children.map((c) => layoutNodeToSnapshot(c, depth + 1, maxDepth))
      : [];
  return {
    type: box.type,
    label,
    contentRect: { ...box.contentRect },
    childCount: box.children.length,
    hasInlineLayout: box.inlineLayout !== undefined,
    children,
  };
}

function countLayoutBoxes(box: LayoutBox): number {
  let count = 1;
  for (const child of box.children) count += countLayoutBoxes(child);
  return count;
}

function countStackingContexts(snap: StackingContextSnapshot): number {
  let count = 1;
  for (const child of snap.children) count += countStackingContexts(child);
  return count;
}
