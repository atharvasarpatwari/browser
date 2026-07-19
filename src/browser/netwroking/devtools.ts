/**
 * @file src/browser/netwroking/devtools.ts
 *
 * -----------------------------------------------------------------------
 * Developer Tools for NovaBrowser: Inspector, Console, and Network tab.
 *
 * Integrates with the existing Networking layer (ip-protocol.ts,
 * firewall.ts) rather than re-modeling connection state — a blocked
 * firewall decision becomes a "blocked" row in the Network tab, and
 * connection attempts feed real Resource-Timing-style timing marks.
 *
 * The Inspector deliberately does not depend on a concrete DOM/Engine
 * implementation. It works against a small `DOMNodeLike` interface so
 * whatever the Engine layer's node type turns out to be, an adapter can
 * satisfy this contract without devtools.ts needing to change.
 *
 * Responsibilities:
 *   - Console: leveled logging, printf-style formatting, consecutive
 *     duplicate collapsing ("x12"), grouping, filtering, subscription
 *   - Network tab: per-connection entries with Resource-Timing-style
 *     phases (dns/connect/request/response), HTTP metadata slots for
 *     when the HTTP layer lands, firewall-blocked entries, HAR export
 *   - Inspector: generic DOM tree walking, a small CSS-selector-lite
 *     query engine (tag/#id/.class/[attr]/[attr=value], descendant
 *     combinator), selection, breadcrumbs, box-model/style adapters
 *   - A composite DevTools facade wiring all three panels together with
 *     a single subscribe API for a UI shell
 *
 * Zero external dependencies beyond ip-protocol.ts and firewall.ts.
 * Compiles clean under strict TypeScript (strict: true,
 * noUncheckedIndexedAccess: true).
 * -----------------------------------------------------------------------
 */

import {
  type ParsedIP,
  type ConnectionTarget,
  type DNSRecord,
  type SocketConnection,
  serializeIP,
} from "./ip-protocol";
import { type FirewallDecision } from "./firewall";

// =========================================================================
// 1. Shared event emitter
// =========================================================================

type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter — no Node EventEmitter dependency, browser-safe. */
class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<any>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

// =========================================================================
// 2. Console panel
// =========================================================================

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleEntry {
  id: number;
  level: LogLevel;
  message: string;
  args: unknown[];
  timestamp: number;
  groupPath: string[];
  repeatCount: number;
  source?: string;
}

export interface ConsoleFilter {
  levels?: LogLevel[];
  query?: string;
}

interface ConsoleEvents {
  entry: ConsoleEntry;
  cleared: void;
  [key: string]: unknown;
}

const MAX_CONSOLE_ENTRIES = 2000;

/**
 * Safely stringifies a value for console display, handling circular
 * references and common non-JSON types (functions, undefined, symbols)
 * that JSON.stringify would otherwise choke on or silently drop.
 */
export function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "bigint") return `${value.toString()}n`;

  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        if (typeof val === "bigint") return `${val.toString()}n`;
        return val;
      },
      2
    );
  } catch {
    return String(value);
  }
}

/** printf-style substitution: %s, %d/%i, %f, %o/%O, %% — mirrors console.log's own format spec. */
export function formatConsoleMessage(args: unknown[]): string {
  if (args.length === 0) return "";
  const first = args[0];

  if (typeof first !== "string" || !/%[sdifoOc%]/.test(first)) {
    return args.map(formatConsoleValue).join(" ");
  }

  let argIndex = 1;
  const formatted = first.replace(/%([sdifoOc%])/g, (match, specifier: string) => {
    if (specifier === "%") return "%";
    if (argIndex >= args.length) return match;
    const arg = args[argIndex++];
    switch (specifier) {
      case "s":
        return typeof arg === "string" ? arg : formatConsoleValue(arg);
      case "d":
      case "i":
        return String(Math.trunc(Number(arg)));
      case "f":
        return String(Number(arg));
      case "o":
      case "O":
        return formatConsoleValue(arg);
      case "c":
        return "";
      default:
        return match;
    }
  });

  const rest = args.slice(argIndex).map(formatConsoleValue);
  return [formatted, ...rest].join(" ").trim();
}

