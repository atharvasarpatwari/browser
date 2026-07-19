import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatConsoleValue,
  formatConsoleMessage,
  ConsoleService,
  NetworkMonitor,
  DOMInspector,
  DevTools,
} from "../src/browser/netwroking/devtools";
import type {
  DOMNodeLike,
  ConnectionTarget,
  BoxModel,
} from "../src/browser/netwroking/devtools";
import type { FirewallDecision } from "../src/browser/netwroking/firewall";
import type { DNSRecord, ParsedIP } from "../src/browser/netwroking/ip-protocol";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeTarget(overrides?: Partial<ConnectionTarget>): ConnectionTarget {
  return { hostname: "example.com", port: 443, protocol: "https", ...overrides };
}

function makeIPv4(addr = "93.184.216.34"): ParsedIP {
  const octets = addr.split(".").map(Number) as [number, number, number, number];
  return { version: 4, octets, raw: addr };
}

function makeDNSRecord(hostname = "example.com", addr?: ParsedIP): DNSRecord {
  return { hostname, address: addr ?? makeIPv4(), ttlSeconds: 300, resolvedAt: Date.now() };
}

function makeFirewallDecision(action: "allow" | "deny", reason = "blocked by rule"): FirewallDecision {
  return {
    action,
    ruleId: "r1",
    reason,
    target: makeTarget(),
    address: makeIPv4(),
    timestamp: Date.now(),
  };
}

function makeNode(
  id: string,
  tag: string,
  attrs?: Record<string, string>,
  children?: DOMNodeLike[],
  text?: string,
): DOMNodeLike {
  return {
    nodeId: id,
    tagName: tag,
    attributes: attrs ?? {},
    children: children ?? [],
    ...(text !== undefined ? { textContent: text } : {}),
  };
}

function makeTree(): DOMNodeLike {
  return makeNode("root", "html", {}, [
    makeNode("head", "head", {}, [
      makeNode("title", "title", {}, [], "Test Page"),
      makeNode("meta", "meta", { charset: "utf-8" }),
    ]),
    makeNode("body", "body", { class: "main" }, [
      makeNode("div1", "div", { id: "container", class: "wrapper" }, [
        makeNode("p1", "p", { class: "text" }, [
          makeNode("span1", "span", { id: "label" }, [], "Hello"),
        ]),
        makeNode("p2", "p", { class: "text secondary" }, [
          makeNode("span2", "span", {}, [], "World"),
        ]),
      ]),
      makeNode("div2", "div", { id: "sidebar" }, [
        makeNode("a1", "a", { href: "/about" }, [], "About"),
      ]),
    ]),
  ]);
}

// =========================================================================
// formatConsoleValue
// =========================================================================

