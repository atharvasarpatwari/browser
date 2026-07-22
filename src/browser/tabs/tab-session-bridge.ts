import type { IDisposable } from '../../app/dependency-container';
import type { ITabManager } from './tab-manager';
import type { ITabSession } from './tab-session';
import { TabContextState, type ITabContextManager, type TabContext } from '../engine/tab-context';

type TabSessionBridgeEventType =
  | 'tabContextCreated'
  | 'tabContextDestroyed'
  | 'tabContextCrashed';

interface TabSessionBridgeEvent {
  readonly kind: TabSessionBridgeEventType;
  readonly tabId: string;
  readonly contextId: string;
}

interface TabSessionBridgeCrashedEvent extends TabSessionBridgeEvent {
  readonly kind: 'tabContextCrashed';
  readonly error: Error;
}

type TabSessionBridgeEventUnion = TabSessionBridgeEvent | TabSessionBridgeCrashedEvent;
type TabSessionBridgeEventHandler = (event: TabSessionBridgeEventUnion) => void;

class TabSessionBridgeEventBus {
  private readonly channels = new Map<TabSessionBridgeEventType, Set<TabSessionBridgeEventHandler>>();

  on(type: TabSessionBridgeEventType, handler: TabSessionBridgeEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: TabSessionBridgeEventType, handler: TabSessionBridgeEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: TabSessionBridgeEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[TabSessionBridge] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

interface ITabSessionBridge extends IDisposable {
  getContextForTab(tabId: string): TabContext | null;
  getTabForContext(contextId: string): string | null;
  getAllMappings(): ReadonlyMap<string, string>;
  isTabAlive(tabId: string): boolean;
  on(type: TabSessionBridgeEventType, handler: TabSessionBridgeEventHandler): void;
  off(type: TabSessionBridgeEventType, handler: TabSessionBridgeEventHandler): void;
  dispose(): void;
}

class TabSessionBridge implements ITabSessionBridge {
  private readonly tabToContext = new Map<string, string>();
  private readonly contextToTab = new Map<string, string>();
  private readonly tabHandlers = new Map<string, (event: any) => void>();
  private readonly contextHandlers = new Map<string, (event: any) => void>();
  private readonly bus = new TabSessionBridgeEventBus();

  constructor(
    private readonly tabManager: ITabManager,
    private readonly contextManager: ITabContextManager,
  ) {
    this.tabManager.on('tabCreated', (e) => {
      if (e.kind === 'tabCreated') this.createContextForTab(e.tab);
    });

    this.tabManager.on('tabRemoved', (e) => {
      if (e.kind === 'tabRemoved') this.destroyContextForTab(e.tabId);
    });

    for (const tab of this.tabManager.tabs) {
      this.createContextForTab(tab);
    }
  }

  getContextForTab(tabId: string): TabContext | null {
    const ctxId = this.tabToContext.get(tabId);
    return ctxId ? this.contextManager.getContext(ctxId) : null;
  }

  getTabForContext(contextId: string): string | null {
    return this.contextToTab.get(contextId) ?? null;
  }

  getAllMappings(): ReadonlyMap<string, string> {
    return new Map(this.tabToContext);
  }

  isTabAlive(tabId: string): boolean {
    const ctxId = this.tabToContext.get(tabId);
    if (!ctxId) return false;
    const ctx = this.contextManager.getContext(ctxId);
    return ctx !== null && ctx.state !== TabContextState.Disposed;
  }

  on(type: TabSessionBridgeEventType, handler: TabSessionBridgeEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: TabSessionBridgeEventType, handler: TabSessionBridgeEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    for (const [tabId] of this.tabToContext) {
      this.cleanupTabHandlers(tabId);
    }
    for (const [ctxId] of this.contextToTab) {
      this.cleanupContextHandlers(ctxId);
    }
    this.tabToContext.clear();
    this.contextToTab.clear();
    this.bus.dispose();
  }

  private createContextForTab(tab: ITabSession): void {
    const ctx = this.contextManager.createContext();
    this.tabToContext.set(tab.id, ctx.id);
    this.contextToTab.set(ctx.id, tab.id);

    const tabHandler = (event: any) => {
      if (event.kind === 'urlChanged') ctx.setLoading(event.url);
      if (event.kind === 'titleChanged') ctx.setActive(event.title);
    };
    this.tabHandlers.set(tab.id, tabHandler);
    tab.on('urlChanged', tabHandler);
    tab.on('titleChanged', tabHandler);

    const ctxHandler = (event: any) => {
      if (event.kind === 'crashed') {
        this.bus.emit({
          kind: 'tabContextCrashed',
          tabId: tab.id,
          contextId: ctx.id,
          error: event.crashInfo.error,
        });
      }
    };
    this.contextHandlers.set(ctx.id, ctxHandler);
    ctx.on('crashed', ctxHandler);

    this.bus.emit({ kind: 'tabContextCreated', tabId: tab.id, contextId: ctx.id });
  }

  private destroyContextForTab(tabId: string): void {
    const ctxId = this.tabToContext.get(tabId);
    if (!ctxId) return;

    this.cleanupTabHandlers(tabId);
    this.cleanupContextHandlers(ctxId);
    this.contextManager.destroyContext(ctxId);
    this.tabToContext.delete(tabId);
    this.contextToTab.delete(ctxId);

    this.bus.emit({ kind: 'tabContextDestroyed', tabId, contextId: ctxId });
  }

  private cleanupTabHandlers(tabId: string): void {
    const handler = this.tabHandlers.get(tabId);
    if (handler) {
      const tab = this.tabManager.getTab(tabId);
      if (tab) {
        tab.off('urlChanged', handler);
        tab.off('titleChanged', handler);
      }
      this.tabHandlers.delete(tabId);
    }
  }

  private cleanupContextHandlers(ctxId: string): void {
    const handler = this.contextHandlers.get(ctxId);
    if (handler) {
      const ctx = this.contextManager.getContext(ctxId);
      if (ctx) ctx.off('crashed', handler);
      this.contextHandlers.delete(ctxId);
    }
  }
}

export { TabSessionBridge, TabSessionBridgeEventBus };
export type { ITabSessionBridge, TabSessionBridgeEventUnion, TabSessionBridgeEventType };
