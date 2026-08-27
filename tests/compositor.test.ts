import { describe, it, expect } from "vitest";
import {
  buildRenderTree,
  DOMNodeType,
  type DOMNodeLike,
  type ComputedStyleLike,
} from "../src/browser/rendering/pipeline/render-tree";
import { buildLayoutTree, resolveBlockLayout } from "../src/browser/rendering/pipeline/layout-box";
import { buildPaintRecords } from "../src/browser/rendering/pipeline/paint-record";
import { PaintCommandKind } from "../src/browser/rendering/pipeline/paint-record";
import { buildStackingTree } from "../src/browser/rendering/pipeline/stacking-context";
import {
  planCompositing,
  cullCommands,
  commandRect,
  type CompositePlan,
} from "../src/browser/rendering/pipeline/compositor";

// --- tiny fake DOM builder (mirrors sessions 1–5 tests) ---------------------

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

/** Runs sessions 1→6 and returns the composite plan. */
function pipeline(
  dom: DOMNodeLike,
  resolver?: (n: DOMNodeLike) => ComputedStyleLike,
  viewport?: Parameters<typeof planCompositing>[1],
): { commands: ReturnType<typeof buildPaintRecords>; plan: CompositePlan } {
  const render = buildRenderTree(dom, resolver ?? styleMap(new Map()))!;
  const layoutTree = buildLayoutTree(render);
  resolveBlockLayout(layoutTree, { containingBlockWidth: 800 });
  const commands = buildPaintRecords(layoutTree);
  const stackTree = buildStackingTree(layoutTree, commands);
  const plan = planCompositing(stackTree, viewport);
  return { commands, plan };
}

/** Identifies a command by its source box's background color or text. */
function label(cmd: ReturnType<typeof buildPaintRecords>[number]): string {
  if (cmd.kind === "draw-text") return `text:${cmd.text}`;
  if (cmd.kind === "fill-rect") return `bg:${cmd.color}`;
  if (cmd.kind === "stroke-rect") return `border:${cmd.edge}`;
  return "img-placeholder";
}

const flatLabels = (plan: CompositePlan): string[] =>
  plan.layers.flatMap((l) => l.commands.map(label));

// ---------------------------------------------------------------------------
// commandRect
// ---------------------------------------------------------------------------

describe("commandRect", () => {
  it("returns the rect verbatim for rect-based commands", () => {
    const rect = { x: 5, y: 6, width: 7, height: 8 };
    const cmd = { kind: PaintCommandKind.FillRect as const, rect, color: "#fff", sourceBox: null as never };
    expect(commandRect(cmd)).toBe(rect); // identity — no copy
  });

  it("derives a deterministic box for draw-text", () => {
    const cmd = { kind: PaintCommandKind.DrawText as const, text: "hello", x: 10, y: 20, color: "#000", fontSize: 16, sourceBox: null as never };
    const r = commandRect(cmd);
    expect(r.x).toBe(10);
    expect(r.y).toBe(20 - 16); // baseline minus one em
    expect(r.width).toBeCloseTo(5 * 16 * 0.6);
    expect(r.height).toBeCloseTo(16 * 1.2);
  });
});

// ---------------------------------------------------------------------------
// Layer construction
// ---------------------------------------------------------------------------

