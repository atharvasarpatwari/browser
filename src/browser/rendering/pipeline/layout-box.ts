/**
 * layout-box.ts
 * -------------
 * Rendering layer — Session 2 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Consumes the RenderNode tree from render-tree.ts and produces a LayoutBox
 * tree: box generation (block/inline/inline-block/anonymous boxes), the CSS
 * box model (content/padding/border/margin), and basic block + inline-flow
 * geometry resolution (widths, heights, x/y positions).
 *
 * Scope for this session: block formatting context + inline formatting
 * context geometry for normal-flow boxes. Floats, absolute/fixed
 * positioning, and flex/grid box generation are flagged as TODOs — they sit
 * on top of this box tree in later work, once positioning (session 5,
 * stacking-context.ts) and a dedicated flex/grid module exist.
 */

import {
  RenderNode,
  RenderNodeKind,
  type ComputedStyleLike,
} from "./render-tree";
import {
  layoutInlineContent,
  type FontMetricsProvider,
  type InlineLayoutResult,
} from "./text-shaping";

// ---------------------------------------------------------------------------
// Box model primitives
// ---------------------------------------------------------------------------

export interface EdgeSizes {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const ZERO_EDGES: EdgeSizes = { top: 0, right: 0, bottom: 0, left: 0 };

/** Axis-aligned rect in the box's containing block's coordinate space. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const enum BoxType {
  /** Establishes a block formatting context / participates in block flow. */
  Block = "block",
  /** Participates in inline flow within a line box. */
  Inline = "inline",
  /** display:inline-block — inline-level, but block-formats its contents. */
  InlineBlock = "inline-block",
  /** A run of text, laid out by text-shaping.ts (session 3). Leaf box. */
  TextRun = "text-run",
  /** Anonymous box inserted to satisfy CSS box-generation rules. */
  Anonymous = "anonymous",
  /** display:none render-tree nodes never reach here; replaced elements
   * (img, video, canvas, ...) get their own box type since they have
   * intrinsic dimensions and don't lay out children via normal flow. */
  Replaced = "replaced",
}

export interface LayoutBox {
  readonly type: BoxType;
  readonly renderNode: RenderNode | null; // null for anonymous boxes
  readonly style: ComputedStyleLike;

  margin: EdgeSizes;
  border: EdgeSizes;
  padding: EdgeSizes;

  /** Content-box rect, resolved during layout. Zeroed until computed. */
  contentRect: Rect;

  /**
   * Populated on a Block/Anonymous box whose children are inline-level
   * (set by resolveBlockLayout via text-shaping.ts). paint-record.ts
   * (session 4) should iterate `inlineLayout.lineBoxes[].fragments` for
   * inline content rather than each child's contentRect, since a single
   * TextRun box can be split across multiple line fragments.
   */
  inlineLayout?: InlineLayoutResult;

  readonly children: LayoutBox[];
  parent: LayoutBox | null;
}

// ---------------------------------------------------------------------------
// Style value resolution helpers
// ---------------------------------------------------------------------------

/**
 * Numeric box-model style properties this module reads from
 * ComputedStyleLike. The real CSS layer should resolve these to absolute
 * pixel values (percentages/auto resolved against the containing block)
 * before layout-box.ts runs; here we defensively coerce/clamp so a
 * malformed or not-yet-resolved style never produces NaN/negative geometry.
 */
interface BoxModelStyle {
  readonly marginTop?: unknown;
  readonly marginRight?: unknown;
  readonly marginBottom?: unknown;
  readonly marginLeft?: unknown;
  readonly borderTopWidth?: unknown;
  readonly borderRightWidth?: unknown;
  readonly borderBottomWidth?: unknown;
  readonly borderLeftWidth?: unknown;
  readonly paddingTop?: unknown;
  readonly paddingRight?: unknown;
  readonly paddingBottom?: unknown;
  readonly paddingLeft?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}

/** `width`/`height` may legitimately be the literal string "auto". */
function toAutoOrNumber(value: unknown): number | "auto" {
  if (value === "auto" || value === undefined) return "auto";
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return "auto";
}

