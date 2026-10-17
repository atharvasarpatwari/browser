import { describe, it, expect, vi } from 'vitest';
import { Omnibox, canonicalUrl } from '../src/browser/omnibox/omnibox';
import type { OmniboxProvider, OmniboxResult, OmniboxEvent } from '../src/browser/omnibox/omnibox';

const result = (over: Partial<OmniboxResult> & Pick<OmniboxResult, 'text' | 'score'>): OmniboxResult => ({
  type: 'suggestion', description: '', source: 'test', action: 'search', ...over,
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function collect(omnibox: Omnibox): OmniboxEvent[] {
  const events: OmniboxEvent[] = [];
  omnibox.onEvent((e) => events.push(e));
  return events;
}

describe('Omnibox — progressive results', () => {
  it('publishes fast providers immediately and merges slow ones when they arrive', async () => {
    const omnibox = new Omnibox();
    const events = collect(omnibox);
    const gate = deferred<OmniboxResult[]>();
    omnibox.addProvider({ name: 'fast', getSuggestions: () => [result({ text: 'local', score: 50 })] });
    omnibox.addProvider({ name: 'slow', slow: true, getSuggestions: () => gate.promise });

    const pending = omnibox.onInputChanged('x');
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]!.results!.map((r) => r.text)).toEqual(['local']);

    gate.resolve([result({ text: 'remote', score: 70 })]);
    const final = await pending;
    expect(events).toHaveLength(2);
    expect(events[1]!.results!.map((r) => r.text)).toEqual(['remote', 'local']);
    expect(final.map((r) => r.text)).toEqual(['remote', 'local']);
  });

  it('still emits exactly once when every provider is fast (existing behaviour)', async () => {
    const omnibox = new Omnibox();
    const events = collect(omnibox);
    omnibox.addProvider({ name: 'a', getSuggestions: () => [result({ text: 'a', score: 1 })] });
    omnibox.addProvider({ name: 'b', getSuggestions: async () => [result({ text: 'b', score: 2 })] });
    await omnibox.onInputChanged('x');
    expect(events).toHaveLength(1);
  });

  it('does not re-publish when a slow provider finished before the fast phase did', async () => {
    const omnibox = new Omnibox();
    const events = collect(omnibox);
    omnibox.addProvider({ name: 'fast', getSuggestions: async () => { await tick(); return [result({ text: 'a', score: 1 })]; } });
    omnibox.addProvider({ name: 'slow', slow: true, getSuggestions: () => [result({ text: 'b', score: 2 })] });
    const final = await omnibox.onInputChanged('x');
    expect(events).toHaveLength(1);
    expect(final.map((r) => r.text)).toEqual(['b', 'a']);
  });

  it('survives providers that throw synchronously or reject', async () => {
    const omnibox = new Omnibox();
    omnibox.addProvider({ name: 'boom', getSuggestions: () => { throw new Error('sync'); } });
    omnibox.addProvider({ name: 'reject', slow: true, getSuggestions: () => Promise.reject(new Error('async')) });
    omnibox.addProvider({ name: 'ok', getSuggestions: () => [result({ text: 'fine', score: 1 })] });
    expect((await omnibox.onInputChanged('x')).map((r) => r.text)).toEqual(['fine']);
  });
});

