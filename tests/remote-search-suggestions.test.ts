import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  RemoteSearchSuggestionsProvider, LruCache, parseSuggestions, cleanSuggestions, isSensitiveQuery,
  getSuggestEndpoint, SUGGEST_ENDPOINTS,
} from '../src/browser/omnibox/remote-search-suggestions';
import type { RemoteSuggestionsDeps } from '../src/browser/omnibox/remote-search-suggestions';

describe('parseSuggestions', () => {
  it('reads OpenSearch suggestion arrays', () => {
    expect(parseSuggestions(['rea', ['react', 'reality'], [], []])).toEqual(['react', 'reality']);
    expect(parseSuggestions(['rea', ['react', 7, null, 'redux']])).toEqual(['react', 'redux']);
  });

  it('reads DuckDuckGo phrase objects', () => {
    expect(parseSuggestions([{ phrase: 'react' }, { phrase: 'redux' }, { nope: 1 }, null])).toEqual(['react', 'redux']);
  });

  it.each([null, undefined, 'react', 42, {}, [], [1, 2], ['q'], ['q', 'not-an-array']])('returns [] for %j', (v) => {
    expect(parseSuggestions(v)).toEqual([]);
  });
});

describe('cleanSuggestions', () => {
  it('trims, de-duplicates, and drops the query itself and over-long entries', () => {
    expect(cleanSuggestions(['  react  hooks ', 'React Hooks', 'REACT', 'redux', '', 'x'.repeat(121)], 'react'))
      .toEqual(['react hooks', 'redux']);
  });
});

