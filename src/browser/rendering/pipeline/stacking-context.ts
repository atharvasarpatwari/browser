/**
 * stacking-context.ts
 * -------------------
 * Rendering layer — Session 5 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Takes a laid-out LayoutBox tree plus the flat painter's-algorithm display
 * list produced by paint-record.ts (session 4) and re-orders/re-groups that
 * same list into CSS 2.2 Appendix E stacking order. Individual commands are
 * never rebuilt — only regrouped and resequenced.
 *
 * Model: a StackingNode owns an ordered item list in document encounter
 * order. Items are either single paint commands (this context's own flow
 * content, including positioned z-index:auto descendants) or references to
 * child stacking contexts. Flattening emits:
 *
 *   1. negative-z child contexts (z ascending, document order ties)
 *   2. the context's own items in document order (commands and z=0/auto
 *      child contexts interleaved exactly as encountered)
 *   3. positive-z child contexts (z ascending, document order ties)
 */

import { BoxType, type LayoutBox } from "./layout-box";
import type { ComputedStyleLike } from "./render-tree";
import type { PaintCommand } from "./paint-record";

// ---------------------------------------------------------------------------
// Stacking-context formation rules
// ---------------------------------------------------------------------------

/**
 * Decides whether a box forms a stacking context.
 *
 * Rules applied (CSS 2.2 Appendix E + common extensions):
 *  - the root box always forms one
 *  - positioned element (position != static) with z-index != auto
 *  - opacity < 1 (any position)
 *  - transform other than none (any position) — read defensively from the
 *    open style index signature
 *  - isolation: isolate
 *  - will-change listing transform or opacity
 */
export function createsStackingContext(
  style: ComputedStyleLike,
  isRoot = false,
): boolean {
  if (isRoot) return true;

  const position = style.position ?? "static";
  const positioned = position !== "static";
  const zIndex = style.zIndex ?? "auto";

  if (positioned && zIndex !== "auto") return true;
  if (typeof style.opacity === "number" && style.opacity < 1) return true;

  const transform = style.transform;
  if (typeof transform === "string" && transform.length > 0 && transform !== "none") {
    return true;
  }

  if (style.isolation === "isolate") return true;

  const willChange = style.willChange;
  if (typeof willChange === "string" && willChange.length > 0) {
    const props = willChange.split(",").map((s) => s.trim().toLowerCase());
    if (props.includes("transform") || props.includes("opacity")) return true;
  }

  return false;
}

/** Effective z-index used for sorting: numeric value, or 0 for auto. */
function effectiveZIndex(style: ComputedStyleLike): number {
  const z = style.zIndex;
  return typeof z === "number" && Number.isFinite(z) ? z : 0;
}

// ---------------------------------------------------------------------------
// Stacking tree types
// ---------------------------------------------------------------------------

export type StackItem =
  | { readonly kind: "command"; readonly command: PaintCommand }
  | { readonly kind: "context"; readonly node: StackingNode };

