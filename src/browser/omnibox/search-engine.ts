import type { IDisposable } from '../../app/dependency-container';
import type { OmniboxProvider, OmniboxResult } from './omnibox';

interface SearchEngine {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly keyword: string;
  readonly icon?: string;
  isDefault: boolean;
}

interface ISearchEngineManager extends IDisposable {
  getEngines(): SearchEngine[];
  getDefaultEngine(): SearchEngine;
  setDefaultEngine(id: string): boolean;
  addEngine(engine: Omit<SearchEngine, 'id' | 'isDefault'>): SearchEngine;
  removeEngine(id: string): boolean;
  getEngineByKeyword(keyword: string): SearchEngine | null;
  buildSearchUrl(query: string, engineId?: string): string;
  parseKeyword(input: string): { keyword: string; query: string } | null;
  onEvent(handler: EngineEventHandler): () => void;
  reorderEngine(id: string, newIndex: number): boolean;
  replaceEngines(list: ReadonlyArray<Omit<SearchEngine, 'id' | 'isDefault'>>): void;
}

type EngineEventKind = 'added' | 'removed' | 'defaultChanged';
interface EngineEvent {
  readonly kind: EngineEventKind;
  readonly engine: SearchEngine;
}

type EngineEventHandler = (event: EngineEvent) => void;