describe('Omnibox — stale-response guard', () => {
  it('never publishes results for an input that has been superseded', async () => {
    const omnibox = new Omnibox();
    const events = collect(omnibox);
    const gates = new Map<string, ReturnType<typeof deferred<OmniboxResult[]>>>();
    omnibox.addProvider({
      name: 'slow', slow: true,
      getSuggestions: (input) => { const g = deferred<OmniboxResult[]>(); gates.set(input, g); return g.promise; },
    });

    const first = omnibox.onInputChanged('re');
    await tick();
    const second = omnibox.onInputChanged('rea');
    await tick();
    const before = events.length;

    gates.get('re')!.resolve([result({ text: 'stale', score: 99 })]);
    await first;
    expect(events).toHaveLength(before); // nothing published for 're'

    gates.get('rea')!.resolve([result({ text: 'fresh', score: 1 })]);
    await second;
    const last = events[events.length - 1]!;
    expect(last.input).toBe('rea');
    expect(last.results!.map((r) => r.text)).toEqual(['fresh']);
    expect(events.some((e) => e.results?.some((r) => r.text === 'stale'))).toBe(false);
  });

  it('cancels in-flight slow results when the input is cleared or the omnibox disabled', async () => {
    const omnibox = new Omnibox();
    const events = collect(omnibox);
    const gate = deferred<OmniboxResult[]>();
    omnibox.addProvider({ name: 'slow', slow: true, getSuggestions: () => gate.promise });

    const pending = omnibox.onInputChanged('abc');
    await tick();
    await omnibox.onInputChanged(''); // user cleared the box
    const afterClear = events.length;
    gate.resolve([result({ text: 'late', score: 5 })]);
    await pending;
    expect(events).toHaveLength(afterClear);
    expect(events[events.length - 1]!.results).toEqual([]);
  });

  it('disabling the omnibox cancels in-flight slow results', async () => {
    const omnibox = new Omnibox();
    const events = collect(omnibox);
    const gate = deferred<OmniboxResult[]>();
    omnibox.addProvider({ name: 'slow', slow: true, getSuggestions: () => gate.promise });
    const pending = omnibox.onInputChanged('abc');
    await tick();
    const before = events.length; // the fast phase already published (empty)
    omnibox.enabled = false;
    gate.resolve([result({ text: 'late', score: 5 })]);
    await pending;
    expect(events).toHaveLength(before);
  });

  it('dispose() leaves no handlers to notify', async () => {
    const omnibox = new Omnibox();
    const handler = vi.fn();
    omnibox.onEvent(handler);
    omnibox.dispose();
    await omnibox.onInputChanged('abc');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Omnibox — de-duplication', () => {
  const history = result({ type: 'history', text: 'Example', url: 'https://www.example.com/', score: 60, action: 'navigate' });
  const bookmark = result({ type: 'bookmark', text: 'Example', url: 'http://example.com', score: 80, action: 'navigate' });
  const provider = (...r: OmniboxResult[]): OmniboxProvider => ({ name: `p${r.length}-${r[0]!.type}`, getSuggestions: () => r });

  it('keeps the same page under different types by default (existing behaviour)', async () => {
    const omnibox = new Omnibox();
    omnibox.addProvider(provider(history));
    omnibox.addProvider(provider(bookmark));
    expect(await omnibox.onInputChanged('x')).toHaveLength(2);
  });

  it('collapses the same page across types, keeping the best-scoring row, when canonicalDedupe is on', async () => {
    const omnibox = new Omnibox({ canonicalDedupe: true });
    omnibox.addProvider(provider(history));
    omnibox.addProvider(provider(bookmark));
    const out = await omnibox.onInputChanged('x');
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('bookmark');
  });

  it('only collapses navigable rows — searches that share a URL are untouched', async () => {
    const omnibox = new Omnibox({ canonicalDedupe: true });
    const s1 = result({ text: 'one', url: 'https://s.test/?q=a', score: 5 });
    const s2 = result({ text: 'two', url: 'https://s.test/?q=a', score: 4, type: 'search' });
    omnibox.addProvider(provider(s1));
    omnibox.addProvider(provider(s2));
    expect(await omnibox.onInputChanged('x')).toHaveLength(2);
  });

  it('uses id to keep distinct rows that share a URL (two tabs, same page)', async () => {
    const omnibox = new Omnibox();
    const t = (id: string) => result({ type: 'tab', id, text: 'T', url: 'https://a.test/', score: 10, action: 'switch-tab' });
    omnibox.addProvider({ name: 'tabs', getSuggestions: () => [t('1'), t('2')] });
    expect(await omnibox.onInputChanged('x')).toHaveLength(2);
  });

  it('canonicalUrl ignores scheme, www, trailing slash and case but not path or query', () => {
    expect(canonicalUrl('https://WWW.Example.com/')).toBe(canonicalUrl('http://example.com'));
    expect(canonicalUrl('https://example.com/a/')).toBe('example.com/a');
    expect(canonicalUrl('https://example.com/a?x=1')).not.toBe(canonicalUrl('https://example.com/a'));
    expect(canonicalUrl('https://example.com:8080/')).toBe('example.com:8080');
    expect(canonicalUrl('not a url')).toBe('not a url');
  });

  it('applies maxResults after de-duplication', async () => {
    const omnibox = new Omnibox({ canonicalDedupe: true });
    omnibox.addProvider({
      name: 'many',
      getSuggestions: () => [
        result({ type: 'url', text: 'a', url: 'https://a.test/', score: 9, action: 'navigate' }),
        result({ type: 'bookmark', text: 'a', url: 'https://a.test', score: 8, action: 'navigate' }),
        result({ type: 'url', text: 'b', url: 'https://b.test/', score: 7, action: 'navigate' }),
      ],
    });
    expect((await omnibox.onInputChanged('x', 2)).map((r) => r.text)).toEqual(['a', 'b']);
  });
});

describe('Omnibox — routing', () => {
  const make = (omnibox: Omnibox, seen: string[]) => {
    for (const name of ['a', 'b', 'c']) {
      omnibox.addProvider({
        name,
        getSuggestions: (q) => { seen.push(`${name}:${q}`); return [result({ text: name, score: 1 })]; },
      });
    }
  };

  it('runs only the named providers and hands them the rewritten query', async () => {
    const omnibox = new Omnibox();
    const seen: string[] = [];
    make(omnibox, seen);
    const out = await omnibox.onInputChanged('@tabs foo', 8, { providers: ['a', 'c'], query: '  foo ' });
    expect(seen.sort()).toEqual(['a:foo', 'c:foo']);
    expect(out.map((r) => r.text).sort()).toEqual(['a', 'c']);
  });

  it('lets a scope pass an empty query (listing mode)', async () => {
    const omnibox = new Omnibox();
    const seen: string[] = [];
    make(omnibox, seen);
    await omnibox.onInputChanged('@tabs', 8, { providers: ['b'], query: '' });
    expect(seen).toEqual(['b:']);
  });

  it('without a route every provider sees the trimmed input', async () => {
    const omnibox = new Omnibox();
    const seen: string[] = [];
    make(omnibox, seen);
    await omnibox.onInputChanged('  hello  ');
    expect(seen.sort()).toEqual(['a:hello', 'b:hello', 'c:hello']);
  });

  it('keeps the raw input on emitted events', async () => {
    const omnibox = new Omnibox();
    const events = collect(omnibox);
    make(omnibox, []);
    await omnibox.onInputChanged('@tabs foo', 8, { providers: ['a'], query: 'foo' });
    expect(events[0]!.input).toBe('@tabs foo');
  });

  it('runs nothing for an empty provider list and ignores unknown names', async () => {
    const omnibox = new Omnibox();
    const seen: string[] = [];
    make(omnibox, seen);
    expect(await omnibox.onInputChanged('x', 8, { providers: [] })).toEqual([]);
    expect(await omnibox.onInputChanged('x', 8, { providers: ['nope', 'a'] })).toHaveLength(1);
    expect(seen).toEqual(['a:x']);
  });
});

describe('Omnibox — selecting results', () => {
  const select = (r: OmniboxResult) => {
    const omnibox = new Omnibox();
    const events = collect(omnibox);
    omnibox.selectResult(r);
    return events;
  };

  it('keeps the navigate/search/fill events', () => {
    expect(select(result({ text: 't', score: 1, url: 'https://x', action: 'navigate' }))[0]).toMatchObject({ kind: 'navigated', input: 'https://x' });
    expect(select(result({ text: 'q', score: 1, action: 'search' }))[0]).toMatchObject({ kind: 'searched', input: 'q' });
    expect(select(result({ text: 'f', score: 1, action: 'fill' }))[0]).toMatchObject({ kind: 'navigated', input: 'f' });
  });

  it.each(['copy', 'switch-tab', 'run-action', 'research'] as const)('emits "activated" for %s', (action) => {
    const r = result({ text: 'x', score: 1, action, id: 'id-1' });
    const [e] = select(r);
    expect(e).toMatchObject({ kind: 'activated', input: 'x' });
    expect(e!.results).toEqual([r]);
  });
});