export class ConsoleService {
  private entries: ConsoleEntry[] = [];
  private nextId = 1;
  private groupStack: string[] = [];
  private events = new Emitter<ConsoleEvents>();

  log(...args: unknown[]): void {
    this.push("log", args);
  }
  info(...args: unknown[]): void {
    this.push("info", args);
  }
  warn(...args: unknown[]): void {
    this.push("warn", args);
  }
  error(...args: unknown[]): void {
    this.push("error", args);
  }
  debug(...args: unknown[]): void {
    this.push("debug", args);
  }

  group(label: string): void {
    this.push("log", [`▶ ${label}`]);
    this.groupStack.push(label);
  }

  groupEnd(): void {
    this.groupStack.pop();
  }

  private push(level: LogLevel, args: unknown[], source?: string): void {
    const message = formatConsoleMessage(args);
    const last = this.entries[this.entries.length - 1];

    if (
      last &&
      last.level === level &&
      last.message === message &&
      last.groupPath.length === this.groupStack.length &&
      last.groupPath.every((g, i) => g === this.groupStack[i])
    ) {
      last.repeatCount++;
      last.timestamp = Date.now();
      this.events.emit("entry", last);
      return;
    }

    const entry: ConsoleEntry = {
      id: this.nextId++,
      level,
      message,
      args,
      timestamp: Date.now(),
      groupPath: [...this.groupStack],
      repeatCount: 1,
      ...(source ? { source } : {}),
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_CONSOLE_ENTRIES) {
      this.entries.shift();
    }
    this.events.emit("entry", entry);
  }

  clear(): void {
    this.entries = [];
    this.groupStack = [];
    this.events.emit("cleared", undefined);
  }

  getEntries(filter?: ConsoleFilter): ConsoleEntry[] {
    let result = this.entries;
    if (filter?.levels) {
      const levels = filter.levels;
      result = result.filter((e) => levels.includes(e.level));
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      result = result.filter((e) => e.message.toLowerCase().includes(q));
    }
    return [...result];
  }

  onEntry(listener: Listener<ConsoleEntry>): () => void {
    return this.events.on("entry", listener);
  }

  onClear(listener: Listener<void>): () => void {
    return this.events.on("cleared", listener);
  }

  /**
   * Patches the global `console` object (if one exists — guarded for
   * non-browser/non-Node contexts) so ordinary console.* calls made
   * elsewhere in NovaBrowser also surface in this panel. Returns a
   * restore function.
   */
  patchGlobalConsole(): () => void {
    if (typeof console === "undefined") return () => {};

    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    console.log = (...args: unknown[]) => {
      this.log(...args);
      original.log.apply(console, args);
    };
    console.info = (...args: unknown[]) => {
      this.info(...args);
      original.info.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      this.warn(...args);
      original.warn.apply(console, args);
    };
    console.error = (...args: unknown[]) => {
      this.error(...args);
      original.error.apply(console, args);
    };
    console.debug = (...args: unknown[]) => {
      this.debug(...args);
      original.debug.apply(console, args);
    };

    return () => {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
    };
  }
}

// =========================================================================
// 3. Network panel
// =========================================================================

export type NetworkEntryStatus = "pending" | "connecting" | "complete" | "error" | "blocked";

export interface NetworkTiming {
  dnsStart?: number;
  dnsEnd?: number;
  connectStart?: number;
  connectEnd?: number;
  requestStart?: number;
  responseStart?: number;
  responseEnd?: number;
}

export interface NetworkTimingBreakdown {
  dnsMs: number | null;
  connectMs: number | null;
  ttfbMs: number | null;
  downloadMs: number | null;
  totalMs: number | null;
}

export interface NetworkEntry {
  id: string;
  target: ConnectionTarget;
  status: NetworkEntryStatus;
  resolvedAddress?: ParsedIP;
  timing: NetworkTiming;
  blockedReason?: string;
  errorMessage?: string;
  attemptNumber?: number;
  method?: string;
  url?: string;
  statusCode?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  transferSizeBytes?: number;
  initiator?: string;
}

interface NetworkEvents {
  entry: NetworkEntry;
  cleared: void;
  [key: string]: unknown;
}

