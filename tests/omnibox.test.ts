import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Omnibox } from '../src/browser/omnibox/omnibox';
import type { OmniboxProvider, OmniboxResult } from '../src/browser/omnibox/omnibox';
import { SearchSuggestionsProvider, isLikelyUrl } from '../src/browser/omnibox/search-suggestions';
import { UrlSuggestionsProvider, isDomainName, looksLikeUrl } from '../src/browser/omnibox/url-suggestions';
import { BookmarkSuggestionsProvider } from '../src/browser/omnibox/bookmark-suggestions';
import { HistorySuggestionsProvider, computeFrecency } from '../src/browser/omnibox/history-suggestions';
import { SearchEngineManager, EngineSwitchProvider, BUILT_IN_ENGINES } from '../src/browser/omnibox/search-engine';

/* ============================================================
   1. Omnibox Tests
   ============================================================ */
describe('Omnibox', () => {
  let omnibox: Omnibox;

  beforeEach(() => {
    omnibox = new Omnibox();
  });

  it('starts enabled', () => {
    expect(omnibox.enabled).toBe(true);
  });

  it('addProvider and getProviders', () => {
    const provider: OmniboxProvider = {
      name: 'test',
      getSuggestions: () => [{ type: 'suggestion', text: 'test', description: 'desc', score: 50, source: 'test', action: 'search' }],
    };
    omnibox.addProvider(provider);
    expect(omnibox.getProviders()).toHaveLength(1);
    expect(omnibox.getProviders()[0].name).toBe('test');
  });

  it('removeProvider removes by name', () => {
    const p1: OmniboxProvider = { name: 'a', getSuggestions: () => [] };
    const p2: OmniboxProvider = { name: 'b', getSuggestions: () => [] };
    omnibox.addProvider(p1);
    omnibox.addProvider(p2);
    expect(omnibox.removeProvider('a')).toBe(true);
    expect(omnibox.getProviders()).toHaveLength(1);
    expect(omnibox.getProviders()[0].name).toBe('b');
    expect(omnibox.removeProvider('nonexistent')).toBe(false);
  });

  it('onInputChanged returns empty when disabled', async () => {
    omnibox.enabled = false;
    const results = await omnibox.onInputChanged('test');
    expect(results).toEqual([]);
  });

  it('onInputChanged returns empty for empty input', async () => {
    const results = await omnibox.onInputChanged('');
    expect(results).toEqual([]);
  });

  it('onInputChanged queries providers and merges results', async () => {
    const p1: OmniboxProvider = {
      name: 'p1',
      getSuggestions: () => [
        { type: 'search', text: 'a', description: 'A', score: 50, source: 'p1', action: 'search' },
      ],
    };
    const p2: OmniboxProvider = {
      name: 'p2',
      getSuggestions: () => [
        { type: 'url', text: 'b', description: 'B', score: 80, source: 'p2', action: 'navigate' },
      ],
    };
    omnibox.addProvider(p1);
    omnibox.addProvider(p2);
    const results = await omnibox.onInputChanged('test');
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('p2'); // higher score first
  });

  it('onInputChanged deduplicates results', async () => {
    const p1: OmniboxProvider = {
      name: 'p1',
      getSuggestions: () => [
        { type: 'url', text: 'same', description: 'same', url: 'https://x.com', score: 50, source: 'p1', action: 'navigate' },
      ],
    };
    const p2: OmniboxProvider = {
      name: 'p2',
      getSuggestions: () => [
        { type: 'url', text: 'same', description: 'same', url: 'https://x.com', score: 80, source: 'p2', action: 'navigate' },
      ],
    };
    omnibox.addProvider(p1);
    omnibox.addProvider(p2);
    const results = await omnibox.onInputChanged('test');
    expect(results).toHaveLength(1);
  });

  it('onInputChanged respects maxResults', async () => {
    const provider: OmniboxProvider = {
      name: 'many',
      getSuggestions: () => Array.from({ length: 10 }, (_, i) => ({
        type: 'suggestion' as const, text: `r${i}`, description: `${i}`, score: 100 - i, source: 'many', action: 'search' as const,
      })),
    };
    omnibox.addProvider(provider);
    const results = await omnibox.onInputChanged('test', 3);
    expect(results).toHaveLength(3);
  });

  it('selectResult emits navigated event', () => {
    const handler = vi.fn();
    omnibox.onEvent(handler);
    omnibox.selectResult({
      type: 'url', text: 'x', description: 'https://x.com', url: 'https://x.com', score: 100, source: 't', action: 'navigate',
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'navigated' }));
  });

  it('selectResult emits searched event', () => {
    const handler = vi.fn();
    omnibox.onEvent(handler);
    omnibox.selectResult({
      type: 'search', text: 'query', description: 'search', score: 100, source: 't', action: 'search',
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'searched' }));
  });

  it('clear removes all state', () => {
    const handler = vi.fn();
    omnibox.addProvider({ name: 't', getSuggestions: () => [] });
    omnibox.onEvent(handler);
    omnibox.clear();
    expect(omnibox.getProviders()).toHaveLength(0);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resultsChanged' }));
  });

  it('dispose disables and cleans up', () => {
    omnibox.addProvider({ name: 't', getSuggestions: () => [] });
    omnibox.dispose();
    expect(omnibox.enabled).toBe(false);
    expect(omnibox.getProviders()).toHaveLength(0);
  });
});

