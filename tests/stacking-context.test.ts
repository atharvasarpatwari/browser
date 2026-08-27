import { describe, it, expect } from "vitest";
import {
  buildRenderTree,
  DOMNodeType,
  type DOMNodeLike,
  type ComputedStyleLike,
} from "../src/browser/rendering/pipeline/render-tree";
import { buildLayoutTree, resolveBlockLayout, BoxType } from "../src/browser/rendering/pipeline/layout-box";
import { buildPaintRecords, type PaintCommand } from "../src/browser/rendering/pipeline/paint-record";
import {
  createsStackingContext,
  buildStackingTree,
  flattenStackingOrder,
  countContexts,
  maxContextDepth,
} from "../src/browser/rendering/pipeline/stacking-context";

// --- tiny fake DOM builder (mirrors sessions 1–4 tests) ---------------------

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

/** Runs the full session 1→5 pipeline and returns commands + box tree. */
function pipeline(
  dom: DOMNodeLike,
  resolver?: (n: DOMNodeLike) => ComputedStyleLike,
) {
  const render = buildRenderTree(dom, resolver ?? styleMap(new Map()))!;
  const layoutTree = buildLayoutTree(render);
  resolveBlockLayout(layoutTree, { containingBlockWidth: 800 });
  const commands = buildPaintRecords(layoutTree);
  const stackTree = buildStackingTree(layoutTree, commands);
  return { render, layoutTree, commands, stackTree };
}

/** Identifies a command by its source box's background color or text. */
function label(cmd: PaintCommand): string {
  if (cmd.kind === "draw-text") return `text:${cmd.text}`;
  if (cmd.kind === "fill-rect") return `bg:${cmd.color}`;
  if (cmd.kind === "stroke-rect") return `border:${cmd.edge}:${cmd.color}`;
  return "img-placeholder";
}

function sequence(cmds: readonly PaintCommand[]): string[] {
  return cmds.map(label);
}

// ---------------------------------------------------------------------------
// createsStackingContext
// ---------------------------------------------------------------------------

