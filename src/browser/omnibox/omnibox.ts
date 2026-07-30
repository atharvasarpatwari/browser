import type { IDisposable } from '../../app/dependency-container';

type OmniboxResultType = 'search' | 'url' | 'bookmark' | 'history' | 'suggestion' | 'engine';
type OmniboxAction = 'navigate' | 'search' | 'fill';

interface OmniboxResult {
  readonly type: OmniboxResultType;
  readonly text: string;
  readonly description: string;
  readonly url?: string;
  readonly icon?: string;
  readonly score: number;
  readonly source: string;
  readonly action: OmniboxAction;
}

interface OmniboxProvider {
  readonly name: string;
  getSuggestions(input: string, maxResults?: number): OmniboxResult[] | Promise<OmniboxResult[]>;
}

type OmniboxEventKind = 'resultsChanged' | 'navigated' | 'searched';
interface OmniboxEvent {
  readonly kind: OmniboxEventKind;
  readonly input: string;
  readonly results?: OmniboxResult[];
}

type OmniboxEventHandler = (event: OmniboxEvent) => void;

interface IOmnibox extends IDisposable {
  addProvider(provider: OmniboxProvider): void;
  removeProvider(name: string): boolean;
  getProviders(): OmniboxProvider[];
  onInputChanged(input: string, maxResults?: number): Promise<OmniboxResult[]>;
  selectResult(result: OmniboxResult): void;
  clear(): void;
  onEvent(handler: OmniboxEventHandler): () => void;
  get enabled(): boolean;
  set enabled(val: boolean);
}

class Omnibox implements IOmnibox {
  private readonly providers: OmniboxProvider[] = [];
  private readonly handlers = new Set<OmniboxEventHandler>();
  private _enabled = true;
  private _lastInput = '';
  private _lastResults: OmniboxResult[] = [];

  get enabled(): boolean { return this._enabled; }
  set enabled(val: boolean) { this._enabled = val; }

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

  async onInputChanged(input: string, maxResults = 8): Promise<OmniboxResult[]> {
    if (!this._enabled || !input.trim()) {
      const results: OmniboxResult[] = [];
      this._lastInput = input;
      this._lastResults = results;
      this.emit({ kind: 'resultsChanged', input, results });
      return results;
    }

    const trimmed = input.trim();
    const promises = this.providers.map(p =>
      Promise.resolve(p.getSuggestions(trimmed, maxResults)).catch(() => [] as OmniboxResult[]),
    );
    const nested = await Promise.all(promises);

    const seen = new Set<string>();
    const all: OmniboxResult[] = [];
    for (const list of nested) {
      for (const r of list) {
        const key = `${r.type}:${r.url ?? r.text}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(r);
        }
      }
    }

    all.sort((a, b) => b.score - a.score);
    const results = all.slice(0, maxResults);

    this._lastInput = input;
    this._lastResults = results;
    this.emit({ kind: 'resultsChanged', input, results });
    return results;
  }

  selectResult(result: OmniboxResult): void {
    if (result.action === 'navigate') {
      this.emit({ kind: 'navigated', input: result.url ?? result.text, results: [result] });
    } else if (result.action === 'search') {
      this.emit({ kind: 'searched', input: result.text, results: [result] });
    } else {
      this.emit({ kind: 'navigated', input: result.url ?? result.text, results: [result] });
    }
  }

  clear(): void {
    this._lastInput = '';
    this._lastResults = [];
    this.providers.length = 0;
    this.emit({ kind: 'resultsChanged', input: '', results: [] });
  }

  onEvent(handler: OmniboxEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: OmniboxEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.providers.length = 0;
    this.handlers.clear();
    this._lastResults = [];
    this._lastInput = '';
    this._enabled = false;
  }
}

export { Omnibox };
export type { IOmnibox, OmniboxResult, OmniboxProvider, OmniboxResultType, OmniboxAction, OmniboxEvent, OmniboxEventKind, OmniboxEventHandler };