const MAX_NETWORK_ENTRIES = 1000;

let networkEntryCounter = 0;
function nextNetworkEntryId(): string {
  networkEntryCounter++;
  return `net-${networkEntryCounter}-${Date.now()}`;
}

export class NetworkMonitor {
  private entries = new Map<string, NetworkEntry>();
  private order: string[] = [];
  private events = new Emitter<NetworkEvents>();

  startEntry(target: ConnectionTarget, initiator?: string): string {
    const id = nextNetworkEntryId();
    const entry: NetworkEntry = {
      id,
      target,
      status: "pending",
      timing: {},
      ...(initiator ? { initiator } : {}),
    };
    this.upsert(entry);
    return id;
  }

  markDNSStart(id: string): void {
    this.patchTiming(id, { dnsStart: now() });
  }

  markDNSEnd(id: string, record?: DNSRecord): void {
    this.patchTiming(id, { dnsEnd: now() });
    if (record) this.patch(id, { resolvedAddress: record.address });
  }

  markConnectStart(id: string): void {
    this.patchTiming(id, { connectStart: now() });
    this.patch(id, { status: "connecting" });
  }

  markConnectEnd(id: string): void {
    this.patchTiming(id, { connectEnd: now() });
  }

  markRequestStart(id: string): void {
    this.patchTiming(id, { requestStart: now() });
  }

  markResponseStart(id: string): void {
    this.patchTiming(id, { responseStart: now() });
  }

  complete(id: string): void {
    this.patchTiming(id, { responseEnd: now() });
    this.patch(id, { status: "complete" });
  }

  fail(id: string, errorMessage: string): void {
    this.patchTiming(id, { responseEnd: now() });
    this.patch(id, { status: "error", errorMessage });
  }

  recordHTTPRequest(id: string, info: { method: string; url: string; headers?: Record<string, string> }): void {
    this.patch(id, {
      method: info.method,
      url: info.url,
      ...(info.headers ? { requestHeaders: info.headers } : {}),
    });
  }

  recordHTTPResponse(
    id: string,
    info: { statusCode: number; headers?: Record<string, string>; transferSizeBytes?: number }
  ): void {
    this.patch(id, {
      statusCode: info.statusCode,
      ...(info.headers ? { responseHeaders: info.headers } : {}),
      ...(info.transferSizeBytes !== undefined ? { transferSizeBytes: info.transferSizeBytes } : {}),
    });
  }

  recordFirewallDecision(decision: FirewallDecision): string {
    const id = this.startEntry(decision.target, "firewall");
    if (decision.action === "deny") {
      this.patch(id, { status: "blocked", blockedReason: decision.reason, resolvedAddress: decision.address });
    } else {
      this.patch(id, { status: "complete", resolvedAddress: decision.address });
    }
    return id;
  }

  createAttemptListener(id: string): (record: DNSRecord, attemptNumber: number) => void {
    return (record: DNSRecord, attemptNumber: number) => {
      this.patch(id, { attemptNumber, resolvedAddress: record.address });
      this.markConnectStart(id);
    };
  }

  wrapOpenSocket(
    id: string,
    openSocket: (address: ParsedIP, port: number) => Promise<SocketConnection>
  ): (address: ParsedIP, port: number) => Promise<SocketConnection> {
    return async (address: ParsedIP, port: number) => {
      this.patch(id, { resolvedAddress: address });
      try {
        const connection = await openSocket(address, port);
        this.markConnectEnd(id);
        this.complete(id);
        return connection;
      } catch (err) {
        this.fail(id, err instanceof Error ? err.message : String(err));
        throw err;
      }
    };
  }

  getEntry(id: string): NetworkEntry | undefined {
    return this.entries.get(id);
  }

  getEntries(filter?: { status?: NetworkEntryStatus[]; hostname?: string }): NetworkEntry[] {
    let result = this.order.map((id) => this.entries.get(id)!).filter(Boolean);
    if (filter?.status) {
      const statuses = filter.status;
      result = result.filter((e) => statuses.includes(e.status));
    }
    if (filter?.hostname) {
      const h = filter.hostname.toLowerCase();
      result = result.filter((e) => e.target.hostname.toLowerCase().includes(h));
    }
    return result;
  }

