import { describe, it, expect } from "vitest";
import {
  buildRenderTree,
  walkRenderTree,
  countRenderNodes,
  RenderNodeKind,
  DOMNodeType,
  type DOMNodeLike,
  type ComputedStyleLike,
} from "../src/browser/rendering/pipeline/render-tree";

// --- tiny fake DOM builder -------------------------------------------------

function el(name: string, children: DOMNodeLike[] = []): DOMNodeLike {
  return { nodeType: DOMNodeType.Element, nodeName: name, childNodes: children, textContent: null };
}
function text(t: string): DOMNodeLike {
  return { nodeType: DOMNodeType.Text, nodeName: "#text", childNodes: [], textContent: t };
}
function comment(t: string): DOMNodeLike {
  return { nodeType: DOMNodeType.Comment, nodeName: "#comment", childNodes: [], textContent: t };
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

describe("buildRenderTree", () => {
  it("builds a basic block/inline tree and drops comments", () => {
    const span = el("span", [text("hi")]);
    const p = el("p", [span, comment("note")]);
    const root = el("div", [p]);

    const tree = buildRenderTree(root, styleMap(new Map([[span, { display: "inline" }]])));
    expect(tree).not.toBeNull();
    expect(tree!.kind).toBe(RenderNodeKind.Block);
    expect(tree!.children).toHaveLength(1);

    const pNode = tree!.children[0]!;
    expect(pNode.kind).toBe(RenderNodeKind.Block);
    // comment dropped, only span remains
    expect(pNode.children).toHaveLength(1);
    expect(pNode.children[0]!.kind).toBe(RenderNodeKind.Inline);
  });

  it("omits display:none subtrees entirely", () => {
    const hidden = el("div", [el("p", [text("gone")])]);
    const visible = el("div");
    const root = el("div", [hidden, visible]);

    const tree = buildRenderTree(
      root,
      styleMap(new Map([[hidden, { display: "none" }]])),
    );
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0]!.domNode).toBe(visible);
  });

  it("keeps visibility:hidden nodes (distinct from display:none)", () => {
    const hiddenVis = el("div");
    const root = el("div", [hiddenVis]);
    const tree = buildRenderTree(
      root,
      styleMap(new Map([[hiddenVis, { visibility: "hidden" }]])),
    );
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0]!.style.visibility).toBe("hidden");
  });

  it("collapses pure-whitespace text nodes between elements", () => {
    const root = el("div", [text("   \n  "), el("p"), text("\t")]);
    const tree = buildRenderTree(root, styleMap(new Map()));
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0]!.kind).toBe(RenderNodeKind.Block);
  });

  it("keeps meaningful text nodes as Text render nodes", () => {
    const root = el("div", [text("hello world")]);
    const tree = buildRenderTree(root, styleMap(new Map()));
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0]!.kind).toBe(RenderNodeKind.Text);
  });

  it("classifies known replaced elements and does not recurse into them", () => {
    const img = el("img", [text("should not appear")]);
    const root = el("div", [img]);
    const tree = buildRenderTree(root, styleMap(new Map()));
    const imgNode = tree!.children[0]!;
    expect(imgNode.kind).toBe(RenderNodeKind.Replaced);
    expect(imgNode.children).toHaveLength(0);
  });

  it("inline-block classifies as Block per current mapping", () => {
    const ib = el("div");
    const root = el("div", [ib]);
    const tree = buildRenderTree(root, styleMap(new Map([[ib, { display: "inline-block" }]])));
    expect(tree!.children[0]!.kind).toBe(RenderNodeKind.Block);
  });

  it("walkRenderTree visits every node exactly once, pre-order", () => {
    const root = el("div", [el("p", [text("a")]), el("span")]);
    const tree = buildRenderTree(root, styleMap(new Map([[root.childNodes[1] as DOMNodeLike, { display: "inline" }]])))!;
    const seen: RenderNodeKind[] = [];
    walkRenderTree(tree, (n) => seen.push(n.kind));
    expect(seen.length).toBe(countRenderNodes(tree));
    expect(seen[0]).toBe(RenderNodeKind.Block); // root div first (pre-order)
  });

  it("returns null for a root that is itself display:none is not applicable (root always built)", () => {
    // Root bypasses the display:none short-circuit (isRoot flag), matching
    // how a real engine always has a root render object.
    const root = el("div");
    const tree = buildRenderTree(root, styleMap(new Map([[root, { display: "none" }]])));
    expect(tree).not.toBeNull();
  });
});