/** The first entry is the default engine. */
const BUILT_IN_ENGINES: Array<Omit<SearchEngine, 'id' | 'isDefault'>> = [
  { name: 'Nova', url: 'nova://search?q=%s', keyword: 'nova', icon: '✨' },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'ddg', icon: '🦆' },
  { name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: 'g', icon: '🔍' },
  { name: 'Bing', url: 'https://www.bing.com/search?q=%s', keyword: 'b', icon: '🔵' },
  { name: 'Brave', url: 'https://search.brave.com/search?q=%s', keyword: 'br', icon: '🦁' },
  { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', keyword: 'eco', icon: '🌳' },
  { name: 'Kagi', url: 'https://kagi.com/search?q=%s', keyword: 'k', icon: '🔮' },
  { name: 'StartPage', url: 'https://www.startpage.com/do/search?q=%s', keyword: 'sp', icon: '🛡️' },
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', keyword: 'w', icon: '📚' },
  { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', keyword: 'yt', icon: '▶️' },
  { name: 'GitHub', url: 'https://github.com/search?q=%s', keyword: 'gh', icon: '🐙' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s', keyword: 'so', icon: '📋' },
  { name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s', keyword: 'r', icon: '👽' },
];

let engineCounter = 0;

class SearchEngineManager implements ISearchEngineManager {
  private engines: SearchEngine[] = [];
  private defaultId = '';
  private readonly handlers = new Set<EngineEventHandler>();

  constructor() {
    for (const e of BUILT_IN_ENGINES) {
      const id = `engine-${++engineCounter}`;
      this.engines.push({ ...e, id, isDefault: false });
    }
    this.defaultId = this.engines[0]?.id ?? '';
    if (this.defaultId) {
      const def = this.engines.find(e => e.id === this.defaultId);
      if (def) def.isDefault = true;
    }
  }

  getEngines(): SearchEngine[] {
    return [...this.engines];
  }

  getDefaultEngine(): SearchEngine {
    const def = this.engines.find(e => e.id === this.defaultId);
    if (def) return { ...def };
    if (this.engines.length > 0) {
      this.defaultId = this.engines[0].id;
      this.engines[0].isDefault = true;
      return { ...this.engines[0] };
    }
    return {
      id: 'fallback', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s',
      keyword: 'ddg', icon: '🦆', isDefault: true,
    };
  }

  setDefaultEngine(id: string): boolean {
    const engine = this.engines.find(e => e.id === id);
    if (!engine) return false;
    for (const e of this.engines) e.isDefault = false;
    engine.isDefault = true;
    this.defaultId = id;
    this.emit({ kind: 'defaultChanged', engine: { ...engine } });
    return true;
  }

  addEngine(opts: Omit<SearchEngine, 'id' | 'isDefault'>): SearchEngine {
    const id = `engine-${++engineCounter}`;
    const engine: SearchEngine = { ...opts, id, keyword: opts.keyword.trim().toLowerCase(), isDefault: false };
    this.engines.push(engine);
    this.emit({ kind: 'added', engine: { ...engine } });
    return { ...engine };
  }

  removeEngine(id: string): boolean {
    if (this.engines.length <= 1) return false;
    const idx = this.engines.findIndex(e => e.id === id);
    if (idx < 0) return false;
    const [engine] = this.engines.splice(idx, 1);
    const wasDefault = this.defaultId === id;
    if (wasDefault && this.engines.length > 0) {
      this.defaultId = this.engines[0].id;
      this.engines[0].isDefault = true;
    }
    this.emit({ kind: 'removed', engine });
    if (wasDefault && this.engines.length > 0) {
      this.emit({ kind: 'defaultChanged', engine: { ...this.engines[0] } });
    }
    return true;
  }

  reorderEngine(id: string, newIndex: number): boolean {
    const idx = this.engines.findIndex(e => e.id === id);
    if (idx < 0) return false;
    const clamped = Math.max(0, Math.min(newIndex, this.engines.length - 1));
    if (clamped === idx) return true;
    const [engine] = this.engines.splice(idx, 1);
    this.engines.splice(clamped, 0, engine);
    return true;
  }

  replaceEngines(list: ReadonlyArray<Omit<SearchEngine, 'id' | 'isDefault'>>): void {
    if (list.length === 0) return;
    this.engines = list.map(e => ({ ...e, id: `engine-${++engineCounter}`, isDefault: false }));
    this.defaultId = this.engines[0].id;
    this.engines[0].isDefault = true;
  }

  getEngineByKeyword(keyword: string): SearchEngine | null {
    return this.engines.find(e => e.keyword === keyword.toLowerCase()) ?? null;
  }

  buildSearchUrl(query: string, engineId?: string): string {
    const engine = engineId
      ? this.engines.find(e => e.id === engineId) ?? this.getDefaultEngine()
      : this.getDefaultEngine();
    return engine.url.replace('%s', encodeURIComponent(query));
  }

  parseKeyword(input: string): { keyword: string; query: string } | null {
    if (!input.startsWith('!')) return null;
    const spaceIdx = input.indexOf(' ');
    if (spaceIdx < 0) return null;
    const keyword = input.substring(1, spaceIdx).toLowerCase();
    const query = input.substring(spaceIdx + 1).trim();
    if (!keyword || !query) return null;
    const engine = this.getEngineByKeyword(keyword);
    if (!engine) return null;
    return { keyword, query };
  }

  onEvent(handler: EngineEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: EngineEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.engines.length = 0;
    this.handlers.clear();
  }
}

class EngineSwitchProvider implements OmniboxProvider {
  readonly name = 'engine-switch';
  private manager: ISearchEngineManager;

  constructor(manager: ISearchEngineManager) {
    this.manager = manager;
  }

  getSuggestions(input: string, maxResults = 3): OmniboxResult[] {
    const query = input.trim().toLowerCase();
    if (!query || !query.startsWith('!')) return [];

    const keyword = query.substring(1).split(/\s+/)[0].toLowerCase();
    const engines = this.manager.getEngines();

    const matched = keyword
      ? engines.filter(e => e.keyword.startsWith(keyword) || e.name.toLowerCase().includes(keyword))
      : engines;

    const results: OmniboxResult[] = [];
    let score = 80;
    for (const engine of matched) {
      if (results.length >= maxResults) break;
      const searchQuery = query.includes(' ') ? query.substring(query.indexOf(' ') + 1).trim() : '';
      results.push({
        type: 'engine',
        text: `!${engine.keyword}`,
        description: searchQuery
          ? `Search ${engine.name} for "${searchQuery}"`
          : `Search with ${engine.name}`,
        url: searchQuery
          ? engine.url.replace('%s', encodeURIComponent(searchQuery))
          : engine.url,
        icon: engine.icon ?? '🔍',
        score: score--,
        source: this.name,
        action: 'search',
      });
    }

    return results;
  }
}

export { SearchEngineManager, EngineSwitchProvider, BUILT_IN_ENGINES };
export type { ISearchEngineManager, SearchEngine, EngineEvent, EngineEventKind, EngineEventHandler };