  getTimingBreakdown(id: string): NetworkTimingBreakdown | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    return computeTimingBreakdown(entry.timing);
  }

  clear(): void {
    this.entries.clear();
    this.order = [];
    this.events.emit("cleared", undefined);
  }

  onEntry(listener: Listener<NetworkEntry>): () => void {
    return this.events.on("entry", listener);
  }

  onClear(listener: Listener<void>): () => void {
    return this.events.on("cleared", listener);
  }

  exportHAR(): object {
    return {
      log: {
        version: "1.2",
        creator: { name: "NovaBrowser DevTools", version: "1.0" },
        entries: this.getEntries().map((e) => {
          const timing = computeTimingBreakdown(e.timing);
          return {
            startedDateTime: e.timing.dnsStart ? new Date(e.timing.dnsStart).toISOString() : null,
            time: timing.totalMs ?? 0,
            request: {
              method: e.method ?? "CONNECT",
              url: e.url ?? `${e.target.protocol}://${e.target.hostname}:${e.target.port}`,
              headers: toHARHeaders(e.requestHeaders),
            },
            response: {
              status: e.statusCode ?? (e.status === "blocked" ? 0 : -1),
              headers: toHARHeaders(e.responseHeaders),
              bodySize: e.transferSizeBytes ?? -1,
            },
            serverIPAddress: e.resolvedAddress ? serializeIP(e.resolvedAddress) : undefined,
            timings: {
              dns: timing.dnsMs ?? -1,
              connect: timing.connectMs ?? -1,
              wait: timing.ttfbMs ?? -1,
              receive: timing.downloadMs ?? -1,
            },
            _status: e.status,
            _blockedReason: e.blockedReason,
          };
        }),
      },
    };
  }

  private patch(id: string, changes: Partial<NetworkEntry>): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const updated = { ...entry, ...changes };
    this.upsert(updated);
  }

  private patchTiming(id: string, changes: Partial<NetworkTiming>): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.upsert({ ...entry, timing: { ...entry.timing, ...changes } });
  }

  private upsert(entry: NetworkEntry): void {
    if (!this.entries.has(entry.id)) {
      this.order.push(entry.id);
      if (this.order.length > MAX_NETWORK_ENTRIES) {
        const evicted = this.order.shift();
        if (evicted) this.entries.delete(evicted);
      }
    }
    this.entries.set(entry.id, entry);
    this.events.emit("entry", entry);
  }
}

function now(): number {
  return Date.now();
}

function computeTimingBreakdown(t: NetworkTiming): NetworkTimingBreakdown {
  const dnsMs = t.dnsStart !== undefined && t.dnsEnd !== undefined ? t.dnsEnd - t.dnsStart : null;
  const connectMs =
    t.connectStart !== undefined && t.connectEnd !== undefined ? t.connectEnd - t.connectStart : null;
  const ttfbMs =
    t.requestStart !== undefined && t.responseStart !== undefined ? t.responseStart - t.requestStart : null;
  const downloadMs =
    t.responseStart !== undefined && t.responseEnd !== undefined ? t.responseEnd - t.responseStart : null;
  const start = t.dnsStart ?? t.connectStart ?? t.requestStart;
  const totalMs = start !== undefined && t.responseEnd !== undefined ? t.responseEnd - start : null;
  return { dnsMs, connectMs, ttfbMs, downloadMs, totalMs };
}