function readEdges(
  style: ComputedStyleLike,
  prefix: "margin" | "border" | "padding",
): EdgeSizes {
  const s = style as unknown as BoxModelStyle;
  const suffix = prefix === "border" ? "Width" : "";
  const key = (side: string) =>
    `${prefix}${side}${suffix}` as keyof BoxModelStyle;
  return {
    top: toNonNegativeNumber(s[key("Top")]),
    right: toNonNegativeNumber(s[key("Right")]),
    bottom: toNonNegativeNumber(s[key("Bottom")]),
    left: toNonNegativeNumber(s[key("Left")]),
  };
}

// ---------------------------------------------------------------------------
// Box tree construction (box generation)
// ---------------------------------------------------------------------------

export interface LayoutBoxBuildOptions {
  /**
   * Element local names (from RenderNode.domNode.nodeName) treated as
   * replaced boxes. Mirrors render-tree's replacedElementNames but is kept
   * independent so layout can diverge from render-tree classification if
   * needed later (e.g. an <img> with a broken src still needs a box).
   */
  readonly replacedElementNames?: ReadonlySet<string>;
}

const DEFAULT_REPLACED_ELEMENTS: ReadonlySet<string> = new Set([
  "img",
  "video",
  "audio",
  "canvas",
  "iframe",
  "embed",
  "object",
]);

/**
 * Builds a LayoutBox tree from a RenderNode tree.
 *
 * Box-generation rules applied:
 *  - RenderNodeKind.Block -> BoxType.Block
 *  - RenderNodeKind.Inline -> BoxType.Inline (unless computed display is
 *    inline-block, per style.display, which promotes it)
 *  - RenderNodeKind.Text -> BoxType.TextRun leaf (no children)
 *  - RenderNodeKind.Replaced -> BoxType.Replaced leaf (no children; content
 *    dimensions come from the replaced element's intrinsic size, resolved
 *    outside this module)
 *  - Anonymous block box insertion: when a Block box has a mix of inline-
 *    level children (Inline/TextRun) and block-level children, the
 *    consecutive runs of inline-level children are wrapped in anonymous
 *    block boxes so the parent's children are homogeneously block-level.
 *    This mirrors CSS 2.2 §9.2.1.1.
 */
export function buildLayoutTree(
  root: RenderNode,
  options: LayoutBoxBuildOptions = {},
): LayoutBox {
  const replaced = options.replacedElementNames ?? DEFAULT_REPLACED_ELEMENTS;
  const box = buildBox(root, replaced, null);
  wrapAnonymousBlocks(box);
  return box;
}

function buildBox(
  node: RenderNode,
  replacedElementNames: ReadonlySet<string>,
  parent: LayoutBox | null,
): LayoutBox {
  const type = classifyBox(node, replacedElementNames);

  const box: LayoutBox = {
    type,
    renderNode: node,
    style: node.style,
    margin: type === BoxType.TextRun ? ZERO_EDGES : readEdges(node.style, "margin"),
    border: type === BoxType.TextRun ? ZERO_EDGES : readEdges(node.style, "border"),
    padding: type === BoxType.TextRun ? ZERO_EDGES : readEdges(node.style, "padding"),
    contentRect: { x: 0, y: 0, width: 0, height: 0 },
    children: [],
    parent,
  };

  if (type !== BoxType.TextRun && type !== BoxType.Replaced) {
    for (const child of node.children) {
      box.children.push(buildBox(child, replacedElementNames, box));
    }
  }

  return box;
}

/**
 * NOTE (cross-file contract with render-tree.ts): render-tree's
 * classifyElement() maps display:inline-block/-flex/-grid to
 * RenderNodeKind.Block, not Inline — its own comment says the inline-level-
 * outer/block-level-inner distinction is deferred to this module. So the
 * inline-block check below must run for the Block branch too, not just
 * Inline. (Caught by the render-tree -> layout-box integration test.)
 */
const INLINE_LEVEL_DISPLAYS = new Set(["inline-block", "inline-flex", "inline-grid"]);

