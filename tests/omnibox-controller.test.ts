import { describe, it, expect, vi } from 'vitest';
import { OmniboxController, pickDefault, arrangeResults } from '../src/ui/components/omnibox-controller';
import { tierScore, tiered } from '../src/browser/omnibox/score-tiers';
import type { OmniboxControllerDeps } from '../src/ui/components/omnibox-controller';
import type { ActivationOptions, QueryBadge, RowActionHandler } from '../src/ui/components/address-bar/address-bar.view';
import { Omnibox } from '../src/browser/omnibox/omnibox';
import type { OmniboxProvider, OmniboxResult } from '../src/browser/omnibox/omnibox';
import { BangRegistry, BangSuggestionsProvider } from '../src/browser/omnibox/bangs';
import { ScopeHintsProvider } from '../src/browser/omnibox/scope-hints';

const row = (over: Partial<OmniboxResult> & Pick<OmniboxResult, 'type' | 'text'>): OmniboxResult => ({
  description: '', score: 50, source: 'test', action: 'navigate', ...over,
});

const history = (title: string, url: string, score: number) => row({ type: 'history', text: title, url, score, source: 'history-suggestions' });
const bookmark = (title: string, url: string, score = 105) => row({ type: 'bookmark', text: title, url, score, source: 'bookmark-suggestions' });
const tab = (title: string, url: string, id = 't1') => row({ type: 'tab', id, text: title, url, score: 85, action: 'switch-tab', source: 'tab-switch' });
const searchRow = (q: string) => row({ type: 'search', text: q, url: `nova://search?q=${q}`, score: 90, action: 'search', source: 'search-suggestions' });
const answerRow = row({ type: 'answer', text: '4', description: '2+2 = 4', score: 100, action: 'copy', source: 'instant-answers' });
const no: ActivationOptions = { newTab: false };

describe('pickDefault', () => {
  const g = (r: OmniboxResult[], text: string, intent: Parameters<typeof pickDefault>[2] = 'GENERAL_SEARCH') => pickDefault(r, text, intent);

  it('takes a tab, bookmark or frecent page whose title or host starts with what was typed', () => {
    expect(g([history('GitHub', 'https://github.com/', 400)], 'git')!.text).toBe('GitHub');
    expect(g([bookmark('Rust Book', 'https://doc.rust-lang.org/book/')], 'rust b')!.text).toBe('Rust Book');
    expect(g([history('Home', 'https://www.youtube.com/', 300)], 'youtu')!.text).toBe('Home'); // host match, www ignored
  });

  it('prefers a tab over a bookmark over history, then the higher score', () => {
    const rows = [history('GitHub', 'https://github.com/', 900), bookmark('GitHub bm', 'https://github.com/x'), tab('GitHub tab', 'https://github.com/t')];
    expect(g(rows, 'git')!.type).toBe('tab');
    expect(g(rows.slice(0, 2), 'git')!.type).toBe('bookmark');
    expect(g([history('a', 'https://git.a/', 200), history('b', 'https://git.b/', 300)], 'git')!.text).toBe('b');
  });

  it('ignores weakly frecent history, short input, non-matching rows and non-general intents', () => {
    expect(g([history('GitHub', 'https://github.com/', 99)], 'git')).toBeNull();
    expect(g([history('GitHub', 'https://github.com/', 500)], 'g')).toBeNull();
    expect(g([history('GitHub', 'https://github.com/', 500)], 'hub')).toBeNull();
    expect(g([history('GitHub', 'https://github.com/', 500)], 'git', 'DIRECT_URL')).toBeNull();
    expect(g([history('GitHub', 'https://github.com/', 500)], 'git', 'CALCULATION_OR_CONVERSION')).toBeNull();
    expect(g([row({ type: 'url', text: 'git.com', url: 'https://git.com/', score: 90 })], 'git')).toBeNull(); // guessed TLDs never hijack Enter
    expect(g([row({ type: 'bookmark', text: 'git', score: 100 })], 'git')).toBeNull(); // no url
  });
});

/** What the subsystem does to the original providers' rows before they reach the controller. */
const legacy = (r: OmniboxResult): OmniboxResult => ({ ...r, score: tierScore(r), meta: { rawScore: r.score } });