/* ============================================================
   2. Search Suggestions Tests
   ============================================================ */
describe('SearchSuggestionsProvider', () => {
  let provider: SearchSuggestionsProvider;

  beforeEach(() => {
    provider = new SearchSuggestionsProvider();
  });

  it('returns search result for text input', () => {
    const results = provider.getSuggestions('hello');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('search');
    expect(results[0].action).toBe('search');
    expect(results[0].text).toBe('hello');
    expect(results[0].url).toContain('duckduckgo.com');
  });

  it('returns empty for URL-like input', () => {
    expect(provider.getSuggestions('example.com')).toEqual([]);
    expect(provider.getSuggestions('https://x.com')).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(provider.getSuggestions('')).toEqual([]);
  });

  it('generates local suggestions for longer queries', () => {
    const results = provider.getSuggestions('how');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some(r => r.type === 'suggestion')).toBe(true);
  });

  it('setSearchEngine updates engine', () => {
    provider.setSearchEngine({ name: 'Google', url: 'https://google.com/search?q=%s', keyword: 'g', icon: 'G' });
    const results = provider.getSuggestions('test');
    expect(results[0].url).toContain('google.com');
    expect(results[0].description).toContain('Google');
  });

  it('getSearchEngine returns copy', () => {
    const engine = provider.getSearchEngine();
    expect(engine.name).toBe('DuckDuckGo');
  });
});

/* ============================================================
   3. URL Suggestions Tests
   ============================================================ */
describe('UrlSuggestionsProvider', () => {
  let provider: UrlSuggestionsProvider;

  beforeEach(() => {
    provider = new UrlSuggestionsProvider();
  });

  it('returns TLD completions for bare domain', () => {
    const results = provider.getSuggestions('example');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe('url');
    expect(results[0].action).toBe('navigate');
    expect(results[0].url).toMatch(/^https:\/\/www\.example\./);
  });

  it('returns https completion for dotted domain', () => {
    const results = provider.getSuggestions('example.com');
    expect(results.some(r => r.url === 'https://example.com')).toBe(true);
  });

  it('returns result for protocol-prefixed input', () => {
    const results = provider.getSuggestions('https://example.com');
    expect(results.some(r => r.url === 'https://example.com')).toBe(true);
  });

  it('addKnownUrl adds to suggestion pool', () => {
    provider.addKnownUrl('https://test.com/page', 'Test Page');
    const results = provider.getSuggestions('/page');
    expect(results.some(r => r.url === 'https://test.com/page')).toBe(true);
  });

  it('clearKnownUrls removes known URLs', () => {
    provider.addKnownUrl('https://test.com', 'Test');
    provider.clearKnownUrls();
    const results = provider.getSuggestions('test');
    expect(results.every(r => r.url !== 'https://test.com')).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(provider.getSuggestions('')).toEqual([]);
  });
});

describe('isDomainName', () => {
  it('validates domain names', () => {
    expect(isDomainName('example')).toBe(true);
    expect(isDomainName('my-site')).toBe(true);
    expect(isDomainName('a')).toBe(false);
    expect(isDomainName('example.com')).toBe(false);
  });
});

describe('looksLikeUrl', () => {
  it('detects URLs', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('https://x.com')).toBe(true);
    expect(looksLikeUrl('localhost')).toBe(true);
    expect(looksLikeUrl('hello world')).toBe(false);
  });
});

/* ============================================================
   4. Bookmark Suggestions Tests
   ============================================================ */