describe("createsStackingContext", () => {
  it("root always forms a stacking context", () => {
    expect(createsStackingContext(baseStyle, true)).toBe(true);
  });

  it("static z:auto element does not form one", () => {
    expect(createsStackingContext(baseStyle)).toBe(false);
  });

  it("positioned with z-index:0 forms one", () => {
    expect(createsStackingContext({ ...baseStyle, position: "relative", zIndex: 0 })).toBe(true);
  });

  it("positioned with negative z-index forms one", () => {
    expect(createsStackingContext({ ...baseStyle, position: "absolute", zIndex: -3 })).toBe(true);
  });

  it("positioned with z-index:auto does not (z-index alone)", () => {
    expect(createsStackingContext({ ...baseStyle, position: "relative", zIndex: "auto" })).toBe(false);
  });

  it("opacity < 1 forms one even when static", () => {
    expect(createsStackingContext({ ...baseStyle, opacity: 0.5 })).toBe(true);
  });

  it("opacity exactly 1 does not", () => {
    expect(createsStackingContext({ ...baseStyle, opacity: 1 })).toBe(false);
  });

  it("transform other than none forms one even when static", () => {
    expect(createsStackingContext({ ...baseStyle, transform: "translateX(10px)" })).toBe(true);
  });

  it("transform: none does not", () => {
    expect(createsStackingContext({ ...baseStyle, transform: "none" })).toBe(false);
  });

  it("isolation: isolate forms one", () => {
    expect(createsStackingContext({ ...baseStyle, isolation: "isolate" })).toBe(true);
  });

  it("will-change listing transform or opacity forms one", () => {
    expect(createsStackingContext({ ...baseStyle, willChange: "transform" })).toBe(true);
    expect(createsStackingContext({ ...baseStyle, willChange: "opacity" })).toBe(true);
    expect(createsStackingContext({ ...baseStyle, willChange: "color" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildStackingTree + flattenStackingOrder
// ---------------------------------------------------------------------------

describe("buildStackingTree / flattenStackingOrder — single context", () => {
  it("assigns every command to the root when nothing else forms a context", () => {
    const dom = el("div", [el("p", [text("hi")])]);
    const { stackTree, commands } = pipeline(dom);

    expect(countContexts(stackTree)).toBe(1);
    expect(stackTree.items.filter((i) => i.kind === "command")).toHaveLength(commands.length);
    // Flattening a context-free tree must reproduce the original order.
    expect(flattenStackingOrder(stackTree)).toEqual(commands);
  });

  it("does not mutate or clone command objects when flattening", () => {
    const dom = el("div");
    const { stackTree, commands } = pipeline(
      dom,
      styleMap(new Map([[dom, { backgroundColor: "#123456" }]])),
    );
    const flat = flattenStackingOrder(stackTree);
    expect(flat[0]).toBe(commands[0]);
  });
});

describe("flattenStackingOrder — Appendix E ordering", () => {
  it("negative-z child paints after the context's own background but before flow content", () => {
    const neg = el("div", [text("neg")]);
    const flow = el("div", [text("flow")]);
    const dom = el("div", [neg, flow]);

    const { stackTree } = pipeline(
      dom,
      styleMap(new Map([
        [dom, { backgroundColor: "#111111" }],
        [neg, { backgroundColor: "#222222", position: "relative", zIndex: -1 }],
        [flow, { backgroundColor: "#333333" }],
      ])),
    );

    expect(sequence(flattenStackingOrder(stackTree))).toEqual([
      "bg:#111111",   // root's own background first
      "bg:#222222",   // negative-z child context
      "text:neg",
      "bg:#333333",   // flow content, document order (box bg before its text)
      "text:flow",
    ]);
  });

  it("positive-z child paints after all later document-order siblings", () => {
    const early = el("div", [text("early")]);
    const top = el("div", [text("top")]);
    const late = el("div", [text("late")]);
    const dom = el("div", [early, top, late]);

    const { stackTree } = pipeline(
      dom,
      styleMap(new Map([
        [top, { position: "relative", zIndex: 5 }],
      ])),
    );

    const seq = sequence(flattenStackingOrder(stackTree));
    expect(seq.indexOf("text:top")).toBeGreaterThan(seq.indexOf("text:late"));
    expect(seq.indexOf("text:top")).toBe(seq.length - 1);
  });

  it("sorts positive-z children ascending regardless of DOM order", () => {
    const low = el("div", [text("low")]);
    const high = el("div", [text("high")]);
    const mid = el("div", [text("mid")]);
    const dom = el("div", [high, low, mid]); // DOM order: high, low, mid

    const { stackTree } = pipeline(
      dom,
      styleMap(new Map([
        [high, { position: "relative", zIndex: 30 }],
        [low, { position: "relative", zIndex: 10 }],
        [mid, { position: "relative", zIndex: 20 }],
      ])),
    );

    expect(sequence(flattenStackingOrder(stackTree))).toEqual([
      "text:low",
      "text:mid",
      "text:high",
    ]);
  });

  it("equal z-index preserves document order (stable sort)", () => {
    const a = el("div", [text("a")]);
    const b = el("div", [text("b")]);
    const c = el("div", [text("c")]);
    const dom = el("div", [c, a, b]);

    const { stackTree } = pipeline(
      dom,
      styleMap(new Map([
        [a, { position: "relative", zIndex: 2 }],
        [b, { position: "relative", zIndex: 2 }],
        [c, { position: "relative", zIndex: 2 }],
      ])),
    );

    expect(sequence(flattenStackingOrder(stackTree))).toEqual([
      "text:c",
      "text:a",
      "text:b",
    ]);
  });

  it("keeps nested subtrees intact: positive grandchild stays inside its negative parent group", () => {
    const inner = el("span", [text("inner")]);
    const parent = el("div", [inner]);
    const sibling = el("div", [text("sibling")]);
    const dom = el("div", [parent, sibling]);

    const { stackTree } = pipeline(
      dom,
      styleMap(new Map([
        [parent, { position: "relative", zIndex: -2 }],
        [inner, { display: "inline-block", position: "relative", zIndex: 100 }],
      ])),
    );

    const seq = sequence(flattenStackingOrder(stackTree));
    const innerIdx = seq.indexOf("text:inner");
    const siblingIdx = seq.indexOf("text:sibling");
    // The whole negative-z group paints before the sibling, even though the
    // grandchild carries z=100 inside that group.
    expect(innerIdx).toBeLessThan(siblingIdx);
    expect(maxContextDepth(stackTree)).toBeGreaterThanOrEqual(3); // root → parent → inner
  });

  it("opacity < 1 static box forms its own context without disturbing sibling order", () => {
    const faded = el("div", [text("faded")]);
    const normal = el("div", [text("normal")]);
    const dom = el("div", [faded, normal]);

    const { stackTree, commands } = pipeline(
      dom,
      styleMap(new Map([
        [faded, { opacity: 0.4 }],
      ])),
    );

    // faded is a z=0 child context → middle band at its document position.
    expect(sequence(flattenStackingOrder(stackTree))).toEqual([
      "text:faded",
      "text:normal",
    ]);
    expect(countContexts(stackTree)).toBe(2);
    expect(commands.every((c) => typeof c === "object")).toBe(true);
  });

  it("z=0 positioned contexts stay interleaved in document order with z-auto content", () => {
    const before = el("div", [text("before")]);
    const zeroCtx = el("div", [text("zero")]);
    const autoPos = el("div", [text("auto")]);
    const after = el("div", [text("after")]);
    const dom = el("div", [before, zeroCtx, autoPos, after]);

    const { stackTree } = pipeline(
      dom,
      styleMap(new Map([
        [zeroCtx, { position: "relative", zIndex: 0 }],
        [autoPos, { position: "relative", zIndex: "auto" }],
      ])),
    );

    expect(sequence(flattenStackingOrder(stackTree))).toEqual([
      "text:before",
      "text:zero",
      "text:auto",
      "text:after",
    ]);
  });
});

describe("cross-file audit: sessions 1–5 full pipeline", () => {
  it("produces spec-ordered output for a mixed stacking page", () => {
    // Page: header bg, hidden-behind banner (z:-1), body text,
    // modal overlay (z:9), tooltip (z:10).
    const banner = el("div", [text("banner")]);
    const header = el("div", [text("header")]);
    const body = el("div", [text("body")]);
    const modal = el("div", [text("modal")]);
    const tooltip = el("div", [text("tooltip")]);
    const dom = el("div", [header, banner, body, modal, tooltip]);

    const { stackTree } = pipeline(
      dom,
      styleMap(new Map([
        [dom, { backgroundColor: "#ffffff" }],
        [banner, { backgroundColor: "#ff0000", position: "absolute", zIndex: -1 }],
        [modal, { backgroundColor: "#000000", position: "fixed", zIndex: 9 }],
        [tooltip, { backgroundColor: "#ffff00", position: "absolute", zIndex: 10 }],
      ])),
    );

    const seq = sequence(flattenStackingOrder(stackTree));
    expect(seq).toEqual([
      "bg:#ffffff",     // root background
      "bg:#ff0000",     // banner (z=-1)
      "text:banner",
      "text:header",    // flow content, document order
      "text:body",
      "bg:#000000",     // modal (z=9)
      "text:modal",
      "bg:#ffff00",     // tooltip (z=10)
      "text:tooltip",
    ]);
  });

  it("counts contexts and depth for diagnostics on a deep tree", () => {
    const midCtx = el("div", [el("div", [text("leaf")])]);
    const dom = el("div", [midCtx]);

    const { stackTree } = pipeline(
      dom,
      styleMap(new Map([
        [midCtx, { isolation: "isolate" }],
      ])),
    );

    expect(countContexts(stackTree)).toBe(2);
    expect(maxContextDepth(stackTree)).toBe(2);
    // Sanity: leaf text survived flattening.
    expect(sequence(flattenStackingOrder(stackTree))).toContain("text:leaf");
  });
});
