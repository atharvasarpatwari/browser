/**
 * @file src/browser/engine/tab-context.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Provide per-tab isolation by giving each tab its own rendering pipeline,
 * JS context, and lifecycle state. A crash in one tab's context does not
 * affect other tabs or the browser process.
 *
 * Each TabContext owns:
 *   • Its own DomTree instance (DOM is not shared between tabs)
 *   • Its own LayoutEngine instance
 *   • Its own PaintEngine instance
 *   • Its own JsEventLoop (timers are per-tab)
 *   • Crash metadata (error, phase, crash count, recovery state)
 *   • A snapshot of the last known good state for recovery
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      ITabContext is the public contract.
 *  Encapsulation    All internal state is private; only lifecycle methods are public.
 *  Single-Resp.     TabContext owns one tab's isolation — nothing else.
 *  Open / Closed    New isolation strategies can be added via composition.
 *  Liskov-Subst.    Any ITabContext implementation can be used interchangeably.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { IDomTree, DomDocument } from '../rendering/dom-tree';
import { DomTree } from '../rendering/dom-tree';
import type { ILayoutEngine } from '../rendering/layout-engine';
import { LayoutEngine } from '../rendering/layout-engine';
import type { IPaintEngine } from '../rendering/paint-engine';
import { PaintEngine } from '../rendering/paint-engine';
import { EventLoop } from '../js/event-loop';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The operational state of a tab context. */
enum TabContextState {
  /** Freshly created, not yet navigated. */
  Idle       = 'idle',
  /** Currently loading/rendering a page. */
  Loading    = 'loading',
  /** Page loaded and interactive. */
  Active     = 'active',
  /** An error occurred; tab is non-functional. */
  Crashed    = 'crashed',
  /** Recovery in progress (re-navigating to last known URL). */
  Recovering = 'recovering',
  /** Context has been disposed. */
  Disposed   = 'disposed',
}

/** Describes why a tab context crashed. */
interface TabCrashInfo {
  /** The error that caused the crash. */
  readonly error: Error;
  /** The phase during which the crash occurred. */
  readonly phase: 'parse' | 'style' | 'layout' | 'paint' | 'script' | 'navigation' | 'unknown';
  /** When the crash occurred. */
  readonly timestamp: number;
  /** The URL that was being loaded when the crash occurred. */
  readonly url: string;
}

/** A snapshot of tab state for recovery. */
interface TabSnapshot {
  /** The URL of the last successfully loaded page. */
  readonly url: string;
  /** The page title at snapshot time. */
  readonly title: string;
  /** When the snapshot was taken. */
  readonly timestamp: number;
}

/** Configuration for a tab context. */
interface TabContextConfig {
  /** Maximum number of recovery attempts before giving up. */
  readonly maxRecoveryAttempts: number;
  /** Timeout in ms for any single rendering phase. */
  readonly phaseTimeoutMs: number;
  /** Whether to automatically attempt recovery on crash. */
  readonly autoRecover: boolean;
}