describe("planCompositing — layer construction", () => {
  it("produces one base layer when nothing forms a context", () => {
    const dom = el("div", [el("div", [text("hi")])]);
    const { commands, plan } = pipeline(dom);

    expect(plan.layers).toHaveLength(1);
    const base = plan.layers[0]!;
    expect(base.id).toBe("layer-1");
    expect(base.needsIsolation).toBe(false);
    expect(base.sourceBox).toBeNull();
    expect(base.commands).toHaveLength(commands.length);
    expect(plan.stats.layerCount).toBe(1);
  });

  it("marks layers isolated for opacity < 1 contexts only", () => {
    const faded = el("div", [text("faded")]);
    const plain = el("div", [text("plain")]);
    const dom = el("div", [faded, plain]);

    const { plan } = pipeline(
      dom,
      styleMap(new Map([
        [faded, { opacity: 0.3 }],
        [plain, { position: "relative", zIndex: 2 }],
      ])),
    );

    const fadedLayer = plan.layers.find((l) => l.commands.some((c) => label(c) === "text:faded"))!;
    const plainLayer = plan.layers.find((l) => l.commands.some((c) => label(c) === "text:plain"))!;
    expect(fadedLayer.needsIsolation).toBe(true);
    expect(plainLayer.needsIsolation).toBe(false);
    expect(fadedLayer.sourceBox).not.toBeNull();
  });

  it("marks transform contexts isolated too", () => {
    const moved = el("div", [text("moved")]);
    const dom = el("div", [moved]);

    const { plan } = pipeline(
      dom,
      styleMap(new Map([[moved, { transform: "translateX(8px)" }]])),
    );

    const movedLayer = plan.layers.find((l) => l.needsIsolation)!;
    expect(movedLayer).toBeDefined();
    expect(movedLayer.commands.map(label)).toContain("text:moved");
  });

  it("emits layers in Appendix E order across z bands", () => {
    const neg = el("div", [text("neg")]);
    const flow = el("div", [text("flow")]);
    const pos = el("div", [text("pos")]);
    const dom = el("div", [neg, flow, pos]);

    const { plan } = pipeline(
      dom,
      styleMap(new Map([
        [neg, { backgroundColor: "#111111", position: "relative", zIndex: -1 }],
        [pos, { backgroundColor: "#222222", position: "relative", zIndex: 4 }],
      ])),
    );

    // Negative context's segment paints before base content; positive after.
    const seq = flatLabels(plan);
    expect(seq.indexOf("text:neg")).toBeLessThan(seq.indexOf("text:flow"));
    expect(seq.indexOf("text:flow")).toBeLessThan(seq.indexOf("text:pos"));
    // Root background still precedes everything.
    expect(plan.layers[0]!.commands[0]!.kind).toBe("fill-rect");
  });

  it("splits the base layer around negative-z children", () => {
    const neg = el("div", [text("neg")]);
    const dom = el("div", [el("p", [text("head")]), neg]);

    const { plan } = pipeline(
      dom,
      styleMap(new Map([
        [dom, { backgroundColor: "#ffffff" }],
        [neg, { backgroundColor: "#ff0000", position: "absolute", zIndex: -1 }],
      ])),
    );

    // Segments owned by root: [bg], then flow content after the neg layer.
    const rootSegments = plan.layers.filter((l) => l.sourceBox === null);
    expect(rootSegments.length).toBeGreaterThanOrEqual(2);
    expect(rootSegments[0]!.commands.map(label)).toEqual(["bg:#ffffff"]);
    const negIdx = plan.layers.findIndex((l) => l.sourceBox !== null && l.commands.some((c) => c.kind === "fill-rect"));
    const headLayerIdx = plan.layers.findIndex((l) => l.commands.some((c) => label(c) === "text:head"));
    expect(negIdx).toBeGreaterThan(0);
    expect(headLayerIdx).toBeGreaterThan(negIdx);
  });

  it("assigns sequential ids in paint order", () => {
    const a = el("div", [text("a")]);
    const b = el("div", [text("b")]);
    const dom = el("div", [a, b]);

    const { plan } = pipeline(
      dom,
      styleMap(new Map([
        [a, { isolation: "isolate" }],
        [b, { isolation: "isolate" }],
      ])),
    );

    expect(plan.layers.map((l) => l.id)).toEqual(plan.layers.map((_, i) => `layer-${i + 1}`));
  });
});

// ---------------------------------------------------------------------------
// Bounds & stats
// ---------------------------------------------------------------------------

describe("planCompositing — bounds & stats", () => {
  it("computes exact union bounds per layer", () => {
    const box = el("div");
    const dom = el("div", [box]);
    const styles = new Map<DOMNodeLike, Partial<ComputedStyleLike>>([
      [box, { backgroundColor: "#00ff00" }],
    ]);
    const { plan } = pipeline(dom, styleMap(styles));

    const layer = plan.layers[0]!;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const cmd of layer.commands) {
      const r = commandRect(cmd);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    expect(layer.bounds.x).toBe(minX);
    expect(layer.bounds.y).toBe(minY);
    expect(layer.bounds.width).toBe(maxX - minX);
    expect(layer.bounds.height).toBe(maxY - minY);
  });

  it("reports stats with zero culled when no viewport is given", () => {
    const dom = el("div", [el("div", [text("x")])]);
    const { commands, plan } = pipeline(dom);

    expect(plan.stats.totalCommandsIn).toBe(commands.length);
    expect(plan.stats.totalCommandsOut).toBe(commands.length);
    expect(plan.stats.culledCommands).toBe(0);
    expect(plan.viewport.width).toBe(Number.POSITIVE_INFINITY);
  });
});