describe('BookmarkSuggestionsProvider', () => {
  let provider: BookmarkSuggestionsProvider;

  beforeEach(() => {
    provider = new BookmarkSuggestionsProvider();
  });

  it('returns empty when no queryFn set', () => {
    expect(provider.getSuggestions('test')).toEqual([]);
  });

  it('returns bookmark results from queryFn', () => {
    provider.setQueryFn((q) => [
      { id: '1', title: 'Example', url: 'https://example.com', iconUrl: null, folder: false },
      { id: '2', title: 'Other', url: 'https://other.com', iconUrl: null, folder: false },
    ].filter(e => e.title.toLowerCase().includes(q) || (e.url ?? '').toLowerCase().includes(q)));
    const results = provider.getSuggestions('example');
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('bookmark');
    expect(results[0].action).toBe('navigate');
    expect(results[0].url).toBe('https://example.com');
  });

  it('filters out folders', () => {
    provider.setQueryFn(() => [
      { id: '1', title: 'Folder', url: null, iconUrl: null, folder: true },
    ]);
    expect(provider.getSuggestions('folder')).toEqual([]);
  });

  it('handles async queryFn', async () => {
    provider.setQueryFn(async (q) => [
      { id: '1', title: 'Async', url: 'https://async.com', iconUrl: null, folder: false },
    ]);
    const results = await provider.getSuggestions('async');
    expect(results).toHaveLength(1);
  });
});

/* ============================================================
   5. History Suggestions Tests
   ============================================================ */
describe('HistorySuggestionsProvider', () => {
  let provider: HistorySuggestionsProvider;

  beforeEach(() => {
    provider = new HistorySuggestionsProvider();
  });

  it('returns empty when no queryFn set', () => {
    expect(provider.getSuggestions('test')).toEqual([]);
  });

  it('returns history results from queryFn', () => {
    provider.setQueryFn((q, max) => [
      { id: '1', url: 'https://example.com', title: 'Example', visitCount: 5, typedCount: 2, lastVisitTime: Date.now() },
      { id: '2', url: 'https://other.com', title: 'Other', visitCount: 1, typedCount: 0, lastVisitTime: Date.now() - 86400000 },
    ].filter(e => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)));
    const results = provider.getSuggestions('example');
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('history');
    expect(results[0].action).toBe('navigate');
    expect(results[0].url).toBe('https://example.com');
  });

  it('sorts by frecency', () => {
    provider.setQueryFn((q, max) => [
      { id: '1', url: 'https://a.com', title: 'A Page', visitCount: 1, typedCount: 0, lastVisitTime: Date.now() - 86400000 * 20 },
      { id: '2', url: 'https://b.com', title: 'B Page', visitCount: 100, typedCount: 50, lastVisitTime: Date.now() },
    ].filter(e => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)));
    const results = provider.getSuggestions('b');
    expect(results).toHaveLength(1);
  });

  it('handles async queryFn', async () => {
    provider.setQueryFn(async (q) => [
      { id: '1', url: 'https://async.com', title: 'Async', visitCount: 3, typedCount: 1, lastVisitTime: Date.now() },
    ]);
    const results = await provider.getSuggestions('async');
    expect(results).toHaveLength(1);
  });
});

describe('computeFrecency', () => {
  it('returns higher score for more visited/typed entries', () => {
    const a = computeFrecency({ id: '1', url: 'https://a.com', title: 'A', visitCount: 100, typedCount: 50, lastVisitTime: Date.now() });
    const b = computeFrecency({ id: '2', url: 'https://b.com', title: 'B', visitCount: 1, typedCount: 0, lastVisitTime: Date.now() - 86400000 * 30 });
    expect(a).toBeGreaterThan(b);
  });
});

/* ============================================================
   6. Search Engine Integration Tests
   ============================================================ */