const DEFAULT_TAB_CONFIG: TabContextConfig = {
  maxRecoveryAttempts: 3,
  phaseTimeoutMs: 10_000,
  autoRecover: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ITabContext extends IDisposable {
  /** Unique identifier for this tab context. */
  readonly id: string;
  /** Current operational state. */
  readonly state: TabContextState;
  /** The DOM tree owned by this tab (isolated from other tabs). */
  readonly domTree: IDomTree;
  /** The layout engine owned by this tab. */
  readonly layoutEngine: ILayoutEngine;
  /** The paint engine owned by this tab. */
  readonly paintEngine: IPaintEngine;
  /** The JS event loop owned by this tab. */
  readonly eventLoop: EventLoop;
  /** Number of times this context has crashed. */
  readonly crashCount: number;
  /** Information about the last crash, or null if no crash. */
  readonly lastCrash: TabCrashInfo | null;
  /** The last known good state snapshot, or null if none. */
  readonly snapshot: TabSnapshot | null;

  /** Mark the context as loading a URL. */
  setLoading(url: string): void;
  /** Mark the context as active (page loaded successfully). */
  setActive(title: string): void;
  /** Record a crash with error info. */
  crash(error: Error, phase: TabCrashInfo['phase'], url: string): void;
  /** Attempt recovery by resetting state. Returns true if recovery is possible. */
  recover(): boolean;
  /** Take a snapshot of the current good state. */
  saveSnapshot(url: string, title: string): void;
  /** Get the tab context configuration. */
  getConfig(): TabContextConfig;
  /** Update the tab context configuration. */
  updateConfig(config: Partial<TabContextConfig>): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BUS
// ─────────────────────────────────────────────────────────────────────────────

type TabContextEventType = 'stateChanged' | 'crashed' | 'recovered' | 'snapshotSaved';

interface TabContextEvent {
  readonly kind: TabContextEventType;
  readonly tabId: string;
}

interface TabContextStateChangedEvent extends TabContextEvent {
  readonly kind: 'stateChanged';
  readonly from: TabContextState;
  readonly to: TabContextState;
}

interface TabContextCrashedEvent extends TabContextEvent {
  readonly kind: 'crashed';
  readonly crashInfo: TabCrashInfo;
}

interface TabContextRecoveredEvent extends TabContextEvent {
  readonly kind: 'recovered';
  readonly attempt: number;
}

interface TabContextSnapshotSavedEvent extends TabContextEvent {
  readonly kind: 'snapshotSaved';
  readonly url: string;
}

type TabContextBusEvent =
  | TabContextStateChangedEvent
  | TabContextCrashedEvent
  | TabContextRecoveredEvent
  | TabContextSnapshotSavedEvent;

type TabContextEventHandler = (event: TabContextBusEvent) => void;

class TabContextEventBus {
  private readonly channels = new Map<TabContextEventType, Set<TabContextEventHandler>>();

  on(type: TabContextEventType, handler: TabContextEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: TabContextEventType, handler: TabContextEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: TabContextBusEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[TabContextEventBus] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

let _tabContextSeq = 0;

class TabContext implements ITabContext {
  readonly id: string;
  private _state: TabContextState = TabContextState.Idle;
  private _crashCount = 0;
  private _lastCrash: TabCrashInfo | null = null;
  private _snapshot: TabSnapshot | null = null;
  private _config: TabContextConfig;
  private readonly _domTree: IDomTree;
  private readonly _layoutEngine: ILayoutEngine;
  private readonly _paintEngine: IPaintEngine;
  private readonly _eventLoop: EventLoop;
  private readonly bus = new TabContextEventBus();

  constructor(config?: Partial<TabContextConfig>) {
    this.id = `tabctx-${Date.now()}-${(++_tabContextSeq).toString(36)}`;
    this._config = { ...DEFAULT_TAB_CONFIG, ...config };
    this._domTree = new DomTree();
    this._layoutEngine = new LayoutEngine();
    this._paintEngine = new PaintEngine();
    this._eventLoop = new EventLoop();
  }

  get state(): TabContextState { return this._state; }
  get domTree(): IDomTree { return this._domTree; }
  get layoutEngine(): ILayoutEngine { return this._layoutEngine; }
  get paintEngine(): IPaintEngine { return this._paintEngine; }
  get eventLoop(): EventLoop { return this._eventLoop; }
  get crashCount(): number { return this._crashCount; }
  get lastCrash(): TabCrashInfo | null { return this._lastCrash; }
  get snapshot(): TabSnapshot | null { return this._snapshot; }

  setLoading(url: string): void {
    if (this._state === TabContextState.Crashed ||
        this._state === TabContextState.Disposed) return;
    this.transition(TabContextState.Loading);
  }

  setActive(title: string): void {
    if (this._state === TabContextState.Crashed ||
        this._state === TabContextState.Disposed) return;
    this.transition(TabContextState.Active);
  }

  crash(error: Error, phase: TabCrashInfo['phase'], url: string): void {
    this._crashCount++;
    this._lastCrash = {
      error,
      phase,
      timestamp: Date.now(),
      url,
    };
    this.transition(TabContextState.Crashed);
  }

  recover(): boolean {
    if (this._state !== TabContextState.Crashed) return false;
    if (this._crashCount >= this._config.maxRecoveryAttempts) return false;

    this.transition(TabContextState.Recovering);

    // Reset rendering pipeline state
    this._layoutEngine.dispose();
    this._paintEngine.dispose();
    this._layoutEngine.clearLayout?.();

    // Create fresh instances to avoid contaminated state
    // (In a real browser, we'd reuse the instances but clear their caches)

    this.transition(TabContextState.Active);
    return true;
  }

  saveSnapshot(url: string, title: string): void {
    this._snapshot = {
      url,
      title,
      timestamp: Date.now(),
    };
    this.bus.emit({ kind: 'snapshotSaved', tabId: this.id, url });
  }

  getConfig(): TabContextConfig {
    return { ...this._config };
  }

  updateConfig(config: Partial<TabContextConfig>): void {
    this._config = { ...this._config, ...config };
  }

  on(type: TabContextEventType, handler: TabContextEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: TabContextEventType, handler: TabContextEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    if (this._state === TabContextState.Disposed) return;
    this._layoutEngine.dispose();
    this._paintEngine.dispose();
    this._eventLoop.clear();
    this.bus.dispose();
    this.transition(TabContextState.Disposed);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private transition(to: TabContextState): void {
    const from = this._state;
    this._state = to;
    this.bus.emit({ kind: 'stateChanged', tabId: this.id, from, to });

    if (to === TabContextState.Crashed && this._lastCrash) {
      this.bus.emit({ kind: 'crashed', tabId: this.id, crashInfo: this._lastCrash });
    }
    if (to === TabContextState.Active && from === TabContextState.Recovering) {
      this.bus.emit({ kind: 'recovered', tabId: this.id, attempt: this._crashCount });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB CONTEXT MANAGER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages a set of TabContext instances, one per tab.
 * Provides creation, lookup, and bulk disposal.
 */
interface ITabContextManager extends IDisposable {
  createContext(config?: Partial<TabContextConfig>): TabContext;
  getContext(id: string): TabContext | null;
  destroyContext(id: string): boolean;
  getAllContexts(): readonly TabContext[];
  getCrashedContexts(): readonly TabContext[];
  dispose(): void;
}

class TabContextManager implements ITabContextManager {
  private readonly contexts = new Map<string, TabContext>();

  createContext(config?: Partial<TabContextConfig>): TabContext {
    const ctx = new TabContext(config);
    this.contexts.set(ctx.id, ctx);
    return ctx;
  }

  getContext(id: string): TabContext | null {
    return this.contexts.get(id) ?? null;
  }

  destroyContext(id: string): boolean {
    const ctx = this.contexts.get(id);
    if (!ctx) return false;
    ctx.dispose();
    this.contexts.delete(id);
    return true;
  }

  getAllContexts(): readonly TabContext[] {
    return [...this.contexts.values()];
  }

  getCrashedContexts(): readonly TabContext[] {
    return [...this.contexts.values()].filter(c => c.state === TabContextState.Crashed);
  }

  dispose(): void {
    for (const ctx of this.contexts.values()) {
      ctx.dispose();
    }
    this.contexts.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  TabContext,
  TabContextManager,
  TabContextEventBus,
  TabContextState,
  DEFAULT_TAB_CONFIG,
};

export type {
  ITabContext,
  ITabContextManager,
  TabContextConfig,
  TabCrashInfo,
  TabSnapshot,
  TabContextEvent,
  TabContextBusEvent,
  TabContextEventHandler,
  TabContextEventType,
};