export interface StackingNode {
  /** Box forming this stacking context; the tree root box at top level. */
  readonly box: LayoutBox;
  /** Numeric z-index for sibling sorting ("auto" counts as 0). */
  readonly zIndex: number;
  /** True for the root context. */
  readonly isRoot: boolean;
  /**
   * This context's content in document encounter order: individual commands
   * plus z=0/auto child contexts interleaved where they occur.
   */
  readonly items: StackItem[];
  /** All child contexts in document order (unsorted). */
  readonly children: StackingNode[];
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

/**
 * Builds the stacking tree for a laid-out box tree and assigns every paint
 * command to the stacking context that owns it (its nearest box-tree
 * ancestor forming a stacking context — always exists since the root forms
 * one).
 *
 * Three passes:
 *  1. classify every box → context node + ownership + pre-order index
 *  2. bucket commands by owning context
 *  3. fill each context's item list, then sort it by document position so
 *     commands and child contexts interleave exactly as encountered
 */
export function buildStackingTree(
  root: LayoutBox,
  commands: readonly PaintCommand[],
): StackingNode {
  const rootNode: StackingNode = {
    box: root,
    zIndex: 0,
    isRoot: true,
    items: [],
    children: [],
  };

  const nodeOf = new Map<LayoutBox, StackingNode>();
  const ownerOf = new Map<LayoutBox, StackingNode>();
  const docIndex = new Map<LayoutBox, number>();

  let counter = 0;
  const classify = (box: LayoutBox, parentNode: StackingNode | null, isRootBox: boolean): void => {
    docIndex.set(box, counter++);
    let selfNode: StackingNode;
    // TextRun and Anonymous boxes are not elements (and may share their
    // parent's style object), so they never form stacking contexts.
    const canFormContext =
      box.type !== BoxType.TextRun && box.type !== BoxType.Anonymous;
    if (isRootBox || !canFormContext) {
      selfNode = parentNode ?? rootNode;
    } else if (createsStackingContext(box.style)) {
      selfNode = {
        box,
        zIndex: effectiveZIndex(box.style),
        isRoot: false,
        items: [],
        children: [],
      };
      parentNode!.children.push(selfNode);
    } else {
      selfNode = parentNode!;
    }
    nodeOf.set(box, selfNode);
    ownerOf.set(box, selfNode);
    for (const child of box.children) {
      classify(child, selfNode, false);
    }
  };
  classify(root, null, true);

  // Bucket commands by owner, preserving their original relative order.
  const buckets = new Map<StackingNode, PaintCommand[]>();
  for (const command of commands) {
    const owner = ownerOf.get(command.sourceBox) ?? rootNode;
    const bucket = buckets.get(owner);
    if (bucket) bucket.push(command);
    else buckets.set(owner, [command]);
  }

  // Fill item lists: own commands first, then child contexts in document
  // order (recursing depth-first).
  const fillItems = (node: StackingNode): void => {
    for (const command of buckets.get(node) ?? []) {
      node.items.push({ kind: "command", command });
    }
    for (const child of node.children) {
      node.items.push({ kind: "context", node: child });
      fillItems(child);
    }
    // Restore document-order interleaving between own commands and child
    // contexts (stable: ties keep insertion order).
    node.items.sort(
      (a, b) =>
        docIndexOf(a) - docIndexOf(b),
    );
  };

  const docIndexOf = (item: StackItem): number => {
    const box = item.kind === "context" ? item.node.box : item.command.sourceBox;
    return docIndex.get(box) ?? Number.MAX_SAFE_INTEGER;
  };

  fillItems(rootNode);

  return rootNode;
}

// ---------------------------------------------------------------------------
// Flattening (Appendix E order)
// ---------------------------------------------------------------------------

/** Stable sort by z-index ascending; equal z preserves document order. */
function sortByZ(nodes: readonly StackingNode[]): StackingNode[] {
  return [...nodes].sort((a, b) => a.zIndex - b.zIndex);
}

/**
 * Flattens a stacking tree back into a single ordered PaintCommand list
 * following CSS 2.2 Appendix E:
 *   1. the context element's own background/border/image commands
 *   2. negative-z child contexts (z ascending)
 *   3. the context's remaining document-order items (flow content,
 *      positioned z-auto content, z=0/auto child contexts interleaved
 *      exactly as encountered)
 *   4. positive-z child contexts (z ascending)
 *
 * The input tree is not mutated and command objects are reused as-is.
 */
export function flattenStackingOrder(node: StackingNode): PaintCommand[] {
  const out: PaintCommand[] = [];

  // Step 1: this context element's own painting (background/border/
  // placeholder — every command sourced directly by the context box).
  for (const item of node.items) {
    if (item.kind === "command" && item.command.sourceBox === node.box) {
      out.push(item.command);
    }
  }

  // Step 2: negative-z child contexts.
  const negative = sortByZ(node.children.filter((c) => c.zIndex < 0));
  for (const child of negative) {
    out.push(...flattenStackingOrder(child));
  }

  // Step 3: remaining document-order content. Context items in the negative
  // or positive z-bands are skipped here — they were already emitted by
  // steps 2/4; only z=0/auto contexts stay interleaved in this band.
  for (const item of node.items) {
    if (item.kind === "command") {
      if (item.command.sourceBox !== node.box) {
        out.push(item.command);
      }
    } else if (item.node.zIndex === 0) {
      out.push(...flattenStackingOrder(item.node));
    }
  }

  // Step 4: positive-z child contexts.
  const positive = sortByZ(node.children.filter((c) => c.zIndex > 0));
  for (const child of positive) {
    out.push(...flattenStackingOrder(child));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Total number of stacking contexts in the tree, including the root. */
export function countContexts(node: StackingNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countContexts(child);
  }
  return count;
}

/** Maximum nesting depth of the stacking tree (root = 1). */
export function maxContextDepth(node: StackingNode): number {
  let depth = 1;
  for (const child of node.children) {
    depth = Math.max(depth, 1 + maxContextDepth(child));
  }
  return depth;
}