describe('SearchEngineManager', () => {
  let manager: SearchEngineManager;

  beforeEach(() => {
    manager = new SearchEngineManager();
  });

  it('initializes with built-in engines', () => {
    const engines = manager.getEngines();
    expect(engines.length).toBeGreaterThanOrEqual(8);
    expect(engines[0].isDefault).toBe(true);
  });

  it('getDefaultEngine returns default', () => {
    const def = manager.getDefaultEngine();
    expect(def.name).toBeTruthy();
    expect(def.isDefault).toBe(true);
  });

  it('setDefaultEngine changes default', () => {
    const engines = manager.getEngines();
    const target = engines[1];
    expect(manager.setDefaultEngine(target.id)).toBe(true);
    expect(manager.getDefaultEngine().id).toBe(target.id);
    expect(manager.setDefaultEngine('nonexistent')).toBe(false);
  });

  it('addEngine adds a custom engine', () => {
    const engine = manager.addEngine({ name: 'Custom', url: 'https://custom.com?q=%s', keyword: 'c', icon: 'C' });
    expect(engine.id).toMatch(/^engine-/);
    expect(engine.isDefault).toBe(false);
    expect(manager.getEngines()).toHaveLength(BUILT_IN_ENGINES.length + 1);
  });

  it('removeEngine removes by id', () => {
    const engine = manager.addEngine({ name: 'Temp', url: 'https://temp.com?q=%s', keyword: 't', icon: 'T' });
    expect(manager.removeEngine(engine.id)).toBe(true);
    expect(manager.getEngines()).toHaveLength(BUILT_IN_ENGINES.length);
    expect(manager.removeEngine('nonexistent')).toBe(false);
  });

  it('getEngineByKeyword finds by keyword', () => {
    const engine = manager.getEngineByKeyword('g');
    expect(engine).not.toBeNull();
    expect(engine!.name).toBe('Google');
    expect(manager.getEngineByKeyword('nonexistent')).toBeNull();
  });

  it('buildSearchUrl replaces %s', () => {
    const url = manager.buildSearchUrl('hello world');
    expect(url).toContain(encodeURIComponent('hello world'));
  });

  it('buildSearchUrl with specific engine', () => {
    const engine = manager.addEngine({ name: 'Custom', url: 'https://custom.com/?query=%s', keyword: 'c', icon: 'C' });
    const url = manager.buildSearchUrl('test', engine.id);
    expect(url).toBe('https://custom.com/?query=test');
  });

  it('parseKeyword detects keyword prefix', () => {
    const result = manager.parseKeyword('!g hello world');
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe('g');
    expect(result!.query).toBe('hello world');
  });

  it('parseKeyword returns null without keyword', () => {
    expect(manager.parseKeyword('hello')).toBeNull();
    expect(manager.parseKeyword('!')).toBeNull();
    expect(manager.parseKeyword('! nonexistent')).toBeNull();
  });

  it('onEvent fires on add', () => {
    const handler = vi.fn();
    manager.onEvent(handler);
    manager.addEngine({ name: 'New', url: 'https://new.com?q=%s', keyword: 'n', icon: 'N' });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'added' }));
  });

  it('onEvent fires on remove', () => {
    const engine = manager.addEngine({ name: 'Temp', url: 'https://temp.com?q=%s', keyword: 't', icon: 'T' });
    const handler = vi.fn();
    manager.onEvent(handler);
    manager.removeEngine(engine.id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'removed' }));
  });

  it('dispose clears engines', () => {
    manager.dispose();
    expect(manager.getEngines()).toEqual([]);
  });
});

describe('EngineSwitchProvider', () => {
  let manager: SearchEngineManager;
  let provider: EngineSwitchProvider;

  beforeEach(() => {
    manager = new SearchEngineManager();
    provider = new EngineSwitchProvider(manager);
  });

  it('returns engine suggestions for bang syntax', () => {
    const results = provider.getSuggestions('!g');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].type).toBe('engine');
  });

  it('returns empty for non-bang input', () => {
    expect(provider.getSuggestions('hello')).toEqual([]);
  });

  it('filters engines by keyword', () => {
    const results = provider.getSuggestions('!g test');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.description.includes('Google'))).toBe(true);
  });
});

/* ============================================================
   Integration: Omnibox + All Providers
   ============================================================ */
describe('Omnibox Integration', () => {
  it('works with all providers', async () => {
    const omnibox = new Omnibox();
    const search = new SearchSuggestionsProvider();
    const urls = new UrlSuggestionsProvider();
    const bm = new BookmarkSuggestionsProvider();
    const hist = new HistorySuggestionsProvider();
    const engineMgr = new SearchEngineManager();
    const engineSw = new EngineSwitchProvider(engineMgr);

    bm.setQueryFn((q) => [{ id: 'b1', title: 'Test Page', url: 'https://test.com', iconUrl: null, folder: false }].filter(e => e.title.toLowerCase().includes(q) || (e.url ?? '').toLowerCase().includes(q)));
    hist.setQueryFn((q) => [{ id: 'h1', url: 'https://example.com', title: 'Example', visitCount: 5, typedCount: 2, lastVisitTime: Date.now() }].filter(e => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)));

    omnibox.addProvider(search);
    omnibox.addProvider(urls);
    omnibox.addProvider(bm);
    omnibox.addProvider(hist);
    omnibox.addProvider(engineSw);

    const results = await omnibox.onInputChanged('test', 10);
    expect(results.length).toBeGreaterThan(0);
    const types = new Set(results.map(r => r.type));
    expect(types.has('search')).toBe(true);
  });
});