function toHARHeaders(headers?: Record<string, string>): Array<{ name: string; value: string }> {
  if (!headers) return [];
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

// =========================================================================
// 4. Inspector panel (Elements)
// =========================================================================

export interface DOMNodeLike {
  nodeId: string;
  tagName: string;
  attributes: Record<string, string>;
  children: DOMNodeLike[];
  textContent?: string;
}

export interface BoxModel {
  content: { x: number; y: number; width: number; height: number };
  padding: [number, number, number, number];
  border: [number, number, number, number];
  margin: [number, number, number, number];
}

export type StyleProvider = (nodeId: string) => Record<string, string> | null;
export type BoxModelProvider = (nodeId: string) => BoxModel | null;

interface InspectorEvents {
  selectionChanged: string | null;
  [key: string]: unknown;
}

export class DOMInspector {
  private selectedNodeId: string | null = null;
  private events = new Emitter<InspectorEvents>();
  private styleProvider: StyleProvider | null = null;
  private boxModelProvider: BoxModelProvider | null = null;

  constructor(private rootProvider: () => DOMNodeLike | null) {}

  setStyleProvider(provider: StyleProvider): void {
    this.styleProvider = provider;
  }

  setBoxModelProvider(provider: BoxModelProvider): void {
    this.boxModelProvider = provider;
  }

  getTree(): DOMNodeLike | null {
    return this.rootProvider();
  }

  findById(nodeId: string): DOMNodeLike | null {
    return this.walk(this.getTree(), (n) => n.nodeId === nodeId);
  }

  select(nodeId: string | null): void {
    if (nodeId !== null && !this.findById(nodeId)) return;
    this.selectedNodeId = nodeId;
    this.events.emit("selectionChanged", nodeId);
  }

  getSelected(): DOMNodeLike | null {
    return this.selectedNodeId ? this.findById(this.selectedNodeId) : null;
  }

  onSelectionChanged(listener: Listener<string | null>): () => void {
    return this.events.on("selectionChanged", listener);
  }

  getBreadcrumbs(nodeId: string): DOMNodeLike[] {
    const root = this.getTree();
    if (!root) return [];
    const path: DOMNodeLike[] = [];

    const search = (node: DOMNodeLike): boolean => {
      path.push(node);
      if (node.nodeId === nodeId) return true;
      for (const child of node.children) {
        if (search(child)) return true;
      }
      path.pop();
      return false;
    };

    search(root);
    return path;
  }

  getComputedStyle(nodeId: string): Record<string, string> | null {
    return this.styleProvider ? this.styleProvider(nodeId) : null;
  }

  getBoxModel(nodeId: string): BoxModel | null {
    return this.boxModelProvider ? this.boxModelProvider(nodeId) : null;
  }

  search(query: string): DOMNodeLike[] {
    const q = query.toLowerCase();
    const results: DOMNodeLike[] = [];

    const visit = (node: DOMNodeLike) => {
      const haystack = [
        node.tagName,
        node.textContent ?? "",
        ...Object.entries(node.attributes).flatMap(([k, v]) => [k, v]),
      ]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(q)) results.push(node);
      for (const child of node.children) visit(child);
    };

    const root = this.getTree();
    if (root) visit(root);
    return results;
  }

  querySelectorAll(selector: string): DOMNodeLike[] {
    const segments = selector.trim().split(/\s+/).filter(Boolean).map(parseCompoundSelector);
    const root = this.getTree();
    if (!root || segments.length === 0) return [];

    let candidates = [root];
    for (const segment of segments) {
      const next: DOMNodeLike[] = [];
      for (const candidate of candidates) {
        next.push(...descendantsMatching(candidate, segment));
      }
      candidates = dedupeByNodeId(next);
    }
    return candidates;
  }

  querySelector(selector: string): DOMNodeLike | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  private walk(node: DOMNodeLike | null, predicate: (n: DOMNodeLike) => boolean): DOMNodeLike | null {
    if (!node) return null;
    if (predicate(node)) return node;
    for (const child of node.children) {
      const found = this.walk(child, predicate);
      if (found) return found;
    }
    return null;
  }
}

interface CompoundSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: Array<{ name: string; value: string | null }>;
}

function parseCompoundSelector(raw: string): CompoundSelector {
  const result: CompoundSelector = { tag: null, id: null, classes: [], attrs: [] };
  const pattern = /(#[\w-]+)|(\.[\w-]+)|(\[[\w-]+(?:="[^"]*")?\])|([\w-]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const [, idPart, classPart, attrPart, tagPart] = match;
    if (idPart) {
      result.id = idPart.slice(1);
    } else if (classPart) {
      result.classes.push(classPart.slice(1));
    } else if (attrPart) {
      const inner = attrPart.slice(1, -1);
      const eqIdx = inner.indexOf("=");
      if (eqIdx === -1) {
        result.attrs.push({ name: inner, value: null });
      } else {
        const name = inner.slice(0, eqIdx);
        const value = inner.slice(eqIdx + 1).replace(/^"|"$/g, "");
        result.attrs.push({ name, value });
      }
    } else if (tagPart) {
      result.tag = tagPart;
    }
  }

  return result;
}