describe('isSensitiveQuery', () => {
  it.each([
    '4111 1111 1111 1111',
    'my card 4111-1111-1111-1111 expired',
    '123-45-6789',
    'contact me at jane.doe@example.com',
    'eyJhbGciOiJIUzI1NiJ9.payload.sig',
    'password: hunter2',
    'api_key=abc123',
    'ghp_1234567890abcdefghijklmnop12',
    'x'.repeat(101),
  ])('flags %j', (q) => {
    expect(isSensitiveQuery(q)).toBe(true);
  });

  it.each([
    'how to bake bread',
    'iphone 15 pro max review',
    '1234 5678 9012 3456', // 16 digits but fails Luhn
    'pneumonoultramicroscopicsilicovolcanoconiosis', // long but no digits
    'reset password for gmail',
  ])('allows %j', (q) => {
    expect(isSensitiveQuery(q)).toBe(false);
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry beyond capacity', () => {
    const c = new LruCache<number>(2, 1000);
    c.set('a', 1); c.set('b', 2);
    expect(c.get('a')).toBe(1); // refreshes a
    c.set('c', 3); // evicts b
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });

  it('expires entries after the TTL', () => {
    let t = 0;
    const c = new LruCache<number>(5, 1000, () => t);
    c.set('a', 1);
    t = 1000;
    expect(c.get('a')).toBe(1);
    t = 1001;
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('overwrites without growing', () => {
    const c = new LruCache<number>(2, 1000);
    c.set('a', 1); c.set('a', 2);
    expect(c.get('a')).toBe(2);
    expect(c.size).toBe(1);
  });
});

describe('suggestion endpoints', () => {
  it('knows the built-in providers and nothing else', () => {
    expect(getSuggestEndpoint('duckduckgo')).toContain('{searchTerms}');
    for (const slug of Object.keys(SUGGEST_ENDPOINTS)) expect(SUGGEST_ENDPOINTS[slug]).toMatch(/^https:\/\//);
    expect(getSuggestEndpoint('nope')).toBeNull();
    expect(getSuggestEndpoint('constructor')).toBeNull();
    expect(getSuggestEndpoint('__proto__')).toBeNull();
  });
});

describe('RemoteSearchSuggestionsProvider', () => {
  let fetchJson: Mock<(url: string, signal: AbortSignal) => Promise<unknown>>;
  let deps: RemoteSuggestionsDeps;
  let enabled: boolean;
  let incognito: boolean;
  let endpoint: string | null;

  const make = (extra: Partial<RemoteSuggestionsDeps> = {}) => new RemoteSearchSuggestionsProvider({ ...deps, ...extra });
  const settle = async <T>(p: Promise<T>): Promise<T> => { await vi.advanceTimersByTimeAsync(120); return p; };

  beforeEach(() => {
    vi.useFakeTimers();
    enabled = true;
    incognito = false;
    endpoint = 'https://suggest.test/?q={searchTerms}';
    fetchJson = vi.fn<(url: string, signal: AbortSignal) => Promise<unknown>>(
      async () => ['react', ['react hooks', 'react router', 'React']],
    );
    deps = {
      getEndpoint: () => endpoint,
      buildSearchUrl: (q) => `https://search.test/?q=${encodeURIComponent(q)}`,
      engineName: () => 'TestEngine',
      isEnabled: () => enabled,
      isIncognito: () => incognito,
      fetchJson: (url, signal) => fetchJson(url, signal),
      classifyOptions: { isBang: (kw) => kw === 'g' },
    };
  });

  afterEach(() => { vi.useRealTimers(); });

  it('returns mapped, ranked search suggestions', async () => {
    const results = await settle(make().getSuggestions('react'));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0]![0]).toBe('https://suggest.test/?q=react');
    expect(results).toEqual([
      {
        type: 'suggestion', text: 'react hooks', description: 'Search TestEngine for "react hooks"',
        url: 'https://search.test/?q=react%20hooks', icon: '🔍', score: 70, source: 'remote-suggestions', action: 'search',
      },
      expect.objectContaining({ text: 'react router', score: 65 }),
    ]);
  });

  it('is marked slow so the omnibox never waits on it for local rows', () => {
    expect(make().slow).toBe(true);
  });

  it('percent-encodes the query into the endpoint', async () => {
    await settle(make().getSuggestions('a b&c'));
    expect(fetchJson.mock.calls[0]![0]).toBe('https://suggest.test/?q=a%20b%26c');
  });

  it('debounces: only the last of several rapid calls hits the network', async () => {
    const p = make();
    const first = p.getSuggestions('re');
    await vi.advanceTimersByTimeAsync(50);
    const second = p.getSuggestions('rea');
    await vi.advanceTimersByTimeAsync(50);
    const third = p.getSuggestions('reac');
    await vi.advanceTimersByTimeAsync(120);
    expect(await first).toEqual([]);
    expect(await second).toEqual([]);
    expect((await third).length).toBeGreaterThan(0);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0]![0]).toBe('https://suggest.test/?q=reac');
  });

  it('honours a custom debounce interval', async () => {
    const p = make({ debounceMs: 300 });
    const r = p.getSuggestions('react');
    await vi.advanceTimersByTimeAsync(299);
    expect(fetchJson).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await r).length).toBeGreaterThan(0);
  });

  it('serves repeat queries from the cache without waiting or fetching', async () => {
    const p = make();
    await settle(p.getSuggestions('react'));
    const again = await p.getSuggestions('React '); // case/space-insensitive key, no timer advance
    expect(again.length).toBeGreaterThan(0);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('expires cached entries after the TTL', async () => {
    let t = 0;
    const p = make({ now: () => t, cacheTtlMs: 1000 });
    await settle(p.getSuggestions('react'));
    t = 5000;
    await settle(p.getSuggestions('react'));
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it('aborts the in-flight request when a newer query arrives', async () => {
    const signals: AbortSignal[] = [];
    fetchJson.mockImplementation((_url: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        setTimeout(() => resolve(['q', ['slow answer']]), 1000);
      });
    });
    const p = make();
    const first = p.getSuggestions('react');
    await vi.advanceTimersByTimeAsync(120); // first request is now in flight
    const second = p.getSuggestions('reactor');
    expect(signals[0]!.aborted).toBe(true);
    expect(await first).toEqual([]);
    await vi.advanceTimersByTimeAsync(120 + 1000);
    expect((await second).map((r) => r.text)).toEqual(['slow answer']);
  });

  it('drops a late response whose request was superseded, even if the transport ignores abort', async () => {
    let release: (v: unknown) => void = () => {};
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const p = make();
    const first = p.getSuggestions('react');
    await vi.advanceTimersByTimeAsync(120);
    p.getSuggestions('reactor'); // supersedes
    release(['react', ['stale suggestion']]);
    expect(await first).toEqual([]);
  });

  it('degrades to no suggestions on network errors and garbage responses', async () => {
    fetchJson.mockRejectedValueOnce(new Error('offline'));
    expect(await settle(make().getSuggestions('react'))).toEqual([]);
    fetchJson.mockResolvedValueOnce({ not: 'an array' });
    expect(await settle(make().getSuggestions('redux'))).toEqual([]);
  });

  describe('zero-leakage guards (the network is never touched)', () => {
    const expectSilent = async (query: string, p = make()) => {
      expect(await settle(p.getSuggestions(query))).toEqual([]);
      expect(fetchJson).not.toHaveBeenCalled();
    };

    it('does nothing in incognito', async () => { incognito = true; await expectSilent('react'); });
    it('does nothing when suggestions are disabled', async () => { enabled = false; await expectSilent('react'); });
    it('does nothing without an endpoint', async () => { endpoint = null; await expectSilent('react'); });
    it('does nothing below the minimum length', async () => { await expectSilent('r'); });
    it('does nothing for sensitive-looking text', async () => {
      await expectSilent('password: hunter2');
      await expectSilent('4111 1111 1111 1111');
    });
    it.each(['github.com/pulls', 'https://example.com', '2+2', '72 f to c', '@tabs settings', '!g foo', 'localhost:3000'])(
      'does nothing for non-search intent %j',
      async (q) => { await expectSilent(q); },
    );

    it('reads the incognito flag on every call, not just at construction', async () => {
      const p = make();
      await settle(p.getSuggestions('react'));
      expect(fetchJson).toHaveBeenCalledTimes(1);
      incognito = true;
      expect(await p.getSuggestions('reactor')).toEqual([]); // sync return, no timer needed
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchJson).toHaveBeenCalledTimes(1);
    });
  });

  it('dispose cancels pending work and clears the cache', async () => {
    const p = make();
    const pending = p.getSuggestions('react');
    p.dispose();
    expect(await pending).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('caps results at maxSuggestions', async () => {
    fetchJson.mockResolvedValueOnce(['q', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']]);
    const results = await settle(make({ maxSuggestions: 3 }).getSuggestions('query'));
    expect(results.map((r) => r.text)).toEqual(['a1', 'a2', 'a3']);
  });
});