describe('arrangeResults', () => {
  it('puts the instant answer first, then the Enter row, then everything else by score', () => {
    const rows = [
      legacy(history('Other', 'https://other.test/', 200)),
      searchRow('git'),
      legacy(history('GitHub', 'https://github.com/', 400)),
      answerRow,
      row({ type: 'suggestion', text: 'git status', score: 70, action: 'search', source: 'remote-suggestions' }),
      legacy(bookmark('Docs', 'https://docs.test/', 110)),
    ].map((r) => (r.type === 'search' ? { ...r, score: 98 } : r));
    const out = arrangeResults(rows, 'git', 'GENERAL_SEARCH');
    expect(out.map((r) => r.text)).toEqual(['4', 'GitHub', 'git', 'Docs', 'Other', 'git status']);
    expect(out.find((r) => r.text === 'GitHub')!.score).toBe(99);
  });

  it('keeps the typed search row on top when nothing is a strong navigational match', () => {
    const out = arrangeResults([legacy(history('Weak', 'https://weak.test/', 40)), { ...searchRow('weak'), score: 98 }], 'weak', 'GENERAL_SEARCH');
    expect(out[0]!.text).toBe('weak');
  });

  it('never mutates its input', () => {
    const h = legacy(history('GitHub', 'https://github.com/', 400));
    arrangeResults([h], 'git', 'GENERAL_SEARCH');
    expect(h.score).toBe(80);
  });

  it('judges a history row by its own score (meta.rawScore), not the rescaled one', () => {
    expect(pickDefault([legacy(history('GitHub', 'https://github.com/', 400))], 'git', 'GENERAL_SEARCH')).not.toBeNull();
    expect(pickDefault([legacy(history('GitHub', 'https://github.com/', 90))], 'git', 'GENERAL_SEARCH')).toBeNull();
  });
});

describe('tierScore / tiered', () => {
  it('maps every provider scale onto 0–100', () => {
    expect(tierScore(history('H', 'https://h.test/', 780))).toBe(80);
    expect(tierScore(history('H', 'https://h.test/', 0))).toBe(50);
    expect(tierScore(bookmark('B', 'https://b.test/', 115))).toBe(90);
    expect(tierScore(tab('T', 'https://t.test/'))).toBe(85);
    expect(tierScore(row({ type: 'url', text: 'u', score: 95 }))).toBe(84);
    expect(tierScore(row({ type: 'search', text: 'q', source: 'bangs', score: 5 }))).toBe(100);
    expect(tierScore(row({ type: 'search', text: 'q', score: 5 }))).toBe(98);
    expect(tierScore(row({ type: 'archive', text: 'a', score: 61 }))).toBe(61);
    expect(tierScore(answerRow)).toBe(100);
  });

  it('caps a provider, rescales its rows, and keeps the original score', async () => {
    const many = Array.from({ length: 10 }, (_, i) => history(`H${i}`, `https://h${i}.test/`, 700 - i));
    const sync = tiered({ name: 'h', getSuggestions: () => many }, 3);
    const rows = sync.getSuggestions('x', 8) as OmniboxResult[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ score: 80, meta: { rawScore: 700 } });

    const asyncRows = await (tiered({ name: 'h', getSuggestions: async () => many }, 2).getSuggestions('x') as Promise<OmniboxResult[]>);
    expect(asyncRows).toHaveLength(2);
    expect(asyncRows[1]).toMatchObject({ score: 80, meta: { rawScore: 699 } });
    expect(many[0]!.score).toBe(700);
  });

  it('asks the wrapped provider for no more than its cap, and passes name and slowness through', () => {
    const spy = vi.fn((_input: string, _max?: number) => [] as OmniboxResult[]);
    const wrapped = tiered({ name: 'n', slow: true, getSuggestions: spy }, 4);
    wrapped.getSuggestions('q', 8);
    wrapped.getSuggestions('q', 2);
    expect(spy.mock.calls.map((c) => c[1])).toEqual([4, 2]);
    expect(wrapped).toMatchObject({ name: 'n', slow: true });
  });
});

