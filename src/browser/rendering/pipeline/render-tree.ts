/**
 * render-tree.ts
 * ---------------
 * Rendering layer — Session 1 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Builds the render tree from a DOM tree + computed style, mirroring the
 * classic browser pipeline: DOM + CSSOM -> Render Tree -> Layout -> Paint.
 *
 * NOTE: The DOM and CSS/Layout architectural layers have not been generated
 * yet in this session order. To keep this module strictly typed and
 * self-contained, minimal structural interfaces (DOMNodeLike,
 * ComputedStyleLike) are declared below that describe the *shape* this
 * module expects. When the real DOM layer (dom-node.ts, etc.) and CSS layer
 * (computed-style.ts, etc.) are generated, these placeholder interfaces
 * should be deleted and replaced with imports from those modules — the
 * structural shape has been kept intentionally close to what a standards
 * DOM Node / CSSStyleDeclaration would expose, so the swap should be a
 * near drop-in replacement.
 */

// ---------------------------------------------------------------------------
// Placeholder cross-layer contracts (to be replaced by real DOM/CSS layers)
// ---------------------------------------------------------------------------

export const enum DOMNodeType {
  Element = 1,
  Text = 3,
  Comment = 8,
  Document = 9,
}

export interface DOMNodeLike {
  readonly nodeType: DOMNodeType;
  readonly nodeName: string;
  readonly childNodes: readonly DOMNodeLike[];
  readonly textContent: string | null;
}

export type CSSDisplayValue =
  | "none"
  | "block"
  | "inline"
  | "inline-block"
  | "flex"
  | "inline-flex"
  | "grid"
  | "inline-grid"
  | "table"
  | "list-item";

export type CSSPositionValue = "static" | "relative" | "absolute" | "fixed" | "sticky";

/** Minimal structural subset of a resolved/computed style for a node. */
export interface ComputedStyleLike {
  readonly display: CSSDisplayValue;
  readonly position: CSSPositionValue;
  readonly zIndex: number | "auto";
  readonly opacity: number;
  readonly visibility: "visible" | "hidden" | "collapse";
  /** Arbitrary extra computed properties layout/paint will read later. */
  readonly [property: string]: unknown;
}

/** Resolves computed style for a given DOM node. Supplied by the CSS layer. */
export type StyleResolver = (node: DOMNodeLike) => ComputedStyleLike;

// ---------------------------------------------------------------------------
// Render tree types
// ---------------------------------------------------------------------------

export const enum RenderNodeKind {
  Root = "root",
  Block = "block",
  Inline = "inline",
  Text = "text",
  Replaced = "replaced",
}

export interface RenderNode {
  readonly kind: RenderNodeKind;
  readonly domNode: DOMNodeLike;
  readonly style: ComputedStyleLike;
  readonly children: RenderNode[];
  parent: RenderNode | null;
}

export interface RenderTreeBuildOptions {
  /**
   * Element local names that are inherently "replaced" elements for
   * render-tree purposes (img, video, canvas, iframe, ...). These get
   * RenderNodeKind.Replaced regardless of computed display block/inline,
   * since replaced elements are laid out specially downstream.
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a render tree from a DOM (sub)tree.
 *
 * Rules applied (per CSS 2.2 / CSS Display spec basics):
 *  - Nodes with `display: none` are omitted entirely (they and their
 *    subtree produce no render tree nodes).
 *  - Comment nodes and processing-instruction-like nodes are omitted.
 *  - Text nodes that are pure whitespace between block-level siblings are
 *    dropped (whitespace collapsing at the render-tree stage); other text
 *    nodes become RenderNodeKind.Text leaves.
 *  - Elements resolve to Block, Inline, or Replaced based on computed
 *    display and the replacedElementNames set.
 *  - `visibility: hidden` nodes ARE included (they still occupy layout
 *    space) — that is distinct from `display: none`.
 */
export function buildRenderTree(
  root: DOMNodeLike,
  resolveStyle: StyleResolver,
  options: RenderTreeBuildOptions = {},
): RenderNode | null {
  const replaced = options.replacedElementNames ?? DEFAULT_REPLACED_ELEMENTS;
  return buildNode(root, resolveStyle, replaced, null, /* isRoot */ true);
}

/** Depth-first pre-order walk over a render tree. */
export function walkRenderTree(
  node: RenderNode,
  visit: (node: RenderNode, depth: number) => void,
  depth = 0,
): void {
  visit(node, depth);
  for (const child of node.children) {
    walkRenderTree(child, visit, depth + 1);
  }
}

/** Counts total nodes in a render tree — useful for diagnostics/tests. */
export function countRenderNodes(node: RenderNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countRenderNodes(child);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Internal construction
// ---------------------------------------------------------------------------

function buildNode(
  domNode: DOMNodeLike,
  resolveStyle: StyleResolver,
  replacedElementNames: ReadonlySet<string>,
  parent: RenderNode | null,
  isRoot: boolean,
): RenderNode | null {
  switch (domNode.nodeType) {
    case DOMNodeType.Comment:
      return null;

    case DOMNodeType.Text: {
      const text = domNode.textContent ?? "";
      if (!isRoot && isCollapsibleWhitespace(text)) {
        return null;
      }
      const textNode: RenderNode = {
        kind: RenderNodeKind.Text,
        domNode,
        // Text nodes inherit the parent's computed style for painting
        // purposes (color, font, etc.) — resolved via the parent element.
        style: parent ? parent.style : resolveStyle(domNode),
        children: [],
        parent,
      };
      return textNode;
    }

    case DOMNodeType.Document:
    case DOMNodeType.Element: {
      const style = resolveStyle(domNode);

      if (!isRoot && style.display === "none") {
        return null;
      }

      const kind = classifyElement(domNode, style, replacedElementNames);

      const renderNode: RenderNode = {
        kind,
        domNode,
        style,
        children: [],
        parent,
      };

      // Replaced elements manage their own internal content (e.g. an <img>'s
      // pixels, an <iframe>'s subdocument) — don't recurse into DOM children
      // for render-tree purposes.
      if (kind !== RenderNodeKind.Replaced) {
        for (const child of domNode.childNodes) {
          const childRenderNode = buildNode(
            child,
            resolveStyle,
            replacedElementNames,
            renderNode,
            false,
          );
          if (childRenderNode !== null) {
            renderNode.children.push(childRenderNode);
          }
        }
      }

      return renderNode;
    }

    default:
      // Unknown/unsupported node types (processing instructions, doctype,
      // etc.) produce no render tree representation.
      return null;
  }
}

function classifyElement(
  domNode: DOMNodeLike,
  style: ComputedStyleLike,
  replacedElementNames: ReadonlySet<string>,
): RenderNodeKind.Block | RenderNodeKind.Inline | RenderNodeKind.Replaced {
  const localName = domNode.nodeName.toLowerCase();
  if (replacedElementNames.has(localName)) {
    return RenderNodeKind.Replaced;
  }

  switch (style.display) {
    case "inline":
      return RenderNodeKind.Inline;
    case "block":
    case "flex":
    case "grid":
    case "table":
    case "list-item":
      return RenderNodeKind.Block;
    case "inline-block":
    case "inline-flex":
    case "inline-grid":
      // Treated as block-like formatting internally, inline-level box
      // externally; layout-box.ts (session 2) resolves the box-model
      // distinction. Render tree just needs "has its own box".
      return RenderNodeKind.Block;
    default:
      return RenderNodeKind.Inline;
  }
}

function isCollapsibleWhitespace(text: string): boolean {
  return /^[ \t\n\r\f]*$/.test(text);
}