function classifyBox(
  node: RenderNode,
  replacedElementNames: ReadonlySet<string>,
): BoxType {
  switch (node.kind) {
    case RenderNodeKind.Text:
      return BoxType.TextRun;
    case RenderNodeKind.Replaced:
      return BoxType.Replaced;
    case RenderNodeKind.Inline:
      return INLINE_LEVEL_DISPLAYS.has(node.style.display)
        ? BoxType.InlineBlock
        : BoxType.Inline;
    case RenderNodeKind.Block:
    case RenderNodeKind.Root:
    default: {
      const localName = node.domNode.nodeName.toLowerCase();
      if (replacedElementNames.has(localName)) return BoxType.Replaced;
      if (INLINE_LEVEL_DISPLAYS.has(node.style.display)) return BoxType.InlineBlock;
      return BoxType.Block;
    }
  }
}

/** True for box types that flow inline within a line box. */
function isInlineLevel(box: LayoutBox): boolean {
  return (
    box.type === BoxType.Inline ||
    box.type === BoxType.InlineBlock ||
    box.type === BoxType.TextRun ||
    (box.type === BoxType.Replaced && isReplacedInlineLevel(box))
  );
}

function isReplacedInlineLevel(box: LayoutBox): boolean {
  // Replaced elements default to inline-level (e.g. <img>) unless their
  // computed display says otherwise.
  const display = box.style.display;
  return display !== "block" && display !== "flex" && display !== "grid";
}

/**
 * Walks the box tree and wraps runs of inline-level children of a Block box
 * that also has block-level siblings into anonymous block boxes, per
 * CSS 2.2 §9.2.1.1. If a Block box's children are homogeneous (all inline
 * or all block), nothing is wrapped.
 */
function wrapAnonymousBlocks(box: LayoutBox): void {
  for (const child of box.children) {
    wrapAnonymousBlocks(child);
  }

  if (box.type !== BoxType.Block) return;
  if (box.children.length === 0) return;

  const hasBlockChild = box.children.some((c) => !isInlineLevel(c));
  const hasInlineChild = box.children.some((c) => isInlineLevel(c));
  if (!hasBlockChild || !hasInlineChild) return; // homogeneous, no-op

  const newChildren: LayoutBox[] = [];
  let run: LayoutBox[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const anon = makeAnonymousBlock(box);
    for (const inlineChild of run) {
      inlineChild.parent = anon;
      anon.children.push(inlineChild);
    }
    newChildren.push(anon);
    run = [];
  };

  for (const child of box.children) {
    if (isInlineLevel(child)) {
      run.push(child);
    } else {
      flushRun();
      newChildren.push(child);
    }
  }
  flushRun();

  box.children.length = 0;
  box.children.push(...newChildren);
}

function makeAnonymousBlock(parent: LayoutBox): LayoutBox {
  return {
    type: BoxType.Anonymous,
    renderNode: null,
    style: parent.style, // anonymous boxes inherit the parent's computed style
    margin: ZERO_EDGES,
    border: ZERO_EDGES,
    padding: ZERO_EDGES,
    contentRect: { x: 0, y: 0, width: 0, height: 0 },
    children: [],
    parent,
  };
}

// ---------------------------------------------------------------------------
// Block-flow geometry resolution
// ---------------------------------------------------------------------------

export interface LayoutConstraints {
  /** Width of the containing block's content box, in pixels. */
  readonly containingBlockWidth: number;
  /** Optional available height (viewport height) for percentage resolution. */
  readonly containingBlockHeight?: number;
  /** Optional font metrics backend for inline content; defaults inside text-shaping.ts. */
  readonly fontMetricsProvider?: FontMetricsProvider;
}

/**
 * Resolves geometry (contentRect) for a block-formatting-context box tree
 * using the standard block-flow algorithm:
 *  - block-level boxes stack vertically, full available width unless a
 *    fixed width is specified
 *  - inline-level content (TextRun/Inline/InlineBlock) is delegated to
 *    text-shaping.ts's layoutInlineContent for real line-box geometry
 *    (resolves the session-2 TODO that previously stubbed inline children
 *    at zero height)
 *  - margins are NOT collapsed in this pass (documented follow-up)
 *
 * Mutates contentRect (and, for inline containers, inlineLayout) on every
 * box in the tree; also returns the root box for convenience/chaining.
 */
