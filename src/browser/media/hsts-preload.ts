import type { IDisposable } from '../../app/dependency-container';

interface IHstsPreloadService extends IDisposable {
  isPreloaded(host: string): boolean;
  getPreloadedEntry(host: string): HstsPreloadEntry | undefined;
  checkUrl(url: string): HstsPreloadResult;
  addPreloadHost(host: string, includeSubDomains?: boolean): void;
  removePreloadHost(host: string): void;
  getPreloadCount(): number;
  getPreloadedHosts(): readonly string[];
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  onEvent(handler: HstsPreloadEventHandler): () => void;
}

type HstsPreloadEventKind = 'preload-hit' | 'host-added' | 'host-removed' | 'enabled-changed';
type HstsPreloadEventHandler = (event: HstsPreloadEvent) => void;

interface HstsPreloadEvent {
  readonly kind: HstsPreloadEventKind;
  readonly data?: Record<string, unknown>;
}

interface HstsPreloadEntry {
  readonly host: string;
  readonly includeSubDomains: boolean;
}

interface HstsPreloadResult {
  readonly host: string;
  readonly isPreloaded: boolean;
  readonly includeSubDomains: boolean;
  readonly shouldUpgrade: boolean;
  readonly upgradedUrl?: string;
}

const DEFAULT_PRELOAD_LIST: readonly HstsPreloadEntry[] = [
  { host: 'google.com', includeSubDomains: true },
  { host: 'youtube.com', includeSubDomains: true },
  { host: 'github.com', includeSubDomains: true },
  { host: 'github.io', includeSubDomains: false },
  { host: 'twitter.com', includeSubDomains: true },
  { host: 'x.com', includeSubDomains: true },
  { host: 'facebook.com', includeSubDomains: true },
  { host: 'wikipedia.org', includeSubDomains: true },
  { host: 'wikipedia.com', includeSubDomains: true },
  { host: 'amazon.com', includeSubDomains: true },
  { host: 'amazon.co.uk', includeSubDomains: true },
  { host: 'apple.com', includeSubDomains: true },
  { host: 'cloudflare.com', includeSubDomains: true },
  { host: 'microsoft.com', includeSubDomains: true },
  { host: 'live.com', includeSubDomains: true },
  { host: 'mozilla.org', includeSubDomains: true },
  { host: 'netflix.com', includeSubDomains: true },
  { host: 'paypal.com', includeSubDomains: true },
  { host: 'reddit.com', includeSubDomains: true },
  { host: 'wordpress.org', includeSubDomains: true },
  { host: 'yahoo.com', includeSubDomains: true },
  { host: 'dropbox.com', includeSubDomains: true },
  { host: 'linkedin.com', includeSubDomains: true },
  { host: 'stackoverflow.com', includeSubDomains: true },
  { host: 'duckduckgo.com', includeSubDomains: true },
  { host: 'bing.com', includeSubDomains: true },
  { host: 'spotify.com', includeSubDomains: true },
  { host: 'whatsapp.com', includeSubDomains: true },
  { host: 'zoom.us', includeSubDomains: true },
  { host: 'slack.com', includeSubDomains: true },
  { host: 'gitlab.com', includeSubDomains: true },
  { host: 'npmjs.com', includeSubDomains: true },
  { host: 'nodejs.org', includeSubDomains: true },
  { host: 'rubygems.org', includeSubDomains: true },
  { host: 'pypi.org', includeSubDomains: true },
  { host: 'chromium.org', includeSubDomains: true },
  { host: 'mozilla.com', includeSubDomains: true },
  { host: 'tutanota.com', includeSubDomains: true },
  { host: 'proton.me', includeSubDomains: true },
  { host: 'signal.org', includeSubDomains: true },
  { host: 'torproject.org', includeSubDomains: true },
];

class HstsPreloadService implements IHstsPreloadService {
  private _entries = new Map<string, HstsPreloadEntry>();
  private _enabled = true;
  private _handlers = new Set<HstsPreloadEventHandler>();

  constructor() {
    for (const entry of DEFAULT_PRELOAD_LIST) {
      this._entries.set(entry.host, entry);
    }
  }

  isPreloaded(host: string): boolean {
    if (!this._enabled) return false;
    return this.lookup(host.toLowerCase()) !== undefined;
  }

  getPreloadedEntry(host: string): HstsPreloadEntry | undefined {
    return this.lookup(host.toLowerCase());
  }

  checkUrl(url: string): HstsPreloadResult {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { host: url, isPreloaded: false, includeSubDomains: false, shouldUpgrade: false };
    }

    const host = u.hostname.toLowerCase();
    const entry = this.lookup(host);
    const isPreloaded = this._enabled && entry !== undefined;
    const shouldUpgrade = isPreloaded && u.protocol === 'http:';

    let upgradedUrl: string | undefined;
    if (shouldUpgrade) {
      u.protocol = 'https:';
      if (u.port === '80') u.port = '';
      upgradedUrl = u.toString();
      this.emit({ kind: 'preload-hit', data: { host, from: url, to: upgradedUrl } });
    }

    return {
      host,
      isPreloaded,
      includeSubDomains: entry?.includeSubDomains ?? false,
      shouldUpgrade,
      upgradedUrl,
    };
  }

  addPreloadHost(host: string, includeSubDomains = true): void {
    const lower = host.toLowerCase();
    this._entries.set(lower, { host: lower, includeSubDomains });
    this.emit({ kind: 'host-added', data: { host: lower, includeSubDomains } });
  }

  removePreloadHost(host: string): void {
    const lower = host.toLowerCase();
    this._entries.delete(lower);
    this.emit({ kind: 'host-removed', data: { host: lower } });
  }

  getPreloadCount(): number {
    return this._entries.size;
  }

  getPreloadedHosts(): readonly string[] {
    return [...this._entries.keys()];
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.emit({ kind: 'enabled-changed', data: { enabled } });
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  onEvent(handler: HstsPreloadEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: HstsPreloadEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._entries.clear();
  }

  private lookup(host: string): HstsPreloadEntry | undefined {
    if (this._entries.has(host)) return this._entries.get(host);
    for (const entry of this._entries.values()) {
      if (entry.includeSubDomains && host.endsWith('.' + entry.host)) return entry;
    }
    return undefined;
  }
}

export { HstsPreloadService, DEFAULT_PRELOAD_LIST };
export type { IHstsPreloadService, HstsPreloadEntry, HstsPreloadResult, HstsPreloadEvent, HstsPreloadEventKind, HstsPreloadEventHandler };
