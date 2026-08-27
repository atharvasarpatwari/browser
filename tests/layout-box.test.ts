import { describe, it, expect } from "vitest";
import {
  buildRenderTree,
  DOMNodeType,
  type DOMNodeLike,
  type ComputedStyleLike,
} from "../src/browser/rendering/pipeline/render-tree";
import {
  buildLayoutTree,
  resolveBlockLayout,
  walkLayoutTree,
  borderBoxRect,
  BoxType,
} from "../src/browser/rendering/pipeline/layout-box";

// --- tiny fake DOM builder (mirrors render-tree.test.ts) -------------------

function el(name: string, children: DOMNodeLike[] = []): DOMNodeLike {
  return { nodeType: DOMNodeType.Element, nodeName: name, childNodes: children, textContent: null };
}
function text(t: string): DOMNodeLike {
  return { nodeType: DOMNodeType.Text, nodeName: "#text", childNodes: [], textContent: t };
}

const baseStyle: ComputedStyleLike = {
  display: "block",
  position: "static",
  zIndex: "auto",
  opacity: 1,
  visibility: "visible",
};

function styleMap(overrides: Map<DOMNodeLike, Partial<ComputedStyleLike>>) {
  return (node: DOMNodeLike): ComputedStyleLike => ({
    ...baseStyle,
    ...(overrides.get(node) ?? {}),
  });
}

describe("cross-file audit: render-tree -> layout-box pipeline", () => {
  it("consumes a real RenderNode tree end to end", () => {
    const span = el("span", [text("hi")]);
    const p = el("p", [span]);
    const root = el("div", [p]);

    const renderTree = buildRenderTree(root, styleMap(new Map([[span, { display: "inline" }]])))!;
    const layoutTree = buildLayoutTree(renderTree);

    expect(layoutTree.type).toBe(BoxType.Block);
    expect(layoutTree.children[0]!.type).toBe(BoxType.Block); // <p>
  });
});

describe("buildLayoutTree — box generation", () => {
  it("classifies block/inline/text render nodes into matching box types", () => {
    const span = el("span", [text("hi")]);
    const root = el("div", [span]);
    const renderTree = buildRenderTree(root, styleMap(new Map([[span, { display: "inline" }]])))!;
    const layoutTree = buildLayoutTree(renderTree);

    expect(layoutTree.type).toBe(BoxType.Block);
    const spanBox = layoutTree.children[0]!;
    expect(spanBox.type).toBe(BoxType.Inline);
    expect(spanBox.children[0]!.type).toBe(BoxType.TextRun);
  });

  it("promotes inline elements with display:inline-block", () => {
    const span = el("span");
    const root = el("div", [span]);
    const renderTree = buildRenderTree(
      root,
      styleMap(new Map([[span, { display: "inline-block" }]])),
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    expect(layoutTree.children[0]!.type).toBe(BoxType.InlineBlock);
  });

  it("classifies replaced elements as BoxType.Replaced leaves", () => {
    const img = el("img", [text("alt fallback text, should not become a box")]);
    const root = el("div", [img]);
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);
    const imgBox = layoutTree.children[0]!;
    expect(imgBox.type).toBe(BoxType.Replaced);
    expect(imgBox.children).toHaveLength(0);
  });

  it("wraps mixed inline+block children of a block box in an anonymous block", () => {
    const inlineSpan = el("span", [text("inline text")]);
    const blockDiv = el("div");
    const root = el("div", [inlineSpan, blockDiv]);

    const renderTree = buildRenderTree(
      root,
      styleMap(new Map([[inlineSpan, { display: "inline" }]])),
    )!;
    const layoutTree = buildLayoutTree(renderTree);

    // Expect: root.children = [anonymous-block(containing inlineSpan), blockDiv-box]
    expect(layoutTree.children).toHaveLength(2);
    expect(layoutTree.children[0]!.type).toBe(BoxType.Anonymous);
    expect(layoutTree.children[0]!.children[0]!.type).toBe(BoxType.Inline);
    expect(layoutTree.children[1]!.type).toBe(BoxType.Block);
  });

  it("does not wrap when children are homogeneous (all block)", () => {
    const a = el("div");
    const b = el("div");
    const root = el("div", [a, b]);
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);
    expect(layoutTree.children.every((c) => c.type === BoxType.Block)).toBe(true);
  });

  it("does not wrap when children are homogeneous (all inline)", () => {
    const a = el("span");
    const b = el("span");
    const root = el("div", [a, b]);
    const renderTree = buildRenderTree(
      root,
      styleMap(new Map([[a, { display: "inline" }], [b, { display: "inline" }]])),
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    expect(layoutTree.children.every((c) => c.type === BoxType.Inline)).toBe(true);
  });
});