export function resolveBlockLayout(
  root: LayoutBox,
  constraints: LayoutConstraints,
): LayoutBox {
  layoutBlockBox(root, constraints.containingBlockWidth, 0, 0, constraints.fontMetricsProvider);
  return root;
}

function layoutBlockBox(
  box: LayoutBox,
  containingWidth: number,
  originX: number,
  originY: number,
  fontMetricsProvider: FontMetricsProvider | undefined,
): number {
  const styleWidth = toAutoOrNumber((box.style as unknown as BoxModelStyle).width);
  const horizontalNonContent =
    box.margin.left +
    box.margin.right +
    box.border.left +
    box.border.right +
    box.padding.left +
    box.padding.right;

  const contentWidth =
    styleWidth === "auto"
      ? Math.max(0, containingWidth - horizontalNonContent)
      : styleWidth;

  const contentX = originX + box.margin.left + box.border.left + box.padding.left;
  const contentY = originY + box.margin.top + box.border.top + box.padding.top;

  let cursorY = contentY;

  // Box-generation (wrapAnonymousBlocks, session 2) guarantees a Block box's
  // direct children are homogeneous: either all block-level, or all
  // inline-level. So we only need to branch once per box, not per child.
  const firstChild = box.children[0];
  const isInlineFormattingContext = firstChild !== undefined && isInlineLevel(firstChild);

  if (isInlineFormattingContext) {
    // Inline-block boxes establish their own block formatting context, and
    // replaced boxes have intrinsic-only sizing — neither is resolved by
    // the block-flow loop below, so both must be sized here BEFORE
    // text-shaping measures them as atomic inline items. Without this,
    // their contentRect stays at the zeroed initial value and they vanish
    // from the line (caught by the inline-block line-breaking test).
    resolveInlineAtomSizes(box, contentWidth, fontMetricsProvider);
    const result =
      fontMetricsProvider !== undefined
        ? layoutInlineContent(box, contentWidth, contentX, contentY, fontMetricsProvider)
        : layoutInlineContent(box, contentWidth, contentX, contentY);
    box.inlineLayout = result;
    cursorY = contentY + result.totalHeight;

    // Best-effort contentRect per source box: union of its own fragments'
    // rects, for any consumer that reads child.contentRect directly rather
    // than walking inlineLayout.lineBoxes (paint-record.ts should prefer
    // the latter for wrapped runs — see the LayoutBox.inlineLayout doc).
    applyFragmentRectsToSourceBoxes(box, result);
  } else {
    for (const child of box.children) {
      const childHeight = layoutBlockBox(
        child,
        contentWidth,
        contentX,
        cursorY,
        fontMetricsProvider,
      );
      cursorY += childHeight + child.margin.top + child.margin.bottom;
    }
  }

  const styleHeight = toAutoOrNumber((box.style as unknown as BoxModelStyle).height);
  const autoHeight = cursorY - contentY;
  const contentHeight = styleHeight === "auto" ? Math.max(0, autoHeight) : styleHeight;

  box.contentRect = { x: contentX, y: contentY, width: contentWidth, height: contentHeight };

  return contentHeight;
}

/**
 * Resolves intrinsic box-model sizes for the atomic (non-text) inline items
 * within one inline formatting context, so text-shaping.ts can treat them
 * as fixed-width tokens. Recurses through Inline (<span>-like) wrappers
 * since those don't themselves need sizing, only their InlineBlock/Replaced
 * descendants do.
 */
