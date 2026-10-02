import { describe, it, expect } from 'vitest';
import { BangRegistry, BUILT_IN_BANGS } from '../src/browser/omnibox/bangs';

describe('built-in bang catalog', () => {
  it('has around fifty well-formed, unique entries', () => {
    expect(BUILT_IN_BANGS.length).toBeGreaterThanOrEqual(50);
    const keywords = BUILT_IN_BANGS.map((b) => b.keyword);
    expect(new Set(keywords).size).toBe(keywords.length);
    for (const bang of BUILT_IN_BANGS) {
      expect(bang.keyword).toMatch(/^[a-z0-9]{1,12}$/);
      expect(bang.name.length).toBeGreaterThan(0);
      expect(bang.url).toMatch(/^https:\/\//);
      expect(bang.url).toContain('{searchTerms}');
    }
  });

  it('covers the flagship engines and the shortcuts named in the plan', () => {
    const keywords = new Set(BUILT_IN_BANGS.map((b) => b.keyword));
    for (const k of ['g', 'ddg', 'b', 'br', 'eco', 'k', 'sp', 'w', 'gh', 'yt', 'so', 'r']) expect(keywords.has(k)).toBe(true);
  });

  it('expands every template into a parseable URL on its own host', () => {
    const registry = new BangRegistry();
    for (const bang of BUILT_IN_BANGS) {
      const url = new URL(registry.resolve(bang.keyword, 'a b&c')!);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe(new URL(bang.url.replace('{searchTerms}', 'x')).hostname);
      expect(url.href).not.toContain('{searchTerms}');
    }
  });
});

describe('BangRegistry', () => {
  it('resolves bangs, case-insensitively, with the query percent-encoded', () => {
    const r = new BangRegistry();
    expect(r.resolve('g', 'hello world')).toBe('https://www.google.com/search?q=hello%20world');
    expect(r.resolve('YT', 'cats & dogs')).toBe('https://www.youtube.com/results?search_query=cats%20%26%20dogs');
    expect(r.resolve('nope', 'x')).toBeNull();
    expect(r.has('GH')).toBe(true);
    expect(r.has('nope')).toBe(false);
    expect(r.get('w')!.name).toBe('Wikipedia');
  });

  it('lets caller-supplied bangs add to and override the built-ins', () => {
    const r = new BangRegistry([
      { keyword: 'G', name: 'My Google', url: 'https://search.example.com/?q={searchTerms}' },
      { keyword: 'mine', name: 'Mine', url: 'https://mine.example.com/s?q=%s' },
    ]);
    expect(r.resolve('g', 'x')).toBe('https://search.example.com/?q=x');
    expect(r.resolve('mine', 'a b')).toBe('https://mine.example.com/s?q=a%20b');
    expect(r.get('g')!.name).toBe('My Google');
    expect(r.list().length).toBe(BUILT_IN_BANGS.length + 1);
  });

  it('rejects unusable bangs', () => {
    const r = new BangRegistry();
    const before = r.list().length;
    expect(r.add({ keyword: '', name: 'x', url: 'https://x.test/?q=%s' })).toBe(false);
    expect(r.add({ keyword: 'has space', name: 'x', url: 'https://x.test/?q=%s' })).toBe(false);
    expect(r.add({ keyword: 'waytoolongkeyword', name: 'x', url: 'https://x.test/?q=%s' })).toBe(false);
    expect(r.add({ keyword: 'js', name: 'x', url: 'javascript:alert(1)' })).toBe(false);
    expect(r.add({ keyword: 'dt', name: 'x', url: 'data:text/html,hi' })).toBe(false);
    expect(r.add({ keyword: 'ok', name: 'x', url: 'https://x.test/?q=%s' })).toBe(true);
    expect(r.list().length).toBe(before + 1);
  });

  it('completes partially typed bangs, best matches first', () => {
    const r = new BangRegistry();
    const g = r.complete('g').map((b) => b.keyword);
    expect(g[0]).toBe('g');
    expect(g).toHaveLength(5);
    expect(g.every((k) => k.startsWith('g'))).toBe(true);
    expect(r.complete('wiki').map((b) => b.keyword)).toEqual(['w']);
    expect(r.complete('stack').map((b) => b.keyword)).toEqual(['so']);
    expect(r.complete('zzzz')).toEqual([]);
    expect(r.complete('g', 2)).toHaveLength(2);
  });
});