describe("resolveBlockLayout — block-flow geometry", () => {
  it("stacks block children vertically and fills containing width", () => {
    const a = el("div");
    const b = el("div");
    const root = el("div", [a, b]);
    const renderTree = buildRenderTree(root, styleMap(new Map()))!;
    const layoutTree = buildLayoutTree(renderTree);

    resolveBlockLayout(layoutTree, { containingBlockWidth: 800 });

    expect(layoutTree.contentRect.width).toBe(800);
    const [boxA, boxB] = layoutTree.children;
    expect(boxA!.contentRect.y).toBe(0);
    expect(boxB!.contentRect.y).toBe(0); // both zero-height (no text-shaping yet) -> stack at same y
    expect(boxA!.contentRect.width).toBe(800);
  });

  it("respects fixed pixel width over auto", () => {
    const fixed = el("div");
    const root = el("div", [fixed]);
    const renderTree = buildRenderTree(
      root,
      (node) => (node === fixed ? { ...baseStyle, width: 200 } : baseStyle) as ComputedStyleLike,
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 800 });
    expect(layoutTree.children[0]!.contentRect.width).toBe(200);
  });

  it("accounts for margin/border/padding in contentRect origin", () => {
    const child = el("div");
    const root = el("div", [child]);
    const renderTree = buildRenderTree(
      root,
      (node) =>
        (node === child
          ? {
              ...baseStyle,
              marginTop: 10,
              marginLeft: 5,
              paddingTop: 3,
              borderTopWidth: 2,
            }
          : baseStyle) as ComputedStyleLike,
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 800 });

    const childBox = layoutTree.children[0]!;
    expect(childBox.contentRect.x).toBe(5); // margin-left
    expect(childBox.contentRect.y).toBe(10 + 2 + 3); // margin+border+padding top
  });

  it("borderBoxRect adds padding+border back around contentRect", () => {
    const child = el("div");
    const root = el("div", [child]);
    const renderTree = buildRenderTree(
      root,
      (node) =>
        (node === child
          ? { ...baseStyle, paddingLeft: 4, paddingRight: 4, borderLeftWidth: 1, borderRightWidth: 1 }
          : baseStyle) as ComputedStyleLike,
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 100 });

    const childBox = layoutTree.children[0]!;
    const bbox = borderBoxRect(childBox);
    expect(bbox.width).toBe(childBox.contentRect.width + 4 + 4 + 1 + 1);
  });

  it("walkLayoutTree visits every box pre-order", () => {
    const a = el("div", [el("span", [text("x")])]);
    const root = el("div", [a]);
    const renderTree = buildRenderTree(
      root,
      styleMap(new Map([[a.childNodes[0] as DOMNodeLike, { display: "inline" }]])),
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    const seen: BoxType[] = [];
    walkLayoutTree(layoutTree, (b) => seen.push(b.type));
    expect(seen[0]).toBe(BoxType.Block);
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  it("never produces NaN or negative geometry from malformed style input", () => {
    const child = el("div");
    const root = el("div", [child]);
    const renderTree = buildRenderTree(
      root,
      (node) =>
        (node === child
          ? { ...baseStyle, marginTop: -50, width: "not-a-number" as unknown }
          : baseStyle) as ComputedStyleLike,
    )!;
    const layoutTree = buildLayoutTree(renderTree);
    resolveBlockLayout(layoutTree, { containingBlockWidth: 500 });

    const childBox = layoutTree.children[0]!;
    expect(Number.isFinite(childBox.contentRect.width)).toBe(true);
    expect(Number.isFinite(childBox.contentRect.height)).toBe(true);
    expect(childBox.contentRect.width).toBeGreaterThanOrEqual(0);
  });
});