function resolveInlineAtomSizes(
  container: LayoutBox,
  availableWidth: number,
  fontMetricsProvider: FontMetricsProvider | undefined,
): void {
  for (const child of container.children) {
    if (child.type === BoxType.InlineBlock) {
      // Establishes its own formatting context. availableWidth is used as
      // the containing width for shrink-to-fit approximation when the box
      // has no explicit style.width — an approximation, not true
      // shrink-to-fit-by-content sizing (documented follow-up).
      layoutBlockBox(child, availableWidth, 0, 0, fontMetricsProvider);
    } else if (child.type === BoxType.Replaced) {
      const styleWidth = toAutoOrNumber((child.style as unknown as BoxModelStyle).width);
      const styleHeight = toAutoOrNumber((child.style as unknown as BoxModelStyle).height);
      // Replaced elements without explicit dimensions fall back to a fixed
      // placeholder intrinsic size (mirrors a "broken image" box) until a
      // real intrinsic-size source (natural image/video dimensions) exists.
      child.contentRect = {
        x: 0,
        y: 0,
        width: styleWidth === "auto" ? 150 : styleWidth,
        height: styleHeight === "auto" ? 100 : styleHeight,
      };
    } else if (child.type === BoxType.Inline) {
      resolveInlineAtomSizes(child, availableWidth, fontMetricsProvider);
    }
    // TextRun needs no pre-pass: text-shaping measures glyph advances
    // directly from the DOM text content.
  }
}

/** Translates a Rect by (dx, dy), preserving width/height. */
function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height };
}

/**
 * Shifts a box's contentRect (and, if present, its inlineLayout line-box
 * geometry) by (dx, dy), recursing into children. Needed because
 * resolveInlineAtomSizes lays out an inline-block's subtree at a temporary
 * (0, 0) origin — its true position isn't known until line breaking places
 * it — so once the line position is known, the whole subtree must be
 * shifted into place, not just the inline-block's own box.
 */
function translateBoxSubtree(box: LayoutBox, dx: number, dy: number): void {
  box.contentRect = translateRect(box.contentRect, dx, dy);
  if (box.inlineLayout) {
    box.inlineLayout = {
      totalHeight: box.inlineLayout.totalHeight,
      lineBoxes: box.inlineLayout.lineBoxes.map((line) => ({
        rect: translateRect(line.rect, dx, dy),
        baseline: line.baseline + dy,
        fragments: line.fragments.map((f) => ({
          box: f.box,
          text: f.text,
          rect: translateRect(f.rect, dx, dy),
          baseline: f.baseline + dy,
        })),
      })),
    };
  }
  for (const child of box.children) {
    translateBoxSubtree(child, dx, dy);
  }
}

function applyFragmentRectsToSourceBoxes(
  container: LayoutBox,
  result: InlineLayoutResult,
): void {
  const seen = new Set<LayoutBox>();
  for (const line of result.lineBoxes) {
    for (const fragment of line.fragments) {
      // First fragment wins for boxes wrapped across multiple lines —
      // documented tradeoff above.
      if (seen.has(fragment.box)) continue;
      seen.add(fragment.box);

      if (fragment.box.type === BoxType.TextRun) {
        // TextRun content dimensions come entirely from line layout — full
        // overwrite is correct (no subtree to preserve/shift).
        fragment.box.contentRect = fragment.rect;
      } else {
        // InlineBlock/Replaced: fragment.rect.height is a font-metric
        // line-height, NOT the box's real computed height — only its
        // position is authoritative here. Translate the box (and its
        // whole subtree, resolved earlier at a 0,0 placeholder origin in
        // resolveInlineAtomSizes) by the delta into its real position,
        // preserving the width/height already resolved for it.
        const dx = fragment.rect.x - fragment.box.contentRect.x;
        const dy = fragment.rect.y - fragment.box.contentRect.y;
        translateBoxSubtree(fragment.box, dx, dy);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** Depth-first pre-order walk over a layout box tree. */
export function walkLayoutTree(
  box: LayoutBox,
  visit: (box: LayoutBox, depth: number) => void,
  depth = 0,
): void {
  visit(box, depth);
  for (const child of box.children) {
    walkLayoutTree(child, visit, depth + 1);
  }
}

/** The full border-box rect (content + padding + border), post-layout. */
export function borderBoxRect(box: LayoutBox): Rect {
  const { contentRect, padding, border } = box;
  return {
    x: contentRect.x - padding.left - border.left,
    y: contentRect.y - padding.top - border.top,
    width: contentRect.width + padding.left + padding.right + border.left + border.right,
    height: contentRect.height + padding.top + padding.bottom + border.top + border.bottom,
  };
}
