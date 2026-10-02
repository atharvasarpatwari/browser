import type { IDisposable } from '../../app/dependency-container';

type OmniboxResultType =
  | 'search' | 'url' | 'bookmark' | 'history' | 'suggestion' | 'engine'
  | 'answer' | 'tab' | 'action' | 'archive' | 'ai';
type OmniboxAction =
  | 'navigate' | 'search' | 'fill'
  | 'copy' | 'switch-tab' | 'run-action' | 'research';

interface OmniboxResult {
  readonly type: OmniboxResultType;
  readonly text: string;
  readonly description: string;
  readonly url?: string;
  readonly icon?: string;
  readonly score: number;
  readonly source: string;
  readonly action: OmniboxAction;
  /** Stable identity (tab id, action id…) — used for de-duplication and activation. */
  readonly id?: string;
  /** Right-aligned hint text, e.g. "Switch to tab". */
  readonly hint?: string;
  /** Provider-specific payload (e.g. a color swatch). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

interface OmniboxProvider {
  readonly name: string;
  /** Network-bound providers: their results are merged in later without delaying fast ones. */
  readonly slow?: boolean;
  getSuggestions(input: string, maxResults?: number): OmniboxResult[] | Promise<OmniboxResult[]>;
}

type OmniboxEventKind = 'resultsChanged' | 'navigated' | 'searched' | 'activated';
interface OmniboxEvent {
  readonly kind: OmniboxEventKind;
  readonly input: string;
  readonly results?: OmniboxResult[];
}

type OmniboxEventHandler = (event: OmniboxEvent) => void;

interface OmniboxOptions {
  /** Collapse navigable results that point at the same page (scheme/www/trailing slash ignored). */
  readonly canonicalDedupe?: boolean;
}

/** Narrows one query to specific providers and/or rewrites the text they see (e.g. `@tabs foo`). */
interface OmniboxRoute {
  /** Only providers with these names run. */
  readonly providers?: readonly string[];
  /** Text handed to providers instead of the raw input (the payload after a scope or bang). */
  readonly query?: string;
}

interface IOmnibox extends IDisposable {
  addProvider(provider: OmniboxProvider): void;
  removeProvider(name: string): boolean;
  getProviders(): OmniboxProvider[];
  onInputChanged(input: string, maxResults?: number, route?: OmniboxRoute): Promise<OmniboxResult[]>;
  selectResult(result: OmniboxResult): void;
  clear(): void;
  onEvent(handler: OmniboxEventHandler): () => void;
  get enabled(): boolean;
  set enabled(val: boolean);
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${u.port ? `:${u.port}` : ''}${path}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const NAVIGABLE: ReadonlySet<OmniboxAction> = new Set<OmniboxAction>(['navigate', 'switch-tab']);

class Omnibox implements IOmnibox {
  private readonly providers: OmniboxProvider[] = [];
  private readonly handlers = new Set<OmniboxEventHandler>();
  private readonly canonicalDedupe: boolean;
  private _enabled = true;
  private _lastInput = '';
  private _lastResults: OmniboxResult[] = [];
  /** Bumped on every input change; results from an older call are never published. */
  private _seq = 0;

  constructor(options: OmniboxOptions = {}) {
    this.canonicalDedupe = options.canonicalDedupe ?? false;
  }

  get enabled(): boolean { return this._enabled; }
  set enabled(val: boolean) {
    this._enabled = val;
    this._seq++; // toggling invalidates anything still in flight
  }

  addProvider(provider: OmniboxProvider): void {
    this.providers.push(provider);
  }

  removeProvider(name: string): boolean {
    const idx = this.providers.findIndex(p => p.name === name);
    if (idx < 0) return false;
    this.providers.splice(idx, 1);
    return true;
  }

  getProviders(): OmniboxProvider[] {
    return [...this.providers];
  }

  async onInputChanged(input: string, maxResults = 8, route?: OmniboxRoute): Promise<OmniboxResult[]> {
    const seq = ++this._seq;
    if (!this._enabled || !input.trim()) {
      const results: OmniboxResult[] = [];
      this._lastInput = input;
      this._lastResults = results;
      this.emit({ kind: 'resultsChanged', input, results });
      return results;
    }

    const trimmed = route?.query !== undefined ? route.query.trim() : input.trim();
    const allowed = route?.providers ? new Set(route.providers) : null;
    const providers = this.providers.filter((p) => !allowed || allowed.has(p.name));
    const lists: OmniboxResult[][] = providers.map(() => []);
    let version = 0;
    let publishedVersion = -1;

    const run = async (p: OmniboxProvider, i: number): Promise<void> => {
      try { lists[i] = await p.getSuggestions(trimmed, maxResults); } catch { lists[i] = []; }
      version++;
    };
    const publish = (): OmniboxResult[] => {
      const results = this.merge(lists, maxResults);
      if (seq === this._seq) {
        publishedVersion = version;
        this._lastInput = input;
        this._lastResults = results;
        this.emit({ kind: 'resultsChanged', input, results });
      }
      return results;
    };

    const fast: Promise<void>[] = [];
    const slow: Promise<void>[] = [];
    providers.forEach((p, i) => (p.slow ? slow : fast).push(run(p, i)));

    await Promise.all(fast);
    let results = publish();
    if (slow.length > 0) {
      await Promise.all(slow.map(p => p.then(() => {
        if (seq === this._seq && version !== publishedVersion) results = publish();
      })));
    }
    return results;
  }

  selectResult(result: OmniboxResult): void {
    switch (result.action) {
      case 'navigate':
        this.emit({ kind: 'navigated', input: result.url ?? result.text, results: [result] });
        break;
      case 'search':
        this.emit({ kind: 'searched', input: result.text, results: [result] });
        break;
      case 'fill':
        this.emit({ kind: 'navigated', input: result.url ?? result.text, results: [result] });
        break;
      default:
        this.emit({ kind: 'activated', input: result.text, results: [result] });
    }
  }

  clear(): void {
    this._seq++;
    this._lastInput = '';
    this._lastResults = [];
    this.providers.length = 0;
    this.emit({ kind: 'resultsChanged', input: '', results: [] });
  }

  onEvent(handler: OmniboxEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private merge(lists: readonly OmniboxResult[][], maxResults: number): OmniboxResult[] {
    const seen = new Set<string>();
    const all: OmniboxResult[] = [];
    for (const list of lists) {
      for (const r of list) {
        const key = `${r.type}:${r.id ?? r.url ?? r.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(r);
        }
      }
    }

    all.sort((a, b) => b.score - a.score);

    if (!this.canonicalDedupe) return all.slice(0, maxResults);

    const pages = new Set<string>();
    const out: OmniboxResult[] = [];
    for (const r of all) {
      if (r.url && NAVIGABLE.has(r.action)) {
        const page = canonicalUrl(r.url);
        if (pages.has(page)) continue;
        pages.add(page);
      }
      out.push(r);
    }
    return out.slice(0, maxResults);
  }

  private emit(event: OmniboxEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this._seq++;
    this.providers.length = 0;
    this.handlers.clear();
    this._lastResults = [];
    this._lastInput = '';
    this._enabled = false;
  }
}

export { Omnibox, canonicalUrl };
export type {
  IOmnibox, OmniboxOptions, OmniboxRoute, OmniboxResult, OmniboxProvider, OmniboxResultType,
  OmniboxAction, OmniboxEvent, OmniboxEventKind, OmniboxEventHandler,
};