// ---------------------------------------------------------------------------
// Viewport culling
// ---------------------------------------------------------------------------

describe("planCompositing — viewport culling", () => {
  it("drops fully-outside commands but keeps intersecting ones", () => {
    const near = el("div", [text("near")]);
    const spacer = el("div");
    const far = el("div", [text("far")]);
    const dom = el("div", [near, spacer, far]);
    const styles = new Map<DOMNodeLike, Partial<ComputedStyleLike>>([
      [near, { backgroundColor: "#0000ff", height: 50 }],
      [spacer, { height: 5000 }],
      [far, { backgroundColor: "#ff0000", height: 50 }],
    ]);

    const { plan } = pipeline(dom, styleMap(styles), { viewport: { x: 0, y: 0, width: 800, height: 600 } });

    const labels = flatLabels(plan);
    expect(labels).toContain("bg:#0000ff");
    expect(labels).not.toContain("bg:#ff0000");
    expect(labels).not.toContain("text:far");
    expect(plan.stats.culledCommands).toBeGreaterThan(0);
    expect(plan.stats.totalCommandsOut).toBe(
      plan.stats.totalCommandsIn - plan.stats.culledCommands,
    );
  });

  it("eliminates layers that become empty after culling", () => {
    const visible = el("div", [text("visible")]);
    const hidden = el("div", [text("hidden")]);
    const dom = el("div", [visible, hidden]);
    const styles = new Map<DOMNodeLike, Partial<ComputedStyleLike>>([
      [visible, { height: 40 }],
      [hidden, { isolation: "isolate", backgroundColor: "#123456", height: 40 }],
      // Spacer between them pushes `hidden` below the viewport.
    ]);
    // Insert spacer between via layout: give visible a big bottom margin.
    styles.set(visible, { height: 40, marginBottom: 5000 });

    const { plan } = pipeline(dom, styleMap(styles), { viewport: { x: 0, y: 0, width: 800, height: 600 } });

    const isolatedLayers = plan.layers.filter((l) => l.needsIsolation);
    expect(isolatedLayers).toHaveLength(0); // its only command was culled away
  });

  it("keeps partially-intersecting commands", () => {
    const half = el("div", [text("half")]);
    const dom = el("div", [half]);
    const styles = new Map<DOMNodeLike, Partial<ComputedStyleLike>>([
      [half, { backgroundColor: "#abcdef", height: 100 }],
    ]);

    // Viewport covers only y in [0, 50) — box spans [0, ~100).
    const { plan } = pipeline(dom, styleMap(styles), { viewport: { x: 0, y: 0, width: 800, height: 50 } });
    expect(flatLabels(plan)).toContain("bg:#abcdef");
  });
});

// ---------------------------------------------------------------------------
// Standalone cullCommands
// ---------------------------------------------------------------------------

describe("cullCommands", () => {
  it("partitions into kept and culled preserving order", () => {
    const inside = { kind: PaintCommandKind.FillRect as const, rect: { x: 0, y: 0, width: 10, height: 10 }, color: "#000", sourceBox: null as never };
    const outside = { kind: PaintCommandKind.FillRect as const, rect: { x: 9999, y: 9999, width: 10, height: 10 }, color: "#000", sourceBox: null as never };
    const touching = { kind: PaintCommandKind.FillRect as const, rect: { x: 9, y: 9, width: 10, height: 10 }, color: "#000", sourceBox: null as never };

    const viewport = { x: 0, y: 0, width: 100, height: 100 };
    const { kept, culled } = cullCommands([inside, outside, touching], viewport);

    expect(kept).toEqual([inside, touching]); // touching edge intersects
    expect(culled).toEqual([outside]);
  });
});
