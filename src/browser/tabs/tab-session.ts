import type { IDisposable } from '../../app/dependency-container';
import type { NavigationEntry, NavigationState } from '../navigation/navigation-controller';
import type { PageLoadState } from '../engine/browser-engine';

type TabEventType =
  | 'titleChanged' | 'urlChanged' | 'loadingStateChanged'
  | 'faviconChanged' | 'audibleChanged' | 'mutedChanged';

interface TabEvent {
  readonly kind: TabEventType;
  readonly tabId: string;
}

interface TitleChangedEvent extends TabEvent {
  readonly kind: 'titleChanged';
  readonly title: string;
}

interface UrlChangedEvent extends TabEvent {
  readonly kind: 'urlChanged';
  readonly url: string;
}

interface LoadingStateChangedEvent extends TabEvent {
  readonly kind: 'loadingStateChanged';
  readonly loading: boolean;
}

interface FaviconChangedEvent extends TabEvent {
  readonly kind: 'faviconChanged';
  readonly favicon: string;
}

interface AudibleChangedEvent extends TabEvent {
  readonly kind: 'audibleChanged';
  readonly audible: boolean;
}

interface MutedChangedEvent extends TabEvent {
  readonly kind: 'mutedChanged';
  readonly muted: boolean;
}

type TabSessionEvent =
  | TitleChangedEvent
  | UrlChangedEvent
  | LoadingStateChangedEvent
  | FaviconChangedEvent
  | AudibleChangedEvent
  | MutedChangedEvent;

interface ITabSession extends IDisposable {
  readonly id: string;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  groupId: string | null;
  readonly history: readonly NavigationEntry[];
  readonly historyIndex: number;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getState(): TabSessionState;
  setUrl(url: string): void;
  setTitle(title: string): void;
  setFavicon(favicon: string): void;
  setLoading(loading: boolean): void;
  setAudible(audible: boolean): void;
  setMuted(muted: boolean): void;
  setPinned(pinned: boolean): void;
  setGroupId(groupId: string | null): void;
  pushHistory(entry: NavigationEntry): void;
  on(type: TabEventType, handler: (event: TabSessionEvent) => void): void;
  off(type: TabEventType, handler: (event: TabSessionEvent) => void): void;
}

interface TabSessionState {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly favicon: string | null;
  readonly loading: boolean;
  readonly audible: boolean;
  readonly muted: boolean;
  readonly pinned: boolean;
  readonly groupId: string | null;
  readonly historyLength: number;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

type TabEventHandler = (event: TabSessionEvent) => void;

let _tabSeq = 0;
function nextTabId(): string {
  return `tab-${Date.now()}-${(++_tabSeq).toString(36)}`;
}

class TabSessionEventBus {
  private readonly channels = new Map<TabEventType, Set<TabEventHandler>>();

  on(type: TabEventType, handler: TabEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: TabEventType, handler: TabEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: TabSessionEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[TabSession] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class TabSession implements ITabSession {
  readonly id: string;
  private _url = '';
  private _title = '';
  private _favicon: string | null = null;
  private _loading = false;
  private _audible = false;
  private _muted = false;
  private _pinned = false;
  private _groupId: string | null = null;
  private readonly _history: NavigationEntry[] = [];
  private _historyIndex = -1;
  private readonly bus = new TabSessionEventBus();

  constructor(url = 'about:blank') {
    this.id = nextTabId();
    this._url = url;
  }

  get url(): string { return this._url; }
  get title(): string { return this._title; }
  get favicon(): string | null { return this._favicon; }
  get loading(): boolean { return this._loading; }
  get audible(): boolean { return this._audible; }
  get muted(): boolean { return this._muted; }
  get pinned(): boolean { return this._pinned; }
  get groupId(): string | null { return this._groupId; }
  get history(): readonly NavigationEntry[] { return [...this._history]; }
  get historyIndex(): number { return this._historyIndex; }

  canGoBack(): boolean { return this._historyIndex > 0; }
  canGoForward(): boolean { return this._historyIndex < this._history.length - 1; }

  getState(): TabSessionState {
    return {
      id: this.id,
      url: this._url,
      title: this._title,
      favicon: this._favicon,
      loading: this._loading,
      audible: this._audible,
      muted: this._muted,
      pinned: this._pinned,
      groupId: this._groupId,
      historyLength: this._history.length,
      canGoBack: this.canGoBack(),
      canGoForward: this.canGoForward(),
    };
  }

  setUrl(url: string): void {
    if (this._url === url) return;
    this._url = url;
    this.bus.emit({ kind: 'urlChanged', tabId: this.id, url });
  }

  setTitle(title: string): void {
    if (this._title === title) return;
    this._title = title;
    this.bus.emit({ kind: 'titleChanged', tabId: this.id, title });
  }

  setFavicon(favicon: string): void {
    if (this._favicon === favicon) return;
    this._favicon = favicon;
    this.bus.emit({ kind: 'faviconChanged', tabId: this.id, favicon });
  }

  setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this.bus.emit({ kind: 'loadingStateChanged', tabId: this.id, loading });
  }

  setAudible(audible: boolean): void {
    if (this._audible === audible) return;
    this._audible = audible;
    this.bus.emit({ kind: 'audibleChanged', tabId: this.id, audible });
  }

  setMuted(muted: boolean): void {
    if (this._muted === muted) return;
    this._muted = muted;
    this.bus.emit({ kind: 'mutedChanged', tabId: this.id, muted });
  }

  setPinned(pinned: boolean): void {
    this._pinned = pinned;
  }

  setGroupId(groupId: string | null): void {
    this._groupId = groupId;
  }

  pushHistory(entry: NavigationEntry): void {
    if (this._historyIndex < this._history.length - 1) {
      this._history.splice(this._historyIndex + 1);
    }
    this._history.push(entry);
    this._historyIndex = this._history.length - 1;
  }

  on(type: TabEventType, handler: TabEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: TabEventType, handler: TabEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this._history.length = 0;
    this._historyIndex = -1;
    this.bus.dispose();
  }
}

export { TabSession, TabSessionEventBus };
export type { ITabSession, TabSessionState, TabSessionEvent, TabEventType };
