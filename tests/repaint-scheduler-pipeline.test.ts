import { describe, it, expect } from "vitest";
import { RepaintScheduler } from "../src/browser/rendering/pipeline/repaint-scheduler";
import {
  buildRenderTree,
  DOMNodeType,
  type DOMNodeLike,
  type ComputedStyleLike,
} from "../src/browser/rendering/pipeline/render-tree";

// --- tiny helpers -----------------------------------------------------------

function el(name: string, children: DOMNodeLike[] = []): DOMNodeLike {
  return { nodeType: DOMNodeType.Element, nodeName: name, childNodes: children, textContent: null };
}
function txt(t: string): DOMNodeLike {
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

// ---------------------------------------------------------------------------
// renderSync — full pipeline
// ---------------------------------------------------------------------------

describe("RepaintScheduler — renderSync", () => {
  it("returns null when no DOM is set", () => {
    const sched = new RepaintScheduler();
    expect(sched.renderSync()).toBeNull();
  });

  it("produces a complete pipeline snapshot", () => {
    const div = el("div", [txt("hello")]);
    const dom = el("html", [div]);
    const sched = new RepaintScheduler()
      .setDOM(dom)
      .setStyleResolver(styleMap(new Map([[div, { backgroundColor: "#ff0000", width: 100, height: 50 }]])));

    const snap = sched.renderSync();
    expect(snap).not.toBeNull();
    expect(snap!.renderRoot).not.toBeNull();
    expect(snap!.layoutRoot).not.toBeNull();
    expect(snap!.paintCommands.length).toBeGreaterThan(0);
    expect(snap!.stackRoot).not.toBeNull();
    expect(snap!.compositePlan).not.toBeNull();
    expect(snap!.rasterResult).not.toBeNull();
  });

  it("increments frame number each call", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    const a = sched.renderSync();
    const b = sched.renderSync();
    expect(a!.metrics.frameNumber).toBe(1);
    expect(b!.metrics.frameNumber).toBe(2);
    expect(sched.frameCount).toBe(2);
  });

  it("records positive duration", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    const snap = sched.renderSync();
    expect(snap!.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("captures paint command count and layer count", () => {
    const div = el("div");
    const dom = el("div", [div]);
    const sched = new RepaintScheduler().setDOM(dom);
    const snap = sched.renderSync();
    expect(snap!.metrics.paintCommandCount).toBeGreaterThanOrEqual(0);
    expect(snap!.metrics.layerCount).toBeGreaterThanOrEqual(0);
  });

  it("applies viewport dimensions to layout", () => {
    const div = el("div");
    const dom = el("div", [div]);
    const sched = new RepaintScheduler({
      viewportWidth: 400,
      viewportHeight: 300,
    }).setDOM(dom);
    const snap = sched.renderSync();
    expect(snap!.rasterResult!.width).toBe(400);
    expect(snap!.rasterResult!.height).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// Request / coalescing
// ---------------------------------------------------------------------------

describe("RepaintScheduler — requestRepaint", () => {
  it("coalesces multiple requests into one frame", async () => {
    const dom = el("div");
    let frameCount = 0;
    const sched = new RepaintScheduler().setDOM(dom);
    sched.onFrameReady(() => { frameCount++; });

    sched.requestRepaint();
    sched.requestRepaint();
    sched.requestRepaint();

    await new Promise((r) => setTimeout(r, 50));
    expect(frameCount).toBe(1);
  });

  it("isPending returns true while a request is outstanding", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    expect(sched.isPending()).toBe(false);
    sched.requestRepaint();
    expect(sched.isPending()).toBe(true);
  });

  it("cancelRepaint stops the pending frame", async () => {
    const dom = el("div");
    let called = false;
    const sched = new RepaintScheduler().setDOM(dom);
    sched.onFrameReady(() => { called = true; });

    sched.requestRepaint();
    sched.cancelRepaint();
    await new Promise((r) => setTimeout(r, 50));
    expect(called).toBe(false);
    expect(sched.isPending()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("RepaintScheduler — history", () => {
  it("stores metrics in history", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    sched.renderSync();
    sched.renderSync();
    expect(sched.history.length).toBe(2);
    expect(sched.history[0]!.frameNumber).toBe(1);
    expect(sched.history[1]!.frameNumber).toBe(2);
  });

  it("respects maxHistory limit", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    sched.setMaxHistory(3);
    for (let i = 0; i < 5; i++) sched.renderSync();
    expect(sched.history.length).toBe(3);
    expect(sched.history[0]!.frameNumber).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Viewport resize
// ---------------------------------------------------------------------------

describe("RepaintScheduler — viewport", () => {
  it("setViewport updates dimensions and triggers repaint", async () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    sched.renderSync(); // initial frame
    sched.setViewport(640, 480);
    expect(sched.viewportWidth).toBe(640);
    expect(sched.viewportHeight).toBe(480);
    expect(sched.isPending()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe("RepaintScheduler — dispose", () => {
  it("clears state after dispose", () => {
    const dom = el("div");
    const sched = new RepaintScheduler().setDOM(dom);
    sched.renderSync();
    sched.dispose();
    expect(sched.history.length).toBe(0);
    expect(sched.lastSnapshot).toBeNull();
    expect(sched.renderSync()).toBeNull();
  });
});