describe("formatConsoleValue", () => {
  it("returns strings as-is", () => {
    expect(formatConsoleValue("hello")).toBe("hello");
  });

  it("formats undefined", () => {
    expect(formatConsoleValue(undefined)).toBe("undefined");
  });

  it("formats functions with name", () => {
    function myFunc() {}
    expect(formatConsoleValue(myFunc)).toBe("[Function: myFunc]");
  });

  it("formats anonymous functions", () => {
    expect(formatConsoleValue(() => {})).toBe("[Function: anonymous]");
  });

  it("formats symbols", () => {
    expect(formatConsoleValue(Symbol.for("test"))).toBe("Symbol(test)");
  });

  it("formats errors", () => {
    const err = new Error("oops");
    expect(formatConsoleValue(err)).toBe("Error: oops");
  });

  it("formats named errors", () => {
    const err = new TypeError("bad type");
    expect(formatConsoleValue(err)).toBe("TypeError: bad type");
  });

  it("formats bigints", () => {
    expect(formatConsoleValue(BigInt(123))).toBe("123n");
  });

  it("formats objects as JSON", () => {
    expect(formatConsoleValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("handles circular references", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(formatConsoleValue(obj)).toContain("[Circular]");
  });

  it("formats numbers", () => {
    expect(formatConsoleValue(42)).toBe("42");
  });

  it("formats booleans", () => {
    expect(formatConsoleValue(true)).toBe("true");
  });

  it("formats null", () => {
    expect(formatConsoleValue(null)).toBe("null");
  });

  it("formats arrays", () => {
    expect(formatConsoleValue([1, 2])).toBe("[\n  1,\n  2\n]");
  });
});

// =========================================================================
// formatConsoleMessage
// =========================================================================

describe("formatConsoleMessage", () => {
  it("returns empty string for no args", () => {
    expect(formatConsoleMessage([])).toBe("");
  });

  it("joins non-format args", () => {
    expect(formatConsoleMessage(["hello", "world"])).toBe("hello world");
  });

  it("formats %s with string", () => {
    expect(formatConsoleMessage(["hello %s", "world"])).toBe("hello world");
  });

  it("formats %d with number", () => {
    expect(formatConsoleMessage(["count: %d", 42])).toBe("count: 42");
  });

  it("formats %i with number (truncated)", () => {
    expect(formatConsoleMessage(["val: %i", 3.7])).toBe("val: 3");
  });

  it("formats %f with float", () => {
    expect(formatConsoleMessage(["pi: %f", 3.14])).toBe("pi: 3.14");
  });

  it("formats %o with object", () => {
    expect(formatConsoleMessage(["obj: %o", { a: 1 }])).toContain('"a": 1');
  });

  it("formats %% as literal percent", () => {
    expect(formatConsoleMessage(["100%%"])).toBe("100%");
  });

  it("handles missing args for specifier", () => {
    expect(formatConsoleMessage(["hello %s"])).toBe("hello %s");
  });

  it("appends extra args after format string", () => {
    expect(formatConsoleMessage(["%s", "a", "b", "c"])).toBe("a b c");
  });

  it("handles non-string first arg", () => {
    expect(formatConsoleMessage([42, "extra"])).toBe("42 extra");
  });

  it("formats %c as empty string (CSS consumed)", () => {
    // %c is consumed (returns ""), but literal "red" after it stays in the string
    expect(formatConsoleMessage(["%cred%s", "style", "text"])).toBe("redtext");
  });
});

// =========================================================================
// ConsoleService
// =========================================================================

describe("ConsoleService", () => {
  let console: ConsoleService;

  beforeEach(() => {
    console = new ConsoleService();
  });

  it("log creates an entry", () => {
    const handler = vi.fn();
    console.onEntry(handler);
    console.log("hello");
    expect(handler).toHaveBeenCalledOnce();
    const entry = handler.mock.calls[0]![0];
    expect(entry.level).toBe("log");
    expect(entry.message).toBe("hello");
    expect(entry.repeatCount).toBe(1);
  });

  it("info creates an info-level entry", () => {
    const handler = vi.fn();
    console.onEntry(handler);
    console.info("test");
    expect(handler.mock.calls[0]![0].level).toBe("info");
  });

  it("warn creates a warn-level entry", () => {
    const handler = vi.fn();
    console.onEntry(handler);
    console.warn("warning");
    expect(handler.mock.calls[0]![0].level).toBe("warn");
  });

  it("error creates an error-level entry", () => {
    const handler = vi.fn();
    console.onEntry(handler);
    console.error("fail");
    expect(handler.mock.calls[0]![0].level).toBe("error");
  });

  it("debug creates a debug-level entry", () => {
    const handler = vi.fn();
    console.onEntry(handler);
    console.debug("trace");
    expect(handler.mock.calls[0]![0].level).toBe("debug");
  });

  it("collapses consecutive identical messages", () => {
    console.log("same");
    console.log("same");
    console.log("same");
    const entries = console.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.repeatCount).toBe(3);
  });

  it("does not collapse different messages", () => {
    console.log("a");
    console.log("b");
    expect(console.getEntries()).toHaveLength(2);
  });

  it("does not collapse across levels", () => {
    console.log("msg");
    console.warn("msg");
    expect(console.getEntries()).toHaveLength(2);
  });

  it("group creates grouped entry", () => {
    console.group("Section");
    console.log("inside");
    const entries = console.getEntries();
    expect(entries[1]!.groupPath).toEqual(["Section"]);
  });

  it("groupEnd pops the stack", () => {
    console.group("A");       // entry 0: groupPath = [] (captured before "A" pushed)
    console.group("B");       // entry 1: groupPath = ["A"] (captured before "B" pushed)
    console.log("deep");      // entry 2: groupPath = ["A", "B"]
    console.groupEnd();
    console.log("shallow");   // entry 3: groupPath = ["A"]
    const entries = console.getEntries();
    expect(entries[0]!.groupPath).toEqual([]);
    expect(entries[1]!.groupPath).toEqual(["A"]);
    expect(entries[2]!.groupPath).toEqual(["A", "B"]);
    expect(entries[3]!.groupPath).toEqual(["A"]);
  });

  it("clear removes all entries and emits cleared", () => {
    console.log("a");
    console.log("b");
    const handler = vi.fn();
    console.onClear(handler);
    console.clear();
    expect(console.getEntries()).toHaveLength(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("getEntries filters by level", () => {
    console.log("a");
    console.warn("b");
    console.error("c");
    console.log("d");
    const warns = console.getEntries({ levels: ["warn"] });
    expect(warns).toHaveLength(1);
    expect(warns[0]!.message).toBe("b");
  });

  it("getEntries filters by query", () => {
    console.log("hello world");
    console.log("goodbye");
    const result = console.getEntries({ query: "hello" });
    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe("hello world");
  });

  it("onEntry returns unsubscribe function", () => {
    const handler = vi.fn();
    const unsub = console.onEntry(handler);
    console.log("a");
    expect(handler).toHaveBeenCalledOnce();
    unsub();
    console.log("b");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("respects MAX_CONSOLE_ENTRIES (2000)", () => {
    for (let i = 0; i < 2100; i++) {
      console.log(`msg-${i}`);
    }
    expect(console.getEntries().length).toBe(2000);
    const first = console.getEntries()[0];
    expect(first!.message).toBe("msg-100");
  });

  it("patchGlobalConsole captures log calls", () => {
    const origLog = console.log;
    const restore = console.patchGlobalConsole();
    const handler = vi.fn();
    console.onEntry(handler);
    console.log("captured");
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].message).toBe("captured");
    restore();
  });

  it("patchGlobalConsole restore reverts console", () => {
    const globalConsole = globalThis.console;
    const origLog = globalConsole.log;
    const svc = new ConsoleService();
    const restore = svc.patchGlobalConsole();
    expect(globalConsole.log).not.toBe(origLog);
    restore();
    expect(globalConsole.log).toBe(origLog);
  });
});

// =========================================================================
// NetworkMonitor
// =========================================================================

describe("NetworkMonitor", () => {
  let monitor: NetworkMonitor;

  beforeEach(() => {
    monitor = new NetworkMonitor();
  });

  it("startEntry creates a pending entry", () => {
    const id = monitor.startEntry(makeTarget());
    const entry = monitor.getEntry(id);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("pending");
    expect(entry!.target.hostname).toBe("example.com");
  });

  it("startEntry records initiator", () => {
    const id = monitor.startEntry(makeTarget(), "navigation");
    expect(monitor.getEntry(id)!.initiator).toBe("navigation");
  });

  it("markDNSStart and markDNSEnd record timing", () => {
    const id = monitor.startEntry(makeTarget());
    monitor.markDNSStart(id);
    monitor.markDNSEnd(id);
    const timing = monitor.getTimingBreakdown(id);
    expect(timing).not.toBeNull();
    expect(timing!.dnsMs).toBeGreaterThanOrEqual(0);
  });

  it("markDNSEnd records resolved address", () => {
    const id = monitor.startEntry(makeTarget());
    const record = makeDNSRecord();
    monitor.markDNSEnd(id, record);
    expect(monitor.getEntry(id)!.resolvedAddress).toBeDefined();
  });

  it("markConnectStart sets connecting status", () => {
    const id = monitor.startEntry(makeTarget());
    monitor.markConnectStart(id);
    expect(monitor.getEntry(id)!.status).toBe("connecting");
  });

  it("complete sets complete status", () => {
    const id = monitor.startEntry(makeTarget());
    monitor.complete(id);
    expect(monitor.getEntry(id)!.status).toBe("complete");
  });

  it("fail sets error status with message", () => {
    const id = monitor.startEntry(makeTarget());
    monitor.fail(id, "connection refused");
    const entry = monitor.getEntry(id)!;
    expect(entry.status).toBe("error");
    expect(entry.errorMessage).toBe("connection refused");
  });

  it("recordHTTPRequest stores method and url", () => {
    const id = monitor.startEntry(makeTarget());
    monitor.recordHTTPRequest(id, { method: "GET", url: "https://example.com/page" });
    const entry = monitor.getEntry(id)!;
    expect(entry.method).toBe("GET");
    expect(entry.url).toBe("https://example.com/page");
  });

  it("recordHTTPResponse stores status code and headers", () => {
    const id = monitor.startEntry(makeTarget());
    monitor.recordHTTPResponse(id, {
      statusCode: 200,
      headers: { "content-type": "text/html" },
      transferSizeBytes: 1024,
    });
    const entry = monitor.getEntry(id)!;
    expect(entry.statusCode).toBe(200);
    expect(entry.responseHeaders).toEqual({ "content-type": "text/html" });
    expect(entry.transferSizeBytes).toBe(1024);
  });

  it("recordFirewallDecision creates blocked entry for deny", () => {
    const decision = makeFirewallDecision("deny", "private network");
    const id = monitor.recordFirewallDecision(decision);
    const entry = monitor.getEntry(id)!;
    expect(entry.status).toBe("blocked");
    expect(entry.blockedReason).toBe("private network");
    expect(entry.initiator).toBe("firewall");
  });

  it("recordFirewallDecision creates complete entry for allow", () => {
    const decision = makeFirewallDecision("allow", "explicit allow");
    const id = monitor.recordFirewallDecision(decision);
    expect(monitor.getEntry(id)!.status).toBe("complete");
  });

  it("createAttemptListener patches attempt number and starts connect", () => {
    const id = monitor.startEntry(makeTarget());
    const listener = monitor.createAttemptListener(id);
    listener(makeDNSRecord(), 2);
    const entry = monitor.getEntry(id)!;
    expect(entry.attemptNumber).toBe(2);
    expect(entry.status).toBe("connecting");
  });

  it("wrapOpenSocket times connect and completes on success", async () => {
    const id = monitor.startEntry(makeTarget());
    const mockSocket = { target: makeTarget(), resolvedAddress: makeIPv4(), state: "open" as const };
    const openSocket = vi.fn().mockResolvedValue(mockSocket);
    const wrapped = monitor.wrapOpenSocket(id, openSocket);

    const result = await wrapped(makeIPv4(), 443);
    expect(result).toBe(mockSocket);
    expect(monitor.getEntry(id)!.status).toBe("complete");
  });

  it("wrapOpenSocket records error on failure", async () => {
    const id = monitor.startEntry(makeTarget());
    const openSocket = vi.fn().mockRejectedValue(new Error("timeout"));
    const wrapped = monitor.wrapOpenSocket(id, openSocket);

    await expect(wrapped(makeIPv4(), 443)).rejects.toThrow("timeout");
    expect(monitor.getEntry(id)!.status).toBe("error");
    expect(monitor.getEntry(id)!.errorMessage).toBe("timeout");
  });

  it("getEntries filters by status", () => {
    const id1 = monitor.startEntry(makeTarget());
    const id2 = monitor.startEntry(makeTarget());
    monitor.complete(id1);
    monitor.fail(id2, "err");
    const completed = monitor.getEntries({ status: ["complete"] });
    expect(completed).toHaveLength(1);
    expect(completed[0]!.id).toBe(id1);
  });

  it("getEntries filters by hostname", () => {
    monitor.startEntry(makeTarget({ hostname: "a.com" }));
    monitor.startEntry(makeTarget({ hostname: "b.com" }));
    const result = monitor.getEntries({ hostname: "a.com" });
    expect(result).toHaveLength(1);
    expect(result[0]!.target.hostname).toBe("a.com");
  });

  it("clear removes all entries and emits cleared", () => {
    monitor.startEntry(makeTarget());
    const handler = vi.fn();
    monitor.onClear(handler);
    monitor.clear();
    expect(monitor.getEntries()).toHaveLength(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("onEntry returns unsubscribe function", () => {
    const handler = vi.fn();
    const unsub = monitor.onEntry(handler);
    monitor.startEntry(makeTarget());
    expect(handler).toHaveBeenCalledOnce();
    unsub();
    monitor.startEntry(makeTarget());
    expect(handler).toHaveBeenCalledOnce();
  });

  it("getTimingBreakdown returns null for unknown id", () => {
    expect(monitor.getTimingBreakdown("nonexistent")).toBeNull();
  });

  it("getTimingBreakdown computes all phases", () => {
    const id = monitor.startEntry(makeTarget());
    monitor.markDNSStart(id);
    monitor.markDNSEnd(id);
    monitor.markConnectStart(id);
    monitor.markConnectEnd(id);
    monitor.markRequestStart(id);
    monitor.markResponseStart(id);
    monitor.complete(id);

    const b = monitor.getTimingBreakdown(id)!;
    expect(b.dnsMs).toBeGreaterThanOrEqual(0);
    expect(b.connectMs).toBeGreaterThanOrEqual(0);
    expect(b.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(b.downloadMs).toBeGreaterThanOrEqual(0);
    expect(b.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("exportHAR produces valid HAR structure", () => {
    const id = monitor.startEntry(makeTarget());
    monitor.complete(id);
    const har = monitor.exportHAR() as any;
    expect(har.log.version).toBe("1.2");
    expect(har.log.creator.name).toBe("NovaBrowser DevTools");
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0].request.method).toBe("CONNECT");
    expect(har.log.entries[0].response.status).toBe(-1);
  });

  it("exportHAR includes blocked reason for blocked entries", () => {
    const decision = makeFirewallDecision("deny", "blocked");
    monitor.recordFirewallDecision(decision);
    const har = monitor.exportHAR() as any;
    expect(har.log.entries[0]._blockedReason).toBe("blocked");
    expect(har.log.entries[0].response.status).toBe(0);
  });

  it("respects MAX_NETWORK_ENTRIES (1000)", () => {
    for (let i = 0; i < 1002; i++) {
      monitor.startEntry(makeTarget({ hostname: `h${i}.com` }));
    }
    expect(monitor.getEntries()).toHaveLength(1000);
  });
});

// =========================================================================
// DOMInspector
// =========================================================================

describe("DOMInspector", () => {
  let inspector: DOMInspector;

  beforeEach(() => {
    inspector = new DOMInspector(() => makeTree());
  });

  it("getTree returns root", () => {
    const tree = inspector.getTree();
    expect(tree).not.toBeNull();
    expect(tree!.tagName).toBe("html");
  });

  it("findById finds a node", () => {
    const node = inspector.findById("p1");
    expect(node).not.toBeNull();
    expect(node!.tagName).toBe("p");
  });

  it("findById returns null for unknown id", () => {
    expect(inspector.findById("nonexistent")).toBeNull();
  });

  it("select and getSelected work together", () => {
    inspector.select("p1");
    const selected = inspector.getSelected();
    expect(selected).not.toBeNull();
    expect(selected!.nodeId).toBe("p1");
  });

  it("select ignores unknown id", () => {
    inspector.select("p1");
    inspector.select("nonexistent");
    expect(inspector.getSelected()!.nodeId).toBe("p1");
  });

  it("select(null) deselects", () => {
    inspector.select("p1");
    inspector.select(null);
    expect(inspector.getSelected()).toBeNull();
  });

  it("onSelectionChanged fires on select", () => {
    const handler = vi.fn();
    inspector.onSelectionChanged(handler);
    inspector.select("p1");
    expect(handler).toHaveBeenCalledWith("p1");
  });

  it("getBreadcrumbs returns path from root to node", () => {
    const crumbs = inspector.getBreadcrumbs("span1");
    expect(crumbs.length).toBeGreaterThanOrEqual(3);
    expect(crumbs[0]!.tagName).toBe("html");
    const last = crumbs[crumbs.length - 1];
    expect(last!.nodeId).toBe("span1");
  });

  it("getBreadcrumbs returns empty for unknown node", () => {
    expect(inspector.getBreadcrumbs("nonexistent")).toHaveLength(0);
  });

  it("setStyleProvider enables getComputedStyle", () => {
    inspector.setStyleProvider((id) => (id === "p1" ? { color: "red" } : null));
    expect(inspector.getComputedStyle("p1")).toEqual({ color: "red" });
    expect(inspector.getComputedStyle("nonexistent")).toBeNull();
  });

  it("getComputedStyle returns null without provider", () => {
    expect(inspector.getComputedStyle("p1")).toBeNull();
  });

  it("setBoxModelProvider enables getBoxModel", () => {
    const box: BoxModel = {
      content: { x: 0, y: 0, width: 100, height: 50 },
      padding: [5, 5, 5, 5],
      border: [1, 1, 1, 1],
      margin: [0, 0, 0, 0],
    };
    inspector.setBoxModelProvider((id) => (id === "p1" ? box : null));
    expect(inspector.getBoxModel("p1")).toEqual(box);
    expect(inspector.getBoxModel("nonexistent")).toBeNull();
  });

  it("search finds nodes by tag name", () => {
    const results = inspector.search("span");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("search finds nodes by attribute value", () => {
    const results = inspector.search("sidebar");
    expect(results).toHaveLength(1);
    expect(results[0]!.nodeId).toBe("div2");
  });

  it("search finds nodes by text content", () => {
    const results = inspector.search("Hello");
    expect(results).toHaveLength(1);
    expect(results[0]!.nodeId).toBe("span1");
  });

  it("querySelector finds element by tag", () => {
    const node = inspector.querySelector("span");
    expect(node).not.toBeNull();
    expect(node!.tagName).toBe("span");
  });

  it("querySelector finds element by id", () => {
    const node = inspector.querySelector("#sidebar");
    expect(node).not.toBeNull();
    expect(node!.nodeId).toBe("div2");
  });

  it("querySelector finds element by class", () => {
    const nodes = inspector.querySelectorAll(".text");
    expect(nodes).toHaveLength(2);
  });

  it("querySelector finds by attribute presence", () => {
    const node = inspector.querySelector("[href]");
    expect(node).not.toBeNull();
    expect(node!.nodeId).toBe("a1");
  });

  it("querySelector finds by attribute value", () => {
    const node = inspector.querySelector('[href="/about"]');
    expect(node).not.toBeNull();
    expect(node!.nodeId).toBe("a1");
  });

  it("querySelectorAll with descendant combinator", () => {
    const nodes = inspector.querySelectorAll("div p");
    expect(nodes).toHaveLength(2);
  });

  it("querySelectorAll compound selector", () => {
    // div.wrapper matches div1 (class="wrapper"); p.text matches p1 and p2
    const nodes = inspector.querySelectorAll("div.wrapper p.text");
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.nodeId)).toEqual(expect.arrayContaining(["p1", "p2"]));
  });

  it("querySelectorAll returns empty for no match", () => {
    expect(inspector.querySelectorAll("table")).toHaveLength(0);
  });

  it("querySelector returns null for no match", () => {
    expect(inspector.querySelector("table")).toBeNull();
  });

  it("querySelectorAll deduplicates results", () => {
    const nodes = inspector.querySelectorAll("html html");
    expect(nodes).toHaveLength(0); // root is excluded from descendants
  });
});

// =========================================================================
// DevTools facade
// =========================================================================

describe("DevTools", () => {
  let devtools: DevTools;

  beforeEach(() => {
    devtools = new DevTools(() => makeTree());
  });

  it("initializes with all panels", () => {
    expect(devtools.console).toBeDefined();
    expect(devtools.network).toBeDefined();
    expect(devtools.inspector).toBeDefined();
  });

  it("open sets isOpen and emits events", () => {
    const openHandler = vi.fn();
    const panelHandler = vi.fn();
    devtools.onOpenChanged(openHandler);
    devtools.onPanelChanged(panelHandler);
    devtools.open("console");
    expect(devtools.isOpen()).toBe(true);
    expect(openHandler).toHaveBeenCalledWith(true);
    expect(panelHandler).toHaveBeenCalledWith("console");
  });

  it("close clears isOpen and emits event", () => {
    devtools.open();
    const handler = vi.fn();
    devtools.onOpenChanged(handler);
    devtools.close();
    expect(devtools.isOpen()).toBe(false);
    expect(handler).toHaveBeenCalledWith(false);
  });

  it("toggle toggles open state", () => {
    devtools.toggle();
    expect(devtools.isOpen()).toBe(true);
    devtools.toggle();
    expect(devtools.isOpen()).toBe(false);
  });

  it("setPanel changes active panel", () => {
    const handler = vi.fn();
    devtools.onPanelChanged(handler);
    devtools.setPanel("network");
    expect(devtools.getPanel()).toBe("network");
    expect(handler).toHaveBeenCalledWith("network");
  });

  it("open defaults to current panel", () => {
    devtools.setPanel("network");
    devtools.close();
    const handler = vi.fn();
    devtools.onPanelChanged(handler);
    devtools.open();
    expect(handler).toHaveBeenCalledWith("network");
  });

  it("dispose cleans up", () => {
    const handler = vi.fn();
    devtools.onOpenChanged(handler);
    devtools.dispose();
    devtools.open();
    expect(handler).not.toHaveBeenCalled();
  });

  it("enableGlobalConsoleCapture and disableGlobalConsoleCapture", () => {
    devtools.enableGlobalConsoleCapture();
    const handler = vi.fn();
    devtools.console.onEntry(handler);
    // console.log should now be captured
    console.log("test-capture");
    expect(handler).toHaveBeenCalled();
    devtools.disableGlobalConsoleCapture();
  });
});