describe('OmniboxController', () => {
  async function setup(extra: Partial<OmniboxControllerDeps> = {}) {
    const handlers = new Map<string, Set<(e: never) => void>>();
    const addressBar = {
      on: (kind: string, h: (e: never) => void) => { (handlers.get(kind) ?? handlers.set(kind, new Set()).get(kind)!).add(h); },
      off: (kind: string, h: (e: never) => void) => { handlers.get(kind)?.delete(h); },
      setResults: vi.fn<(r: readonly OmniboxResult[]) => void>(),
    };
    let interceptor!: (value: string, selected: OmniboxResult | null, how: ActivationOptions) => boolean;
    let onResult!: (r: OmniboxResult, how: ActivationOptions) => void;
    let onRowAction!: RowActionHandler;
    const view = {
      setSubmitInterceptor: (i: typeof interceptor) => { interceptor = i; },
      setResultHandler: (h: typeof onResult) => { onResult = h; },
      setRowActionHandler: (h: RowActionHandler) => { onRowAction = h; },
      setQueryBadge: vi.fn<(badge: QueryBadge | null) => void>(),
    };

    const calls: string[] = [];
    const provider = (name: string, rows: OmniboxResult[] | ((q: string) => OmniboxResult[])): OmniboxProvider => ({
      name,
      getSuggestions: (q) => { calls.push(`${name}:${q}`); return typeof rows === 'function' ? rows(q) : rows; },
    });
    const bangs = new BangRegistry();
    const omnibox = new Omnibox({ canonicalDedupe: true });
    omnibox.addProvider(tiered(provider('history-suggestions', [history('GitHub', 'https://github.com/', 400)]), 4));
    omnibox.addProvider(provider('search-suggestions', (q) => [{ ...searchRow(q), score: 98 }]));
    omnibox.addProvider(provider('instant-answers', (q) => (q === '2+2' ? [answerRow] : [])));
    omnibox.addProvider(provider('scope:tabs', (q) => [tab(`Tab about ${q || 'anything'}`, 'https://t.test/', 'tab-9')]));
    omnibox.addProvider(provider('ai-research', (q) => (q ? [row({ type: 'ai', text: `Research ${q}`, action: 'research', meta: { query: q }, score: 100 })] : [])));
    omnibox.addProvider(new BangSuggestionsProvider(bangs));
    omnibox.addProvider(new ScopeHintsProvider());

    const actions = {
      open: vi.fn(), search: vi.fn(), switchTab: vi.fn(), runAction: vi.fn(), research: vi.fn(), copy: vi.fn(), fill: vi.fn(),
      deleteHistory: vi.fn<(id: string) => void | Promise<void>>(),
    };
    const speculative = { consider: vi.fn() };
    const controller = new OmniboxController({
      addressBar: addressBar as never,
      view,
      omnibox,
      bangs,
      actions,
      normalizeUrl: (raw) => (/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`),
      resolveAction: (text) => (text.toLowerCase() === 'open settings' ? 'open-settings' : null),
      scopeProviders: { tabs: ['scope:tabs'], history: ['history-suggestions'], ai: ['ai-research'], research: ['ai-research'] },
      scopeOnlyProviders: ['scope:tabs', 'ai-research', 'scope-hints'],
      actionPhrases: new Set(['open settings']),
      speculative,
      ...extra,
    });
    const flush = () => new Promise<void>((r) => setTimeout(r, 0));
    const type = async (value: string) => {
      for (const h of handlers.get('typing') ?? []) (h as (e: unknown) => void)({ kind: 'typing', value });
      await flush();
    };
    const lastShown = (): readonly OmniboxResult[] => {
      const shown = addressBar.setResults.mock.calls;
      return shown.length > 0 ? shown[shown.length - 1]![0] : [];
    };
    const badge = (): QueryBadge | null | undefined => {
      const calls = view.setQueryBadge.mock.calls;
      return calls[calls.length - 1]?.[0];
    };
    return {
      controller, omnibox, addressBar, actions, speculative, calls, type, flush, lastShown, badge, view,
      interceptor: () => interceptor, onResult: () => onResult, onRowAction: () => onRowAction, handlers,
    };
  }

  describe('routing keystrokes', () => {
    it('sends ordinary text to every provider except scope-only ones', async () => {
      const t = await setup();
      await t.type('github');
      expect(t.calls).toEqual(expect.arrayContaining(['history-suggestions:github', 'search-suggestions:github', 'instant-answers:github']));
      expect(t.calls.some((c) => c.startsWith('scope:tabs') || c.startsWith('ai-research'))).toBe(false);
    });

    it('routes `@tabs foo` to the tabs scope with just the payload', async () => {
      const t = await setup();
      await t.type('@tabs foo');
      expect(t.calls).toEqual(['scope:tabs:foo']);
      expect(t.lastShown().map((r) => r.id)).toEqual(['tab-9']);
    });

    it('lists scope completions while the scope is being typed', async () => {
      const t = await setup();
      await t.type('@ta');
      expect(t.lastShown().map((r) => r.text)).toEqual(['@tabs']);
      await t.type('@');
      expect(t.lastShown().map((r) => r.text)).toEqual(['@tabs', '@history', '@bookmarks', '@archive', '@ai', '@research']);
    });

    it('routes bangs to the bang provider only', async () => {
      const t = await setup();
      await t.type('!g cats');
      expect(t.calls).toEqual([]); // the bang provider is not a spy provider
      expect(t.lastShown().map((r) => [r.text, r.url, r.score])).toEqual([['!g cats', 'https://www.google.com/search?q=cats', 100]]);
      await t.type('!yt');
      expect(t.lastShown()[0]).toMatchObject({ text: '!yt', action: 'fill' });
    });

    it('routes `@ai question` to the research provider', async () => {
      const t = await setup();
      await t.type('@ai how do tides work');
      expect(t.calls).toEqual(['ai-research:how do tides work']);
      expect(t.lastShown()[0]).toMatchObject({ type: 'ai', action: 'research' });
    });

    it('clears the dropdown when the input is emptied', async () => {
      const t = await setup();
      await t.type('github');
      await t.type('   ');
      expect(t.lastShown()).toEqual([]);
    });

    it('shows arranged rows: the instant answer first, then the row Enter will take', async () => {
      const t = await setup();
      await t.type('2+2');
      expect(t.lastShown()[0]).toMatchObject({ type: 'answer' });
      await t.type('git');
      expect(t.lastShown().map((r) => r.text).slice(0, 2)).toEqual(['GitHub', 'git']);
    });

    it('offers the top row to the speculative loader', async () => {
      const t = await setup();
      await t.type('git');
      expect(t.speculative.consider).toHaveBeenCalledWith(expect.objectContaining({ text: 'GitHub', score: 99 }));
    });
  });

  describe('submitting', () => {
    it('ignores empty input', async () => {
      const t = await setup();
      expect(t.interceptor()('   ', null, no)).toBe(false);
      expect(t.actions.search).not.toHaveBeenCalled();
    });

    it('activates the selected row according to its action', async () => {
      const t = await setup();
      const submit = (r: OmniboxResult, how = no) => t.interceptor()('typed', r, how);
      expect(submit(history('H', 'https://h.test/?utm_source=x&id=1', 100))).toBe(true);
      expect(t.actions.open).toHaveBeenLastCalledWith('https://h.test/?id=1', no); // tracker stripped
      submit(searchRow('cats'), { newTab: true });
      expect(t.actions.open).toHaveBeenLastCalledWith('nova://search?q=cats', { newTab: true });
      submit(row({ type: 'history', text: 'no-url', action: 'navigate' }));
      expect(t.actions.open).toHaveBeenLastCalledWith('no-url', no);
      submit(tab('T', 'https://t.test/', 'tab-3'));
      expect(t.actions.switchTab).toHaveBeenCalledWith('tab-3');
      submit(row({ type: 'tab', text: 'T', url: 'https://t.test/', action: 'switch-tab' }));
      expect(t.actions.open).toHaveBeenLastCalledWith('https://t.test/', no); // no id → open instead
      submit(row({ type: 'action', id: 'open-settings', text: 'Open settings', action: 'run-action' }));
      expect(t.actions.runAction).toHaveBeenCalledWith('open-settings');
      submit(row({ type: 'ai', text: 'Research x', action: 'research', meta: { query: 'the query' } }));
      expect(t.actions.research).toHaveBeenCalledWith('the query');
      submit(answerRow);
      expect(t.actions.copy).toHaveBeenCalledWith('4');
      submit(row({ type: 'engine', text: '!g', action: 'fill' }));
      expect(t.actions.fill).toHaveBeenCalledWith('!g ');
    });

    it('opens the strong default (a frecent page) for plain text typed just before Enter', async () => {
      const t = await setup();
      await t.type('git');
      t.interceptor()('git', null, no);
      expect(t.actions.open).toHaveBeenCalledWith('https://github.com/', no);
      expect(t.actions.search).not.toHaveBeenCalled();
    });

    it('searches when there is no strong default, or the results are for older text', async () => {
      const t = await setup();
      await t.type('git');
      t.interceptor()('something else', null, no);
      expect(t.actions.search).toHaveBeenLastCalledWith('something else', no);
      const u = await setup();
      u.interceptor()('git', null, { newTab: true }); // Enter before any results exist
      expect(u.actions.search).toHaveBeenCalledWith('git', { newTab: true });
    });

    it('treats calculations as searches', async () => {
      const t = await setup();
      t.interceptor()('2+2', null, no);
      expect(t.actions.search).toHaveBeenCalledWith('2+2', no);
    });

    it('opens direct URLs normalised and stripped of trackers, unless stripping is off', async () => {
      const t = await setup();
      t.interceptor()('example.com/page?utm_source=n&id=1&fbclid=z', null, no);
      expect(t.actions.open).toHaveBeenLastCalledWith('https://example.com/page?id=1', no);
      const off = await setup({ stripTracking: () => false });
      off.interceptor()('example.com/?utm_source=n', null, no);
      expect(off.actions.open).toHaveBeenLastCalledWith('https://example.com/?utm_source=n', no);
    });

    it('resolves bangs: with a query, bare, and unknown', async () => {
      const t = await setup();
      t.interceptor()('!g quantum computing', null, no);
      expect(t.actions.open).toHaveBeenLastCalledWith('https://www.google.com/search?q=quantum%20computing', no);
      t.interceptor()('react docs !gh', null, no);
      expect(t.actions.open).toHaveBeenLastCalledWith('https://github.com/search?q=react%20docs', no);
      t.interceptor()('!yt', null, no);
      expect(t.actions.open).toHaveBeenLastCalledWith('https://www.youtube.com/', no);
      t.interceptor()('!nonsense foo', null, no);
      expect(t.actions.search).toHaveBeenLastCalledWith('!nonsense foo', no);
    });

    it('runs exact browser commands, otherwise searches', async () => {
      const t = await setup();
      t.interceptor()('Open  settings', null, no);
      expect(t.actions.runAction).toHaveBeenCalledWith('open-settings');
      const u = await setup({ resolveAction: () => null });
      u.interceptor()('open settings', null, no);
      expect(u.actions.search).toHaveBeenCalledWith('open settings', no);
    });

    it('starts research for @ai / @research, and ignores a bare scope', async () => {
      const t = await setup();
      t.interceptor()('@ai how do tides work', null, no);
      expect(t.actions.research).toHaveBeenLastCalledWith('how do tides work');
      t.interceptor()('@research x', null, no);
      expect(t.actions.research).toHaveBeenLastCalledWith('x');
      t.actions.research.mockClear();
      expect(t.interceptor()('@ai', null, no)).toBe(true);
      expect(t.interceptor()('@ta', null, no)).toBe(true);
      expect(t.actions.research).not.toHaveBeenCalled();
      expect(t.actions.search).not.toHaveBeenCalled();
    });

    it('activates the top result of a scoped search', async () => {
      const t = await setup();
      t.interceptor()('@tabs settings', null, no);
      await t.flush();
      expect(t.actions.switchTab).toHaveBeenCalledWith('tab-9');
    });

    it('routes the result handler (mouse clicks) through the same activation', async () => {
      const t = await setup();
      t.onResult()(tab('T', 'https://t.test/', 'tab-5'), no);
      expect(t.actions.switchTab).toHaveBeenCalledWith('tab-5');
    });
  });

  describe('query-type badge', () => {
    it.each([
      ['hello world', { kind: 'search', text: '🔍' }],
      ['example.com', { kind: 'url', text: '🌐' }],
      ['!g cats', { kind: 'bang', text: '!g', title: 'Search Google' }],
      ['!yt', { kind: 'bang', text: '!yt', title: 'Search YouTube' }],
      ['@tabs foo', { kind: 'scope', text: '@tabs' }],
      ['@history', { kind: 'scope', text: '@history' }],
      ['@ai how do tides work', { kind: 'ai', text: '✨' }],
      ['@research tides', { kind: 'ai', text: '✨' }],
      ['open settings', { kind: 'command', text: '⚡' }],
      ['2+2', { kind: 'calc', text: '🧮' }],
    ])('badges "%s" as %j', async (text, expected) => {
      const t = await setup();
      await t.type(text);
      expect(t.badge()).toMatchObject(expected);
    });

    it('has no badge for empty input or while an @scope is still being typed', async () => {
      const t = await setup();
      await t.type('@ta');
      expect(t.badge()).toBeNull();
      await t.type('@');
      expect(t.badge()).toBeNull();
      await t.type('hello');
      expect(t.badge()).not.toBeNull();
      await t.type('   ');
      expect(t.badge()).toBeNull();
    });

    it('still badges a bang whose keyword is unknown to the registry as an ordinary search', async () => {
      const t = await setup();
      await t.type('!nosuchbang cats');
      expect(t.badge()).toMatchObject({ kind: 'search' });
    });

    it('is cleared when the text is submitted or a row is chosen', async () => {
      const t = await setup();
      await t.type('hello');
      expect(t.badge()).not.toBeNull();
      t.interceptor()('hello', null, no);
      expect(t.badge()).toBeNull();

      await t.type('hello');
      expect(t.badge()).not.toBeNull();
      t.onResult()(tab('T', 'https://t.test/', 'tab-5'), no);
      expect(t.badge()).toBeNull();
    });

    it('does not fail when the view has no badge (older view ports)', async () => {
      const t = await setup();
      delete (t.view as { setQueryBadge?: unknown }).setQueryBadge;
      await t.type('hello');
      expect(t.lastShown().length).toBeGreaterThan(0);
    });
  });

  describe('row actions (copy link, remove from history)', () => {
    const gh = row({ type: 'history', text: 'GitHub', url: 'https://github.com/', meta: { historyId: 'h1' } });

    it('copies the row\'s link', async () => {
      const t = await setup();
      t.onRowAction()('copy', gh);
      expect(t.actions.copy).toHaveBeenCalledWith('https://github.com/');
      t.onRowAction()('copy', row({ type: 'history', text: 'no url' }));
      expect(t.actions.copy).toHaveBeenCalledTimes(1);
    });

    it('removes the entry, and only then runs the query again so the row is gone', async () => {
      const t = await setup();
      let finish!: () => void;
      t.actions.deleteHistory.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
      await t.type('git');
      t.calls.length = 0;

      t.onRowAction()('delete', gh);
      await t.flush();
      expect(t.actions.deleteHistory).toHaveBeenCalledWith('h1');
      expect(t.calls).toEqual([]); // not before the removal has finished
      finish();
      await t.flush();
      expect(t.calls).toContain('history-suggestions:git');
    });

    it('refreshes even if the removal throws, and ignores a row that has no history id', async () => {
      const t = await setup();
      t.actions.deleteHistory.mockRejectedValueOnce(new Error('storage offline'));
      await t.type('git');
      t.calls.length = 0;
      t.onRowAction()('delete', gh);
      await t.flush();
      expect(t.calls).toContain('history-suggestions:git');

      t.actions.deleteHistory.mockClear();
      t.onRowAction()('delete', row({ type: 'history', text: 'GitLab', url: 'https://gitlab.com/' }));
      await t.flush();
      expect(t.actions.deleteHistory).not.toHaveBeenCalled();
    });

    it('does not re-open the dropdown when the text was submitted while the removal was running', async () => {
      const t = await setup();
      let finish!: () => void;
      t.actions.deleteHistory.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
      await t.type('git');
      t.onRowAction()('delete', gh);
      t.interceptor()('git', null, no);
      const shown = t.addressBar.setResults.mock.calls.length;
      finish();
      await t.flush();
      expect(t.addressBar.setResults.mock.calls.length).toBe(shown);
    });
  });

  it('drops provider results that arrive after a submission, until the next keystroke', async () => {
    const t = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    t.omnibox.addProvider({
      name: 'slow-network', slow: true,
      getSuggestions: async () => { await gate; return [row({ type: 'suggestion', text: 'late', action: 'search' })]; },
    });
    await t.type('hello');
    const before = t.addressBar.setResults.mock.calls.length;
    t.interceptor()('hello', null, no);
    release();
    await t.flush();
    expect(t.addressBar.setResults.mock.calls.length).toBe(before); // the late rows never reach the dropdown
    await t.type('hello again');
    expect(t.addressBar.setResults.mock.calls.length).toBeGreaterThan(before);
  });

  it('stops listening after dispose', async () => {
    const t = await setup();
    t.controller.dispose();
    await t.type('git');
    expect(t.addressBar.setResults).not.toHaveBeenCalled();
    expect(t.handlers.get('typing')!.size).toBe(0);
  });
});