function matchesCompoundSelector(node: DOMNodeLike, sel: CompoundSelector): boolean {
  if (sel.tag && node.tagName.toLowerCase() !== sel.tag.toLowerCase()) return false;
  if (sel.id && node.attributes["id"] !== sel.id) return false;

  if (sel.classes.length > 0) {
    const nodeClasses = (node.attributes["class"] ?? "").split(/\s+/).filter(Boolean);
    if (!sel.classes.every((c) => nodeClasses.includes(c))) return false;
  }

  for (const attr of sel.attrs) {
    const actual = node.attributes[attr.name];
    if (actual === undefined) return false;
    if (attr.value !== null && actual !== attr.value) return false;
  }

  return true;
}

function descendantsMatching(node: DOMNodeLike, sel: CompoundSelector): DOMNodeLike[] {
  const results: DOMNodeLike[] = [];
  const visit = (n: DOMNodeLike, isRoot: boolean) => {
    if (!isRoot && matchesCompoundSelector(n, sel)) results.push(n);
    for (const child of n.children) visit(child, false);
  };
  visit(node, true);
  return results;
}

function dedupeByNodeId(nodes: DOMNodeLike[]): DOMNodeLike[] {
  const seen = new Set<string>();
  const result: DOMNodeLike[] = [];
  for (const n of nodes) {
    if (!seen.has(n.nodeId)) {
      seen.add(n.nodeId);
      result.push(n);
    }
  }
  return result;
}

// =========================================================================
// 5. Composite DevTools facade
// =========================================================================

export type DevToolsPanelName = "elements" | "console" | "network";

interface DevToolsShellEvents {
  panelChanged: DevToolsPanelName;
  openChanged: boolean;
  [key: string]: unknown;
}

export class DevTools {
  readonly console: ConsoleService;
  readonly network: NetworkMonitor;
  readonly inspector: DOMInspector;

  private isOpenFlag = false;
  private activePanel: DevToolsPanelName = "elements";
  private shellEvents = new Emitter<DevToolsShellEvents>();
  private restoreConsole: (() => void) | null = null;

  constructor(rootProvider: () => DOMNodeLike | null) {
    this.console = new ConsoleService();
    this.network = new NetworkMonitor();
    this.inspector = new DOMInspector(rootProvider);
  }

  open(panel: DevToolsPanelName = this.activePanel): void {
    this.isOpenFlag = true;
    this.activePanel = panel;
    this.shellEvents.emit("openChanged", true);
    this.shellEvents.emit("panelChanged", panel);
  }

  close(): void {
    this.isOpenFlag = false;
    this.shellEvents.emit("openChanged", false);
  }

  toggle(): void {
    this.isOpenFlag ? this.close() : this.open();
  }

  isOpen(): boolean {
    return this.isOpenFlag;
  }

  setPanel(panel: DevToolsPanelName): void {
    this.activePanel = panel;
    this.shellEvents.emit("panelChanged", panel);
  }

  getPanel(): DevToolsPanelName {
    return this.activePanel;
  }

  onPanelChanged(listener: Listener<DevToolsPanelName>): () => void {
    return this.shellEvents.on("panelChanged", listener);
  }

  onOpenChanged(listener: Listener<boolean>): () => void {
    return this.shellEvents.on("openChanged", listener);
  }

  enableGlobalConsoleCapture(): void {
    this.restoreConsole?.();
    this.restoreConsole = this.console.patchGlobalConsole();
  }

  disableGlobalConsoleCapture(): void {
    this.restoreConsole?.();
    this.restoreConsole = null;
  }

  dispose(): void {
    this.disableGlobalConsoleCapture();
    this.shellEvents.clear();
  }
}

// =========================================================================
// 6. Convenience export
// =========================================================================

export const DevToolsModule = {
  DevTools,
  ConsoleService,
  NetworkMonitor,
  DOMInspector,
  formatConsoleMessage,
  formatConsoleValue,
};

export default DevToolsModule;
